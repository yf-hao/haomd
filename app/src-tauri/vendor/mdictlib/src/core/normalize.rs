use crate::error::{Error, Result};
use crate::limits::try_reserve_string;
use crate::types::{ContainerKind, Header};

/// The clean-room compatibility profile used when `StripKey` is enabled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StripKeyProfile {
    /// Retain ASCII letters/digits and leave every non-ASCII character intact.
    AsciiAlphanumeric,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct KeyNormalizer {
    case_sensitive: bool,
    strip_profile: Option<StripKeyProfile>,
    resource_path: bool,
}

impl KeyNormalizer {
    pub(super) const fn from_header(header: &Header, kind: ContainerKind) -> Self {
        Self {
            case_sensitive: header.key_case_sensitive,
            strip_profile: if header.strip_key {
                Some(StripKeyProfile::AsciiAlphanumeric)
            } else {
                None
            },
            resource_path: matches!(kind, ContainerKind::Mdd),
        }
    }

    pub(super) fn normalize(self, raw: &str) -> Result<String> {
        let capacity = self.normalized_len(raw)?;
        let mut normalized = String::new();
        try_reserve_string(&mut normalized, capacity, "normalized key")?;
        self.normalize_into(raw, &mut normalized);
        Ok(normalized)
    }

    /// Appends the normalized form of `raw` to an existing buffer.
    ///
    /// The caller is responsible for having reserved the [`Self::normalized_len`]
    /// bytes this appends; building millions of keys into one arena is the
    /// reason this exists rather than only [`Self::normalize`].
    pub(super) fn normalize_into(self, raw: &str, out: &mut String) {
        let mut at_path_start = true;
        for mut character in raw.chars() {
            if self.resource_path && at_path_start && matches!(character, '/' | '\\') {
                continue;
            }
            at_path_start = false;
            if !self.retains(character) {
                continue;
            }
            if self.resource_path && character == '/' {
                character = '\\';
            }
            if self.case_sensitive || character.is_ascii() {
                // `char::to_lowercase` is a table lookup returning an iterator.
                // Keys are overwhelmingly ASCII, and this runs over every key in
                // the file.
                out.push(if self.case_sensitive {
                    character
                } else {
                    character.to_ascii_lowercase()
                });
            } else {
                out.extend(character.to_lowercase());
            }
        }
    }

    /// Appends the normalized UTF-8 bytes directly to a shared byte arena.
    pub(super) fn normalize_bytes_into(self, raw: &str, out: &mut Vec<u8>) {
        let mut at_path_start = true;
        for mut character in raw.chars() {
            if self.resource_path && at_path_start && matches!(character, '/' | '\\') {
                continue;
            }
            at_path_start = false;
            if !self.retains(character) {
                continue;
            }
            if self.resource_path && character == '/' {
                character = '\\';
            }
            if self.case_sensitive || character.is_ascii() {
                let normalized = if self.case_sensitive {
                    character
                } else {
                    character.to_ascii_lowercase()
                };
                let mut encoded = [0u8; 4];
                out.extend_from_slice(normalized.encode_utf8(&mut encoded).as_bytes());
            } else {
                for normalized in character.to_lowercase() {
                    let mut encoded = [0u8; 4];
                    out.extend_from_slice(normalized.encode_utf8(&mut encoded).as_bytes());
                }
            }
        }
    }

    const fn retains(self, character: char) -> bool {
        !matches!(self.strip_profile, Some(StripKeyProfile::AsciiAlphanumeric))
            || !character.is_ascii()
            || character.is_ascii_alphanumeric()
    }

    pub(super) fn normalized_len(self, raw: &str) -> Result<usize> {
        let mut length = 0usize;
        let mut at_path_start = true;
        for mut character in raw.chars() {
            if self.resource_path && at_path_start && matches!(character, '/' | '\\') {
                continue;
            }
            at_path_start = false;
            if !self.retains(character) {
                continue;
            }
            if self.resource_path && character == '/' {
                character = '\\';
            }
            if self.case_sensitive || character.is_ascii() {
                length = length
                    .checked_add(character.len_utf8())
                    .ok_or(Error::InvalidFormat("normalized key length overflow"))?;
            } else {
                for lowercase in character.to_lowercase() {
                    length = length
                        .checked_add(lowercase.len_utf8())
                        .ok_or(Error::InvalidFormat("normalized key length overflow"))?;
                }
            }
        }
        Ok(length)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn normalizer(case_sensitive: bool, strip: bool) -> KeyNormalizer {
        KeyNormalizer {
            case_sensitive,
            strip_profile: strip.then_some(StripKeyProfile::AsciiAlphanumeric),
            resource_path: false,
        }
    }

    fn resource_normalizer(case_sensitive: bool) -> KeyNormalizer {
        KeyNormalizer {
            case_sensitive,
            strip_profile: None,
            resource_path: true,
        }
    }

    #[test]
    fn preserves_raw_shape_without_strip_key() {
        assert_eq!(
            normalizer(true, false).normalize(" A-b.c ").unwrap(),
            " A-b.c "
        );
    }

    #[test]
    fn strip_key_removes_non_alphanumeric_ascii_anywhere() {
        assert_eq!(
            normalizer(false, true).normalize(" A-b.c_D ").unwrap(),
            "abcd"
        );
    }

    #[test]
    fn strip_key_preserves_non_ascii_whitespace_and_punctuation() {
        assert_eq!(
            normalizer(true, true).normalize("A\u{2003}B—C").unwrap(),
            "A\u{2003}B—C"
        );
    }

    #[test]
    fn case_folding_can_expand_unicode_characters() {
        assert_eq!(normalizer(false, false).normalize("İ").unwrap(), "i\u{307}");
    }

    #[test]
    fn mdd_paths_ignore_leading_and_separator_style_differences() {
        let normalizer = resource_normalizer(true);
        for path in [
            r"\assets\theme.css",
            "/assets/theme.css",
            "assets/theme.css",
        ] {
            assert_eq!(normalizer.normalize(path).unwrap(), r"assets\theme.css");
        }
    }
}
