//! Fixed key ordering for written dictionaries.
//!
//! Conventional readers locate entries by binary search over key-block
//! summaries, so emitted files must carry one deterministic order. The rule
//! is: scalar Unicode lowercase folding, ASCII punctuation and space removal
//! for MDX keys only, then folded codepoint order. Keys whose folded forms
//! are equal (case-only or punctuation-only differences) keep caller
//! insertion order because the caller sorts stably.
//!
//! Community writers that sort through a locale transform add length and
//! trailing-punctuation tie-breaks after that transform; under this fixed
//! fold, equal folded text is identical text, so those tie-breaks have
//! nothing left to order and are deliberately absent.

use std::cmp::Ordering;

use super::Kind;

/// Compares two dictionary keys under the fixed writer ordering.
pub(super) fn compare(kind: Kind, left: &str, right: &str) -> Ordering {
    fold(left, matches!(kind, Kind::Mdx)).cmp(&fold(right, matches!(kind, Kind::Mdx)))
}

/// Lowercases a key and, for MDX keys, removes ASCII punctuation and spaces.
fn fold(key: &str, strip: bool) -> String {
    let mut folded = String::with_capacity(key.len());
    for ch in key.chars().flat_map(char::to_lowercase) {
        if strip && (ch.is_ascii_punctuation() || ch == ' ') {
            continue;
        }
        folded.push(ch);
    }
    folded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_case_before_comparing() {
        assert_eq!(compare(Kind::Mdx, "Apple", "apple"), Ordering::Equal);
        assert_eq!(compare(Kind::Mdx, "apple", "Banana"), Ordering::Less);
    }

    #[test]
    fn prefixes_sort_before_longer_keys() {
        assert_eq!(compare(Kind::Mdx, "ab", "abc"), Ordering::Less);
    }

    #[test]
    fn mdx_keys_strip_ascii_punctuation_and_space() {
        // "a-b" folds to "ab", which sorts after "aa".
        assert_eq!(compare(Kind::Mdx, "a-b", "aa"), Ordering::Greater);
        // MDD keys keep punctuation, so "a-b" sorts before "aa" by codepoint.
        assert_eq!(compare(Kind::Mdd, "a-b", "aa"), Ordering::Less);
    }

    #[test]
    fn equal_keys_compare_equal() {
        assert_eq!(compare(Kind::Mdx, "same", "same"), Ordering::Equal);
        assert_eq!(compare(Kind::Mdd, "/a.css", "/a.css"), Ordering::Equal);
    }

    #[test]
    fn non_ascii_survives_folding() {
        assert_eq!(compare(Kind::Mdx, "你好", "世界"), Ordering::Greater);
        // CJK punctuation is not ASCII punctuation and is never stripped.
        assert_eq!(compare(Kind::Mdx, "你·好", "你好"), Ordering::Less);
    }
}
