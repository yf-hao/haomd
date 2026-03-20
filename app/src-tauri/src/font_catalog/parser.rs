use std::path::Path;
use ttf_parser::{name_id, Face};

const STYLE_SUFFIXES: &[&str] = &[
    "regular",
    "bold",
    "italic",
    "oblique",
    "medium",
    "light",
    "thin",
    "black",
    "semibold",
    "demibold",
    "extrabold",
    "ultrabold",
    "condensed",
    "narrow",
];

pub(crate) fn parse_font_family(path: &Path) -> Option<String> {
    if let Some(metadata_family) = parse_family_from_font_metadata(path) {
        return Some(metadata_family);
    }

    parse_family_from_file_stem(path)
}

fn parse_family_from_font_metadata(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    parse_family_from_face_index(&bytes, 0)
}

fn parse_family_from_face_index(bytes: &[u8], index: u32) -> Option<String> {
    let face = Face::parse(bytes, index).ok()?;

    let mut family_name = None;
    let mut typographic_family_name = None;
    for name in face.names() {
        let value = name.to_string()?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            continue;
        }

        if name.name_id == name_id::TYPOGRAPHIC_FAMILY {
            typographic_family_name = Some(trimmed.to_string());
            break;
        }

        if name.name_id == name_id::FAMILY {
            family_name = Some(trimmed.to_string());
        }
    }

    typographic_family_name.or(family_name)
}

fn parse_family_from_file_stem(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    let sanitized = stem.replace(['_', '-'], " ");
    let collapsed = sanitized.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }

    let family = trim_style_suffixes(&collapsed);
    if family.is_empty() {
        None
    } else {
        Some(family.to_string())
    }
}

fn trim_style_suffixes(input: &str) -> &str {
    let mut parts = input.split_whitespace().collect::<Vec<_>>();
    while let Some(last) = parts.last() {
        if STYLE_SUFFIXES.contains(&last.to_ascii_lowercase().as_str()) {
            parts.pop();
        } else {
            break;
        }
    }

    if parts.is_empty() { input } else { &input[..parts.join(" ").len()] }
}

#[cfg(test)]
mod tests {
    use super::{parse_family_from_file_stem, trim_style_suffixes};
    use std::path::Path;

    #[test]
    fn should_strip_common_style_suffixes_from_file_name() {
        let family = parse_family_from_file_stem(Path::new("/tmp/SourceHanSansSC-Bold.otf"));
        assert_eq!(family.as_deref(), Some("SourceHanSansSC"));
    }

    #[test]
    fn should_trim_known_style_suffixes() {
        assert_eq!(trim_style_suffixes("Inter Regular"), "Inter");
        assert_eq!(trim_style_suffixes("Noto Sans CJK SC Bold"), "Noto Sans CJK SC");
        assert_eq!(trim_style_suffixes("PingFang SC"), "PingFang SC");
    }
}
