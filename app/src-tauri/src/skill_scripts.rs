use crate::skills::{read_skill_document_from_dir, sanitize_skill_id, skills_root_dir};
use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use quick_js::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

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
    let program = format!("{script_source}\nJSON.stringify(run(JSON.parse({args_json_literal})));");

    let context = Context::new().map_err(|e| format!("创建 JS 运行时失败: {e}"))?;
    let result_text: String = context
        .eval_as(program.as_str())
        .map_err(|e| format!("执行 JS Skill 失败: {e}"))?;

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

    let result = match script.runtime.trim() {
        "builtin-js" => execute_builtin_js(&script.content, &request.args),
        other => Err(format!("当前仅支持 builtin-js，收到 runtime: {other}")),
    };

    match result {
        Ok(result) => ok(result, trace),
        Err(err) => err_payload(ErrorCode::UNSUPPORTED, err, trace),
    }
}
