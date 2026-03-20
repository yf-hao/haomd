use super::{scan_font_directories, DiscoveredFont, FontCatalogProvider, FontMetadataParser};
use std::path::PathBuf;

pub(crate) struct WindowsFontCatalogProvider {
    parser: Box<dyn FontMetadataParser>,
}

impl WindowsFontCatalogProvider {
    pub(crate) fn new(parser: Box<dyn FontMetadataParser>) -> Self {
        Self { parser }
    }
}

impl FontCatalogProvider for WindowsFontCatalogProvider {
    fn list_fonts(&self) -> Result<Vec<DiscoveredFont>, String> {
        Ok(scan_font_directories(
            &windows_font_directories(),
            self.parser.as_ref(),
        ))
    }
}

fn windows_font_directories() -> Vec<PathBuf> {
    let mut directories = vec![PathBuf::from(r"C:\Windows\Fonts")];

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        directories.push(PathBuf::from(local_app_data).join("Microsoft/Windows/Fonts"));
    }

    directories
}
