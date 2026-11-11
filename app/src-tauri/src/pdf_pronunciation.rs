fn speech_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("AI Provider 未配置 Base URL".to_string());
    }
    let last_segment = trimmed.rsplit('/').next().unwrap_or_default();
    let has_api_version = last_segment.strip_prefix('v').is_some_and(|version| {
        !version.is_empty() && version.chars().all(|value| value.is_ascii_digit())
    });
    let suffix = if has_api_version || last_segment == "beta" {
        "/audio/speech"
    } else {
        "/v1/audio/speech"
    };
    Ok(format!("{trimmed}{suffix}"))
}

#[tauri::command]
pub(crate) async fn synthesize_pdf_pronunciation(
    base_url: String,
    api_key: String,
    text: String,
) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("没有可朗读的文本".to_string());
    }
    if text.chars().count() > 4096 {
        return Err("朗读文本过长".to_string());
    }
    if api_key.trim().is_empty() {
        return Err("AI Provider 未配置 API Key".to_string());
    }

    let response = reqwest::Client::new()
        .post(speech_url(&base_url)?)
        .bearer_auth(api_key.trim())
        .json(&serde_json::json!({
            "model": "tts-1",
            "voice": "alloy",
            "input": text,
            "response_format": "mp3"
        }))
        .send()
        .await
        .map_err(|error| format!("AI 语音请求失败：{error}"))?;

    if !response.status().is_success() {
        return Err(format!("AI 语音服务返回 HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > 10 * 1024 * 1024)
    {
        return Err("AI 语音文件超过 10 MB".to_string());
    }
    let audio = response
        .bytes()
        .await
        .map_err(|error| format!("读取 AI 语音失败：{error}"))?;
    if audio.is_empty() {
        return Err("AI 语音服务返回了空音频".to_string());
    }
    if audio.len() > 10 * 1024 * 1024 {
        return Err("AI 语音文件超过 10 MB".to_string());
    }

    Ok(format!("data:audio/mpeg;base64,{}", base64::encode(audio)))
}
