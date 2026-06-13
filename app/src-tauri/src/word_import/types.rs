use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedWordDocument {
    pub markdown: String,
    pub temp_dir: String,
    pub temp_markdown_path: String,
    pub temp_images_dir: String,
    pub source_docx_path: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizedImportedWordDocument {
    pub markdown: String,
    pub saved_path: String,
    pub assets_dir: String,
}

#[derive(Debug, Clone)]
pub struct ImportedWordImageAsset {
    pub file_name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub enum ImportedWordBlock {
    Paragraph(ImportedWordParagraph),
    Table(ImportedWordTable),
}

#[derive(Debug, Clone)]
pub struct ImportedWordParagraph {
    pub kind: ImportedWordParagraphKind,
    pub inlines: Vec<ImportedWordInline>,
}

#[derive(Debug, Clone)]
pub enum ImportedWordParagraphKind {
    Normal,
    Heading(u8),
    Quote,
    ListItem { ordered: bool, level: usize },
}

#[derive(Debug, Clone)]
pub enum ImportedWordInline {
    Text(ImportedWordTextRun),
    Link { text: String, url: String },
    Image { file_name: String },
}

#[derive(Debug, Clone)]
pub struct ImportedWordTextRun {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub strike: bool,
}

#[derive(Debug, Clone)]
pub struct ImportedWordTable {
    pub rows: Vec<Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct ParsedImportedWordDocument {
    pub blocks: Vec<ImportedWordBlock>,
    pub assets: Vec<ImportedWordImageAsset>,
    pub warnings: Vec<String>,
}
