use encoding_rs::{BIG5, DecoderResult, GB18030, GBK};

use crate::error::{Error, Result};
use crate::limits::try_reserve_string;
use crate::types::{ContainerKind, Header};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextEncoding {
    Utf8,
    Utf16Le,
    Gbk,
    Gb18030,
    Big5,
}

impl TextEncoding {
    /// Resolves the encoding used for physical keys.
    ///
    /// MDD keys are always UTF-16LE regardless of any declared label; MDX keys
    /// follow the header's `Encoding` attribute and default to UTF-8 when it is
    /// absent.
    ///
    /// # Errors
    ///
    /// Returns an error if the declared label names an encoding this build does
    /// not support.
    pub fn for_keys(kind: ContainerKind, header: &Header) -> Result<Self> {
        match kind {
            ContainerKind::Mdd => Ok(Self::Utf16Le),
            ContainerKind::Mdx => Self::from_label(header.encoding_label.as_deref()),
        }
    }

    /// Resolves the encoding used for record payloads.
    ///
    /// MDD payloads are opaque bytes and are never text-decoded, so this
    /// returns `None` for MDD. MDX records use the same encoding as MDX keys.
    ///
    /// # Errors
    ///
    /// Returns an error under the same conditions as [`Self::for_keys`].
    pub fn for_records(kind: ContainerKind, header: &Header) -> Result<Option<Self>> {
        match kind {
            ContainerKind::Mdd => Ok(None),
            ContainerKind::Mdx => Self::from_label(header.encoding_label.as_deref()).map(Some),
        }
    }

    fn from_label(label: Option<&str>) -> Result<Self> {
        let label = label.unwrap_or("UTF-8").trim();
        if label.eq_ignore_ascii_case("UTF-8") || label.eq_ignore_ascii_case("UTF8") {
            Ok(Self::Utf8)
        } else if label.eq_ignore_ascii_case("UTF-16")
            || label.eq_ignore_ascii_case("UTF-16LE")
            || label.eq_ignore_ascii_case("UTF16")
        {
            Ok(Self::Utf16Le)
        } else if label.eq_ignore_ascii_case("GBK") || label.eq_ignore_ascii_case("GB2312") {
            Ok(Self::Gbk)
        } else if label.eq_ignore_ascii_case("GB18030") {
            Ok(Self::Gb18030)
        } else if label.eq_ignore_ascii_case("BIG5") {
            Ok(Self::Big5)
        } else if label.eq_ignore_ascii_case("ISO8859-1")
            || label.eq_ignore_ascii_case("ISO-8859-1")
            || label.eq_ignore_ascii_case("LATIN1")
        {
            // Real v1.2 dictionaries declare this label, but which byte
            // semantics creators actually used is unresolved. Refuse precisely
            // rather than silently substituting a compatible-looking decoder.
            Err(Error::Unsupported(
                "ISO8859-1 text encoding (MDict byte semantics unresolved)",
            ))
        } else {
            Err(Error::Unsupported("text encoding"))
        }
    }

    pub fn unit_size(self) -> usize {
        match self {
            Self::Utf16Le => 2,
            Self::Utf8 | Self::Gbk | Self::Gb18030 | Self::Big5 => 1,
        }
    }

    pub fn max_decoded_len(self, input_len: usize) -> Result<usize> {
        match self {
            Self::Utf8 => Ok(input_len),
            Self::Utf16Le => input_len
                .checked_add(1)
                .and_then(|bytes| bytes.checked_div(2))
                .and_then(|units| units.checked_mul(3))
                .ok_or(Error::InvalidFormat("UTF-16 decoded length overflow")),
            Self::Gbk => max_encoding_rs_output(GBK, input_len),
            Self::Gb18030 => max_encoding_rs_output(GB18030, input_len),
            Self::Big5 => max_encoding_rs_output(BIG5, input_len),
        }
    }

    pub fn decode(self, bytes: &[u8], context: &'static str) -> Result<String> {
        match self {
            Self::Utf8 => {
                let text = std::str::from_utf8(bytes).map_err(|_| Error::Decode {
                    context,
                    encoding: "utf-8",
                })?;
                clone_text(text, context)
            }
            Self::Utf16Le => {
                if !bytes.len().is_multiple_of(2) {
                    return Err(Error::Decode {
                        context,
                        encoding: "utf-16le",
                    });
                }
                let max_output = bytes
                    .len()
                    .checked_div(2)
                    .and_then(|units| units.checked_mul(3))
                    .ok_or(Error::InvalidFormat("UTF-16 decoded length overflow"))?;
                let mut output = String::new();
                try_reserve_string(&mut output, max_output, context)?;
                let units = bytes
                    .chunks_exact(2)
                    .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]));
                for decoded in char::decode_utf16(units) {
                    let character = decoded.map_err(|_| Error::Decode {
                        context,
                        encoding: "utf-16le",
                    })?;
                    output.push(character);
                }
                Ok(output)
            }
            Self::Gbk => decode_encoding_rs(GBK, bytes, context, "gbk"),
            Self::Gb18030 => decode_encoding_rs(GB18030, bytes, context, "gb18030"),
            Self::Big5 => decode_encoding_rs(BIG5, bytes, context, "big5"),
        }
    }

    pub fn split_terminated<'a>(
        self,
        bytes: &'a [u8],
        offset: usize,
        context: &'static str,
    ) -> Result<(&'a [u8], usize)> {
        match self {
            Self::Utf16Le => {
                let tail = bytes
                    .get(offset..)
                    .ok_or(Error::InvalidFormat("terminated string offset overflow"))?;
                for (unit_index, unit) in tail.chunks_exact(2).enumerate() {
                    if unit == [0, 0] {
                        let relative = unit_index
                            .checked_mul(2)
                            .ok_or(Error::InvalidFormat("terminated string length overflow"))?;
                        let end = offset
                            .checked_add(relative)
                            .ok_or(Error::InvalidFormat("terminated string end overflow"))?;
                        let next = end
                            .checked_add(2)
                            .ok_or(Error::InvalidFormat("terminated string end overflow"))?;
                        return Ok((&bytes[offset..end], next));
                    }
                }
                Err(Error::InvalidData(format!(
                    "missing UTF-16 terminator for {context}"
                )))
            }
            Self::Utf8 | Self::Gbk | Self::Gb18030 | Self::Big5 => {
                let tail = bytes
                    .get(offset..)
                    .ok_or(Error::InvalidFormat("terminated string offset overflow"))?;
                let rel = tail.iter().position(|byte| *byte == 0).ok_or_else(|| {
                    Error::InvalidData(format!("missing terminator for {context}"))
                })?;
                let end = offset
                    .checked_add(rel)
                    .ok_or(Error::InvalidFormat("terminated string end overflow"))?;
                let next = end
                    .checked_add(1)
                    .ok_or(Error::InvalidFormat("terminated string end overflow"))?;
                Ok((&bytes[offset..end], next))
            }
        }
    }
}

fn max_encoding_rs_output(
    encoding: &'static encoding_rs::Encoding,
    input_len: usize,
) -> Result<usize> {
    encoding
        .new_decoder_without_bom_handling()
        .max_utf8_buffer_length_without_replacement(input_len)
        .ok_or(Error::InvalidFormat("decoded text length overflow"))
}

fn decode_encoding_rs(
    encoding: &'static encoding_rs::Encoding,
    bytes: &[u8],
    context: &'static str,
    name: &'static str,
) -> Result<String> {
    let mut decoder = encoding.new_decoder_without_bom_handling();
    let max_output = max_encoding_rs_output(encoding, bytes.len())?;
    let mut output = String::new();
    try_reserve_string(&mut output, max_output, context)?;
    let (result, read) = decoder.decode_to_string_without_replacement(bytes, &mut output, true);
    match result {
        DecoderResult::InputEmpty if read == bytes.len() => Ok(output),
        DecoderResult::Malformed(_, _) => Err(Error::Decode {
            context,
            encoding: name,
        }),
        DecoderResult::InputEmpty | DecoderResult::OutputFull => Err(Error::InvalidFormat(
            "text decoder did not consume bounded input",
        )),
    }
}

fn clone_text(text: &str, context: &'static str) -> Result<String> {
    let mut output = String::new();
    try_reserve_string(&mut output, text.len(), context)?;
    output.push_str(text);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_a_four_byte_gb18030_sequence() {
        let decoded = TextEncoding::Gb18030
            .decode(&[0x94, 0x39, 0xfc, 0x36], "test text")
            .unwrap();
        assert_eq!(decoded, "😀");
    }
}
