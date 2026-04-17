use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeminiCompatMessageInput {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeminiGenerateContentRequest {
    pub api_key: String,
    pub base_url: String,
    pub model_id: String,
    #[serde(default)]
    pub system_prompt: Option<String>,
    pub messages: Vec<GeminiCompatMessageInput>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeminiGenerateContentResponse {
    pub content: String,
}

fn build_gemini_generate_content_url(base_url: &str, model_id: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/v1beta") {
        format!("{trimmed}/models/{model_id}:generateContent")
    } else {
        format!("{trimmed}/v1beta/models/{model_id}:generateContent")
    }
}

fn build_prefixed_text(system_prompt: Option<&str>, content: &str) -> String {
    let trimmed_content = content.trim();
    let trimmed_prompt = system_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty());

    match trimmed_prompt {
        Some(prompt) if !trimmed_content.is_empty() => {
            format!("系统要求：\n{prompt}\n\n用户输入：\n{trimmed_content}")
        }
        Some(prompt) => format!("系统要求：\n{prompt}"),
        None => trimmed_content.to_string(),
    }
}

fn build_contents(request: &GeminiGenerateContentRequest) -> Vec<Value> {
    let mut contents = Vec::new();

    for (index, message) in request.messages.iter().enumerate() {
        let text = if index == 0 {
            build_prefixed_text(request.system_prompt.as_deref(), &message.content)
        } else {
            message.content.trim().to_string()
        };

        let role = match message.role.as_str() {
            "assistant" => "model",
            _ => "user",
        };

        contents.push(json!({
            "role": role,
            "parts": [{ "text": text }]
        }));
    }

    if contents.is_empty() {
        let fallback = build_prefixed_text(request.system_prompt.as_deref(), "");
        contents.push(json!({
            "role": "user",
            "parts": [{ "text": fallback }]
        }));
    }

    contents
}

fn extract_gemini_response_text(json: &Value) -> String {
    if let Some(candidate) = json
        .get("candidates")
        .and_then(|value| value.as_array())
        .and_then(|value| value.first())
    {
        if let Some(parts) = candidate
            .get("content")
            .and_then(|value| value.get("parts"))
            .and_then(|value| value.as_array())
        {
            let text = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(|value| value.as_str()))
                .collect::<Vec<_>>()
                .join("");
            if !text.trim().is_empty() {
                return text;
            }
        }
    }

    String::new()
}

fn extract_gemini_error_message(status: u16, response_text: &str) -> String {
    if let Ok(json) = serde_json::from_str::<Value>(response_text) {
        if let Some(message) = json
            .get("error")
            .and_then(|value| value.get("message"))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return format!("Gemini API error ({status}): {message}");
        }
    }

    format!("Gemini API error ({status}): {response_text}")
}

#[tauri::command]
pub async fn gemini_generate_content(
    request: GeminiGenerateContentRequest,
) -> Result<GeminiGenerateContentResponse, String> {
    let client = Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|err| format!("创建 Gemini HTTP 客户端失败: {err}"))?;

    let url = build_gemini_generate_content_url(&request.base_url, &request.model_id);
    let response = client
        .post(url)
        .header("x-goog-api-key", request.api_key.trim())
        .header("Content-Type", "application/json")
        .json(&json!({
            "contents": build_contents(&request)
        }))
        .send()
        .await
        .map_err(|err| format!("Gemini 请求失败: {err}"))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let response_text = response.text().await.unwrap_or_default();
        return Err(extract_gemini_error_message(status, &response_text));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|err| format!("解析 Gemini 响应失败: {err}"))?;
    let content = extract_gemini_response_text(&json);

    if content.trim().is_empty() {
        return Err(format!("Gemini 响应中缺少可解析文本: {}", json));
    }

    Ok(GeminiGenerateContentResponse { content })
}
