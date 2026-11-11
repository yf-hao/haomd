use std::fmt;

use crate::index::KeyIndexRejection;

/// Result type returned by `mdictlib` operations.
pub type Result<T> = std::result::Result<T, Error>;

/// An error reported while configuring, opening, or reading an MDict file or
/// its caller-managed persistent key index.
#[derive(Debug)]
#[non_exhaustive]
pub enum Error {
    /// An underlying file or destination I/O operation failed.
    Io(std::io::Error),
    /// The file violates a fixed structural invariant.
    InvalidFormat(&'static str),
    /// File-derived data is internally inconsistent or malformed.
    InvalidData(String),
    /// A bounded input ended before a required field could be read.
    Truncated {
        /// Description of the field or section being read.
        context: &'static str,
        /// Number of bytes required by the operation.
        needed: usize,
        /// Number of bytes that remained in the bounded input.
        remaining: usize,
    },
    /// A file-derived value exceeded a configured safety ceiling.
    LimitExceeded {
        /// Stable name of the limit that was exceeded.
        limit: &'static str,
        /// Value requested or declared by the file.
        value: u64,
        /// Maximum value accepted by the reader.
        max: u64,
    },
    /// A bounded allocation could not be reserved without panicking.
    AllocationFailed {
        /// Description of the allocation being attempted.
        context: &'static str,
        /// Total number of bytes requested from the allocator, when known.
        requested: u64,
    },
    /// A section or block checksum did not match its payload.
    ChecksumMismatch {
        /// Description of the section or block being verified.
        context: &'static str,
        /// Checksum declared by the file.
        expected: u32,
        /// Checksum calculated from the payload.
        actual: u32,
    },
    /// Text bytes could not be decoded with the declared encoding.
    Decode {
        /// Description of the text field being decoded.
        context: &'static str,
        /// Canonical name of the attempted encoding.
        encoding: &'static str,
    },
    /// An encrypted dictionary requires passcode material that was not supplied.
    MissingPasscode,
    /// Caller-supplied passcode material is malformed.
    InvalidPasscode(&'static str),
    /// The file requests a format feature that this build does not support.
    Unsupported(&'static str),
    /// A persistent key index was rejected before or while it was used.
    KeyIndexRejected(KeyIndexRejection),
    /// A caller-cancellable operation was cancelled at a checkpoint.
    Cancelled {
        /// Stable name of the cancelled operation.
        operation: &'static str,
    },
    /// Source bytes changed while an operation that requires a stable source ran.
    SourceChanged {
        /// Stable name of the operation that observed the change.
        operation: &'static str,
    },
}

impl Error {
    pub(crate) fn truncated(context: &'static str, needed: usize, remaining: usize) -> Self {
        Self::Truncated {
            context,
            needed,
            remaining,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "I/O error: {error}"),
            Self::InvalidFormat(context) => write!(f, "invalid format: {context}"),
            Self::InvalidData(context) => write!(f, "invalid data: {context}"),
            Self::Truncated {
                context,
                needed,
                remaining,
            } => write!(
                f,
                "truncated {context}: need {needed} bytes, have {remaining}"
            ),
            Self::LimitExceeded { limit, value, max } => {
                write!(f, "limit exceeded for {limit}: {value} > {max}")
            }
            Self::AllocationFailed { context, requested } => {
                write!(f, "failed to reserve {requested} bytes for {context}")
            }
            Self::ChecksumMismatch {
                context,
                expected,
                actual,
            } => write!(
                f,
                "checksum mismatch for {context}: expected {expected:#010x}, got {actual:#010x}"
            ),
            Self::Decode { context, encoding } => {
                write!(f, "failed to decode {context} using {encoding}")
            }
            Self::MissingPasscode => write!(f, "dictionary requires a passcode"),
            Self::InvalidPasscode(context) => write!(f, "invalid passcode: {context}"),
            Self::Unsupported(feature) => write!(f, "unsupported feature: {feature}"),
            Self::KeyIndexRejected(reason) => write!(f, "key index rejected: {reason}"),
            Self::Cancelled { operation } => write!(f, "{operation} was cancelled"),
            Self::SourceChanged { operation } => {
                write!(f, "source changed while {operation} was running")
            }
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::KeyIndexRejected(reason) => Some(reason),
            _ => None,
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}
