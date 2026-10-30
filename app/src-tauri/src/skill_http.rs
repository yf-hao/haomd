use reqwest::blocking::{Client, ClientBuilder, Response};
use reqwest::cookie::{CookieStore, Jar};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, CONTENT_LENGTH, COOKIE, HOST, SET_COOKIE,
};
use reqwest::Method;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
use std::process::Command;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, OnceLock,
};
use std::time::{Duration, Instant};
use url::{Host, Url};

const MAX_REQUESTS_PER_SCRIPT: usize = 24;
const MAX_REQUEST_BODY_BYTES: usize = 1_048_576;
const MAX_RESPONSE_BODY_BYTES: usize = 2_097_152;
const MAX_HEADER_BYTES: usize = 32_768;
const MAX_HEADER_VALUE_BYTES: usize = 8_192;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpRequestInput {
    url: String,
    #[serde(default = "default_method")]
    method: String,
    #[serde(default)]
    headers: Map<String, Value>,
    body: Option<Value>,
    form: Option<Map<String, Value>>,
}

struct ParsedHttpRequest {
    url: Url,
    method: Method,
    headers: HeaderMap,
    body: Option<Vec<u8>>,
}

fn default_method() -> String {
    "GET".to_string()
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && (18..=19).contains(&b))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => {
            if let Some(mapped) = ip.to_ipv4_mapped() {
                return is_public_ipv4(mapped);
            }
            let segments = ip.segments();
            !(ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || segments[0] & 0xfe00 == 0xfc00
                || segments[0] & 0xffc0 == 0xfe80
                || (segments[0] == 0x2001 && segments[1] == 0x0db8))
        }
    }
}

fn is_external_dns_name(host: &str) -> bool {
    let host = host.trim_end_matches('.');
    host.contains('.')
        && !host.eq_ignore_ascii_case("localhost")
        && !host.ends_with(".localhost")
        && !host.ends_with(".local")
        && !host.ends_with(".internal")
}

fn normalize_proxy_url(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let value = if value.contains("://") {
        value.to_string()
    } else {
        format!("http://{value}")
    };
    let parsed = Url::parse(&value).ok()?;
    matches!(
        parsed.scheme(),
        "http" | "https" | "socks4" | "socks4a" | "socks5" | "socks5h"
    )
    .then_some(value)
}

fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // Background proxy discovery must not open a console in the GUI app.
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "windows")]
fn setting_value<'a>(settings: &'a str, key: &str) -> Option<&'a str> {
    settings.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        (fields.next()? == key).then(|| fields.last()).flatten()
    })
}

#[cfg(any(target_os = "windows", test))]
fn proxy_server_for_scheme(value: &str, scheme: &str) -> Option<String> {
    let mut default = None;
    for entry in value
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
    {
        if let Some((name, address)) = entry.split_once('=') {
            if name.trim().eq_ignore_ascii_case(scheme) {
                return normalize_proxy_url(address);
            }
        } else {
            default = normalize_proxy_url(entry);
        }
    }
    default
}

fn is_proxy_bypassed(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .ok()
        .is_some_and(|list| {
            list.split(',').map(str::trim).any(|entry| {
                if entry == "*" {
                    return true;
                }
                let entry = entry
                    .strip_prefix("http://")
                    .or_else(|| entry.strip_prefix("https://"))
                    .unwrap_or(entry)
                    .split('/')
                    .next()
                    .unwrap_or("")
                    .trim_start_matches('.')
                    .to_ascii_lowercase();
                let entry = if entry.matches(':').count() == 1 {
                    entry
                        .rsplit_once(':')
                        .map_or(entry.as_str(), |(hostname, _)| hostname)
                } else {
                    entry.as_str()
                };
                !entry.is_empty() && (host == entry || host.ends_with(&format!(".{entry}")))
            })
        })
}

fn configured_proxy_url(scheme: &str, host: &str) -> Option<String> {
    if is_proxy_bypassed(host) {
        return None;
    }
    let env_keys = if scheme == "https" {
        ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
    } else {
        ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
    };
    for key in env_keys {
        if let Ok(value) = std::env::var(key) {
            if let Some(proxy) = normalize_proxy_url(&value) {
                return Some(proxy);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(settings) = command_output("/usr/sbin/scutil", &["--proxy"]) {
            let preferred = if scheme == "https" {
                ["HTTPS", "HTTP"]
            } else {
                ["HTTP", "HTTPS"]
            };
            for name in preferred {
                let enabled = settings
                    .lines()
                    .any(|line| line.trim() == format!("{name}Enable : 1"));
                if !enabled {
                    continue;
                }
                let Some(host) = settings
                    .lines()
                    .find_map(|line| line.trim().strip_prefix(&format!("{name}Proxy : ")))
                else {
                    continue;
                };
                let Some(port) = settings
                    .lines()
                    .find_map(|line| line.trim().strip_prefix(&format!("{name}Port : ")))
                else {
                    continue;
                };
                let host = host.trim();
                let port = port.trim();
                if !host.is_empty() && port.parse::<u16>().is_ok() {
                    return normalize_proxy_url(&format!("http://{host}:{port}"));
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let settings = command_output(
            "reg.exe",
            &[
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                "ProxyEnable",
            ],
        );
        if settings
            .as_deref()
            .and_then(|settings| setting_value(settings, "ProxyEnable"))
            .is_some_and(|value| value.eq_ignore_ascii_case("0x1"))
        {
            if let Some(proxy_server) = command_output(
                "reg.exe",
                &[
                    "query",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                    "/v",
                    "ProxyServer",
                ],
            )
            .as_deref()
            .and_then(|settings| setting_value(settings, "ProxyServer"))
            {
                if let Some(proxy) = proxy_server_for_scheme(proxy_server, scheme) {
                    return Some(proxy);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if command_output("gsettings", &["get", "org.gnome.system.proxy", "mode"])
            .is_some_and(|mode| mode.trim().trim_matches('\'') == "manual")
        {
            let same_proxy = command_output(
                "gsettings",
                &["get", "org.gnome.system.proxy", "use-same-proxy"],
            )
            .is_some_and(|value| value.trim() == "true");
            let protocol = if same_proxy {
                "http"
            } else if scheme == "https" {
                "https"
            } else {
                "http"
            };
            let host = command_output(
                "gsettings",
                &["get", "org.gnome.system.proxy", protocol, "host"],
            )
            .map(|host| host.trim().trim_matches('\'').to_string())
            .filter(|host| !host.is_empty());
            let port = command_output(
                "gsettings",
                &["get", "org.gnome.system.proxy", protocol, "port"],
            )
            .and_then(|port| port.trim().parse::<u16>().ok());
            if let (Some(host), Some(port)) = (host, port.filter(|port| *port != 0)) {
                return normalize_proxy_url(&format!("http://{host}:{port}"));
            }
        }
    }

    None
}

fn resolve_public_addresses(url: &Url, proxy_configured: bool) -> Result<Vec<SocketAddr>, String> {
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "URL 必须包含有效的 HTTP/HTTPS 端口".to_string())?;
    let addresses = match url.host() {
        Some(Host::Domain(host)) if proxy_configured => {
            if !is_external_dns_name(host) {
                return Err("出于安全考虑，HTTP 请求不允许访问本机或内网地址".to_string());
            }
            // Let the configured proxy resolve the destination. This is required
            // on networks whose local DNS intentionally returns synthetic IPs.
            return Ok(Vec::new());
        }
        Some(Host::Domain(host)) => (host, port)
            .to_socket_addrs()
            .map_err(|_| "无法解析请求主机名".to_string())?
            .collect::<Vec<_>>(),
        Some(Host::Ipv4(ip)) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Some(Host::Ipv6(ip)) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        None => return Err("URL 缺少主机名".to_string()),
    };
    if addresses.is_empty() {
        return Err("请求主机名没有可用的 IP 地址".to_string());
    }
    if addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("出于安全考虑，HTTP 请求不允许访问本机或内网地址".to_string());
    }
    Ok(addresses)
}

fn request_client(
    url: &Url,
    addresses: &[SocketAddr],
    cookie_jar: Arc<Jar>,
    proxy_url: Option<&str>,
) -> Result<Client, String> {
    let mut builder = ClientBuilder::new()
        // Proxy selection is explicit below so reqwest's implicit environment
        // behavior cannot silently proxy local fixtures or conflict with the
        // platform proxy settings we resolve ourselves.
        .no_proxy()
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .cookie_provider(cookie_jar);
    if let Some(proxy) = proxy_url
        .filter(|_| matches!(url.host(), Some(Host::Domain(host)) if is_external_dns_name(host)))
    {
        builder =
            builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "系统代理配置无效".to_string())?);
        log::debug!("[skill-http] using the configured network proxy");
    } else if let Some(Host::Domain(host)) = url.host() {
        if addresses.is_empty() {
            return Err("请求主机名没有可用的 IP 地址".to_string());
        }
        builder = builder.resolve_to_addrs(host, addresses);
    }
    builder
        .build()
        .map_err(|_| "创建 HTTP 客户端失败".to_string())
}

fn parse_request(input: &str) -> Result<ParsedHttpRequest, String> {
    let input: HttpRequestInput = serde_json::from_str(input)
        .map_err(|_| "http.request 参数必须是包含 url 的对象".to_string())?;
    let url = Url::parse(&input.url).map_err(|_| "http.request 的 url 无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("仅支持不含用户名密码的 HTTP/HTTPS URL".to_string());
    }
    let method = Method::from_bytes(input.method.trim().to_ascii_uppercase().as_bytes())
        .map_err(|_| "HTTP method 无效".to_string())?;
    if !matches!(
        method,
        Method::GET | Method::POST | Method::PUT | Method::PATCH | Method::DELETE | Method::HEAD
    ) {
        return Err("HTTP method 仅支持 GET、POST、PUT、PATCH、DELETE、HEAD".to_string());
    }

    let mut headers = HeaderMap::new();
    let mut header_bytes = 0;
    for (name, value) in input.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "HTTP header 名称无效".to_string())?;
        if name == HOST || name == CONTENT_LENGTH || name == reqwest::header::TRANSFER_ENCODING {
            return Err("Host、Content-Length、Transfer-Encoding 由 HTTP 客户端管理".to_string());
        }
        let value = value
            .as_str()
            .ok_or_else(|| format!("HTTP header {name} 的值必须是字符串"))?;
        if value.len() > MAX_HEADER_VALUE_BYTES {
            return Err(format!("HTTP header {name} 超过 8 KiB 限制"));
        }
        header_bytes += name.as_str().len() + value.len();
        if header_bytes > MAX_HEADER_BYTES {
            return Err("HTTP headers 总大小超过 32 KiB 限制".to_string());
        }
        let value =
            HeaderValue::from_str(value).map_err(|_| format!("HTTP header {name} 的值无效"))?;
        headers.insert(name, value);
    }

    if input.body.is_some() && input.form.is_some() {
        return Err("HTTP request 不能同时设置 body 和 form".to_string());
    }
    let body = if let Some(form) = input.form {
        if !headers.contains_key(reqwest::header::CONTENT_TYPE) {
            headers.insert(
                reqwest::header::CONTENT_TYPE,
                HeaderValue::from_static("application/x-www-form-urlencoded; charset=utf-8"),
            );
        }
        let mut serializer = url::form_urlencoded::Serializer::new(String::new());
        for (key, value) in form {
            let value = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            serializer.append_pair(&key, &value);
        }
        Some(serializer.finish().into_bytes())
    } else {
        match input.body {
            None | Some(Value::Null) => None,
            Some(Value::String(body)) => Some(body.into_bytes()),
            Some(body) => {
                if !headers.contains_key(reqwest::header::CONTENT_TYPE) {
                    headers.insert(
                        reqwest::header::CONTENT_TYPE,
                        HeaderValue::from_static("application/json; charset=utf-8"),
                    );
                }
                Some(
                    serde_json::to_vec(&body)
                        .map_err(|_| "HTTP body JSON 序列化失败".to_string())?,
                )
            }
        }
    };
    if body
        .as_ref()
        .is_some_and(|body| body.len() > MAX_REQUEST_BODY_BYTES)
    {
        return Err("HTTP request body 超过 1 MiB 限制".to_string());
    }
    Ok(ParsedHttpRequest {
        url,
        method,
        headers,
        body,
    })
}

fn perform_http_request(
    cookie_jar: Arc<Jar>,
    input: &str,
    deadline: Instant,
) -> Result<Value, String> {
    let mut parsed = parse_request(input)?;
    let proxy_url = configured_proxy_url(
        parsed.url.scheme(),
        parsed.url.host_str().unwrap_or_default(),
    );
    let addresses = resolve_public_addresses(&parsed.url, proxy_url.is_some())?;
    let timeout = deadline
        .saturating_duration_since(Instant::now())
        .min(REQUEST_TIMEOUT);
    if timeout.is_zero() {
        return Err("HTTP 请求已超过执行时间限制".to_string());
    }
    let request_client = request_client(
        &parsed.url,
        &addresses,
        cookie_jar.clone(),
        proxy_url.as_deref(),
    )?;
    let cookies_sent = attach_cookie_header(&cookie_jar, &parsed.url, &mut parsed.headers);
    let mut request = request_client
        .request(parsed.method, parsed.url)
        .headers(parsed.headers);
    request = request.timeout(timeout);
    if let Some(body) = parsed.body {
        request = request.body(body);
    }
    let response = request.send().map_err(describe_request_error)?;
    response_to_value(response, &cookie_jar, cookies_sent)
}

fn describe_request_error(error: reqwest::Error) -> String {
    let category = if error.is_timeout() {
        "HTTP request timed out"
    } else if error.is_connect() {
        "HTTP connection failed"
    } else {
        "HTTP request failed"
    };
    let error = error.without_url();
    let mut details = vec![error.to_string()];
    let mut source = std::error::Error::source(&error);
    for _ in 0..5 {
        let Some(cause) = source else { break };
        let detail = cause.to_string();
        if !details.contains(&detail) {
            details.push(detail);
        }
        source = cause.source();
    }
    // Error sources may mention proxy or request URLs; keep credentials and queries out.
    static URL_PATTERN: OnceLock<regex::Regex> = OnceLock::new();
    let pattern = URL_PATTERN.get_or_init(|| regex::Regex::new(r"https?://[^\s)]+").unwrap());
    let details = pattern
        .replace_all(&details.join(": "), "[URL omitted]")
        .into_owned();
    format!(
        "{category}: {}",
        details.chars().take(1500).collect::<String>()
    )
}

// Snapshot matching cookies into the request so diagnostics describe the header actually sent.
// An explicit Cookie header takes precedence over the jar, as it does in reqwest.
fn attach_cookie_header(jar: &Jar, url: &Url, headers: &mut HeaderMap) -> bool {
    if !headers.contains_key(COOKIE) {
        if let Some(cookies) = jar.cookies(url) {
            headers.insert(COOKIE, cookies);
        }
    }
    headers.get(COOKIE).is_some_and(|value| !value.is_empty())
}

fn response_to_value(
    mut response: Response,
    cookie_jar: &Jar,
    cookies_sent: bool,
) -> Result<Value, String> {
    let status = response.status();
    let response_url = response.url().clone();
    let received_cookie_count = response.headers().get_all(SET_COOKIE).iter().count();
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
    {
        return Err("HTTP response body 超过 2 MiB 限制".to_string());
    }
    let mut response_bytes = Vec::new();
    response
        .by_ref()
        .take((MAX_RESPONSE_BODY_BYTES + 1) as u64)
        .read_to_end(&mut response_bytes)
        .map_err(|_| "读取 HTTP response body 失败".to_string())?;
    if response_bytes.len() > MAX_RESPONSE_BODY_BYTES {
        return Err("HTTP response body 超过 2 MiB 限制".to_string());
    }
    let headers = response
        .headers()
        .iter()
        .filter(|(name, _)| *name != SET_COOKIE)
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.as_str().to_string(), Value::String(value.to_string())))
        })
        .collect::<Map<_, _>>();
    let body = String::from_utf8_lossy(&response_bytes).into_owned();
    Ok(json!({
        "ok": status.is_success(),
        "status": status.as_u16(),
        "statusText": status.canonical_reason().unwrap_or(""),
        "headers": headers,
        "body": body,
        "cookies": {
            "sent": cookies_sent,
            "receivedCount": received_cookie_count,
            "availableForUrl": cookie_jar.cookies(&response_url).is_some(),
        },
    }))
}

pub(crate) fn create_cookie_jar() -> Arc<Jar> {
    Arc::new(Jar::default())
}

pub(crate) fn execute_http_request_json(
    cookie_jar: Arc<Jar>,
    request_json: &str,
    request_count: &AtomicUsize,
    deadline: Instant,
) -> String {
    if request_count.fetch_add(1, Ordering::Relaxed) >= MAX_REQUESTS_PER_SCRIPT {
        return json!({ "error": "单次 Skill 最多发起 24 次 HTTP 请求" }).to_string();
    }
    match perform_http_request(cookie_jar, request_json, deadline) {
        Ok(response) => json!({ "response": response }).to_string(),
        Err(error) => {
            log::warn!("[skill-http] {error}");
            json!({ "error": error }).to_string()
        }
    }
}

#[tauri::command]
pub async fn ai_http_request(request: Value) -> std::result::Result<Value, String> {
    let request_json =
        serde_json::to_string(&request).map_err(|_| "无法序列化 HTTP 请求参数".to_string())?;
    static CHAT_COOKIE_JAR: OnceLock<Arc<Jar>> = OnceLock::new();
    let cookie_jar = CHAT_COOKIE_JAR.get_or_init(create_cookie_jar).clone();
    let request_count = Arc::new(AtomicUsize::new(0));
    let deadline = Instant::now() + REQUEST_TIMEOUT;

    tokio::task::spawn_blocking(move || {
        let result = execute_http_request_json(cookie_jar, &request_json, &request_count, deadline);
        let result: Value =
            serde_json::from_str(&result).map_err(|_| "解析 HTTP 请求结果失败".to_string())?;
        if let Some(error) = result.get("error").and_then(Value::as_str) {
            return Err(error.to_string());
        }
        result
            .get("response")
            .cloned()
            .ok_or_else(|| "HTTP 请求没有返回响应".to_string())
    })
    .await
    .map_err(|error| format!("HTTP 请求任务失败: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        attach_cookie_header, create_cookie_jar, describe_request_error, is_public_ip,
        parse_request, request_client, resolve_public_addresses, response_to_value,
    };
    use reqwest::header::{HeaderMap, HeaderValue, COOKIE};
    use std::io::{Read, Write};
    use std::net::IpAddr;
    use std::net::TcpListener;
    use std::time::{Duration, Instant};
    use url::Url;

    #[test]
    fn configured_proxy_handles_external_hosts_without_allowlists() {
        for host in ["api.crossref.org", "kns.cnki.net", "www.baidu.com"] {
            assert!(super::is_external_dns_name(host));
        }
        for host in ["localhost", "service.local", "db.internal", "printer"] {
            assert!(!super::is_external_dns_name(host));
        }
        let baidu = Url::parse("http://www.baidu.com/").unwrap();
        assert!(resolve_public_addresses(&baidu, true).unwrap().is_empty());
        let localhost = Url::parse("http://localhost/").unwrap();
        assert!(resolve_public_addresses(&localhost, true).is_err());
        let private_ip = Url::parse("http://192.168.1.1/").unwrap();
        assert!(resolve_public_addresses(&private_ip, true).is_err());
        assert!(!is_public_ip("0.0.6.200".parse().unwrap()));
        assert_eq!(
            super::proxy_server_for_scheme(
                "http=proxy.example:8080;https=secure-proxy.example:8443",
                "https"
            )
            .as_deref(),
            Some("http://secure-proxy.example:8443")
        );
        assert_eq!(
            super::normalize_proxy_url("socks5h://127.0.0.1:1080").as_deref(),
            Some("socks5h://127.0.0.1:1080")
        );
    }

    #[test]
    fn request_error_reports_connection_failure_without_url_credentials_or_query() {
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .build()
            .unwrap();
        let error = client
            .get("http://127.0.0.1:0/private?token=test-private-token")
            .send()
            .unwrap_err();
        let detail = describe_request_error(error);
        assert!(detail.starts_with("HTTP connection failed:"), "{detail}");
        assert!(!detail.contains("test-private-token"));
        assert!(!detail.contains("127.0.0.1"));
    }

    #[test]
    fn redirect_cookies_are_reused_by_next_client_without_exposing_values() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(8);
            let mut requests = Vec::new();
            while requests.len() < 2 && Instant::now() < deadline {
                let (mut stream, _) = match listener.accept() {
                    Ok(connection) => connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(error) => panic!("test listener failed: {error}"),
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !bytes.windows(4).any(|part| part == b"\r\n\r\n") {
                    let count = stream.read(&mut buffer).unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buffer[..count]);
                }
                requests.push(String::from_utf8(bytes).unwrap());
                let response = if requests.len() == 1 {
                    "HTTP/1.1 302 Found\r\nLocation: /verify/home\r\nSet-Cookie: session=test-cookie-value; Path=/; HttpOnly\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                } else {
                    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK"
                };
                stream.write_all(response.as_bytes()).unwrap();
            }
            requests
        });

        // The local fixture uses the transport directly; the production public-address guard
        // remains enabled and is covered separately below.
        let jar = create_cookie_jar();
        let first_url = Url::parse(&format!("http://{address}/index")).unwrap();
        let first_client = request_client(&first_url, &[address], jar.clone(), None).unwrap();
        let response = first_client.get(first_url).send().unwrap();
        let first = response_to_value(response, &jar, false).unwrap();
        assert_eq!(first["status"], 302);
        assert_eq!(first["headers"]["location"], "/verify/home");
        assert_eq!(first["cookies"]["receivedCount"], 1);
        assert_eq!(first["cookies"]["availableForUrl"], true);
        assert_eq!(first["cookies"]["sent"], false);
        assert!(!first.to_string().contains("test-cookie-value"));

        let next_url = Url::parse(&format!("http://{address}/grid")).unwrap();
        let mut headers = HeaderMap::new();
        let sent = attach_cookie_header(&jar, &next_url, &mut headers);
        let next_client = request_client(&next_url, &[address], jar.clone(), None).unwrap();
        let response = next_client.post(next_url).headers(headers).send().unwrap();
        let second = response_to_value(response, &jar, sent).unwrap();
        assert_eq!(second["status"], 200);
        assert_eq!(second["cookies"]["sent"], true);
        assert_eq!(second["cookies"]["receivedCount"], 0);
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[1].starts_with("POST /grid "));
        assert!(requests[1]
            .to_lowercase()
            .contains("cookie: session=test-cookie-value"));
    }

    #[test]
    fn cookies_respect_scope_and_explicit_header() {
        let jar = create_cookie_jar();
        let url = Url::parse("https://example.com/kns8s/index").unwrap();
        jar.add_cookie_str("session=stored; Path=/kns8s; Secure", &url);
        for other in [
            "https://other.example/kns8s/grid",
            "https://example.com/elsewhere",
            "http://example.com/kns8s/grid",
        ] {
            assert!(!attach_cookie_header(
                &jar,
                &Url::parse(other).unwrap(),
                &mut HeaderMap::new()
            ));
        }
        let mut headers = HeaderMap::new();
        assert!(attach_cookie_header(&jar, &url, &mut headers));
        assert_eq!(headers[COOKIE], "session=stored");
        headers.insert(COOKIE, HeaderValue::from_static("session=explicit"));
        assert!(attach_cookie_header(&jar, &url, &mut headers));
        assert_eq!(headers[COOKIE], "session=explicit");
    }

    #[test]
    fn host_only_homepage_cookies_are_not_sent_to_sibling_search_host() {
        let jar = create_cookie_jar();
        let home = Url::parse("https://www.example.com/").unwrap();
        let grid = Url::parse("https://kns.example.com/kns8s/brief/grid").unwrap();
        jar.add_cookie_str("home=host-only; Path=/; Secure", &home);
        assert!(!attach_cookie_header(&jar, &grid, &mut HeaderMap::new()));
        jar.add_cookie_str(
            "shared=domain-cookie; Domain=example.com; Path=/; Secure",
            &home,
        );
        let mut headers = HeaderMap::new();
        assert!(attach_cookie_header(&jar, &grid, &mut headers));
        assert_eq!(headers[COOKIE], "shared=domain-cookie");
    }

    #[test]
    fn accepts_public_http_url_and_structured_body() {
        let parsed = parse_request(
            r#"{"url":"https://example.com/api","method":"POST","headers":{"Accept":"application/json"},"body":{"query":"hello"}}"#,
        );
        assert!(parsed.is_ok());
    }

    #[test]
    fn rejects_local_network_and_non_http_urls() {
        let local_request = parse_request(r#"{"url":"http://127.0.0.1/"}"#).unwrap();
        assert!(resolve_public_addresses(&local_request.url, false).is_err());
        assert!(!is_public_ip("127.0.0.1".parse::<IpAddr>().unwrap()));
        assert!(parse_request(r#"{"url":"file:///etc/passwd"}"#).is_err());
    }

    #[test]
    fn rejects_manually_overridden_host_header() {
        let parsed =
            parse_request(r#"{"url":"https://example.com","headers":{"Host":"127.0.0.1"}}"#);
        assert!(parsed.is_err());
    }
}
