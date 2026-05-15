use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPdfRect {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPdfDocument {
    #[serde(rename = "sourcePath")]
    pub source_path: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "pageCount")]
    pub page_count: u32,
    pub annotations: Vec<ExportPdfAnnotation>,
    #[serde(rename = "appendixNotes", default)]
    pub appendix_notes: Vec<ExportPdfAppendixNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportPdfAppendixNote {
    pub page: u32,
    #[serde(rename = "annotationKind")]
    pub annotation_kind: String,
    pub quote: Option<String>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ExportPdfAnnotation {
    #[serde(rename = "highlight")]
    Highlight {
        page: u32,
        color: String,
        opacity: f32,
        rects: Vec<ExportPdfRect>,
    },
    #[serde(rename = "underline")]
    Underline {
        page: u32,
        color: String,
        opacity: f32,
        rects: Vec<ExportPdfRect>,
    },
    #[serde(rename = "strikeout")]
    Strikeout {
        page: u32,
        color: String,
        opacity: f32,
        rects: Vec<ExportPdfRect>,
    },
    #[serde(rename = "squiggly")]
    Squiggly {
        page: u32,
        color: String,
        opacity: f32,
        rects: Vec<ExportPdfRect>,
    },
    #[serde(rename = "square")]
    Square {
        page: u32,
        color: String,
        opacity: f32,
        rect: ExportPdfRect,
    },
    #[serde(rename = "circle")]
    Circle {
        page: u32,
        color: String,
        opacity: f32,
        rect: ExportPdfRect,
    },
    #[serde(rename = "line")]
    Line {
        page: u32,
        color: String,
        opacity: f32,
        line: ExportPdfRect,
    },
    #[serde(rename = "arrow")]
    Arrow {
        page: u32,
        color: String,
        opacity: f32,
        line: ExportPdfRect,
    },
    #[serde(rename = "stamp")]
    Stamp {
        page: u32,
        color: String,
        opacity: f32,
        rect: ExportPdfRect,
        #[serde(rename = "stampKind")]
        stamp_kind: String,
    },
    #[serde(rename = "freeText")]
    FreeText {
        page: u32,
        color: String,
        opacity: f32,
        rect: ExportPdfRect,
        text: String,
    },
}
