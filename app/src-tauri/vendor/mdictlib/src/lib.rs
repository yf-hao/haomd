//! Library-first parser for MDict `.mdx` and `.mdd` files.
//!
//! MDX and MDD share one defensive, file-backed parsing core. Opening parses
//! bounded metadata and block indexes; key and record blocks remain lazy.
//!
//! Physical ordinals preserve duplicate identity. By default, raw-exact lookup
//! wins before header-normalized fallback. MDX can opt into [`MatchMode`] to
//! include case variants after exact rows. MDD resources can be streamed through
//! source-bound spans. Per-open limits bound untrusted input and parser work.
//! MDX callers may optionally build a bounded, source-bound persistent key
//! index and reopen it through safe lazy positional reads; artifact placement
//! and publication remain caller-owned.
//! MDict wire checksum comparisons are controlled by [`ChecksumPolicy`] and
//! default to [`ChecksumPolicy::Skip`] for throughput; structural parsing and
//! decompression validation remain enabled.
//! Plaintext version 2 dictionaries can be created with [`MdxBuilder`] and
//! [`MddBuilder`], and existing MDX files can be rebuilt with an [`EditSet`]
//! applied through [`rebuild_mdx`]. Open version 2 files can also be decoded
//! and re-encoded wholesale through [`reencode_mdx`] and [`reencode_mdd`]:
//! every block is decoded and re-emitted with the same structure, so
//! uncompressed sources come back byte-identical and zlib sources differ
//! only inside compressed streams.
//!
//! # Wire versions
//!
//! MDict major versions 1 and 2 are both read through this API. The version is
//! resolved once, from the header, and selects one grammar; it never reaches
//! lookup, iteration, ordinal access, record decoding, or MDD streaming. A file
//! that fails one grammar is never retried under the other.
//!
//! Version 1 support covers unencrypted files using uncompressed or LZO blocks.
//! Encrypted version 1 files and the ISO8859-1 text label are refused with a
//! precise error rather than parsed speculatively.

#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![warn(clippy::missing_errors_doc)]

mod core;
mod edit;
mod error;
mod format;
mod index;
mod limits;
mod lookup;
mod mdd;
mod mdx;
mod reencode;
mod types;
mod write;

#[cfg(fuzzing)]
#[doc(hidden)]
pub mod fuzzing;

pub use edit::{EditSet, rebuild_mdx};
pub use error::{Error, Result};
pub use index::{
    KEY_INDEX_FORMAT_REVISION, KEY_INDEX_NORMALIZATION_REVISION, KEY_INDEX_PARSER_REVISION,
    KEY_INDEX_REVISION, KeyIndex, KeyIndexBuild, KeyIndexOptions, KeyIndexRejection,
    KeyIndexSourceIdentity,
};
pub use lookup::{KeyMatchPage, KeyMatches, MatchBasis, MatchMode};
pub use mdd::{MddFile, MddResource, MddResourceSpan};
pub use mdx::{MdxEntry, MdxFile};
pub use reencode::{reencode_mdd, reencode_mdx};
pub use types::{
    ChecksumPolicy, Header, KeyEntry, KeyOrdinal, Limits, MemoryUsage, OpenOptions, Passcode,
};
pub use write::{
    MddBuilder, MdxBuilder, WriteCompression, WriteEncoding, WriteOptions, WriteSummary,
};
