//! Shared async transports. Request credentials and session state belong to callers.
use reqwest::Client;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct HttpClientPolicy {
    pub timeout: Option<Duration>,
    pub connect_timeout: Option<Duration>,
    pub redirect_limit: Option<usize>,
    pub user_agent: Option<&'static str>,
}

pub(crate) const API_POLICY: HttpClientPolicy = HttpClientPolicy {
    timeout: Some(Duration::from_secs(20)),
    connect_timeout: Some(Duration::from_secs(10)),
    redirect_limit: None,
    user_agent: None,
};
pub(crate) const DOWNLOAD_POLICY: HttpClientPolicy = HttpClientPolicy {
    timeout: Some(Duration::from_secs(20)),
    connect_timeout: None,
    redirect_limit: Some(5),
    user_agent: Some("HaoMD/0.12"),
};

struct CachedClient {
    policy: HttpClientPolicy,
    client: Client,
    created: Instant,
}

#[derive(Default)]
struct ClientPool {
    entries: Vec<CachedClient>,
    proxy_environment: Vec<Option<std::ffi::OsString>>,
}

impl ClientPool {
    fn get(&mut self, policy: HttpClientPolicy) -> Result<Client, reqwest::Error> {
        // Rebuild on environment changes, and periodically refresh platform settings.
        // Existing requests retain their cloned client and can finish normally.
        let proxy_environment = [
            "HTTP_PROXY",
            "http_proxy",
            "HTTPS_PROXY",
            "https_proxy",
            "ALL_PROXY",
            "all_proxy",
            "NO_PROXY",
            "no_proxy",
        ]
        .map(std::env::var_os)
        .to_vec();
        if self.proxy_environment != proxy_environment {
            self.entries.clear();
            self.proxy_environment = proxy_environment;
        }
        self.entries
            .retain(|entry| entry.created.elapsed() < Duration::from_secs(60));
        if let Some(entry) = self.entries.iter().find(|entry| entry.policy == policy) {
            return Ok(entry.client.clone());
        }
        let mut builder = Client::builder().use_rustls_tls();
        if let Some(timeout) = policy.timeout {
            builder = builder.timeout(timeout);
        }
        if let Some(timeout) = policy.connect_timeout {
            builder = builder.connect_timeout(timeout);
        }
        if let Some(limit) = policy.redirect_limit {
            builder = builder.redirect(reqwest::redirect::Policy::limited(limit));
        }
        if let Some(agent) = policy.user_agent {
            builder = builder.user_agent(agent);
        }
        let client = builder.build()?;
        if self.entries.len() >= 16 {
            self.entries.remove(0);
        }
        self.entries.push(CachedClient {
            policy,
            client: client.clone(),
            created: Instant::now(),
        });
        Ok(client)
    }
}

pub(crate) fn shared_client(policy: HttpClientPolicy) -> Result<Client, reqwest::Error> {
    static POOL: OnceLock<Mutex<ClientPool>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(ClientPool::default()))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(policy)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[tokio::test]
    async fn repeated_acquisition_reuses_connection_without_sharing_credentials() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut requests = Vec::new();
            // Both requests must arrive on this same TCP connection.
            for _ in 0..2 {
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    socket.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                requests.push(String::from_utf8(request).unwrap().to_lowercase());
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")
                    .unwrap();
            }
            requests
        });
        let mut pool = ClientPool::default();
        let url = format!("http://{address}/");
        let first = pool.get(Default::default()).unwrap();
        assert_eq!(
            first
                .get(&url)
                .bearer_auth("first-token")
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap(),
            "OK"
        );
        let second = pool.get(Default::default()).unwrap();
        assert_eq!(
            second.get(&url).send().await.unwrap().text().await.unwrap(),
            "OK"
        );
        let requests = server.join().unwrap();
        assert!(requests[0].contains("authorization: bearer first-token"));
        assert!(!requests[1].contains("authorization:"));
    }

    #[tokio::test]
    async fn policies_are_cached_separately_and_expired_entries_are_replaced() {
        let mut pool = ClientPool::default();
        pool.get(Default::default()).unwrap();
        pool.get(API_POLICY).unwrap();
        assert_eq!(pool.entries.len(), 2);
        pool.entries[0].created = Instant::now() - Duration::from_secs(61);
        pool.get(Default::default()).unwrap();
        assert_eq!(pool.entries.len(), 2);
        assert!(pool
            .entries
            .iter()
            .all(|entry| entry.created.elapsed() < Duration::from_secs(60)));
    }

    #[tokio::test]
    async fn timeout_policy_is_applied_to_requests() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                socket.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            std::thread::sleep(Duration::from_millis(200));
        });
        let mut pool = ClientPool::default();
        let client = pool
            .get(HttpClientPolicy {
                timeout: Some(Duration::from_millis(100)),
                ..Default::default()
            })
            .unwrap();
        let error = client
            .get(format!("http://{address}/"))
            .send()
            .await
            .unwrap_err();
        assert!(error.is_timeout());
        server.join().unwrap();
    }
}
