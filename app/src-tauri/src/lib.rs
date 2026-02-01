use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

mod fs_types;

use log::{error, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::async_runtime::spawn;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::sync::{Semaphore, SemaphorePermit};
use tokio::time::timeout;

const DEFAULT_CONCURRENT: usize = 2;
const DEFAULT_QUEUE: usize = 20;
const DEFAULT_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_MAX_INPUT_BYTES: usize = 200_000;

static PLANTUML_SEMAPHORE: Lazy<Semaphore> = Lazy::new(|| Semaphore::new(DEFAULT_CONCURRENT));
static PLANTUML_QUEUE: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ErrorStruct {
  pub code: String,
  pub message: String,
  pub trace_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct RenderPayload {
  pub data: String,
  pub trace_id: String,
  pub format: Option<String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RendererLimits {
  pub command: Option<String>,
  pub timeout_ms: Option<u64>,
  pub max_input_bytes: Option<usize>,
  pub max_file_mb: Option<u64>,
  pub queue_size: Option<usize>,
  pub max_concurrent: Option<usize>,
}

impl RendererLimits {
  fn timeout_ms(&self, default_ms: u64) -> u64 {
    self.timeout_ms.unwrap_or(default_ms)
  }

  fn max_input_bytes(&self, default_bytes: usize) -> usize {
    self.max_input_bytes.unwrap_or(default_bytes)
  }

  fn queue_size(&self, default_size: usize) -> usize {
    self.queue_size.unwrap_or(default_size)
  }
}

fn new_trace_id() -> String {
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or_default();
  format!("trace_{}", nanos)
}

async fn acquire_with_queue(
  semaphore: &'static Semaphore,
  queue: &'static AtomicUsize,
  queue_size: usize,
  trace_id: &str,
  renderer: &str,
) -> Result<SemaphorePermit<'static>, ErrorStruct> {
  loop {
    let current = queue.load(Ordering::SeqCst);
    if current >= queue_size {
      warn!("renderer={} outcome=queue_full trace_id={}", renderer, trace_id);
      return Err(ErrorStruct {
        code: "QUEUE_FULL".into(),
        message: format!("{} 队列已满", renderer),
        trace_id: Some(trace_id.to_string()),
      });
    }
    if queue
      .compare_exchange(current, current + 1, Ordering::SeqCst, Ordering::SeqCst)
      .is_ok()
    {
      break;
    }
  }

  let permit = match semaphore.acquire().await {
    Ok(p) => p,
    Err(err) => {
      queue.fetch_sub(1, Ordering::SeqCst);
      return Err(ErrorStruct {
        code: "SEMAPHORE_CLOSED".into(),
        message: format!("{err}"),
        trace_id: Some(trace_id.to_string()),
      });
    }
  };

  queue.fetch_sub(1, Ordering::SeqCst);
  Ok(permit)
}

#[tauri::command]
async fn render_plantuml(
  puml: String,
  limits: Option<RendererLimits>,
  trace_id: Option<String>,
) -> Result<RenderPayload, ErrorStruct> {
  let limits = limits.unwrap_or_default();
  let trace = trace_id.unwrap_or_else(new_trace_id);
  let timeout_ms = limits.timeout_ms(DEFAULT_TIMEOUT_MS);
  let max_input = limits.max_input_bytes(DEFAULT_MAX_INPUT_BYTES);

  if puml.as_bytes().len() > max_input {
    return Err(ErrorStruct {
      code: "PAYLOAD_TOO_LARGE".into(),
      message: format!("PlantUML 输入超过限制 {} bytes", max_input),
      trace_id: Some(trace.clone()),
    })
  }

  let _permit = acquire_with_queue(
    &PLANTUML_SEMAPHORE,
    &PLANTUML_QUEUE,
    limits.queue_size(DEFAULT_QUEUE),
    &trace,
    "plantuml",
  )
  .await?;

  let command = limits
    .command
    .clone()
    .unwrap_or_else(|| "plantuml".to_string());

  let mut child = Command::new(command)
    .arg("-tsvg")
    .arg("-pipe")
    .stdin(std::process::Stdio::piped())
    .stdout(std::process::Stdio::piped())
    .spawn()
    .map_err(|err| ErrorStruct {
      code: "SPAWN_FAILED".into(),
      message: format!("{err}"),
      trace_id: Some(trace.clone()),
    })?;

  if let Some(mut stdin) = child.stdin.take() {
    stdin
      .write_all(puml.as_bytes())
      .await
      .map_err(|err| ErrorStruct {
        code: "WRITE_FAILED".into(),
        message: format!("{err}"),
        trace_id: Some(trace.clone()),
      })?;
  }

  let duration = Duration::from_millis(timeout_ms);
  let output = timeout(duration, child.wait_with_output())
    .await
    .map_err(|_| ErrorStruct {
      code: "TIMEOUT".into(),
      message: format!("PlantUML 渲染超时 {} ms", timeout_ms),
      trace_id: Some(trace.clone()),
    })
    .and_then(|res| res.map_err(|err| ErrorStruct {
      code: "WAIT_FAILED".into(),
      message: format!("{err}"),
      trace_id: Some(trace.clone()),
    }))?;

  if !output.status.success() {
    error!(
      "renderer=plantuml outcome=failed trace_id={} status={:?}",
      trace,
      output.status
    );
    return Err(ErrorStruct {
      code: "RENDER_FAILED".into(),
      message: String::from_utf8_lossy(&output.stderr).into_owned(),
      trace_id: Some(trace),
    })
  }

  let svg = String::from_utf8_lossy(&output.stdout).into_owned();
  info!("renderer=plantuml outcome=success trace_id={}", trace);
  Ok(RenderPayload {
    data: svg,
    trace_id: trace,
    format: Some("svg".into()),
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      let handle = app.handle();
      let log_plugin = tauri_plugin_log::Builder::default()
        .level(log::LevelFilter::Info)
        .build();
      handle.plugin(log_plugin)?;
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![render_plantuml])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");

  // 预热异步运行时，避免首次命令调用抖动
  spawn(async {});
}
