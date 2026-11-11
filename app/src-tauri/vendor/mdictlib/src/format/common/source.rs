use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::error::{Error, Result};
use crate::format::common::file_url;
use crate::limits::{checked_u64, try_reserve_vec};

pub struct FileSource {
    path: PathBuf,
    file: Mutex<File>,
    len: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FileIdentity {
    pub(crate) len: u64,
    pub(crate) modified_unix_nanos: i128,
}

impl std::fmt::Debug for FileSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileSource")
            .field("path", &self.path)
            .field("len", &self.len)
            .finish()
    }
}

impl FileSource {
    /// Opens a dictionary file, accepting either a path or the `file://` URL a
    /// mobile file picker answers with (see [`file_url::resolve`]).
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = &file_url::resolve(path.as_ref())?;
        let file = File::open(path)?;
        let len = file.metadata()?.len();
        if len == 0 {
            return Err(Error::InvalidFormat("empty input file"));
        }
        Ok(Self {
            path: path.to_path_buf(),
            file: Mutex::new(file),
            len,
        })
    }

    pub fn read_exact_at(&self, offset: u64, len: usize, context: &'static str) -> Result<Vec<u8>> {
        let len_u64 = checked_u64(len, context)?;
        self.ensure_range(offset, len_u64, context)?;

        let mut output = Vec::new();
        try_reserve_vec(&mut output, len, context)?;
        output.resize(len, 0);
        let mut file = self
            .file
            .lock()
            .map_err(|_| Error::InvalidFormat("source mutex poisoned"))?;
        file.seek(SeekFrom::Start(offset))?;
        file.read_exact(&mut output)?;
        Ok(output)
    }

    pub const fn len(&self) -> u64 {
        self.len
    }

    pub(crate) fn current_identity(&self) -> Result<FileIdentity> {
        let file = self
            .file
            .lock()
            .map_err(|_| Error::InvalidFormat("source mutex poisoned"))?;
        let metadata = file.metadata()?;
        Ok(FileIdentity {
            len: metadata.len(),
            modified_unix_nanos: system_time_unix_nanos(metadata.modified()?)?,
        })
    }

    pub fn ensure_range(&self, offset: u64, len: u64, context: &'static str) -> Result<()> {
        let end = offset
            .checked_add(len)
            .ok_or(Error::InvalidFormat("source range overflow"))?;
        if end > self.len {
            let needed = usize::try_from(len).unwrap_or(usize::MAX);
            let remaining = usize::try_from(self.len.saturating_sub(offset)).unwrap_or(usize::MAX);
            return Err(Error::truncated(context, needed, remaining));
        }
        Ok(())
    }
}

fn system_time_unix_nanos(time: SystemTime) -> Result<i128> {
    match time.duration_since(UNIX_EPOCH) {
        Ok(duration) => i128::try_from(duration.as_nanos()).map_err(|_| {
            Error::InvalidData("source modification time exceeds i128 nanoseconds".to_owned())
        }),
        Err(error) => i128::try_from(error.duration().as_nanos())
            .map(|nanos| -nanos)
            .map_err(|_| {
                Error::InvalidData("source modification time exceeds i128 nanoseconds".to_owned())
            }),
    }
}
