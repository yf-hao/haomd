use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::time::{sleep, Duration};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelScopeImageGenerationRequest {
    pub api_key: String,
    pub base_url: String,
    pub model_id: String,
    pub prompt: String,
    #[serde(default)]
    pub aspect_ratio: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelScopeImageGenerationResult {
    pub task_id: String,
    pub image_url: String,
    pub raw: Value,
}

fn trim_trailing_slash(input: &str) -> &str {
    input.trim_end_matches('/')
}

fn build_images_generation_url(base_url: &str) -> String {
    let trimmed = trim_trailing_slash(base_url);
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/images/generations")
    } else {
        format!("{trimmed}/v1/images/generations")
    }
}

fn build_task_status_url(base_url: &str, task_id: &str) -> String {
    let trimmed = trim_trailing_slash(base_url);
    if trimmed.ends_with("/v1") {
        format!("{trimmed}/tasks/{task_id}")
    } else {
        format!("{trimmed}/v1/tasks/{task_id}")
    }
}

fn parse_task_id(payload: &Value) -> Option<String> {
    payload
        .get("task_id")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn parse_output_image(payload: &Value) -> Option<String> {
    payload
        .get("output_images")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn response_message(prefix: &str, status: reqwest::StatusCode, body: &str) -> String {
    if body.trim().is_empty() {
        format!("{prefix}: HTTP {}", status.as_u16())
    } else {
        format!("{prefix}: HTTP {} - {}", status.as_u16(), body.trim())
    }
}

fn resolve_size_from_aspect_ratio(value: &str) -> Option<&'static str> {
    match value.trim() {
        "1:1" => Some("1024x1024"),
        "4:3" => Some("1280x960"),
        "3:4" => Some("960x1280"),
        "16:9" => Some("1600x900"),
        "9:16" => Some("900x1600"),
        _ => None,
    }
}

#[tauri::command]
pub async fn run_modelscope_image_generation(
    _app: AppHandle,
    req: ModelScopeImageGenerationRequest,
) -> ResultPayload<ModelScopeImageGenerationResult> {
    let trace_id = new_trace_id();

    if req.api_key.trim().is_empty() {
        return err_payload(ErrorCode::InvalidPath, "缺少图片生成 API Key", trace_id);
    }
    if req.base_url.trim().is_empty() {
        return err_payload(ErrorCode::InvalidPath, "缺少图片生成 Base URL", trace_id);
    }
    if req.model_id.trim().is_empty() {
        return err_payload(ErrorCode::InvalidPath, "缺少图片生成模型 ID", trace_id);
    }
    if req.prompt.trim().is_empty() {
        return err_payload(ErrorCode::InvalidPath, "请输入图片生成提示词", trace_id);
    }

    let mut common_headers = HeaderMap::new();
    let auth_value = match HeaderValue::from_str(&format!("Bearer {}", req.api_key.trim())) {
        Ok(value) => value,
        Err(err) => {
            return err_payload(
                ErrorCode::UNKNOWN,
                format!("构造认证请求头失败: {err}"),
                trace_id,
            )
        }
    };
    common_headers.insert(AUTHORIZATION, auth_value);
    common_headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    let client = match Client::builder().build() {
        Ok(client) => client,
        Err(err) => {
            return err_payload(
                ErrorCode::UNKNOWN,
                format!("初始化图片生成客户端失败: {err}"),
                trace_id,
            )
        }
    };

    let submit_url = build_images_generation_url(&req.base_url);
    let mut submit_payload = json!({
        "model": req.model_id,
        "prompt": req.prompt,
    });
    if let Some(size) = req
        .aspect_ratio
        .as_deref()
        .and_then(resolve_size_from_aspect_ratio)
    {
        submit_payload["size"] = json!(size);
    }

    let submit_response = match client
        .post(&submit_url)
        .headers(common_headers.clone())
        .header("X-ModelScope-Async-Mode", "true")
        .json(&submit_payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => {
            return err_payload(
                ErrorCode::IoError,
                format!("提交图片生成任务失败: {err}"),
                trace_id,
            )
        }
    };

    if !submit_response.status().is_success() {
        let status = submit_response.status();
        let body = submit_response.text().await.unwrap_or_default();
        return err_payload(
            ErrorCode::UNKNOWN,
            response_message("提交图片生成任务失败", status, &body),
            trace_id,
        );
    }

    let submit_json = match submit_response.json::<Value>().await {
        Ok(value) => value,
        Err(err) => {
            return err_payload(
                ErrorCode::UNKNOWN,
                format!("解析图片生成任务响应失败: {err}"),
                trace_id,
            )
        }
    };

    let task_id = match parse_task_id(&submit_json) {
        Some(task_id) => task_id,
        None => {
            return err_payload(
                ErrorCode::UNKNOWN,
                format!("图片生成任务响应缺少 task_id: {}", submit_json),
                trace_id,
            )
        }
    };

    let task_url = build_task_status_url(&req.base_url, &task_id);
    let max_poll_attempts = 45usize;

    for _ in 0..max_poll_attempts {
        let task_response = match client
            .get(&task_url)
            .headers(common_headers.clone())
            .header("X-ModelScope-Task-Type", "image_generation")
            .send()
            .await
        {
            Ok(response) => response,
            Err(err) => {
                return err_payload(
                    ErrorCode::IoError,
                    format!("轮询图片生成任务失败: {err}"),
                    trace_id,
                )
            }
        };

        if !task_response.status().is_success() {
            let status = task_response.status();
            let body = task_response.text().await.unwrap_or_default();
            return err_payload(
                ErrorCode::UNKNOWN,
                response_message("读取图片生成任务状态失败", status, &body),
                trace_id,
            );
        }

        let task_json = match task_response.json::<Value>().await {
            Ok(value) => value,
            Err(err) => {
                return err_payload(
                    ErrorCode::UNKNOWN,
                    format!("解析图片生成任务状态失败: {err}"),
                    trace_id,
                )
            }
        };

        let status = task_json
            .get("task_status")
            .and_then(Value::as_str)
            .unwrap_or_default();

        match status {
            "SUCCEED" => {
                let image_url = match parse_output_image(&task_json) {
                    Some(url) => url,
                    None => {
                        return err_payload(
                            ErrorCode::UNKNOWN,
                            format!("图片生成任务成功但未返回图片地址: {}", task_json),
                            trace_id,
                        )
                    }
                };
                return ok(
                    ModelScopeImageGenerationResult {
                        task_id,
                        image_url,
                        raw: task_json,
                    },
                    trace_id,
                );
            }
            "FAILED" => {
                let message = task_json
                    .get("message")
                    .and_then(Value::as_str)
                    .or_else(|| task_json.get("error").and_then(Value::as_str))
                    .unwrap_or("图片生成任务失败");
                return err_payload(ErrorCode::UNKNOWN, message, trace_id);
            }
            _ => {
                sleep(Duration::from_secs(2)).await;
            }
        }
    }

    err_payload(ErrorCode::UNKNOWN, "图片生成超时，请稍后重试", trace_id)
}
