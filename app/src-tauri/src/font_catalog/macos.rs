use super::{scan_font_directories, DiscoveredFont, FontCatalogProvider, FontMetadataParser};
use std::path::PathBuf;

pub(crate) struct MacOsFontCatalogProvider {
    parser: Box<dyn FontMetadataParser>,
}

impl MacOsFontCatalogProvider {
    pub(crate) fn new(parser: Box<dyn FontMetadataParser>) -> Self {
        Self { parser }
    }
}

impl FontCatalogProvider for MacOsFontCatalogProvider {
    fn list_fonts(&self) -> Result<Vec<DiscoveredFont>, String> {
        Ok(scan_font_directories(
            &macos_font_directories(),
            self.parser.as_ref(),
        ))
    }
}

fn macos_font_directories() -> Vec<PathBuf> {
    let mut directories = vec![
        PathBuf::from("/System/Library/Fonts"),
        PathBuf::from("/Library/Fonts"),
    ];

    if let Some(home) = std::env::var_os("HOME") {
        directories.push(PathBuf::from(home).join("Library/Fonts"));
    }

    directories
}

