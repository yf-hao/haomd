use super::{scan_font_directories, DiscoveredFont, FontCatalogProvider, FontMetadataParser};
use std::path::PathBuf;
use std::process::Command;

pub(crate) struct LinuxFontCatalogProvider {
    parser: Box<dyn FontMetadataParser>,
}

impl LinuxFontCatalogProvider {
    pub(crate) fn new(parser: Box<dyn FontMetadataParser>) -> Self {
        Self { parser }
    }
}

impl FontCatalogProvider for LinuxFontCatalogProvider {
    fn list_fonts(&self) -> Result<Vec<DiscoveredFont>, String> {
        let fc_list_fonts = list_fonts_via_fc_list();
        if !fc_list_fonts.is_empty() {
            return Ok(fc_list_fonts);
        }

        Ok(scan_font_directories(
            &linux_font_directories(),
            self.parser.as_ref(),
        ))
    }
}

fn list_fonts_via_fc_list() -> Vec<DiscoveredFont> {
    let output = match Command::new("fc-list")
        .args(["--format=%{family}\n"])
        .output()
    {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };

    parse_fc_list_output(&String::from_utf8_lossy(&output.stdout))
}

fn parse_fc_list_output(output: &str) -> Vec<DiscoveredFont> {
    output
        .lines()
        .flat_map(|line| line.split(','))
        .filter_map(|family| {
            let family = family.trim();
            if family.is_empty() {
                None
            } else {
                Some(DiscoveredFont {
                    family: family.to_string(),
                    display_name: family.to_string(),
                })
            }
        })
        .collect()
}

fn linux_font_directories() -> Vec<PathBuf> {
    let mut directories = vec![
        PathBuf::from("/usr/share/fonts"),
        PathBuf::from("/usr/local/share/fonts"),
    ];

    if let Some(home) = std::env::var_os("HOME") {
        directories.push(PathBuf::from(&home).join(".fonts"));
        directories.push(PathBuf::from(home).join(".local/share/fonts"));
    }

    directories
}

#[cfg(test)]
mod tests {
    use super::parse_fc_list_output;

    #[test]
    fn should_parse_fc_list_output_into_fonts() {
        let fonts = parse_fc_list_output("Noto Sans CJK SC,Noto Sans CJK\n\nInter\n");
        assert_eq!(fonts.len(), 3);
        assert_eq!(fonts[0].family, "Noto Sans CJK SC");
        assert_eq!(fonts[1].family, "Noto Sans CJK");
        assert_eq!(fonts[2].family, "Inter");
    }
}
