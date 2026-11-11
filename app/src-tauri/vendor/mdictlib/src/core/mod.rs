mod case_variants;
mod iter;
mod keys;
mod locator;
mod normalize;
pub(crate) mod persistent;
mod records;

use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

pub(crate) use iter::{KeyIter, RecordIter};
pub(crate) use locator::{LocatedKeyPage, LocatedKeys, LocatorBasis};
pub(crate) use records::RecordDescriptor;

use crate::error::{Error, Result};
use crate::format::TextEncoding;
use crate::format::common::descriptors::ValidatedLayout;
use crate::format::common::source::FileSource;
use crate::format::open_layout;
use crate::limits::{MemoryBudget, MemoryReservation, ensure_usize_limit, try_clone_string};
use crate::types::{ChecksumPolicy, ContainerKind, Header, Limits, MemoryUsage, OpenOptions};

use self::keys::DecodedKeyBlock;
use self::locator::KeyLocator;
use self::normalize::KeyNormalizer;
use self::records::DecodedRecordBlock;

pub(super) enum CachedValue<T> {
    Ready(Arc<T>),
    Failed(CachedFailure),
}

pub(super) struct CachedFailure {
    kind: CachedFailureKind,
    _memory: Option<MemoryReservation>,
}

enum CachedFailureKind {
    InvalidFormat(&'static str),
    InvalidData(String),
    Truncated {
        context: &'static str,
        needed: usize,
        remaining: usize,
    },
    LimitExceeded {
        limit: &'static str,
        value: u64,
        max: u64,
    },
    ChecksumMismatch {
        context: &'static str,
        expected: u32,
        actual: u32,
    },
    Decode {
        context: &'static str,
        encoding: &'static str,
    },
    MissingPasscode,
    InvalidPasscode(&'static str),
    Unsupported(&'static str),
}

impl CachedFailure {
    pub(super) fn capture(error: &Error, memory: &Arc<MemoryBudget>) -> Option<Self> {
        let (kind, reservation) = match error {
            Error::Io(_)
            | Error::AllocationFailed { .. }
            | Error::KeyIndexRejected(_)
            | Error::Cancelled { .. }
            | Error::SourceChanged { .. } => return None,
            Error::LimitExceeded {
                limit: "working_memory_bytes",
                ..
            } => return None,
            Error::InvalidFormat(context) => (CachedFailureKind::InvalidFormat(context), None),
            Error::InvalidData(context) => {
                let reservation = memory
                    .reserve(context.len(), "cached deterministic failure")
                    .ok()?;
                let context = try_clone_string(context, "cached deterministic failure").ok()?;
                (CachedFailureKind::InvalidData(context), Some(reservation))
            }
            Error::Truncated {
                context,
                needed,
                remaining,
            } => (
                CachedFailureKind::Truncated {
                    context,
                    needed: *needed,
                    remaining: *remaining,
                },
                None,
            ),
            Error::LimitExceeded { limit, value, max } => (
                CachedFailureKind::LimitExceeded {
                    limit,
                    value: *value,
                    max: *max,
                },
                None,
            ),
            Error::ChecksumMismatch {
                context,
                expected,
                actual,
            } => (
                CachedFailureKind::ChecksumMismatch {
                    context,
                    expected: *expected,
                    actual: *actual,
                },
                None,
            ),
            Error::Decode { context, encoding } => {
                (CachedFailureKind::Decode { context, encoding }, None)
            }
            Error::MissingPasscode => (CachedFailureKind::MissingPasscode, None),
            Error::InvalidPasscode(context) => (CachedFailureKind::InvalidPasscode(context), None),
            Error::Unsupported(feature) => (CachedFailureKind::Unsupported(feature), None),
        };
        Some(Self {
            kind,
            _memory: reservation,
        })
    }

    pub(super) fn replay(&self) -> Error {
        match &self.kind {
            CachedFailureKind::InvalidFormat(context) => Error::InvalidFormat(context),
            CachedFailureKind::InvalidData(context) => {
                match try_clone_string(context, "replayed deterministic failure") {
                    Ok(context) => Error::InvalidData(context),
                    Err(error) => error,
                }
            }
            CachedFailureKind::Truncated {
                context,
                needed,
                remaining,
            } => Error::Truncated {
                context,
                needed: *needed,
                remaining: *remaining,
            },
            CachedFailureKind::LimitExceeded { limit, value, max } => Error::LimitExceeded {
                limit,
                value: *value,
                max: *max,
            },
            CachedFailureKind::ChecksumMismatch {
                context,
                expected,
                actual,
            } => Error::ChecksumMismatch {
                context,
                expected: *expected,
                actual: *actual,
            },
            CachedFailureKind::Decode { context, encoding } => Error::Decode { context, encoding },
            CachedFailureKind::MissingPasscode => Error::MissingPasscode,
            CachedFailureKind::InvalidPasscode(context) => Error::InvalidPasscode(context),
            CachedFailureKind::Unsupported(feature) => Error::Unsupported(feature),
        }
    }
}

/// One open dictionary, shared by MDX and MDD and by every wire version.
pub(crate) struct MdictFile {
    kind: ContainerKind,
    source: Arc<FileSource>,
    layout: ValidatedLayout,
    normalizer: KeyNormalizer,
    limits: Limits,
    checksum_policy: ChecksumPolicy,
    memory: Arc<MemoryBudget>,
    key_block_cache: Mutex<Option<(usize, CachedValue<DecodedKeyBlock>)>>,
    record_block_cache: Mutex<Option<(usize, CachedValue<DecodedRecordBlock>)>>,
    locator: OnceLock<CachedValue<KeyLocator>>,
    locator_build: Mutex<()>,
}

impl std::fmt::Debug for MdictFile {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MdictFile")
            .field("kind", &self.kind)
            .field("source", &self.source)
            .field("header", &self.layout.header)
            .field("key_encoding", &self.layout.key_encoding)
            .field("key_blocks", &self.layout.key_blocks.len())
            .field("record_blocks", &self.layout.record_blocks.len())
            .finish_non_exhaustive()
    }
}

impl MdictFile {
    pub(crate) fn open(
        path: impl AsRef<Path>,
        kind: ContainerKind,
        options: &OpenOptions,
    ) -> Result<Self> {
        let source = Arc::new(FileSource::open(path)?);
        let limits = options.limits.clone();
        let memory = Arc::new(MemoryBudget::new(limits.working_memory_bytes));
        let layout = open_layout(&source, kind, options, &memory)?;
        let normalizer = KeyNormalizer::from_header(&layout.header, kind);

        Ok(Self {
            kind,
            source,
            layout,
            normalizer,
            limits,
            checksum_policy: options.checksum_policy,
            memory,
            key_block_cache: Mutex::new(None),
            record_block_cache: Mutex::new(None),
            locator: OnceLock::new(),
            locator_build: Mutex::new(()),
        })
    }

    pub(crate) fn header(&self) -> &Header {
        &self.layout.header
    }

    /// The underlying byte source, for crate-internal structural work.
    pub(crate) fn source(&self) -> &FileSource {
        &self.source
    }

    /// The validated layout, for crate-internal structural work.
    pub(crate) fn layout(&self) -> &ValidatedLayout {
        &self.layout
    }

    /// The limits this file opened under.
    pub(crate) fn limits(&self) -> &Limits {
        &self.limits
    }

    /// The checksum policy this file opened under.
    pub(crate) fn checksum_policy(&self) -> ChecksumPolicy {
        self.checksum_policy
    }

    pub(crate) fn len(&self) -> u64 {
        self.layout.total_entries
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub(crate) fn memory_usage(&self) -> Result<MemoryUsage> {
        let metadata_bytes = self.layout.retained.metadata_bytes()?;
        let locator_bytes = self.locator.get().map_or(0, |locator| match locator {
            CachedValue::Ready(locator) => locator.memory_bytes(),
            CachedValue::Failed(_) => 0,
        });
        let key_cache_bytes = self
            .key_block_cache
            .lock()
            .map_err(|_| Error::InvalidFormat("key block cache mutex poisoned"))?
            .as_ref()
            .map_or(0, |(_, block)| match block {
                CachedValue::Ready(block) => block.memory_bytes(),
                CachedValue::Failed(_) => 0,
            });
        let record_cache_bytes = self
            .record_block_cache
            .lock()
            .map_err(|_| Error::InvalidFormat("record block cache mutex poisoned"))?
            .as_ref()
            .map_or(0, |(_, block)| match block {
                CachedValue::Ready(block) => block.memory_bytes(),
                CachedValue::Failed(_) => 0,
            });
        let current_bytes = self.memory.used();
        let peak_bytes = self.memory.peak().max(current_bytes);
        Ok(MemoryUsage::new(
            current_bytes,
            peak_bytes,
            metadata_bytes,
            locator_bytes,
            key_cache_bytes,
            record_cache_bytes,
        ))
    }

    /// Returns the encoding used to decode record text.
    ///
    /// # Errors
    ///
    /// Returns an error for containers whose records are opaque bytes.
    pub(crate) fn record_text_encoding(&self) -> Result<TextEncoding> {
        self.layout
            .record_encoding
            .ok_or(Error::InvalidFormat("container records are not text"))
    }

    pub(crate) fn reserve_decoded_record_text(
        &self,
        encoded_len: u64,
    ) -> Result<MemoryReservation> {
        let encoding = self.record_text_encoding()?;
        let encoded_len = crate::limits::checked_usize(encoded_len, "encoded MDX record length")?;
        ensure_usize_limit(
            "materialized_record_bytes",
            encoded_len,
            self.limits.materialized_record_bytes,
        )?;
        let decoded_len = encoding.max_decoded_len(encoded_len)?;
        ensure_usize_limit(
            "materialized_record_bytes",
            decoded_len,
            self.limits.materialized_record_bytes,
        )?;
        let combined = encoded_len
            .checked_add(decoded_len)
            .ok_or(Error::InvalidFormat("decoded record working size overflow"))?;
        self.memory.reserve(combined, "decoded MDX record")
    }

    pub(super) fn key_block_count(&self) -> usize {
        self.layout.key_blocks.len()
    }

    pub(crate) fn keys(&self) -> KeyIter<'_> {
        KeyIter::new(self)
    }

    pub(crate) fn records(&self) -> RecordIter<'_> {
        RecordIter::new(self)
    }
}
