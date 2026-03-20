#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
mod normalize;
mod parser;
#[cfg(target_os = "windows")]
mod windows;

use crate::{err_payload, new_trace_id, ok, ErrorCode, ResultPayload};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontOptionCfg {
    pub family: String,
    pub display_name: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiscoveredFont {
    pub family: String,
    pub display_name: String,
}

pub(crate) trait FontCatalogProvider {
    fn list_fonts(&self) -> Result<Vec<DiscoveredFont>, String>;
}

pub(crate) trait FontMetadataParser {
    fn parse_family(&self, path: &Path) -> Option<String>;
}

#[derive(Debug, Default)]
struct DefaultFontMetadataParser;

impl FontMetadataParser for DefaultFontMetadataParser {
    fn parse_family(&self, path: &Path) -> Option<String> {
        parser::parse_font_family(path)
    }
}

struct EmptyProvider;

impl FontCatalogProvider for EmptyProvider {
    fn list_fonts(&self) -> Result<Vec<DiscoveredFont>, String> {
        Ok(Vec::new())
    }
}

fn create_provider() -> Box<dyn FontCatalogProvider> {
    let parser: Box<dyn FontMetadataParser> = Box::<DefaultFontMetadataParser>::default();

    #[cfg(target_os = "windows")]
    {
        return Box::new(windows::WindowsFontCatalogProvider::new(parser));
    }

    #[cfg(target_os = "macos")]
    {
        return Box::new(macos::MacOsFontCatalogProvider::new(parser));
    }

    #[cfg(target_os = "linux")]
    {
        return Box::new(linux::LinuxFontCatalogProvider::new(parser));
    }

    #[allow(unreachable_code)]
    Box::new(EmptyProvider)
}

pub(crate) fn normalize_to_font_options(fonts: Vec<DiscoveredFont>) -> Vec<FontOptionCfg> {
    normalize::normalize_fonts(fonts)
        .into_iter()
        .map(|font| FontOptionCfg {
            family: font.family.clone(),
            display_name: font.display_name,
            source: "system".to_string(),
        })
        .collect()
}

pub(crate) fn scan_font_directories(
    directories: &[PathBuf],
    parser: &dyn FontMetadataParser,
) -> Vec<DiscoveredFont> {
    let mut fonts = Vec::new();
    for dir in directories {
        collect_fonts_from_path(dir, parser, &mut fonts);
    }
    fonts
}

fn collect_fonts_from_path(
    path: &Path,
    parser: &dyn FontMetadataParser,
    out: &mut Vec<DiscoveredFont>,
) {
    let read_dir = match std::fs::read_dir(path) {
        Ok(read_dir) => read_dir,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            collect_fonts_from_path(&entry_path, parser, out);
            continue;
        }

        if !is_supported_font_file(&entry_path) {
            continue;
        }

        if let Some(family) = parser.parse_family(&entry_path) {
            out.push(DiscoveredFont {
                display_name: family.clone(),
                family,
            });
        }
    }
}

fn is_supported_font_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase()),
        Some(ext) if matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc")
    )
}

#[tauri::command]
pub async fn list_system_fonts() -> ResultPayload<Vec<FontOptionCfg>> {
    let trace = new_trace_id();
    let provider = create_provider();
    match provider.list_fonts() {
        Ok(fonts) => ok(normalize_to_font_options(fonts), trace),
        Err(error) => err_payload(ErrorCode::UNKNOWN, error, trace),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_to_font_options, scan_font_directories, DiscoveredFont, FontMetadataParser,
    };
    use std::path::Path;

    #[derive(Default)]
    struct MockFontMetadataParser;

    impl FontMetadataParser for MockFontMetadataParser {
        fn parse_family(&self, path: &Path) -> Option<String> {
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| stem.replace('-', " "))
        }
    }

    #[test]
    fn should_scan_nested_font_directories_and_ignore_non_font_files() {
        let root = std::env::temp_dir().join(format!(
            "haomd-font-scan-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default()
        ));
        let nested = root.join("nested");
        std::fs::create_dir_all(&nested).expect("create font test dir");
        std::fs::write(root.join("Inter-Regular.ttf"), b"dummy").expect("write font");
        std::fs::write(nested.join("NotoSansSC.otf"), b"dummy").expect("write nested font");
        std::fs::write(root.join("README.txt"), b"ignore").expect("write non-font");

        let fonts = scan_font_directories(&[root.clone()], &MockFontMetadataParser);
        std::fs::remove_dir_all(&root).expect("cleanup font test dir");

        assert_eq!(
            fonts,
            vec![
                DiscoveredFont {
                    family: "Inter Regular".to_string(),
                    display_name: "Inter Regular".to_string(),
                },
                DiscoveredFont {
                    family: "NotoSansSC".to_string(),
                    display_name: "NotoSansSC".to_string(),
                },
            ]
        );
    }

    #[test]
    fn should_normalize_discovered_fonts_to_system_font_options() {
        let options = normalize_to_font_options(vec![
            DiscoveredFont {
                family: "Calibri".to_string(),
                display_name: "Calibri".to_string(),
            },
            DiscoveredFont {
                family: "calibri".to_string(),
                display_name: "CALIBRI".to_string(),
            },
            DiscoveredFont {
                family: "Times New Roman".to_string(),
                display_name: "Times New Roman".to_string(),
            },
        ]);

        assert_eq!(options.len(), 2);
        assert_eq!(options[0].family, "Calibri");
        assert_eq!(options[0].source, "system");
        assert_eq!(options[1].family, "Times New Roman");
    }
}
