use super::DiscoveredFont;
use std::collections::HashSet;

pub(crate) fn normalize_fonts(fonts: Vec<DiscoveredFont>) -> Vec<DiscoveredFont> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::new();

    for font in fonts {
        let family = font.family.trim();
        let display_name = font.display_name.trim();
        if family.is_empty() || display_name.is_empty() {
            continue;
        }

        let dedupe_key = family.to_ascii_lowercase();
        if !seen.insert(dedupe_key) {
            continue;
        }

        normalized.push(DiscoveredFont {
            family: family.to_string(),
            display_name: display_name.to_string(),
        });
    }

    normalized.sort_by(|left, right| {
        left.display_name
            .to_ascii_lowercase()
            .cmp(&right.display_name.to_ascii_lowercase())
            .then_with(|| left.display_name.cmp(&right.display_name))
    });

    normalized
}

#[cfg(test)]
mod tests {
    use super::normalize_fonts;
    use crate::font_catalog::DiscoveredFont;

    #[test]
    fn should_filter_empty_fonts_and_deduplicate_by_family() {
        let fonts = normalize_fonts(vec![
            DiscoveredFont {
                family: "  ".into(),
                display_name: "Ignored".into(),
            },
            DiscoveredFont {
                family: "Calibri".into(),
                display_name: "Calibri".into(),
            },
            DiscoveredFont {
                family: "calibri".into(),
                display_name: "CALIBRI".into(),
            },
            DiscoveredFont {
                family: "Times New Roman".into(),
                display_name: "Times New Roman".into(),
            },
        ]);

        assert_eq!(fonts.len(), 2);
        assert_eq!(fonts[0].family, "Calibri");
        assert_eq!(fonts[1].family, "Times New Roman");
    }
}

