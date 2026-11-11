use std::fs::File;

use super::MdictFile;
use crate::index::{KeyIndexBuild, KeyIndexSourceIdentity};

mod build;
mod cache;
mod format;
mod query;
mod sort;

pub(crate) use build::{build_to_path, build_to_writer, source_identity};
pub(crate) use cache::{PersistentKeyIndex, open};
pub(crate) use query::{locate, locate_case_variants, locate_page, prefix, scan};

const MAGIC: [u8; 8] = *b"MDKIDX01";
const ENDIAN_MARKER: u32 = 0x0102_0304;
const SECTION_COUNT: usize = 4;
const HEADER_FIELDS_BYTES: usize = 216;
const HEADER_BYTES: usize = 224;
const HEADER_PREFIX_BYTES: usize = 24;
const HEADER_CHECKSUM_BYTES: usize = 4;
const CHECKSUM_PAGE_BYTES: usize = 4 * 1024;
const MAX_MERGE_FAN_IN: usize = 32;
const MIN_BUILD_MEMORY_BYTES: usize = 256;
const MIN_CHUNK_BYTES: usize = 64;
const RUN_READ_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SectionKind {
    Text,
    Bounds,
    Raw,
    Order,
}

impl SectionKind {
    const fn index(self) -> usize {
        match self {
            Self::Text => 0,
            Self::Bounds => 1,
            Self::Raw => 2,
            Self::Order => 3,
        }
    }

    const fn name(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Bounds => "bounds",
            Self::Raw => "raw",
            Self::Order => "order",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct SectionDescriptor {
    offset: u64,
    len: u64,
    checksum_start: u64,
    checksum_count: u64,
}

impl SectionDescriptor {
    const EMPTY: Self = Self {
        offset: 0,
        len: 0,
        checksum_start: 0,
        checksum_count: 0,
    };
}

#[derive(Debug)]
pub(crate) struct IndexHeader {
    header_len: u64,
    total_len: u64,
    chunk_bytes: u32,
    source_identity: KeyIndexSourceIdentity,
    normalized_text_len: u64,
    sections: [SectionDescriptor; SECTION_COUNT],
    checksum_count: u64,
}

#[derive(Debug)]
pub(crate) struct BuiltIndex {
    header: Vec<u8>,
    sections: [SectionFile; SECTION_COUNT],
    descriptors: [SectionDescriptor; SECTION_COUNT],
    report: KeyIndexBuild,
}

#[derive(Debug)]
pub(crate) struct SectionFile {
    kind: SectionKind,
    file: File,
    len: u64,
    checksums: Vec<u32>,
}

#[cfg(test)]
mod tests;
