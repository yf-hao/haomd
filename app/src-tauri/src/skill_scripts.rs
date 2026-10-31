use crate::skill_http::{execute_http_request_json, SkillHttpSession};
use crate::skills::{read_skill_document_from_dir, sanitize_skill_id, skills_root_dir};
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use rquickjs::prelude::Func;
use rquickjs::{Context, Runtime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{atomic::AtomicUsize, Arc};
use std::time::{Duration, Instant};
use tauri::AppHandle;

const SKILL_SCRIPT_TIMEOUT: Duration = Duration::from_secs(60);
const SKILL_SCRIPT_MEMORY_LIMIT: usize = 32 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunSkillScriptRequest {
    pub skill_id: String,
    pub script_id: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillRunResultCfg {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

fn execute_builtin_js(script_source: &str, args: &Value) -> Result<SkillRunResultCfg, String> {
    let args_json = serde_json::to_string(args).map_err(|e| format!("序列化脚本参数失败: {e}"))?;
    let args_json_literal =
        serde_json::to_string(&args_json).map_err(|e| format!("构造脚本参数字面量失败: {e}"))?;
    let program = format!(
        "globalThis.http = Object.freeze({{ request(options) {{ const result = JSON.parse(__haomdHttpRequest(JSON.stringify(options))); if (result.error) throw new Error(result.error); return result.response; }} }});\n{script_source}\nJSON.stringify(run(JSON.parse({args_json_literal})));"
    );

    let rt = Runtime::new().map_err(|e| format!("创建 JS 运行时失败: {e}"))?;
    let deadline = Instant::now() + SKILL_SCRIPT_TIMEOUT;
    rt.set_memory_limit(SKILL_SCRIPT_MEMORY_LIMIT);
    rt.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));
    let context = Context::full(&rt).map_err(|e| format!("创建 JS 上下文失败: {e}"))?;
    let http_session = SkillHttpSession::default();
    let request_count = Arc::new(AtomicUsize::new(0));

    let result_text: String = context.with(|ctx| {
        let http_request_count = request_count.clone();
        let http_request = Func::from(move |request_json: String| {
            execute_http_request_json(&http_session, &request_json, &http_request_count, deadline)
        });
        ctx.globals()
            .set("__haomdHttpRequest", http_request)
            .map_err(|e| format!("注册 Skill HTTP API 失败: {e}"))?;
        ctx.eval(program)
            .map_err(|e| format!("执行 JS Skill 失败: {e}"))
    })?;

    serde_json::from_str::<SkillRunResultCfg>(&result_text)
        .map_err(|e| format!("解析 JS Skill 返回值失败: {e}"))
}

#[tauri::command]
pub async fn run_skill_script(
    app: AppHandle,
    request: RunSkillScriptRequest,
) -> ResultPayload<SkillRunResultCfg> {
    let trace = new_trace_id();
    let root = match skills_root_dir(&app) {
        Ok(root) => root,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("获取 Skills 目录失败: {err}"),
                trace,
            )
        }
    };
    let skill_dir = root.join(sanitize_skill_id(&request.skill_id));
    let skill = match read_skill_document_from_dir(&skill_dir).await {
        Ok(skill) => skill,
        Err(err) => return err_payload(ErrorCode::NotFound, err, trace),
    };
    if !skill.enabled {
        return err_payload(
            ErrorCode::UNSUPPORTED,
            "Skill 未启用，拒绝执行脚本".to_string(),
            trace,
        );
    }
    let script = match skill
        .scripts
        .into_iter()
        .find(|script| script.id == request.script_id)
    {
        Some(script) => script,
        None => {
            return err_payload(
                ErrorCode::NotFound,
                format!("未找到脚本: {}", request.script_id),
                trace,
            )
        }
    };
    if script.approval_policy == "manual_only" {
        return err_payload(
            ErrorCode::UNSUPPORTED,
            "该脚本仅允许手动执行，拒绝自动执行".to_string(),
            trace,
        );
    }

    let script_runtime = script.runtime.trim().to_string();
    let script_content = script.content;
    let mut script_args = request.args;
    let needs_cnki_cookie = skill.id == "cnki-reference-search"
        && matches!(script.id.as_str(), "search" | "export-reference");
    let cookie_path = skill_dir.join("cookie.txt");
    if needs_cnki_cookie {
        match tokio::fs::symlink_metadata(&cookie_path).await {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return err_payload(
                    ErrorCode::UNSUPPORTED,
                    "Skill 的 cookie.txt 必须是普通文件".to_string(),
                    trace,
                );
            }
            Ok(metadata) if metadata.len() > 8192 => {
                return err_payload(
                    ErrorCode::UNSUPPORTED,
                    "Skill 的 cookie.txt 超过 8 KiB 限制".to_string(),
                    trace,
                );
            }
            Ok(_) => {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Err(error) = tokio::fs::set_permissions(
                        &cookie_path,
                        std::fs::Permissions::from_mode(0o600),
                    )
                    .await
                    {
                        return err_payload(
                            ErrorCode::IoError,
                            format!("设置 Skill 的 cookie.txt 文件权限失败: {error}"),
                            trace,
                        );
                    }
                }
                match tokio::fs::read_to_string(&cookie_path).await {
                    Ok(cookie) => {
                        let cookie = cookie.trim().to_string();
                        if cookie.contains('\r') || cookie.contains('\n') {
                            return err_payload(
                                ErrorCode::UNSUPPORTED,
                                "Skill 的 cookie.txt 只能包含一行 Cookie 请求头值".to_string(),
                                trace,
                            );
                        }
                        if let Value::Object(args) = &mut script_args {
                            args.insert("cookie".to_string(), Value::String(cookie));
                        } else {
                            return err_payload(
                                ErrorCode::UNSUPPORTED,
                                "Skill 脚本参数必须是 JSON 对象".to_string(),
                                trace,
                            );
                        }
                    }
                    Err(error) => {
                        return err_payload(
                            ErrorCode::IoError,
                            format!("读取 Skill 的 cookie.txt 失败: {error}"),
                            trace,
                        );
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return err_payload(
                    ErrorCode::IoError,
                    format!("读取 Skill 的 cookie.txt 信息失败: {error}"),
                    trace,
                );
            }
        }
    }
    let result = match script_runtime.as_str() {
        "builtin-js" => {
            tokio::task::spawn_blocking(move || execute_builtin_js(&script_content, &script_args))
                .await
                .map_err(|error| format!("Skill 脚本执行任务失败: {error}"))
                .and_then(|result| result)
        }
        other => Err(format!("当前仅支持 builtin-js，收到 runtime: {other}")),
    };

    match result {
        Ok(result) => ok(result, trace),
        Err(err) => err_payload(ErrorCode::UNSUPPORTED, err, trace),
    }
}

#[cfg(test)]
mod tests {
    use super::execute_builtin_js;
    use serde_json::json;

    #[test]
    #[ignore = "Requires access to the public Crossref API"]
    fn crossref_script_live_smoke() {
        let result = execute_builtin_js(
            include_str!("../../../examples/skills/crossref-reference-search/scripts/search.js"),
            &json!({ "queries": ["university student academic support platform"], "rows": 1 }),
        )
        .expect("Crossref script should execute in the actual Skill runtime");
        assert!(result.ok, "{} {}", result.stderr, result.stdout);
        let output: serde_json::Value = serde_json::from_str(&result.stdout).unwrap();
        assert_eq!(output["searches"].as_array().unwrap().len(), 1);
    }

    #[test]
    #[ignore = "Requires access to the public web through the configured system proxy"]
    fn builtin_http_request_uses_system_proxy_for_arbitrary_sites() {
        let result = execute_builtin_js(
            "function run() { const response = http.request({ url: 'http://www.baidu.com/' }); return { ok: response.status === 200, stdout: String(response.status), stderr: '', exitCode: 0 }; }",
            &json!({}),
        )
        .expect("HTTP Skill script should execute");

        assert!(result.ok, "{}", result.stderr);
        assert_eq!(result.stdout, "200");
    }

    #[test]
    fn builtin_js_exposes_http_request_api() {
        let result = execute_builtin_js(
            "function run() { try { http.request({ url: 'file:///etc/passwd' }); } catch (error) { return { ok: true, stdout: error.message, stderr: '', exitCode: 0 }; } return { ok: false, stdout: '', stderr: 'request unexpectedly succeeded', exitCode: 1 }; }",
            &json!({}),
        )
        .expect("skill script should execute");

        assert!(result.ok);
        assert!(result.stdout.contains("HTTP/HTTPS"));
    }
}
