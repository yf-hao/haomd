use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::Arc;

use super::MIN_BUILD_MEMORY_BYTES;
use super::cache::IndexSource;
use super::{
    BuiltIndex, ENDIAN_MARKER, HEADER_BYTES, HEADER_CHECKSUM_BYTES, HEADER_FIELDS_BYTES,
    HEADER_PREFIX_BYTES, IndexHeader, MAGIC, MIN_CHUNK_BYTES, SECTION_COUNT, SectionDescriptor,
    SectionFile, SectionKind,
};
use crate::error::{Error, Result};
use crate::format::common::checksum::adler32;
use crate::index::{
    KEY_INDEX_FORMAT_REVISION, KEY_INDEX_NORMALIZATION_REVISION, KEY_INDEX_PARSER_REVISION,
    KeyIndexOptions, KeyIndexRejection, KeyIndexSourceIdentity,
};
use crate::limits::{
    MemoryBudget, checked_usize, ensure_u64_ceiling, ensure_usize_limit, try_reserve_vec,
};
use crate::types::ChecksumPolicy;

pub(super) fn build_header(
    sections: &[SectionFile; SECTION_COUNT],
    identity: KeyIndexSourceIdentity,
    normalized_text_len: u64,
    options: &KeyIndexOptions,
) -> Result<(Vec<u8>, [SectionDescriptor; SECTION_COUNT], u64)> {
    let chunk_bytes = u32::try_from(options.chunk_bytes)
        .map_err(|_| Error::InvalidData("key-index chunk size exceeds u32".to_owned()))?;
    let header_len = u64::try_from(HEADER_BYTES)
        .map_err(|_| Error::InvalidFormat("key-index header length exceeds u64"))?;
    ensure_usize_limit(
        "key_index_header_bytes",
        HEADER_BYTES,
        options.max_metadata_bytes,
    )?;

    let mut checksum_count = 0u64;
    for section in sections {
        let expected = chunk_count(section.len, u64::from(chunk_bytes))?;
        let actual = u64::try_from(section.checksums.len())
            .map_err(|_| Error::InvalidFormat("key-index checksum count exceeds u64"))?;
        if actual != expected {
            return Err(Error::InvalidFormat(
                "key-index section checksum count mismatch",
            ));
        }
        checksum_count = checksum_count
            .checked_add(actual)
            .ok_or(Error::InvalidFormat("key-index checksum count overflow"))?;
    }
    let checksum_bytes = checksum_count
        .checked_mul(4)
        .ok_or(Error::InvalidFormat("key-index checksum table overflow"))?;
    let metadata_bytes = header_len
        .checked_add(checksum_bytes)
        .ok_or(Error::InvalidFormat("key-index metadata length overflow"))?;
    ensure_u64_ceiling(
        "key_index_metadata_bytes",
        metadata_bytes,
        u64::try_from(options.max_metadata_bytes).unwrap_or(u64::MAX),
    )?;

    let mut descriptors = [SectionDescriptor::EMPTY; SECTION_COUNT];
    let mut offset = align8(header_len.checked_add(checksum_bytes).ok_or(
        Error::InvalidFormat("key-index checksum table end overflow"),
    )?)?;
    let mut checksum_start = 0u64;
    for section in sections {
        offset = align8(offset)?;
        let checksum_len = u64::try_from(section.checksums.len())
            .map_err(|_| Error::InvalidFormat("key-index checksum count exceeds u64"))?;
        descriptors[section.kind.index()] = SectionDescriptor {
            offset,
            len: section.len,
            checksum_start,
            checksum_count: checksum_len,
        };
        checksum_start = checksum_start
            .checked_add(checksum_len)
            .ok_or(Error::InvalidFormat("key-index checksum index overflow"))?;
        offset = offset
            .checked_add(section.len)
            .ok_or(Error::InvalidFormat("key-index section end overflow"))?;
    }
    let total_len = offset;
    ensure_u64_ceiling("key_index_bytes", total_len, options.max_index_bytes)?;

    let mut header = Vec::new();
    try_reserve_vec(&mut header, HEADER_BYTES, "key-index header")?;
    header.extend_from_slice(&MAGIC);
    push_u32(&mut header, KEY_INDEX_FORMAT_REVISION);
    push_u32(&mut header, ENDIAN_MARKER);
    push_u64(&mut header, header_len);
    push_u64(&mut header, total_len);
    push_u32(&mut header, KEY_INDEX_PARSER_REVISION);
    push_u32(&mut header, KEY_INDEX_NORMALIZATION_REVISION);
    push_u32(&mut header, chunk_bytes);
    push_u32(
        &mut header,
        u32::try_from(SECTION_COUNT)
            .map_err(|_| Error::InvalidFormat("section count exceeds u32"))?,
    );
    push_u64(&mut header, identity.source_bytes);
    push_i128(&mut header, identity.source_modified_unix_nanos);
    push_u64(&mut header, identity.key_count);
    push_u64(&mut header, normalized_text_len);
    for descriptor in descriptors {
        push_u64(&mut header, descriptor.offset);
        push_u64(&mut header, descriptor.len);
        push_u64(&mut header, descriptor.checksum_start);
        push_u64(&mut header, descriptor.checksum_count);
    }
    if header.len() != HEADER_FIELDS_BYTES {
        return Err(Error::InvalidFormat(
            "key-index fixed header field length mismatch",
        ));
    }
    let checksum_at = HEADER_BYTES - HEADER_CHECKSUM_BYTES;
    header.resize(checksum_at, 0);
    let checksum = if options.checksum_policy == ChecksumPolicy::Verify {
        adler32(&header)
    } else {
        0
    };
    push_u32(&mut header, checksum);
    if header.len() != HEADER_BYTES {
        return Err(Error::InvalidFormat("key-index header length mismatch"));
    }
    Ok((header, descriptors, total_len))
}

pub(crate) fn read_index_header(
    source: &IndexSource,
    memory: &Arc<MemoryBudget>,
    options: &KeyIndexOptions,
    checksum_policy: ChecksumPolicy,
) -> Result<IndexHeader> {
    if source.len < u64::try_from(HEADER_PREFIX_BYTES).unwrap_or(u64::MAX) {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "truncated header prefix",
        )));
    }
    let prefix_memory =
        memory.reserve(HEADER_PREFIX_BYTES, "persistent key-index header prefix")?;
    let prefix = source.read_exact(0, HEADER_PREFIX_BYTES)?;
    if prefix.get(0..8) != Some(MAGIC.as_slice()) {
        return Err(reject(KeyIndexRejection::InvalidMagic));
    }
    let format_revision = read_u32_slice(&prefix, 8)?;
    if format_revision != KEY_INDEX_FORMAT_REVISION {
        return Err(reject(KeyIndexRejection::UnsupportedFormatRevision {
            found: format_revision,
        }));
    }
    let endian = read_u32_slice(&prefix, 12)?;
    if endian != ENDIAN_MARKER {
        return Err(reject(KeyIndexRejection::UnsupportedEndianMarker {
            found: endian,
        }));
    }
    let header_len = read_u64_slice(&prefix, 16)?;
    drop(prefix);
    drop(prefix_memory);
    let header_len_usize = checked_usize(header_len, "persistent key-index header length")?;
    ensure_usize_limit(
        "key_index_header_bytes",
        header_len_usize,
        options.max_metadata_bytes,
    )?;
    if header_len_usize != HEADER_BYTES || header_len > source.len {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "invalid header length",
        )));
    }
    let _header_memory = memory.reserve(header_len_usize, "persistent key-index header")?;
    let header_bytes = source.read_exact(0, header_len_usize)?;
    let checksum_at = header_len_usize - HEADER_CHECKSUM_BYTES;
    let expected = read_u32_slice(&header_bytes, checksum_at)?;
    if checksum_policy == ChecksumPolicy::Verify {
        let actual = adler32(&header_bytes[..checksum_at]);
        if expected != actual {
            return Err(reject(KeyIndexRejection::ChecksumMismatch {
                section: "header",
                chunk: None,
                expected,
                actual,
            }));
        }
    }
    parse_header(&header_bytes, source.len, options)
}

pub(crate) fn parse_header(
    bytes: &[u8],
    actual_len: u64,
    options: &KeyIndexOptions,
) -> Result<IndexHeader> {
    let mut cursor = HeaderCursor::new(bytes);
    let magic = cursor.read_array::<8>()?;
    if magic != MAGIC {
        return Err(reject(KeyIndexRejection::InvalidMagic));
    }
    let format_revision = cursor.read_u32()?;
    if format_revision != KEY_INDEX_FORMAT_REVISION {
        return Err(reject(KeyIndexRejection::UnsupportedFormatRevision {
            found: format_revision,
        }));
    }
    let endian = cursor.read_u32()?;
    if endian != ENDIAN_MARKER {
        return Err(reject(KeyIndexRejection::UnsupportedEndianMarker {
            found: endian,
        }));
    }
    let header_len = cursor.read_u64()?;
    if header_len != u64::try_from(bytes.len()).unwrap_or(u64::MAX) {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "header length changed while parsing",
        )));
    }
    let total_len = cursor.read_u64()?;
    if total_len != actual_len {
        return Err(reject(KeyIndexRejection::FileLengthMismatch {
            declared: total_len,
            actual: actual_len,
        }));
    }
    ensure_u64_ceiling("key_index_bytes", total_len, options.max_index_bytes)?;
    let parser_revision = cursor.read_u32()?;
    if parser_revision != KEY_INDEX_PARSER_REVISION {
        return Err(reject(KeyIndexRejection::IncompatibleParserRevision {
            found: parser_revision,
        }));
    }
    let normalization_revision = cursor.read_u32()?;
    if normalization_revision != KEY_INDEX_NORMALIZATION_REVISION {
        return Err(reject(
            KeyIndexRejection::IncompatibleNormalizationRevision {
                found: normalization_revision,
            },
        ));
    }
    let chunk_bytes = cursor.read_u32()?;
    let maximum_chunk_bytes = u64::try_from(options.chunk_bytes)
        .map_err(|_| Error::InvalidData("key-index chunk limit exceeds u64".to_owned()))?;
    if chunk_bytes < u32::try_from(MIN_CHUNK_BYTES).unwrap_or(u32::MAX)
        || !chunk_bytes.is_power_of_two()
    {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "chunk length is not a supported power of two",
        )));
    }
    if u64::from(chunk_bytes) > maximum_chunk_bytes {
        return Err(Error::LimitExceeded {
            limit: "key_index_chunk_bytes",
            value: u64::from(chunk_bytes),
            max: u64::try_from(options.chunk_bytes).unwrap_or(u64::MAX),
        });
    }
    let section_count = cursor.read_u32()?;
    if section_count
        != u32::try_from(SECTION_COUNT).map_err(|_| {
            reject(KeyIndexRejection::InvalidLayout(
                "section count exceeds u32",
            ))
        })?
    {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "unexpected section count",
        )));
    }
    let source_bytes = cursor.read_u64()?;
    let source_modified_unix_nanos = cursor.read_i128()?;
    let key_count = cursor.read_u64()?;
    if key_count > u64::from(u32::MAX) {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "key count exceeds ordinal representation",
        )));
    }
    let normalized_text_len = cursor.read_u64()?;
    let source_identity = KeyIndexSourceIdentity {
        source_bytes,
        source_modified_unix_nanos,
        key_count,
    };
    let mut sections = [SectionDescriptor::EMPTY; SECTION_COUNT];
    for descriptor in &mut sections {
        *descriptor = SectionDescriptor {
            offset: cursor.read_u64()?,
            len: cursor.read_u64()?,
            checksum_start: cursor.read_u64()?,
            checksum_count: cursor.read_u64()?,
        };
    }

    let mut expected_checksum_start = 0u64;
    for descriptor in sections {
        if descriptor.checksum_start != expected_checksum_start {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "checksum ranges are not contiguous",
            )));
        }
        let expected_count = chunk_count(descriptor.len, u64::from(chunk_bytes))?;
        if descriptor.checksum_count != expected_count {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "section checksum count is inconsistent",
            )));
        }
        expected_checksum_start = expected_checksum_start
            .checked_add(descriptor.checksum_count)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("checksum count overflow")))?;
    }
    let checksum_bytes = expected_checksum_start
        .checked_mul(4)
        .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("checksum table overflow")))?;
    let metadata_bytes = header_len
        .checked_add(checksum_bytes)
        .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("metadata length overflow")))?;
    ensure_u64_ceiling(
        "key_index_metadata_bytes",
        metadata_bytes,
        u64::try_from(options.max_metadata_bytes).unwrap_or(u64::MAX),
    )?;
    let padding_end = bytes
        .len()
        .checked_sub(HEADER_CHECKSUM_BYTES)
        .ok_or_else(|| {
            reject(KeyIndexRejection::InvalidLayout(
                "header checksum underflow",
            ))
        })?;
    if cursor.position > padding_end
        || bytes[cursor.position..padding_end]
            .iter()
            .any(|byte| *byte != 0)
    {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "header padding is not zero",
        )));
    }

    let bounds_len = key_count
        .checked_add(1)
        .and_then(|count| count.checked_mul(8))
        .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("bounds length overflow")))?;
    let row_array_len = key_count.checked_mul(4).ok_or_else(|| {
        reject(KeyIndexRejection::InvalidLayout(
            "row array length overflow",
        ))
    })?;
    if sections[SectionKind::Text.index()].len != normalized_text_len
        || sections[SectionKind::Bounds.index()].len != bounds_len
        || sections[SectionKind::Raw.index()].len != row_array_len
        || sections[SectionKind::Order.index()].len != row_array_len
    {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "section lengths do not match header counts",
        )));
    }
    Ok(IndexHeader {
        header_len,
        total_len,
        chunk_bytes,
        source_identity,
        normalized_text_len,
        sections,
        checksum_count: expected_checksum_start,
    })
}

pub(super) fn validate_section_layout(source: &IndexSource, header: &IndexHeader) -> Result<()> {
    let checksum_bytes = header
        .checksum_count
        .checked_mul(4)
        .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("checksum table overflow")))?;
    let mut cursor = header
        .header_len
        .checked_add(checksum_bytes)
        .ok_or_else(|| {
            reject(KeyIndexRejection::InvalidLayout(
                "checksum table end overflow",
            ))
        })?;
    if !cursor.is_multiple_of(8) {
        cursor = align8(cursor)?;
    }
    for descriptor in header.sections {
        let aligned = align8(cursor)?;
        if descriptor.offset != aligned || !descriptor.offset.is_multiple_of(8) {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "sections are not ordered and aligned",
            )));
        }
        cursor = descriptor
            .offset
            .checked_add(descriptor.len)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("section end overflow")))?;
        if cursor > source.len {
            return Err(reject(KeyIndexRejection::InvalidLayout(
                "section exceeds file length",
            )));
        }
    }
    if cursor != header.total_len {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "last section does not end at total length",
        )));
    }
    Ok(())
}

pub(crate) fn write_built_index<W, C>(
    built: &mut BuiltIndex,
    destination: &mut W,
    buffer_bytes: usize,
    cancelled: &mut C,
) -> Result<()>
where
    W: Write + Seek + ?Sized,
    C: FnMut() -> bool,
{
    destination.seek(SeekFrom::Start(0))?;
    destination.write_all(&built.header)?;
    for section in &built.sections {
        for checksum in &section.checksums {
            write_u32(destination, *checksum)?;
        }
    }
    for (section, descriptor) in built.sections.iter_mut().zip(built.descriptors) {
        check_cancelled(cancelled, "writing persistent key index")?;
        pad_to(destination, descriptor.offset)?;
        section.file.seek(SeekFrom::Start(0))?;
        copy_exact(
            &mut section.file,
            destination,
            section.len,
            buffer_bytes,
            cancelled,
        )?;
    }
    destination.flush()?;
    let written = destination.stream_position()?;
    if written != built.report.bytes_written {
        return Err(Error::InvalidFormat("generated key-index length mismatch"));
    }
    let destination_len = destination.seek(SeekFrom::End(0))?;
    if destination_len != built.report.bytes_written {
        return Err(Error::InvalidFormat(
            "key-index destination was not empty or truncated",
        ));
    }
    destination.seek(SeekFrom::Start(written))?;
    Ok(())
}

fn copy_exact<R, W, C>(
    source: &mut R,
    destination: &mut W,
    len: u64,
    buffer_bytes: usize,
    cancelled: &mut C,
) -> Result<()>
where
    R: Read + ?Sized,
    W: Write + ?Sized,
    C: FnMut() -> bool,
{
    let buffer_bytes_u64 = u64::try_from(buffer_bytes)
        .map_err(|_| Error::InvalidFormat("key-index copy buffer exceeds u64"))?;
    let mut buffer = Vec::new();
    try_reserve_vec(&mut buffer, buffer_bytes, "key-index copy buffer")?;
    buffer.resize(buffer_bytes, 0);
    let mut remaining = len;
    while remaining > 0 {
        check_cancelled(cancelled, "writing persistent key index")?;
        let read_len = checked_usize(remaining.min(buffer_bytes_u64), "key-index copy length")?;
        source.read_exact(&mut buffer[..read_len])?;
        destination.write_all(&buffer[..read_len])?;
        remaining = remaining
            .checked_sub(
                u64::try_from(read_len)
                    .map_err(|_| Error::InvalidFormat("key-index copy length exceeds u64"))?,
            )
            .ok_or(Error::InvalidFormat("key-index copy remaining underflow"))?;
    }
    Ok(())
}

fn pad_to<W>(file: &mut W, target: u64) -> Result<()>
where
    W: Write + Seek + ?Sized,
{
    let current = file.stream_position()?;
    if current > target {
        return Err(Error::InvalidFormat(
            "key-index section overlaps predecessor",
        ));
    }
    let padding = checked_usize(target - current, "key-index section padding")?;
    if padding > 7 {
        return Err(Error::InvalidFormat(
            "key-index section padding exceeds alignment",
        ));
    }
    file.write_all(&[0; 7][..padding])?;
    Ok(())
}

pub(crate) fn scratch_file(options: &KeyIndexOptions, fallback: Option<&Path>) -> Result<File> {
    if let Some(directory) = options.scratch_directory.as_deref().or(fallback) {
        Ok(tempfile::tempfile_in(directory)?)
    } else {
        Ok(tempfile::tempfile()?)
    }
}

pub(super) fn validate_options(options: &KeyIndexOptions) -> Result<()> {
    if options.build_memory_bytes < MIN_BUILD_MEMORY_BYTES {
        return Err(Error::InvalidData(format!(
            "key-index build memory must be at least {MIN_BUILD_MEMORY_BYTES} bytes"
        )));
    }
    let maximum_chunk_bytes = options
        .build_memory_bytes
        .min(usize::try_from(u32::MAX).unwrap_or(usize::MAX));
    if options.chunk_bytes < MIN_CHUNK_BYTES
        || options.chunk_bytes > maximum_chunk_bytes
        || !options.chunk_bytes.is_power_of_two()
    {
        return Err(Error::InvalidData(format!(
            "key-index chunk bytes must be a power of two from {MIN_CHUNK_BYTES} through {maximum_chunk_bytes}"
        )));
    }
    let minimum_metadata = HEADER_BYTES;
    if options.max_metadata_bytes < minimum_metadata {
        return Err(Error::InvalidData(format!(
            "key-index metadata limit must be at least {minimum_metadata} bytes"
        )));
    }
    Ok(())
}

pub(crate) fn check_cancelled<C>(cancelled: &mut C, operation: &'static str) -> Result<()>
where
    C: FnMut() -> bool,
{
    if cancelled() {
        Err(Error::Cancelled { operation })
    } else {
        Ok(())
    }
}

pub(crate) fn chunk_count(len: u64, chunk_bytes: u64) -> Result<u64> {
    if chunk_bytes == 0 {
        return Err(reject(KeyIndexRejection::InvalidLayout(
            "chunk length is zero",
        )));
    }
    if len == 0 {
        return Ok(0);
    }
    len.checked_add(chunk_bytes - 1)
        .map(|value| value / chunk_bytes)
        .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("chunk count overflow")))
}

pub(crate) fn align8(value: u64) -> Result<u64> {
    value.checked_add(7).map(|value| value & !7).ok_or_else(|| {
        reject(KeyIndexRejection::InvalidLayout(
            "section alignment overflow",
        ))
    })
}

pub(super) fn reject(reason: KeyIndexRejection) -> Error {
    Error::KeyIndexRejected(reason)
}

pub(crate) fn push_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

pub(crate) fn push_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_le_bytes());
}

pub(crate) fn push_i128(output: &mut Vec<u8>, value: i128) {
    output.extend_from_slice(&value.to_le_bytes());
}

pub(crate) fn write_u32<W>(output: &mut W, value: u32) -> Result<()>
where
    W: Write + ?Sized,
{
    output.write_all(&value.to_le_bytes())?;
    Ok(())
}

pub(crate) fn write_u64<W>(output: &mut W, value: u64) -> Result<()>
where
    W: Write + ?Sized,
{
    output.write_all(&value.to_le_bytes())?;
    Ok(())
}

#[cfg(test)]
pub(super) fn read_u32_file(input: &mut File) -> Result<u32> {
    let mut bytes = [0u8; 4];
    input.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

pub(super) fn read_u64_file(input: &mut File) -> Result<u64> {
    let mut bytes = [0u8; 8];
    input.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_u32_slice(bytes: &[u8], offset: usize) -> Result<u32> {
    let end = offset
        .checked_add(4)
        .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("header offset overflow")))?;
    let value = bytes
        .get(offset..end)
        .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("truncated header field")))?;
    Ok(u32::from_le_bytes(value.try_into().map_err(|_| {
        reject(KeyIndexRejection::InvalidLayout("invalid u32 header field"))
    })?))
}

fn read_u64_slice(bytes: &[u8], offset: usize) -> Result<u64> {
    let end = offset
        .checked_add(8)
        .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("header offset overflow")))?;
    let value = bytes
        .get(offset..end)
        .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("truncated header field")))?;
    Ok(u64::from_le_bytes(value.try_into().map_err(|_| {
        reject(KeyIndexRejection::InvalidLayout("invalid u64 header field"))
    })?))
}

struct HeaderCursor<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> HeaderCursor<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn read_array<const N: usize>(&mut self) -> Result<[u8; N]> {
        let end = self
            .position
            .checked_add(N)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("header cursor overflow")))?;
        let source = self
            .bytes
            .get(self.position..end)
            .ok_or_else(|| reject(KeyIndexRejection::InvalidLayout("truncated header field")))?;
        let mut output = [0u8; N];
        output.copy_from_slice(source);
        self.position = end;
        Ok(output)
    }

    fn read_u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.read_array()?))
    }

    fn read_u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.read_array()?))
    }

    fn read_i128(&mut self) -> Result<i128> {
        Ok(i128::from_le_bytes(self.read_array()?))
    }
}
