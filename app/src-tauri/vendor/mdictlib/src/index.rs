use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::core::persistent::PersistentKeyIndex;
use crate::types::{ChecksumPolicy, KeyOrdinal};

/// Stable on-disk key-index format revision.
pub const KEY_INDEX_FORMAT_REVISION: u32 = 3;

/// Stable parser/layout compatibility revision encoded by a key index.
pub const KEY_INDEX_PARSER_REVISION: u32 = 1;

/// Stable header-controlled key-normalization revision encoded by a key index.
pub const KEY_INDEX_NORMALIZATION_REVISION: u32 = 1;

/// Filesystem-safe aggregate revision for persistent key-index cache names.
///
/// This value changes whenever any of the format, parser/layout, or
/// normalization revisions changes.
pub const KEY_INDEX_REVISION: &str = "f3-p1-n1";

const DEFAULT_MAX_INDEX_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const DEFAULT_MAX_METADATA_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_BUILD_MEMORY_BYTES: usize = 32 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES: usize = 64 * 1024;

/// Limits and scratch placement for persistent key-index construction and use.
///
/// Defaults are finite. The build-memory ceiling covers the additional sort
/// buffers owned by the index builder; ordinary parser block/cache memory
/// remains governed by [`crate::Limits`]. Persistent checksum comparisons are
/// controlled separately from source decoding and default to
/// [`ChecksumPolicy::Skip`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyIndexOptions {
    pub(crate) max_index_bytes: u64,
    pub(crate) max_metadata_bytes: usize,
    pub(crate) build_memory_bytes: usize,
    pub(crate) chunk_bytes: usize,
    pub(crate) scratch_directory: Option<PathBuf>,
    pub(crate) checksum_policy: ChecksumPolicy,
}

impl KeyIndexOptions {
    /// Creates finite default key-index options.
    pub const fn new() -> Self {
        Self {
            max_index_bytes: DEFAULT_MAX_INDEX_BYTES,
            max_metadata_bytes: DEFAULT_MAX_METADATA_BYTES,
            build_memory_bytes: DEFAULT_BUILD_MEMORY_BYTES,
            chunk_bytes: DEFAULT_CHUNK_BYTES,
            scratch_directory: None,
            checksum_policy: ChecksumPolicy::Skip,
        }
    }

    /// Sets the maximum accepted or generated index-file length.
    pub const fn with_max_index_bytes(mut self, value: u64) -> Self {
        self.max_index_bytes = value;
        self
    }

    /// Sets the maximum combined fixed-header and on-disk checksum-table length.
    pub const fn with_max_metadata_bytes(mut self, value: usize) -> Self {
        self.max_metadata_bytes = value;
        self
    }

    /// Sets the additional in-memory ceiling for external-sort construction.
    pub const fn with_build_memory_bytes(mut self, value: usize) -> Self {
        self.build_memory_bytes = value;
        self
    }

    /// Sets the section-chunk length used by the persistent artifact.
    ///
    /// An open index retains at most one chunk buffer per section; those
    /// buffers are charged to the originating dictionary memory budget.
    pub const fn with_chunk_bytes(mut self, value: usize) -> Self {
        self.chunk_bytes = value;
        self
    }

    /// Places temporary build runs in `directory`.
    ///
    /// The final destination remains entirely caller-selected. When this is not
    /// set, a path build uses the destination's parent and a sink build uses the
    /// platform temporary directory.
    pub fn with_scratch_directory(mut self, directory: impl AsRef<Path>) -> Self {
        self.scratch_directory = Some(directory.as_ref().to_path_buf());
        self
    }

    /// Selects whether persistent-index header and section checksums are
    /// calculated during construction and verified while the artifact is read.
    /// `Skip` retains the checksum-table slots for the existing format but
    /// writes zero markers instead of calculating checksums; such an artifact
    /// must be reopened with `Skip`.
    #[must_use]
    pub const fn with_checksum_policy(mut self, checksum_policy: ChecksumPolicy) -> Self {
        self.checksum_policy = checksum_policy;
        self
    }

    /// Returns the maximum accepted or generated index-file length.
    pub const fn max_index_bytes(&self) -> u64 {
        self.max_index_bytes
    }

    /// Returns the maximum combined header and checksum-table length.
    pub const fn max_metadata_bytes(&self) -> usize {
        self.max_metadata_bytes
    }
    /// Returns the additional construction-memory ceiling.
    pub const fn build_memory_bytes(&self) -> usize {
        self.build_memory_bytes
    }
    /// Returns the section-chunk length and maximum size of each retained
    /// per-section byte buffer.
    pub const fn chunk_bytes(&self) -> usize {
        self.chunk_bytes
    }

    /// Returns the optional caller-selected scratch directory.
    pub fn scratch_directory(&self) -> Option<&Path> {
        self.scratch_directory.as_deref()
    }

    /// Returns the persistent-index checksum policy.
    pub const fn checksum_policy(&self) -> ChecksumPolicy {
        self.checksum_policy
    }
}

impl Default for KeyIndexOptions {
    fn default() -> Self {
        Self::new()
    }
}

/// Lightweight source identity bound into a persistent key index.
///
/// The modification time is the exact value returned by
/// [`std::fs::Metadata::modified`], expressed as signed nanoseconds relative to
/// the Unix epoch. Its real precision is determined by the source filesystem.
/// Persistent indexing is unavailable when that metadata is unavailable.
/// This stamp detects ordinary staleness; it is neither a content hash nor a
/// cross-path identity. Hosts must namespace cached artifacts by the source's
/// stable location and [`KEY_INDEX_REVISION`], then use this value as that
/// location's freshness stamp.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyIndexSourceIdentity {
    pub(crate) source_bytes: u64,
    pub(crate) source_modified_unix_nanos: i128,
    pub(crate) key_count: u64,
}

impl KeyIndexSourceIdentity {
    /// Reconstructs a previously persisted source identity.
    pub const fn new(source_bytes: u64, source_modified_unix_nanos: i128, key_count: u64) -> Self {
        Self {
            source_bytes,
            source_modified_unix_nanos,
            key_count,
        }
    }

    /// Returns the complete source-file byte length.
    pub const fn source_bytes(self) -> u64 {
        self.source_bytes
    }

    /// Returns the source modification time as signed Unix nanoseconds.
    pub const fn source_modified_unix_nanos(self) -> i128 {
        self.source_modified_unix_nanos
    }

    /// Returns the number of physical key rows.
    pub const fn key_count(self) -> u64 {
        self.key_count
    }
}

/// Result of writing one complete persistent key index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyIndexBuild {
    pub(crate) source_identity: KeyIndexSourceIdentity,
    pub(crate) bytes_written: u64,
}

impl KeyIndexBuild {
    /// Returns the source identity captured from the same open source handle
    /// used to build the index.
    pub const fn source_identity(self) -> KeyIndexSourceIdentity {
        self.source_identity
    }

    /// Returns the exact number of artifact bytes written.
    pub const fn bytes_written(self) -> u64 {
        self.bytes_written
    }
}

/// Structured reason why a persistent key index could not be trusted.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum KeyIndexRejection {
    /// The file does not carry the key-index magic.
    InvalidMagic,
    /// The file uses an unsupported on-disk format revision.
    UnsupportedFormatRevision {
        /// Revision read from the file.
        found: u32,
    },
    /// The file's byte-order marker is not the required marker.
    UnsupportedEndianMarker {
        /// Marker read from the file.
        found: u32,
    },
    /// The file was created by an incompatible parser/layout revision.
    IncompatibleParserRevision {
        /// Revision read from the file.
        found: u32,
    },
    /// The file was created by an incompatible normalization revision.
    IncompatibleNormalizationRevision {
        /// Revision read from the file.
        found: u32,
    },
    /// The embedded source identity differs from the caller's expected value.
    SourceIdentityMismatch,
    /// The current open source length differs from the bound identity.
    SourceLengthMismatch {
        /// Length bound into the identity.
        expected: u64,
        /// Length of the current open source.
        actual: u64,
    },
    /// The current source modification time differs from the bound identity.
    SourceModifiedMismatch {
        /// Modification time bound into the identity, in Unix nanoseconds.
        expected: i128,
        /// Modification time of the current open source, in Unix nanoseconds.
        actual: i128,
    },
    /// The current parsed key count differs from the bound identity.
    KeyCountMismatch {
        /// Count bound into the identity.
        expected: u64,
        /// Count in the current parsed source.
        actual: u64,
    },
    /// The physical file length differs from its header declaration.
    FileLengthMismatch {
        /// Length declared by the header.
        declared: u64,
        /// Physical file length.
        actual: u64,
    },
    /// Header or section geometry violates a fixed invariant.
    InvalidLayout(&'static str),
    /// A checksummed header or section chunk was modified or truncated.
    ChecksumMismatch {
        /// Stable section name (`header`, `text`, `bounds`, `raw`, or `order`).
        section: &'static str,
        /// Zero-based section chunk, or `None` for the header.
        chunk: Option<u64>,
        /// Checksum declared by the index.
        expected: u32,
        /// Checksum calculated from the bytes read.
        actual: u32,
    },
    /// An index candidate did not agree with the current source key row.
    SourceKeyMismatch {
        /// Physical source row that failed positive-result verification.
        ordinal: KeyOrdinal,
    },
}

impl fmt::Display for KeyIndexRejection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidMagic => formatter.write_str("invalid magic"),
            Self::UnsupportedFormatRevision { found } => {
                write!(formatter, "unsupported format revision {found}")
            }
            Self::UnsupportedEndianMarker { found } => {
                write!(formatter, "unsupported endian marker {found:#010x}")
            }
            Self::IncompatibleParserRevision { found } => {
                write!(formatter, "incompatible parser revision {found}")
            }
            Self::IncompatibleNormalizationRevision { found } => {
                write!(formatter, "incompatible normalization revision {found}")
            }
            Self::SourceIdentityMismatch => formatter.write_str("source identity mismatch"),
            Self::SourceLengthMismatch { expected, actual } => write!(
                formatter,
                "source length mismatch: expected {expected}, got {actual}"
            ),
            Self::SourceModifiedMismatch { expected, actual } => write!(
                formatter,
                "source modification time mismatch: expected {expected}, got {actual}"
            ),
            Self::KeyCountMismatch { expected, actual } => write!(
                formatter,
                "source key-count mismatch: expected {expected}, got {actual}"
            ),
            Self::FileLengthMismatch { declared, actual } => write!(
                formatter,
                "file length mismatch: declared {declared}, got {actual}"
            ),
            Self::InvalidLayout(reason) => write!(formatter, "invalid layout: {reason}"),
            Self::ChecksumMismatch {
                section,
                chunk,
                expected,
                actual,
            } => match chunk {
                Some(chunk) => write!(
                    formatter,
                    "checksum mismatch for {section} chunk {chunk}: expected {expected:#010x}, got {actual:#010x}"
                ),
                None => write!(
                    formatter,
                    "checksum mismatch for {section}: expected {expected:#010x}, got {actual:#010x}"
                ),
            },
            Self::SourceKeyMismatch { ordinal } => {
                write!(
                    formatter,
                    "source key mismatch at ordinal {}",
                    ordinal.get()
                )
            }
        }
    }
}

impl std::error::Error for KeyIndexRejection {}

/// Open, source-bound persistent key index.
///
/// Header validation is eager; section verification is lazy. Unkeyed checksums
/// detect accidental corruption, not adversarial replacement.
/// Treat the sidecar as a local, disposable cache rather than authenticated
/// source material.
#[derive(Clone)]
pub struct KeyIndex {
    pub(crate) inner: Arc<PersistentKeyIndex>,
}

impl KeyIndex {
    pub(crate) fn new(inner: PersistentKeyIndex) -> Self {
        Self {
            inner: Arc::new(inner),
        }
    }
    /// Returns the exact source identity embedded in this index.
    pub fn source_identity(&self) -> KeyIndexSourceIdentity {
        self.inner.source_identity()
    }

    /// Returns the number of physical key rows represented by this index.
    pub fn len(&self) -> u64 {
        self.inner.len()
    }

    /// Returns whether the index represents no key rows.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl fmt::Debug for KeyIndex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("KeyIndex")
            .field("revision", &KEY_INDEX_REVISION)
            .field("rows", &self.len())
            .field("source_bytes", &self.source_identity().source_bytes())
            .finish_non_exhaustive()
    }
}
