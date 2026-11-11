//! Decode-and-re-encode rewriting for MDict version 2 files.
//!
//! [`reencode_mdx`] and [`reencode_mdd`] decode every key and record block of
//! an open file through the normal decompression paths and re-emit the whole
//! file: the header framing is re-encoded from the parsed raw XML, the
//! keyword index rows are re-parsed and re-emitted with updated block sizes,
//! and every decompressed block payload is re-wrapped with the same
//! compression tag it was read with.
//!
//! Files whose blocks are all uncompressed come back **byte-identical**.
//! Files with zlib blocks can differ inside the compressed streams only,
//! because deflate output is compressor-specific; decompressed payloads,
//! structure, ordering, summaries, and record separators are preserved. For
//! the same reason re-encoding is idempotent: a second pass reproduces the
//! first output exactly.
//!
//! Version 1 sources, encrypted keyword sections, and LZO blocks are refused
//! with [`Error::Unsupported`] because this iteration has no encoder for
//! them.
//!
//! # Examples
//!
//! ```
//! use mdictlib::{MdxBuilder, MdxFile, WriteCompression, WriteOptions, reencode_mdx};
//!
//! # fn main() -> mdictlib::Result<()> {
//! let options = WriteOptions::new().with_compression(WriteCompression::None);
//! let mut builder = MdxBuilder::with_options(options);
//! builder.add_entry("hello", "<p>greeting</p>")?;
//! let mut original = Vec::new();
//! builder.finish(&mut original)?;
//!
//! let dir = std::env::temp_dir();
//! let path = dir.join(format!("mdictlib-reencode-doc-{}.mdx", std::process::id()));
//! std::fs::write(&path, &original)?;
//! let source = MdxFile::open(&path)?;
//!
//! let mut reencoded = Vec::new();
//! let summary = reencode_mdx(&source, &mut reencoded)?;
//! assert_eq!(summary.entries, 1);
//! assert_eq!(reencoded, original); // uncompressed sources are byte-identical
//!
//! let _ = std::fs::remove_file(&path);
//! # Ok(())
//! # }
//! ```

use std::io::Write;

use crate::core::MdictFile;
use crate::error::{Error, Result};
use crate::format::common::checksum::adler32;
use crate::format::common::compression::decode_block;
use crate::format::common::descriptors::ValidatedLayout;
use crate::format::common::source::FileSource;
use crate::mdd::MddFile;
use crate::mdx::MdxFile;
use crate::types::{ChecksumPolicy, Header, Limits};
use crate::write::{WriteCompression, WriteSummary, envelope, put_u32_be, put_u32_le, put_u64_be};

/// One decoded and re-encodable block.
struct ReencodedBlock {
    payload: Vec<u8>,
    compression: WriteCompression,
}

/// Re-encodes an open MDX dictionary: every block is decoded and re-emitted
/// with the same structure and compression tag.
///
/// # Errors
///
/// Returns [`Error::Unsupported`] for version 1 sources, encrypted keyword
/// sections, or LZO blocks; [`Error::Io`] when writing to `out` fails; and
/// propagates any decode failure observed while decompressing source blocks.
pub fn reencode_mdx<W: Write>(source: &MdxFile, out: W) -> Result<WriteSummary> {
    reencode(source.core(), out)
}

/// Re-encodes an open MDD resource file under the same rules as
/// [`reencode_mdx`].
///
/// # Errors
///
/// Returns the same refusals and propagations as [`reencode_mdx`].
pub fn reencode_mdd<W: Write>(source: &MddFile, out: W) -> Result<WriteSummary> {
    reencode(source.core(), out)
}

fn reencode<W: Write>(file: &MdictFile, mut out: W) -> Result<WriteSummary> {
    let layout = file.layout();
    let source = file.source();
    let limits: &Limits = file.limits();
    let checksum_policy: ChecksumPolicy = file.checksum_policy();
    let header: &Header = &layout.header;

    require_version_2(header)?;
    if header.encryption_mode().has_keyword_header() || header.encryption_mode().has_keyword_index()
    {
        return Err(Error::Unsupported("re-encoding encrypted keyword sections"));
    }

    // ---- Decode every block through the normal path. ----

    let index_range = layout.sections.keyword_index;
    let index_len = usize::try_from(
        index_range
            .end()?
            .checked_sub(index_range.offset())
            .ok_or(Error::InvalidFormat("keyword index range underflow"))?,
    )
    .map_err(|_| Error::InvalidFormat("keyword index length exceeds usize"))?;
    let index_block = ReencodedBlock::decode(
        source,
        index_range.offset(),
        index_len,
        keyword_index_decompressed_len(source, layout)?,
        limits,
        checksum_policy,
        "re-encode keyword index",
    )?;

    let mut key_blocks = Vec::with_capacity(layout.key_blocks.len());
    for block in &layout.key_blocks {
        key_blocks.push(ReencodedBlock::decode(
            source,
            block.comp_offset,
            usize::try_from(block.comp_size)
                .map_err(|_| Error::InvalidData("keyword block length exceeds usize".to_owned()))?,
            usize::try_from(block.decomp_size)
                .map_err(|_| Error::InvalidData("keyword block length exceeds usize".to_owned()))?,
            limits,
            checksum_policy,
            "re-encode keyword block",
        )?);
    }

    let mut record_blocks = Vec::with_capacity(layout.record_blocks.len());
    for block in &layout.record_blocks {
        record_blocks.push(ReencodedBlock::decode(
            source,
            block.comp_offset,
            usize::try_from(block.comp_size)
                .map_err(|_| Error::InvalidData("record block length exceeds usize".to_owned()))?,
            usize::try_from(block.decomp_size)
                .map_err(|_| Error::InvalidData("record block length exceeds usize".to_owned()))?,
            limits,
            checksum_policy,
            "re-encode record block",
        )?);
    }

    // ---- Rebuild the keyword index rows with new compressed sizes. ----

    let keyword_header = source.read_exact_at(
        layout.sections.keyword_header.offset(),
        44,
        "re-encode keyword header",
    )?;
    let legacy_layout =
        stored_checksum_matches_little_endian(&keyword_header[..40], &keyword_header[40..44])?;

    let new_index_payload = rewrite_keyword_index_rows(
        &index_block.payload,
        &key_blocks,
        legacy_layout,
        layout.key_encoding.unit_size(),
    )?;
    let new_index_envelope = envelope(&new_index_payload, index_block.compression);

    let new_key_envelopes: Vec<Vec<u8>> = key_blocks
        .iter()
        .map(|block| envelope(&block.payload, block.compression))
        .collect();
    let mut new_key_blocks_total = 0u64;
    for block in &new_key_envelopes {
        let len = u64::try_from(block.len())
            .map_err(|_| Error::InvalidData("keyword block length overflows u64".to_owned()))?;
        new_key_blocks_total = new_key_blocks_total
            .checked_add(len)
            .ok_or(Error::InvalidFormat("keyword blocks total overflows"))?;
    }

    // ---- Assemble. ----

    let mut bytes = Vec::new();
    let xml_bytes: Vec<u8> = header
        .raw_xml()
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    put_u32_be(
        &mut bytes,
        u32::try_from(xml_bytes.len())
            .map_err(|_| Error::InvalidData("header XML length exceeds u32".to_owned()))?,
    );
    bytes.extend_from_slice(&xml_bytes);
    put_u32_le(&mut bytes, adler32(&xml_bytes));

    let mut keyword_header_payload = Vec::with_capacity(40);
    put_u64_be(&mut keyword_header_payload, layout.key_blocks.len() as u64);
    put_u64_be(&mut keyword_header_payload, layout.total_entries);
    put_u64_be(&mut keyword_header_payload, new_index_payload.len() as u64);
    put_u64_be(&mut keyword_header_payload, new_index_envelope.len() as u64);
    put_u64_be(&mut keyword_header_payload, new_key_blocks_total);
    debug_assert_eq!(keyword_header_payload.len(), 40);
    bytes.extend_from_slice(&keyword_header_payload);
    if legacy_layout {
        put_u32_le(&mut bytes, adler32(&keyword_header_payload));
    } else {
        put_u32_be(&mut bytes, adler32(&keyword_header_payload));
    }

    bytes.extend_from_slice(&new_index_envelope);
    for block in &new_key_envelopes {
        bytes.extend_from_slice(block);
    }

    let new_record_envelopes: Vec<Vec<u8>> = record_blocks
        .iter()
        .map(|block| envelope(&block.payload, block.compression))
        .collect();
    let new_record_blocks_total: u64 = new_record_envelopes
        .iter()
        .map(|block| {
            u64::try_from(block.len())
                .map_err(|_| Error::InvalidData("record block length overflows u64".to_owned()))
        })
        .collect::<Result<Vec<u64>>>()?
        .into_iter()
        .sum();

    put_u64_be(&mut bytes, layout.record_blocks.len() as u64);
    put_u64_be(&mut bytes, layout.total_entries);
    put_u64_be(&mut bytes, (layout.record_blocks.len() * 16) as u64);
    put_u64_be(&mut bytes, new_record_blocks_total);
    for (block, payload) in new_record_envelopes.iter().zip(record_blocks.iter()) {
        put_u64_be(&mut bytes, block.len() as u64);
        put_u64_be(&mut bytes, payload.payload.len() as u64);
    }
    for block in &new_record_envelopes {
        bytes.extend_from_slice(block);
    }

    let total_bytes = bytes.len() as u64;
    out.write_all(&bytes)?;
    out.flush()?;

    Ok(WriteSummary {
        entries: layout.total_entries,
        key_blocks: layout.key_blocks.len() as u64,
        record_blocks: layout.record_blocks.len() as u64,
        total_bytes,
    })
}

impl ReencodedBlock {
    fn decode(
        source: &FileSource,
        comp_offset: u64,
        comp_len: usize,
        decomp_len: usize,
        limits: &Limits,
        checksum_policy: ChecksumPolicy,
        context: &'static str,
    ) -> Result<Self> {
        let raw = source.read_exact_at(comp_offset, comp_len, context)?;
        let compression = mirror_compression(&raw, context)?;
        let payload = decode_block(context, &raw, decomp_len, limits, checksum_policy)?;
        Ok(Self {
            payload,
            compression,
        })
    }
}

fn require_version_2(header: &Header) -> Result<()> {
    let major = header.generated_by_engine_version().split('.').next();
    match major.and_then(|major| major.parse::<u8>().ok()) {
        Some(2) => Ok(()),
        Some(1) => Err(Error::Unsupported("re-encoding MDict version 1 files")),
        _ => Err(Error::Unsupported(
            "re-encoding unknown MDict major version",
        )),
    }
}

fn mirror_compression(block: &[u8], context: &'static str) -> Result<WriteCompression> {
    if block.len() < 8 {
        return Err(Error::truncated(context, 8, block.len()));
    }
    match &block[..4] {
        [0, 0, 0, 0] => Ok(WriteCompression::None),
        [2, 0, 0, 0] => Ok(WriteCompression::Zlib),
        [1, 0, 0, 0] => Err(Error::Unsupported(
            "re-encoding LZO blocks (no LZO encoder)",
        )),
        _ => Err(Error::InvalidData(format!(
            "{context}: unknown compression tag"
        ))),
    }
}

fn keyword_index_decompressed_len(source: &FileSource, layout: &ValidatedLayout) -> Result<usize> {
    let header = source.read_exact_at(
        layout.sections.keyword_header.offset(),
        40,
        "re-encode keyword header",
    )?;
    let value = u64::from_be_bytes([
        header[16], header[17], header[18], header[19], header[20], header[21], header[22],
        header[23],
    ]);
    usize::try_from(value)
        .map_err(|_| Error::InvalidData("keyword index length exceeds usize".to_owned()))
}

fn stored_checksum_matches_little_endian(payload: &[u8], stored: &[u8]) -> Result<bool> {
    let checksum = adler32(payload);
    if checksum.to_be_bytes() == stored {
        return Ok(false);
    }
    if checksum.to_le_bytes() == stored {
        return Ok(true);
    }
    Err(Error::InvalidData(
        "keyword header checksum matches neither byte order".to_owned(),
    ))
}

/// Rebuilds the keyword index payload, copying each row's count and summary
/// bytes verbatim and replacing only the compressed-size field with the new
/// block envelope length.
fn rewrite_keyword_index_rows(
    payload: &[u8],
    key_blocks: &[ReencodedBlock],
    legacy_layout: bool,
    units: usize,
) -> Result<Vec<u8>> {
    fn take<'a>(payload: &'a [u8], cursor: &mut usize, len: usize) -> Result<&'a [u8]> {
        let end = cursor
            .checked_add(len)
            .ok_or(Error::InvalidFormat("keyword index row overflows"))?;
        let slice = payload
            .get(*cursor..end)
            .ok_or_else(|| Error::truncated("keyword index row", len, payload.len() - *cursor))?;
        *cursor = end;
        Ok(slice)
    }

    let terminator = usize::from(!legacy_layout) * units;
    let mut output = Vec::with_capacity(payload.len());
    let mut cursor = 0usize;

    for block in key_blocks {
        let row_start = cursor;
        take(payload, &mut cursor, 8)?; // entry count
        for _ in 0..2 {
            let length_bytes: [u8; 2] = take(payload, &mut cursor, 2)?
                .try_into()
                .expect("two bytes always convert");
            let length = u16::from_be_bytes(length_bytes) as usize;
            take(payload, &mut cursor, length * units)?;
            take(payload, &mut cursor, terminator)?;
        }
        let row_head_end = cursor; // after the summaries, before the old size
        take(payload, &mut cursor, 8)?; // old compressed size, replaced below
        let decompressed_size = take(payload, &mut cursor, 8)?;

        output.extend_from_slice(&payload[row_start..row_head_end]);
        let new_compressed = envelope(&block.payload, block.compression).len() as u64;
        put_u64_be(&mut output, new_compressed);
        output.extend_from_slice(decompressed_size);
    }

    if cursor != payload.len() {
        return Err(Error::InvalidData(format!(
            "keyword index rows consumed {cursor} of {} bytes",
            payload.len()
        )));
    }
    Ok(output)
}
