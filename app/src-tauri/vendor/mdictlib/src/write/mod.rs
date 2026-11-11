//! Create MDict version 2 `.mdx` and `.mdd` files.
//!
//! [`MdxBuilder`] and [`MddBuilder`] emit the plaintext version 2 wire
//! grammar this crate's own parser accepts: a UTF-16LE XML header, one
//! keyword section, and one record section, with every block wrapped in the
//! shared eight-byte big-endian ADLER32 envelope. Entries are sorted with one
//! fixed collation (see the module-private `collation` child), every key
//! block carries first/last summaries for binary search, and record blocks
//! never split an entry across a block boundary.
//!
//! This iteration writes plaintext version 2 files only: no encryption, no
//! LZO, and no version 1 output. Builders hold entries in memory, so memory
//! grows with the dictionary; a spill-based bounded writer remains future
//! work. All sizes are checked against explicit ceilings and reported through
//! the crate's structured [`Error`] values rather than panics.
//!
//! # Examples
//!
//! Build a dictionary, write it, and read it back with [`MdxFile`]:
//!
//! ```
//! use mdictlib::MdxBuilder;
//!
//! # fn main() -> mdictlib::Result<()> {
//! let mut builder = MdxBuilder::new();
//! builder.header_attribute("Title", "Demo dictionary")?;
//! builder.add_entry("hello", "<p>used as a greeting</p>")?;
//! let mut bytes = Vec::new();
//! let summary = builder.finish(&mut bytes)?;
//! assert_eq!(summary.entries, 1);
//! assert_eq!(summary.key_blocks, 1);
//! assert!(!bytes.is_empty());
//! # Ok(())
//! # }
//! ```

mod collation;

use std::io::Write;

use encoding_rs::{BIG5, GB18030, GBK};

use crate::format::common::checksum::adler32;
use crate::{Error, Result};

/// Text encoding used for MDX keys, key summaries, and record bodies.
///
/// MDD keys are always UTF-16LE on the wire, so builders ignore this value
/// for resource names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteEncoding {
    /// UTF-8 text.
    Utf8,
    /// UTF-16 little-endian text.
    Utf16Le,
    /// GBK text.
    Gbk,
    /// GB18030 text.
    Gb18030,
    /// Big5 text.
    Big5,
}

impl WriteEncoding {
    /// Returns the canonical header attribute label for this encoding.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Utf8 => "UTF-8",
            Self::Utf16Le => "UTF-16LE",
            Self::Gbk => "GBK",
            Self::Gb18030 => "GB18030",
            Self::Big5 => "BIG5",
        }
    }

    fn unit_size(self) -> usize {
        match self {
            Self::Utf16Le => 2,
            Self::Utf8 | Self::Gbk | Self::Gb18030 | Self::Big5 => 1,
        }
    }

    fn encode(self, text: &str, context: &'static str) -> Result<Vec<u8>> {
        match self {
            Self::Utf8 => Ok(text.as_bytes().to_vec()),
            Self::Utf16Le => Ok(text.encode_utf16().flat_map(u16::to_le_bytes).collect()),
            Self::Gbk => encode_legacy(GBK, text, context),
            Self::Gb18030 => encode_legacy(GB18030, text, context),
            Self::Big5 => encode_legacy(BIG5, text, context),
        }
    }
}

fn encode_legacy(
    encoding: &'static encoding_rs::Encoding,
    text: &str,
    context: &'static str,
) -> Result<Vec<u8>> {
    let (encoded, _actual, had_errors) = encoding.encode(text);
    if had_errors {
        return Err(Error::InvalidData(format!(
            "{context} is not representable in {}",
            encoding.name()
        )));
    }
    Ok(encoded.into_owned())
}

/// Block compression applied to every emitted key and record block.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteCompression {
    /// Blocks store their payload bytes unchanged.
    None,
    /// Blocks store a zlib (RFC 1950) stream of their payload.
    Zlib,
}

/// Options controlling how a builder emits a dictionary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteOptions {
    encoding: WriteEncoding,
    compression: WriteCompression,
    key_block_target_bytes: u32,
    record_block_target_bytes: u32,
}

impl WriteOptions {
    /// Default decompressed target size of one key block.
    pub const DEFAULT_KEY_BLOCK_TARGET_BYTES: u32 = 32 * 1024;
    /// Default decompressed target size of one record block.
    pub const DEFAULT_RECORD_BLOCK_TARGET_BYTES: u32 = 64 * 1024;

    /// Creates options with UTF-8 text, zlib blocks, and default block
    /// targets.
    pub fn new() -> Self {
        Self {
            encoding: WriteEncoding::Utf8,
            compression: WriteCompression::Zlib,
            key_block_target_bytes: Self::DEFAULT_KEY_BLOCK_TARGET_BYTES,
            record_block_target_bytes: Self::DEFAULT_RECORD_BLOCK_TARGET_BYTES,
        }
    }

    /// Returns the MDX text encoding.
    pub const fn encoding(&self) -> WriteEncoding {
        self.encoding
    }

    /// Returns the block compression.
    pub const fn compression(&self) -> WriteCompression {
        self.compression
    }

    /// Returns the decompressed byte target of one key block.
    pub const fn key_block_target_bytes(&self) -> u32 {
        self.key_block_target_bytes
    }

    /// Returns the decompressed byte target of one record block.
    pub const fn record_block_target_bytes(&self) -> u32 {
        self.record_block_target_bytes
    }

    /// Sets the MDX text encoding.
    pub fn with_encoding(mut self, encoding: WriteEncoding) -> Self {
        self.encoding = encoding;
        self
    }

    /// Sets the block compression.
    pub fn with_compression(mut self, compression: WriteCompression) -> Self {
        self.compression = compression;
        self
    }

    /// Sets the decompressed byte target of one key block. Values below one
    /// are refused when the builder finishes.
    pub fn with_key_block_target_bytes(mut self, bytes: u32) -> Self {
        self.key_block_target_bytes = bytes;
        self
    }

    /// Sets the decompressed byte target of one record block. Values below
    /// one are refused when the builder finishes.
    pub fn with_record_block_target_bytes(mut self, bytes: u32) -> Self {
        self.record_block_target_bytes = bytes;
        self
    }
}

impl Default for WriteOptions {
    fn default() -> Self {
        Self::new()
    }
}

/// What a builder wrote, in physical output terms.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriteSummary {
    /// Number of emitted entries.
    pub entries: u64,
    /// Number of emitted key blocks.
    pub key_blocks: u64,
    /// Number of emitted record blocks.
    pub record_blocks: u64,
    /// Total emitted file length in bytes.
    pub total_bytes: u64,
}

/// Which MDict container a builder emits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Mdx,
    Mdd,
}

#[derive(Debug, Clone)]
struct PendingEntry {
    key: String,
    encoded_key: Vec<u8>,
    encoded_body: Vec<u8>,
}

#[derive(Debug, Clone)]
struct Engine {
    kind: Kind,
    options: WriteOptions,
    header: Vec<(String, String)>,
    entries: Vec<PendingEntry>,
}

impl Engine {
    fn new(kind: Kind, options: WriteOptions) -> Self {
        Self {
            kind,
            options,
            header: Vec::new(),
            entries: Vec::new(),
        }
    }

    fn text_encoding(&self) -> WriteEncoding {
        match self.kind {
            Kind::Mdd => WriteEncoding::Utf16Le,
            Kind::Mdx => self.options.encoding,
        }
    }

    fn header_attribute(&mut self, name: &str, value: &str) -> Result<()> {
        const RESERVED: [&str; 6] = [
            "GeneratedByEngineVersion",
            "RequiredEngineVersion",
            "Encrypted",
            "Encoding",
            "KeyCaseSensitive",
            "StripKey",
        ];
        if RESERVED
            .iter()
            .any(|reserved| reserved.eq_ignore_ascii_case(name))
        {
            return Err(Error::InvalidData(format!(
                "header attribute `{name}` is written by the builder and cannot be overridden"
            )));
        }
        if self.header.len() >= MAX_HEADER_ATTRIBUTES {
            return Err(Error::LimitExceeded {
                limit: "writer header attributes",
                value: u64::try_from(self.header.len()).unwrap_or(u64::MAX) + 1,
                max: MAX_HEADER_ATTRIBUTES as u64,
            });
        }
        if name.len() > MAX_ATTRIBUTE_NAME_BYTES {
            return Err(Error::LimitExceeded {
                limit: "writer header attribute name bytes",
                value: name.len() as u64,
                max: MAX_ATTRIBUTE_NAME_BYTES as u64,
            });
        }
        if value.len() > MAX_ATTRIBUTE_VALUE_BYTES {
            return Err(Error::LimitExceeded {
                limit: "writer header attribute value bytes",
                value: value.len() as u64,
                max: MAX_ATTRIBUTE_VALUE_BYTES as u64,
            });
        }
        if self.header.iter().any(|(existing, _)| existing == name) {
            return Err(Error::InvalidData(format!(
                "header attribute `{name}` was already set"
            )));
        }
        self.header.push((name.to_owned(), value.to_owned()));
        Ok(())
    }

    fn add_text(&mut self, key: &str, body: &str) -> Result<()> {
        let encoding = self.text_encoding();
        let encoded_key = encoding.encode(key, "entry key")?;
        let encoded_body = encoding.encode(body, "entry body")?;
        self.add_encoded(key, encoded_key, encoded_body)
    }

    fn add_bytes(&mut self, key: &str, body: &[u8]) -> Result<()> {
        let encoding = self.text_encoding();
        let encoded_key = encoding.encode(key, "entry key")?;
        self.add_encoded(key, encoded_key, body.to_vec())
    }

    fn add_encoded(
        &mut self,
        key: &str,
        encoded_key: Vec<u8>,
        encoded_body: Vec<u8>,
    ) -> Result<()> {
        if key.contains('\u{0}') {
            return Err(Error::InvalidData(
                "entry keys must not contain a NUL character".to_owned(),
            ));
        }
        if self.entries.len() as u64 >= MAX_ENTRIES {
            return Err(Error::LimitExceeded {
                limit: "writer entries",
                value: self.entries.len() as u64 + 1,
                max: MAX_ENTRIES,
            });
        }
        let units = self.text_encoding().unit_size();
        let key_units = u64::try_from(encoded_key.len() / units).unwrap_or(u64::MAX);
        if key_units > MAX_KEY_ENCODING_UNITS {
            return Err(Error::LimitExceeded {
                limit: "entry key encoding units",
                value: key_units,
                max: MAX_KEY_ENCODING_UNITS,
            });
        }
        if encoded_body.len() as u64 > MAX_ENTRY_BODY_BYTES {
            return Err(Error::LimitExceeded {
                limit: "entry body bytes",
                value: encoded_body.len() as u64,
                max: MAX_ENTRY_BODY_BYTES,
            });
        }
        self.entries.push(PendingEntry {
            key: key.to_owned(),
            encoded_key,
            encoded_body,
        });
        Ok(())
    }

    fn finish<W: Write>(mut self, mut out: W) -> Result<WriteSummary> {
        if self.options.key_block_target_bytes == 0 || self.options.record_block_target_bytes == 0 {
            return Err(Error::InvalidData(
                "block target bytes must be at least one".to_owned(),
            ));
        }

        self.entries
            .sort_by(|left, right| collation::compare(self.kind, &left.key, &right.key));

        let text_encoding = self.text_encoding();
        let units = text_encoding.unit_size();
        let encoded_keys: Vec<&[u8]> = self
            .entries
            .iter()
            .map(|e| e.encoded_key.as_slice())
            .collect();
        let encoded_bodies: Vec<&[u8]> = self
            .entries
            .iter()
            .map(|e| e.encoded_body.as_slice())
            .collect();

        // Record offsets are positions in the concatenated decompressed
        // record stream, independent of block boundaries.
        let mut record_offsets = Vec::with_capacity(encoded_bodies.len());
        let mut record_total: u64 = 0;
        for body in &encoded_bodies {
            record_offsets.push(record_total);
            record_total = record_total.checked_add(body.len() as u64).ok_or_else(|| {
                Error::InvalidData("record stream length overflows u64".to_owned())
            })?;
        }

        // Pack record blocks without splitting an entry across blocks.
        let record_target = u64::from(self.options.record_block_target_bytes);
        let mut record_block_payloads: Vec<Vec<u8>> = Vec::new();
        let mut current_record_block: Vec<u8> = Vec::new();
        for body in &encoded_bodies {
            if !current_record_block.is_empty()
                && current_record_block.len() as u64 + body.len() as u64 > record_target
            {
                record_block_payloads.push(std::mem::take(&mut current_record_block));
            }
            current_record_block.extend_from_slice(body);
        }
        if !current_record_block.is_empty() {
            record_block_payloads.push(current_record_block);
        }

        // Pack key rows into key blocks the same way. One row is
        // offset, key bytes, and one NUL per encoding unit.
        let key_target = u64::from(self.options.key_block_target_bytes);
        let row_size = |key: &[u8]| {
            8u64.checked_add(key.len() as u64 + units as u64)
                .expect("row fits u64")
        };
        struct KeyBlock {
            rows: Vec<usize>,
            payload: Vec<u8>,
        }
        let mut key_blocks: Vec<KeyBlock> = Vec::new();
        let mut current_rows: Vec<usize> = Vec::new();
        let mut current_payload: Vec<u8> = Vec::new();
        for (index, key) in encoded_keys.iter().enumerate() {
            let row_len = row_size(key);
            if !current_payload.is_empty() && current_payload.len() as u64 + row_len > key_target {
                key_blocks.push(KeyBlock {
                    rows: std::mem::take(&mut current_rows),
                    payload: std::mem::take(&mut current_payload),
                });
            }
            current_payload.extend_from_slice(&record_offsets[index].to_be_bytes());
            current_payload.extend_from_slice(key);
            current_payload.extend(std::iter::repeat_n(0, units));
            current_rows.push(index);
        }
        if !current_payload.is_empty() {
            key_blocks.push(KeyBlock {
                rows: current_rows,
                payload: current_payload,
            });
        }

        let compression = self.options.compression;
        let key_blocks_comp_total = key_blocks
            .iter()
            .map(|block| envelope(&block.payload, compression).len())
            .sum::<usize>();
        let record_blocks_comp_total = record_block_payloads
            .iter()
            .map(|payload| envelope(payload, compression).len())
            .sum::<usize>();

        // Key index rows: entry count, first and last summaries, then the
        // block's compressed and decompressed sizes.
        let mut key_index_payload = Vec::new();
        for block in &key_blocks {
            put_u64_be(&mut key_index_payload, block.rows.len() as u64);
            let first = &self.entries[block.rows[0]].key;
            let last = &self.entries[block.rows[block.rows.len() - 1]].key;
            put_summary(&mut key_index_payload, text_encoding, first);
            put_summary(&mut key_index_payload, text_encoding, last);
            put_u64_be(
                &mut key_index_payload,
                envelope(&block.payload, compression).len() as u64,
            );
            put_u64_be(&mut key_index_payload, block.payload.len() as u64);
        }
        let key_index_block = envelope(&key_index_payload, compression);

        // Header XML is always UTF-16LE regardless of the body encoding.
        let xml = header_xml(
            self.kind,
            self.kind == Kind::Mdx,
            text_encoding,
            &self.header,
        );
        let xml_bytes: Vec<u8> = xml.encode_utf16().flat_map(u16::to_le_bytes).collect();

        let mut bytes = Vec::new();
        put_u32_be(&mut bytes, xml_bytes.len() as u32);
        bytes.extend_from_slice(&xml_bytes);
        put_u32_le(&mut bytes, adler32(&xml_bytes));

        let mut keyword_header = Vec::with_capacity(40);
        put_u64_be(&mut keyword_header, key_blocks.len() as u64);
        put_u64_be(&mut keyword_header, self.entries.len() as u64);
        put_u64_be(&mut keyword_header, key_index_payload.len() as u64);
        put_u64_be(&mut keyword_header, key_index_block.len() as u64);
        put_u64_be(&mut keyword_header, key_blocks_comp_total as u64);
        debug_assert_eq!(keyword_header.len(), 40);
        let keyword_header_checksum = adler32(&keyword_header);
        bytes.extend_from_slice(&keyword_header);
        put_u32_be(&mut bytes, keyword_header_checksum);
        bytes.extend_from_slice(&key_index_block);
        for block in &key_blocks {
            bytes.extend_from_slice(&envelope(&block.payload, compression));
        }

        let record_index_len = record_block_payloads.len() * 16;
        put_u64_be(&mut bytes, record_block_payloads.len() as u64);
        put_u64_be(&mut bytes, self.entries.len() as u64);
        put_u64_be(&mut bytes, record_index_len as u64);
        put_u64_be(&mut bytes, record_blocks_comp_total as u64);
        for payload in &record_block_payloads {
            put_u64_be(&mut bytes, envelope(payload, compression).len() as u64);
            put_u64_be(&mut bytes, payload.len() as u64);
        }
        for payload in &record_block_payloads {
            bytes.extend_from_slice(&envelope(payload, compression));
        }

        let total_bytes = bytes.len() as u64;
        out.write_all(&bytes)?;
        out.flush()?;

        Ok(WriteSummary {
            entries: self.entries.len() as u64,
            key_blocks: key_blocks.len() as u64,
            record_blocks: record_block_payloads.len() as u64,
            total_bytes,
        })
    }
}

/// Builder for plaintext MDict version 2 `.mdx` dictionaries.
///
/// See the write module documentation for the emitted grammar and the
/// fixed entry ordering.
#[derive(Debug, Clone)]
pub struct MdxBuilder {
    engine: Engine,
}

impl MdxBuilder {
    /// Creates a builder with default options.
    pub fn new() -> Self {
        Self::with_options(WriteOptions::new())
    }

    /// Creates a builder with the given options.
    pub fn with_options(options: WriteOptions) -> Self {
        Self {
            engine: Engine::new(Kind::Mdx, options),
        }
    }

    /// Sets one caller-owned header attribute such as `Title`,
    /// `Description`, or `StyleSheet`.
    ///
    /// Builder-owned names (`GeneratedByEngineVersion`,
    /// `RequiredEngineVersion`, `Encrypted`, `Encoding`,
    /// `KeyCaseSensitive`, `StripKey`) are refused, as is setting the same
    /// name twice.
    ///
    /// # Errors
    ///
    /// Returns [`Error::InvalidData`] for reserved or duplicate names and
    /// [`Error::LimitExceeded`] when attribute count or size ceilings are
    /// crossed.
    pub fn header_attribute(&mut self, name: &str, value: &str) -> Result<&mut Self> {
        self.engine.header_attribute(name, value)?;
        Ok(self)
    }

    /// Adds one dictionary entry. Bodies are text, encoded with the chosen
    /// [`WriteEncoding`]; text that the encoding cannot represent is
    /// refused.
    ///
    /// # Errors
    ///
    /// Returns [`Error::InvalidData`] for keys containing NUL or text the
    /// chosen encoding cannot represent, and [`Error::LimitExceeded`] when
    /// entry-count, key, or body ceilings are crossed.
    pub fn add_entry(&mut self, key: &str, body: &str) -> Result<&mut Self> {
        self.engine.add_text(key, body)?;
        Ok(self)
    }

    /// Emits the dictionary to `out` and reports what was written. Builders
    /// are single-use.
    ///
    /// # Errors
    ///
    /// Returns [`Error::InvalidData`] for inconsistent options such as a
    /// zero block target and [`Error::Io`] when writing to `out` fails.
    pub fn finish<W: Write>(self, out: W) -> Result<WriteSummary> {
        self.engine.finish(out)
    }
}

impl Default for MdxBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Builder for plaintext MDict version 2 `.mdd` resource files.
///
/// Resource names are always UTF-16LE on the wire and resource bodies are
/// stored as given bytes, so [`WriteEncoding`] is ignored.
#[derive(Debug, Clone)]
pub struct MddBuilder {
    engine: Engine,
}

impl MddBuilder {
    /// Creates a builder with default options.
    pub fn new() -> Self {
        Self::with_options(WriteOptions::new())
    }

    /// Creates a builder with the given options.
    pub fn with_options(options: WriteOptions) -> Self {
        Self {
            engine: Engine::new(Kind::Mdd, options),
        }
    }

    /// Sets one caller-owned header attribute such as `Title` or
    /// `Description`, under the same rules as
    /// [`MdxBuilder::header_attribute`].
    ///
    /// # Errors
    ///
    /// Returns [`Error::InvalidData`] for reserved or duplicate names and
    /// [`Error::LimitExceeded`] when attribute count or size ceilings are
    /// crossed.
    pub fn header_attribute(&mut self, name: &str, value: &str) -> Result<&mut Self> {
        self.engine.header_attribute(name, value)?;
        Ok(self)
    }

    /// Adds one resource under its resource-path name, for example
    /// `/style.css`.
    ///
    /// # Errors
    ///
    /// Returns [`Error::InvalidData`] for names containing NUL and
    /// [`Error::LimitExceeded`] when entry-count, key, or body ceilings are
    /// crossed.
    pub fn add_resource(&mut self, name: &str, bytes: &[u8]) -> Result<&mut Self> {
        self.engine.add_bytes(name, bytes)?;
        Ok(self)
    }

    /// Emits the resource file to `out` and reports what was written.
    /// Builders are single-use.
    ///
    /// # Errors
    ///
    /// Returns [`Error::InvalidData`] for inconsistent options such as a
    /// zero block target and [`Error::Io`] when writing to `out` fails.
    pub fn finish<W: Write>(self, out: W) -> Result<WriteSummary> {
        self.engine.finish(out)
    }
}

impl Default for MddBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Maximum number of caller-owned header attributes.
const MAX_HEADER_ATTRIBUTES: usize = 256;
/// Maximum byte length of one header attribute name.
const MAX_ATTRIBUTE_NAME_BYTES: usize = 128;
/// Maximum byte length of one header attribute value.
const MAX_ATTRIBUTE_VALUE_BYTES: usize = 65_536;
/// Maximum number of entries one builder accepts.
const MAX_ENTRIES: u64 = 50_000_000;
/// Maximum byte length of one entry body before encoding.
const MAX_ENTRY_BODY_BYTES: u64 = 256 * 1024 * 1024;
/// Maximum encoding units of one entry key, matching the u16 summary field.
const MAX_KEY_ENCODING_UNITS: u64 = u16::MAX as u64;

/// Wraps a payload in the shared eight-byte ADLER32 envelope. The
/// compression tag is little-endian on the wire (`[2, 0, 0, 0]` for zlib)
/// while the checksum stays big-endian; this matches what the parser's
/// `parse_comp_type` accepts.
pub(crate) fn envelope(payload: &[u8], compression: WriteCompression) -> Vec<u8> {
    let mut block = Vec::with_capacity(8 + payload.len());
    let tag: u32 = match compression {
        WriteCompression::None => 0,
        WriteCompression::Zlib => 2,
    };
    block.extend_from_slice(&tag.to_le_bytes());
    block.extend_from_slice(&adler32(payload).to_be_bytes());
    match compression {
        WriteCompression::None => block.extend_from_slice(payload),
        WriteCompression::Zlib => {
            block.extend_from_slice(&miniz_oxide::deflate::compress_to_vec_zlib(payload, 6));
        }
    }
    block
}

/// Writes one key summary: the u16 unit count, the encoded text, and one NUL
/// per encoding unit.
fn put_summary(output: &mut Vec<u8>, encoding: WriteEncoding, summary: &str) {
    let encoded = encoding
        .encode(summary, "key summary")
        .expect("key summaries use the same strict encoding that already accepted the full key");
    put_u16_be(
        output,
        u16::try_from(encoded.len() / encoding.unit_size())
            .expect("key summaries were capped at u16 encoding units when the key was encoded"),
    );
    output.extend_from_slice(&encoded);
    output.extend(std::iter::repeat_n(0, encoding.unit_size()));
}

fn header_xml(
    kind: Kind,
    declares_encoding: bool,
    encoding: WriteEncoding,
    extras: &[(String, String)],
) -> String {
    let tag = match kind {
        Kind::Mdx => "Dictionary",
        Kind::Mdd => "Library_Data",
    };
    let mut xml = format!("<{tag} GeneratedByEngineVersion=\"2.0\" RequiredEngineVersion=\"2.0\"");
    if declares_encoding {
        xml.push_str(&format!(" Encoding=\"{}\"", encoding.label()));
    }
    xml.push_str(" KeyCaseSensitive=\"No\" StripKey=\"No\"");
    for (name, value) in extras {
        xml.push_str(&format!(" {}=\"{}\"", name, escape_xml(value)));
    }
    xml.push_str("/>");
    xml
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub(crate) fn put_u16_be(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_be_bytes());
}

pub(crate) fn put_u32_be(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_be_bytes());
}

pub(crate) fn put_u32_le(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

pub(crate) fn put_u64_be(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_header_attribute_is_refused() {
        let mut builder = MdxBuilder::new();
        assert!(builder.header_attribute("Title", "t").is_ok());
        for reserved in [
            "GeneratedByEngineVersion",
            "requiredengineversion",
            "Encrypted",
            "Encoding",
            "KeyCaseSensitive",
            "StripKey",
        ] {
            assert!(builder.header_attribute(reserved, "value").is_err());
        }
    }

    #[test]
    fn duplicate_header_attribute_is_refused() {
        let mut builder = MdxBuilder::new();
        assert!(builder.header_attribute("Title", "one").is_ok());
        assert!(builder.header_attribute("Title", "two").is_err());
    }

    #[test]
    fn nul_in_key_is_refused() {
        let mut builder = MdxBuilder::new();
        assert!(builder.add_entry("a\u{0}b", "body").is_err());
    }

    #[test]
    fn zero_block_target_is_refused_at_finish() {
        let mut builder =
            MdxBuilder::with_options(WriteOptions::new().with_key_block_target_bytes(0));
        assert!(builder.add_entry("a", "b").is_ok());
        assert!(builder.finish(Vec::new()).is_err());
    }

    #[test]
    fn empty_dictionary_emits_a_readable_frame() {
        let summary = MdxBuilder::new().finish(Vec::new()).unwrap();
        assert_eq!(summary.entries, 0);
        assert_eq!(summary.key_blocks, 0);
        assert_eq!(summary.record_blocks, 0);
        assert!(summary.total_bytes > 0);
    }

    #[test]
    fn gbk_encoding_refuses_unrepresentable_text() {
        let mut builder =
            MdxBuilder::with_options(WriteOptions::new().with_encoding(WriteEncoding::Gbk));
        assert!(builder.add_entry("🙂", "body").is_err());
    }

    #[test]
    fn envelope_matches_the_shared_wire_shape() {
        let payload = b"payload";
        let block = envelope(payload, WriteCompression::None);
        assert_eq!(&block[..4], &[0, 0, 0, 0]);
        assert_eq!(&block[4..8], &adler32(payload).to_be_bytes());
        assert_eq!(&block[8..], payload);
        let block = envelope(payload, WriteCompression::Zlib);
        assert_eq!(&block[..4], &[2, 0, 0, 0]);
    }
}
