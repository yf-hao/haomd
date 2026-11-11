//! Narrow adapters used by the out-of-package fuzz harness.

use crate::format::common::compression::decode_block;
use crate::format::common::header::parse_header_bytes;
use crate::types::{ChecksumPolicy, ContainerKind, Limits};

/// Exercises both supported top-level header tags without exposing parser
/// implementation types as public API.
pub fn exercise_header_bytes(data: &[u8]) {
    let _ = parse_header_bytes(data, ContainerKind::Mdx);
    let _ = parse_header_bytes(data, ContainerKind::Mdd);
}

/// Exercises compressed-block decoding without exposing codec internals.
pub fn exercise_compressed_block(data: &[u8], expected_len: usize) {
    let _ = decode_block(
        "fuzz block",
        data,
        expected_len,
        &Limits::new(),
        ChecksumPolicy::Skip,
    );
}
