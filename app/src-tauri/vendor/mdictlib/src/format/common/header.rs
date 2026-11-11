use std::mem::size_of;
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::format::common::checksum::verify_adler32;
use crate::format::common::cursor::Cursor;
use crate::format::common::descriptors::SectionRange;
use crate::format::common::encoding::TextEncoding;
use crate::format::common::source::FileSource;
use crate::limits::{
    MemoryBudget, checked_u64, checked_usize, ensure_u64_limit, try_reserve_string, try_reserve_vec,
};
use crate::types::{ChecksumPolicy, ContainerKind, Header, Limits};

#[derive(Debug, Clone)]
pub struct HeaderSection {
    pub header: Header,
    pub keyword_section_offset: u64,
    pub retained_bytes: usize,
    /// Exact validated byte range covering the whole header section.
    pub section: SectionRange,
}

/// Parses the top-level MDict header from a file-backed source.
pub fn parse_header(
    source: &FileSource,
    kind: ContainerKind,
    limits: &Limits,
    checksum_policy: ChecksumPolicy,
    memory: &Arc<MemoryBudget>,
) -> Result<HeaderSection> {
    let _length_memory = memory.reserve(4, "header length read")?;
    let len_bytes = source.read_exact_at(0, 4, "header length")?;
    let mut cursor = Cursor::new(&len_bytes);
    let xml_len = u64::from(cursor.read_u32_be("header length")?);
    ensure_u64_limit("header_xml_bytes", xml_len, limits.header_xml_bytes)?;
    if !xml_len.is_multiple_of(2) {
        return Err(Error::InvalidFormat(
            "header XML length is not UTF-16LE aligned",
        ));
    }
    let total_len = 4u64
        .checked_add(xml_len)
        .and_then(|value| value.checked_add(4))
        .ok_or(Error::InvalidFormat("header size overflow"))?;
    source.ensure_range(0, total_len, "header section")?;
    let total_len = checked_usize(total_len, "header section length")?;
    let _read_memory = memory.reserve(total_len, "header section read")?;
    let bytes = source.read_exact_at(0, total_len, "header section")?;
    parse_header_bytes_with_limits(&bytes, kind, limits, checksum_policy, memory)
}

/// Parses the top-level MDict header from raw file bytes.
///
/// The provided slice must contain at least the full `header_sect`
/// (`u32 BE length` + UTF-16LE XML + `u32 LE` ADLER32).
#[cfg(any(test, fuzzing))]
pub fn parse_header_bytes(bytes: &[u8], kind: ContainerKind) -> Result<HeaderSection> {
    let limits = Limits::new();
    let memory = Arc::new(MemoryBudget::new(limits.working_memory_bytes));
    parse_header_bytes_with_limits(bytes, kind, &limits, ChecksumPolicy::Verify, &memory)
}

fn parse_header_bytes_with_limits(
    bytes: &[u8],
    kind: ContainerKind,
    limits: &Limits,
    checksum_policy: ChecksumPolicy,
    memory: &Arc<MemoryBudget>,
) -> Result<HeaderSection> {
    let mut cursor = Cursor::new(bytes);
    let xml_len = u64::from(cursor.read_u32_be("header length")?);
    ensure_u64_limit("header_xml_bytes", xml_len, limits.header_xml_bytes)?;
    if !xml_len.is_multiple_of(2) {
        return Err(Error::InvalidFormat(
            "header XML length is not UTF-16LE aligned",
        ));
    }
    let xml_len = checked_usize(xml_len, "header XML length")?;
    let retained_bytes = header_memory_estimate(xml_len, limits)?;
    let _header_memory = memory.reserve(retained_bytes, "parsed header")?;

    let xml_bytes = cursor.read_bytes(xml_len, "header xml")?;
    let expected = cursor.read_u32_le("header checksum")?;
    if checksum_policy == ChecksumPolicy::Verify {
        verify_adler32("header xml", xml_bytes, expected)?;
    }

    let decoded_xml = TextEncoding::Utf16Le.decode(xml_bytes, "header xml")?;
    let raw_xml = clone_header_text(decoded_xml.trim_matches('\0').trim(), "header XML")?;
    let (tag_name, attributes) = parse_single_tag(&raw_xml, limits)?;
    build_header_section(kind, xml_len, raw_xml, tag_name, attributes, retained_bytes)
}

fn build_header_section(
    kind: ContainerKind,
    xml_len: usize,
    raw_xml: String,
    tag_name: String,
    attributes: Vec<(String, String)>,
    retained_bytes: usize,
) -> Result<HeaderSection> {
    match (kind, tag_name.as_str()) {
        (ContainerKind::Mdx, "Dictionary") | (ContainerKind::Mdd, "Library_Data") => {}
        _ => return Err(Error::InvalidFormat("unexpected top-level header tag")),
    }

    let generated_by_engine_version = clone_header_text(
        known_attribute(&attributes, "GeneratedByEngineVersion")?
            .ok_or(Error::InvalidFormat("missing GeneratedByEngineVersion"))?,
        "GeneratedByEngineVersion",
    )?;
    let required_engine_version = match known_attribute(&attributes, "RequiredEngineVersion")? {
        Some(value) => clone_header_text(value, "RequiredEngineVersion")?,
        None => clone_header_text(
            &generated_by_engine_version,
            "effective RequiredEngineVersion",
        )?,
    };

    let encrypted = parse_known_encryption(&attributes)?;

    let header = Header {
        raw_xml,
        tag_name,
        generated_by_engine_version,
        required_engine_version,
        encoding_label: clone_optional_attribute(&attributes, "Encoding")?,
        format: clone_optional_attribute(&attributes, "Format")?,
        // The sibling `mdx` metadata reader defaults v1/v2 MDD resource paths
        // to case-sensitive. Keep MDX's historical false default while
        // matching that metadata compatibility behavior.
        key_case_sensitive: parse_known_bool(
            &attributes,
            "KeyCaseSensitive",
            matches!(kind, ContainerKind::Mdd),
        )?,
        strip_key: parse_known_bool(&attributes, "StripKey", false)?,
        encrypted,
        register_by: clone_optional_attribute(&attributes, "RegisterBy")?,
        reg_code: clone_optional_attribute(&attributes, "RegCode")?,
        description: clone_optional_attribute(&attributes, "Description")?,
        title: clone_optional_attribute(&attributes, "Title")?,
        creation_date: clone_optional_attribute(&attributes, "CreationDate")?,
        attributes,
    };

    let xml_len = checked_u64(xml_len, "header XML length")?;
    let keyword_section_offset = 4u64
        .checked_add(xml_len)
        .and_then(|value| value.checked_add(4))
        .ok_or(Error::InvalidFormat("header section offset overflow"))?;

    Ok(HeaderSection {
        header,
        keyword_section_offset,
        retained_bytes,
        section: SectionRange::new(0, keyword_section_offset),
    })
}

fn header_memory_estimate(xml_len: usize, limits: &Limits) -> Result<usize> {
    let possible_attributes = usize::min(limits.header_attributes, (xml_len / 4).saturating_add(1));
    xml_len
        .checked_mul(8)
        .and_then(|bytes| {
            possible_attributes
                .checked_mul(size_of::<(String, String)>())
                .and_then(|attributes| bytes.checked_add(attributes))
        })
        .and_then(|bytes| bytes.checked_add(size_of::<Header>()))
        .ok_or(Error::InvalidFormat("header memory estimate overflow"))
}

fn parse_single_tag(xml: &str, limits: &Limits) -> Result<(String, Vec<(String, String)>)> {
    let bytes = xml.as_bytes();
    if !bytes.starts_with(b"<") {
        return Err(Error::InvalidFormat("header xml must start with '<'"));
    }
    let mut index = 1usize;
    while index < bytes.len()
        && !bytes[index].is_ascii_whitespace()
        && bytes[index] != b'/'
        && bytes[index] != b'>'
    {
        index += 1;
    }
    if index == 1 {
        return Err(Error::InvalidFormat("empty top-level header tag"));
    }
    let tag_name = clone_header_text(&xml[1..index], "header tag name")?;
    let mut attrs = Vec::new();
    let self_closing;

    loop {
        skip_ascii_whitespace(bytes, &mut index);
        if index >= bytes.len() {
            return Err(Error::InvalidFormat("unterminated header xml tag"));
        }
        match bytes[index] {
            b'/' => {
                index += 1;
                if bytes.get(index) == Some(&b'>') {
                    self_closing = true;
                    break;
                }
                return Err(Error::InvalidFormat("invalid self-closing header tag"));
            }
            b'>' => {
                self_closing = false;
                break;
            }
            _ => {}
        }

        if attrs.len() >= limits.header_attributes {
            return Err(Error::LimitExceeded {
                limit: "header_attributes",
                value: u64::try_from(attrs.len().saturating_add(1)).unwrap_or(u64::MAX),
                max: u64::try_from(limits.header_attributes).unwrap_or(u64::MAX),
            });
        }

        let name_start = index;
        while index < bytes.len()
            && !bytes[index].is_ascii_whitespace()
            && bytes[index] != b'='
            && bytes[index] != b'>'
        {
            index += 1;
        }
        if name_start == index {
            return Err(Error::InvalidFormat("empty header XML attribute name"));
        }
        let name = clone_header_text(&xml[name_start..index], "header attribute name")?;
        if attrs.iter().any(|(candidate, _)| candidate == &name) {
            return Err(Error::InvalidData(
                "duplicate exact header XML attribute".to_owned(),
            ));
        }
        skip_ascii_whitespace(bytes, &mut index);
        if bytes.get(index) != Some(&b'=') {
            return Err(Error::InvalidFormat("expected '=' in header xml attribute"));
        }
        index += 1;
        skip_ascii_whitespace(bytes, &mut index);
        let quote = match bytes.get(index) {
            Some(b'"') => b'"',
            Some(b'\'') => b'\'',
            _ => {
                return Err(Error::InvalidFormat("expected quoted header xml attribute"));
            }
        };
        index += 1;
        let value_start = index;
        while index < bytes.len() && bytes[index] != quote {
            index += 1;
        }
        if index >= bytes.len() {
            return Err(Error::InvalidFormat(
                "unterminated header xml attribute value",
            ));
        }
        let value = unescape_xml(&xml[value_start..index])?;
        try_reserve_vec(&mut attrs, 1, "header attributes")?;
        attrs.push((name, value));
        index += 1;
    }

    index += 1;
    skip_ascii_whitespace(bytes, &mut index);
    if index != bytes.len() && self_closing {
        return Err(Error::InvalidFormat(
            "trailing content after top-level header tag",
        ));
    }
    if index != bytes.len() {
        if !bytes
            .get(index..)
            .is_some_and(|tail| tail.starts_with(b"</"))
        {
            return Err(Error::InvalidFormat(
                "content inside top-level header element is not supported",
            ));
        }
        index += 2;
        let closing_name_start = index;
        while index < bytes.len() && !bytes[index].is_ascii_whitespace() && bytes[index] != b'>' {
            index += 1;
        }
        if bytes.get(closing_name_start..index) != Some(tag_name.as_bytes()) {
            return Err(Error::InvalidFormat(
                "mismatched top-level header closing tag",
            ));
        }
        skip_ascii_whitespace(bytes, &mut index);
        if bytes.get(index) != Some(&b'>') {
            return Err(Error::InvalidFormat(
                "malformed top-level header closing tag",
            ));
        }
        index += 1;
        skip_ascii_whitespace(bytes, &mut index);
        if index != bytes.len() {
            return Err(Error::InvalidFormat(
                "trailing content after top-level header element",
            ));
        }
    }

    Ok((tag_name, attrs))
}

fn skip_ascii_whitespace(bytes: &[u8], index: &mut usize) {
    while *index < bytes.len() && bytes[*index].is_ascii_whitespace() {
        *index += 1;
    }
}

fn known_attribute<'a>(
    attributes: &'a [(String, String)],
    canonical_name: &'static str,
) -> Result<Option<&'a str>> {
    let mut found = None;
    for (name, value) in attributes {
        if !name.eq_ignore_ascii_case(canonical_name) {
            continue;
        }
        if let Some(previous) = found
            && previous != value
        {
            return Err(Error::InvalidData(format!(
                "conflicting aliases for header attribute {canonical_name}"
            )));
        }
        found = Some(value.as_str());
    }
    Ok(found)
}

fn clone_optional_attribute(
    attributes: &[(String, String)],
    canonical_name: &'static str,
) -> Result<Option<String>> {
    known_attribute(attributes, canonical_name)?
        .filter(|value| !value.is_empty())
        .map(|value| clone_header_text(value, canonical_name))
        .transpose()
}

fn parse_known_bool(
    attributes: &[(String, String)],
    canonical_name: &'static str,
    default: bool,
) -> Result<bool> {
    let mut found = None;
    for (name, value) in attributes {
        if !name.eq_ignore_ascii_case(canonical_name) {
            continue;
        }
        let parsed = if value.eq_ignore_ascii_case("yes") {
            true
        } else if value.eq_ignore_ascii_case("no") {
            false
        } else {
            return Err(Error::InvalidData(format!(
                "header attribute {canonical_name} must be Yes or No"
            )));
        };
        if let Some(previous) = found
            && previous != parsed
        {
            return Err(Error::InvalidData(format!(
                "conflicting aliases for header attribute {canonical_name}"
            )));
        }
        found = Some(parsed);
    }
    Ok(found.unwrap_or(default))
}

fn parse_encryption_value(value: &str) -> Result<u8> {
    let bits = if value.eq_ignore_ascii_case("yes") {
        1
    } else if value.eq_ignore_ascii_case("no") {
        0
    } else {
        value
            .parse::<u8>()
            .map_err(|_| Error::InvalidData("header attribute Encrypted is malformed".to_owned()))?
    };
    if bits & !0b11 != 0 {
        return Err(Error::InvalidData(format!(
            "header attribute Encrypted contains unknown bits {bits:#04x}"
        )));
    }
    Ok(bits)
}

fn parse_known_encryption(attributes: &[(String, String)]) -> Result<u8> {
    let mut found = None;
    for (name, value) in attributes {
        if !name.eq_ignore_ascii_case("Encrypted") {
            continue;
        }
        let bits = parse_encryption_value(value)?;
        if let Some(previous) = found
            && previous != bits
        {
            return Err(Error::InvalidData(
                "conflicting aliases for header attribute Encrypted".to_owned(),
            ));
        }
        found = Some(bits);
    }
    Ok(found.unwrap_or(0))
}

fn unescape_xml(value: &str) -> Result<String> {
    let mut output = String::new();
    try_reserve_string(&mut output, value.len(), "header attribute value")?;
    let mut remaining = value;
    while let Some(entity_start) = remaining.find('&') {
        output.push_str(&remaining[..entity_start]);
        let after_ampersand = &remaining[entity_start + 1..];
        let entity_end = after_ampersand
            .find(';')
            .ok_or(Error::InvalidFormat("unterminated XML entity"))?;
        let entity = &after_ampersand[..entity_end];
        match entity {
            "amp" => output.push('&'),
            "lt" => output.push('<'),
            "gt" => output.push('>'),
            "quot" => output.push('"'),
            "apos" => output.push('\''),
            _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                let codepoint = u32::from_str_radix(&entity[2..], 16)
                    .map_err(|_| Error::InvalidFormat("invalid hex xml entity"))?;
                let ch = char::from_u32(codepoint)
                    .ok_or(Error::InvalidFormat("invalid hex xml codepoint"))?;
                output.push(ch);
            }
            _ if entity.starts_with('#') => {
                let codepoint = entity[1..]
                    .parse::<u32>()
                    .map_err(|_| Error::InvalidFormat("invalid decimal xml entity"))?;
                let ch = char::from_u32(codepoint)
                    .ok_or(Error::InvalidFormat("invalid decimal xml codepoint"))?;
                output.push(ch);
            }
            _ => return Err(Error::InvalidFormat("unsupported xml entity")),
        }
        remaining = &after_ampersand[entity_end + 1..];
    }
    output.push_str(remaining);
    Ok(output)
}

fn clone_header_text(value: &str, context: &'static str) -> Result<String> {
    let mut output = String::new();
    try_reserve_string(&mut output, value.len(), context)?;
    output.push_str(value);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_tag_attributes() {
        let xml =
            r#"<Dictionary Encoding="UTF-8" StripKey="Yes" Description="a &lt;b&gt;c&lt;/b&gt;"/>"#;
        let (tag, attrs) = parse_single_tag(xml, &Limits::new()).unwrap();
        assert_eq!(tag, "Dictionary");
        assert_eq!(known_attribute(&attrs, "Encoding").unwrap(), Some("UTF-8"));
        assert_eq!(known_attribute(&attrs, "StripKey").unwrap(), Some("Yes"));
        assert_eq!(
            known_attribute(&attrs, "Description").unwrap(),
            Some("a <b>c</b>")
        );
    }

    #[test]
    fn accepts_single_quoted_attributes_and_uppercase_hex_entities() {
        let xml = r#"<Dictionary GeneratedByEngineVersion='2.0' Title='A &#X42; &apos;C&apos;'/>"#;
        let (tag, attrs) = parse_single_tag(xml, &Limits::new()).unwrap();
        assert_eq!(tag, "Dictionary");
        assert_eq!(
            known_attribute(&attrs, "GeneratedByEngineVersion").unwrap(),
            Some("2.0")
        );
        assert_eq!(known_attribute(&attrs, "Title").unwrap(), Some("A B 'C'"));
    }

    #[test]
    fn accepts_compact_self_closing_tag_and_trailing_whitespace() {
        let (tag, attrs) = parse_single_tag("<Dictionary/> \r\n\t", &Limits::new()).unwrap();
        assert_eq!(tag, "Dictionary");
        assert!(attrs.is_empty());
    }

    #[test]
    fn accepts_empty_matching_closing_tag() {
        for xml in [
            r#"<Dictionary GeneratedByEngineVersion="2.0"></Dictionary>"#,
            "<Dictionary GeneratedByEngineVersion=\"2.0\"> \r\n </Dictionary > \t",
        ] {
            let (tag, attrs) = parse_single_tag(xml, &Limits::new()).unwrap();
            assert_eq!(tag, "Dictionary");
            assert_eq!(
                known_attribute(&attrs, "GeneratedByEngineVersion").unwrap(),
                Some("2.0")
            );
        }
    }

    #[test]
    fn rejects_content_after_top_level_tag() {
        for xml in [
            r#"<Dictionary GeneratedByEngineVersion="2.0"/>garbage"#,
            r#"<Dictionary GeneratedByEngineVersion="2.0">garbage"#,
            r#"<Dictionary GeneratedByEngineVersion="2.0"></Library_Data>"#,
            r#"<Dictionary GeneratedByEngineVersion="2.0"></Dictionary>garbage"#,
        ] {
            let error = parse_single_tag(xml, &Limits::new()).unwrap_err();
            assert!(matches!(error, Error::InvalidFormat(_)), "{xml:?}");
        }
    }

    #[test]
    fn legacy_mdd_boolean_defaults_match_resource_path_semantics() {
        for version in ["1.2", "2.0"] {
            let xml =
                format!(r#"<Library_Data GeneratedByEngineVersion="{version}" Format="Binary"/>"#);
            let (tag, attributes) = parse_single_tag(&xml, &Limits::new()).unwrap();
            let section =
                build_header_section(ContainerKind::Mdd, 0, xml, tag, attributes, 0).unwrap();
            assert!(section.header.key_case_sensitive, "{version}");
            assert!(!section.header.strip_key, "{version}");
        }

        let explicit_yes =
            r#"<Library_Data GeneratedByEngineVersion="2.0" KeyCaseSensitive="Yes"/>"#;
        let (tag, attributes) = parse_single_tag(explicit_yes, &Limits::new()).unwrap();
        let section = build_header_section(
            ContainerKind::Mdd,
            0,
            explicit_yes.to_owned(),
            tag,
            attributes,
            0,
        )
        .unwrap();
        assert!(section.header.key_case_sensitive);
        assert!(!section.header.strip_key);
    }

    #[test]
    fn explicit_booleans_override_container_defaults() {
        let mdd_xml = r#"<Library_Data GeneratedByEngineVersion="2.0" KeyCaseSensitive="No" StripKey="Yes"/>"#;
        let (tag, attributes) = parse_single_tag(mdd_xml, &Limits::new()).unwrap();
        let mdd = build_header_section(
            ContainerKind::Mdd,
            0,
            mdd_xml.to_owned(),
            tag,
            attributes,
            0,
        )
        .unwrap();
        assert!(!mdd.header.key_case_sensitive);
        assert!(mdd.header.strip_key);

        let mdx_xml = r#"<Dictionary GeneratedByEngineVersion="2.0"/>"#;
        let (tag, attributes) = parse_single_tag(mdx_xml, &Limits::new()).unwrap();
        let mdx = build_header_section(
            ContainerKind::Mdx,
            0,
            mdx_xml.to_owned(),
            tag,
            attributes,
            0,
        )
        .unwrap();
        assert!(!mdx.header.key_case_sensitive);
        assert!(!mdx.header.strip_key);
    }

    #[test]
    fn resolves_known_attributes_ascii_case_insensitively() {
        let xml = r#"<Dictionary GeneratedByEngineVersion="2.0" Stripkey="Yes" encrypted="2"/>"#;
        let (tag, attributes) = parse_single_tag(xml, &Limits::new()).unwrap();
        let section =
            build_header_section(ContainerKind::Mdx, 0, xml.to_owned(), tag, attributes, 0)
                .unwrap();
        assert!(section.header.strip_key);
        assert_eq!(section.header.encrypted, 2);
    }

    #[test]
    fn rejects_conflicting_attribute_aliases() {
        let xml = r#"<Dictionary GeneratedByEngineVersion="2.0" StripKey="Yes" Stripkey="No"/>"#;
        let (tag, attributes) = parse_single_tag(xml, &Limits::new()).unwrap();
        let error = build_header_section(ContainerKind::Mdx, 0, xml.to_owned(), tag, attributes, 0)
            .unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }

    #[test]
    fn rejects_duplicate_exact_attributes() {
        let xml = r#"<Dictionary Encoding="UTF-8" Encoding="UTF-16"/>"#;
        let error = parse_single_tag(xml, &Limits::new()).unwrap_err();
        assert!(matches!(error, Error::InvalidData(_)));
    }

    #[test]
    fn rejects_malformed_and_unknown_encryption_bits() {
        assert!(parse_encryption_value("maybe").is_err());
        assert!(parse_encryption_value("4").is_err());
    }

    #[test]
    fn accepts_semantically_equivalent_boolean_and_encryption_aliases() {
        let xml = r#"<Dictionary GeneratedByEngineVersion="2.0" StripKey="Yes" STRIPKEY="YES" Encrypted="No" ENCRYPTED="0"/>"#;
        let (tag, attributes) = parse_single_tag(xml, &Limits::new()).unwrap();
        let section =
            build_header_section(ContainerKind::Mdx, 0, xml.to_owned(), tag, attributes, 0)
                .unwrap();
        assert!(section.header.strip_key);
        assert_eq!(section.header.encrypted, 0);
    }

    #[test]
    fn rejects_oversized_header_before_reading_the_body() {
        let declared = u32::try_from(Limits::new().header_xml_bytes + 1).unwrap();
        let error = parse_header_bytes(&declared.to_be_bytes(), ContainerKind::Mdx).unwrap_err();
        assert!(matches!(error, Error::LimitExceeded { .. }));
    }

    #[test]
    fn rejects_odd_utf16_header_length_before_decoding() {
        let error = parse_header_bytes(&[0, 0, 0, 1], ContainerKind::Mdx).unwrap_err();
        assert!(matches!(
            error,
            Error::InvalidFormat("header XML length is not UTF-16LE aligned")
        ));
    }
}
