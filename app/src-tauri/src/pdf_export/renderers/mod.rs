pub mod line;
pub mod stamp;
pub mod shapes;
pub mod free_text;
pub mod text_markup;

use crate::pdf_export::coords::PdfPageSize;
use crate::pdf_export::types::ExportPdfAnnotation;
use lopdf::content::Operation;

pub struct PageRenderContext {
    pub page_size: PdfPageSize,
    pub ext_gstate_name: Option<String>,
}

pub fn render_annotation(
    annotation: &ExportPdfAnnotation,
    operations: &mut Vec<Operation>,
    context: &PageRenderContext,
) {
    match annotation {
        ExportPdfAnnotation::Highlight { .. }
        | ExportPdfAnnotation::Underline { .. }
        | ExportPdfAnnotation::Strikeout { .. }
        | ExportPdfAnnotation::Squiggly { .. } => {
            text_markup::render(annotation, operations, context)
        }
        ExportPdfAnnotation::Square { .. } | ExportPdfAnnotation::Circle { .. } => {
            shapes::render(annotation, operations, context)
        }
        ExportPdfAnnotation::Line { .. } | ExportPdfAnnotation::Arrow { .. } => {
            line::render(annotation, operations, context)
        }
        ExportPdfAnnotation::Stamp { .. } => stamp::render(annotation, operations, context),
        ExportPdfAnnotation::FreeText { .. } => free_text::render(annotation, operations, context),
    }
}
