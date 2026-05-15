use crate::pdf_export::coords::rect_to_pdf_bounds;
use crate::pdf_export::renderers::PageRenderContext;
use crate::pdf_export::text_outlines::{
    draw_text_line_outline, load_export_font, wrap_text_lines,
};
use crate::pdf_export::types::ExportPdfAnnotation;
use lopdf::{content::Operation, Object};
use ttf_parser::Face;

fn parse_rgb(color: &str) -> [f32; 3] {
    let hex = color.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return [0.0, 0.0, 0.0];
    }
    let parse = |slice: &str| u8::from_str_radix(slice, 16).ok().map(|value| value as f32 / 255.0);
    match (parse(&hex[0..2]), parse(&hex[2..4]), parse(&hex[4..6])) {
        (Some(red), Some(green), Some(blue)) => [red, green, blue],
        _ => [0.0, 0.0, 0.0],
    }
}

pub fn render(
    annotation: &ExportPdfAnnotation,
    operations: &mut Vec<Operation>,
    context: &PageRenderContext,
) {
    let (color, rect, text) = match annotation {
        ExportPdfAnnotation::FreeText { color, rect, text, .. } => {
            (parse_rgb(color), rect, text)
        }
        _ => return,
    };

    let Ok(loaded_font) = load_export_font(text) else {
        return;
    };
    let Ok(face) = Face::parse(&loaded_font.bytes, loaded_font.face_index) else {
        return;
    };

    let bounds = rect_to_pdf_bounds(rect, context.page_size);
    let font_size = (bounds.height * 0.55).clamp(8.0, 20.0);
    let line_height = font_size * 1.25;
    let text_left = bounds.left + 1.5;
    let first_baseline = bounds.top - font_size;
    let units_per_em = face.units_per_em() as f64;
    let scale = font_size / units_per_em;
    let max_width = (bounds.width - 3.0).max(font_size);
    let lines = wrap_text_lines(&face, text, scale, max_width);

    operations.push(Operation::new("q", vec![]));
    operations.push(Operation::new(
        "rg",
        vec![Object::Real(color[0]), Object::Real(color[1]), Object::Real(color[2])],
    ));
    for (index, line) in lines.iter().enumerate() {
        let baseline = first_baseline - line_height * index as f64;
        if baseline < bounds.bottom {
            break;
        }
        draw_text_line_outline(operations, &face, line, text_left, baseline, scale);
    }
    operations.push(Operation::new("Q", vec![]));
}
