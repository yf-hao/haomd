use once_cell::sync::Lazy;
use rodio::{OutputStream, OutputStreamHandle};
use std::ptr;
use std::sync::{
    atomic::{AtomicPtr, Ordering},
    Mutex,
};

static SHARED_STREAM_PTR: AtomicPtr<OutputStream> = AtomicPtr::new(ptr::null_mut());
static SHARED_HANDLE: Lazy<Mutex<Option<OutputStreamHandle>>> = Lazy::new(|| Mutex::new(None));

pub(crate) fn ensure_output_stream_handle() -> Result<OutputStreamHandle, String> {
    let mut guard = SHARED_HANDLE
        .lock()
        .map_err(|err| format!("lock shared audio handle failed: {err}"))?;

    if let Some(handle) = guard.as_ref() {
        return Ok(handle.clone());
    }

    let (stream, handle) = OutputStream::try_default()
        .map_err(|err| format!("create shared output stream failed: {err}"))?;
    let leaked = Box::into_raw(Box::new(stream));
    SHARED_STREAM_PTR.store(leaked, Ordering::SeqCst);
    *guard = Some(handle.clone());
    Ok(handle)
}
