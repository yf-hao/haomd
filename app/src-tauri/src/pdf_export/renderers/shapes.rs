use crate::pdf_export::coords::{rect_to_pdf_bounds, PdfBounds};
use crate::pdf_export::renderers::PageRenderContext;
use crate::pdf_export::types::ExportPdfAnnotation;
use lopdf::{content::Operation, Object};

fn parse_rgb(color: &str) -> [f32; 3] {
    let hex = color.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return [1.0, 0.84, 0.04];
    }
    let parse = |slice: &str| {
        u8::from_str_radix(slice, 16)
            .ok()
            .map(|value| value as f32 / 255.0)
    };
    match (parse(&hex[0..2]), parse(&hex[2..4]), parse(&hex[4..6])) {
        (Some(red), Some(green), Some(blue)) => [red, green, blue],
        _ => [1.0, 0.84, 0.04],
    }
}

fn set_stroke_color(operations: &mut Vec<Operation>, color: [f32; 3]) {
    operations.push(Operation::new(
        "RG",
        vec![
            Object::Real(color[0]),
            Object::Real(color[1]),
            Object::Real(color[2]),
        ],
    ));
}

fn draw_rect(bounds: PdfBounds, operations: &mut Vec<Operation>) {
    let line_width = (bounds.height * 0.03).max(1.2);
    operations.push(Operation::new("w", vec![Object::Real(line_width as f32)]));
    operations.push(Operation::new(
        "re",
        vec![
            Object::Real(bounds.left as f32),
            Object::Real(bounds.bottom as f32),
            Object::Real(bounds.width as f32),
            Object::Real(bounds.height as f32),
        ],
    ));
    operations.push(Operation::new("S", vec![]));
}

fn draw_ellipse(bounds: PdfBounds, operations: &mut Vec<Operation>) {
    let kappa = 0.552_284_749_831_f64;
    let cx = (bounds.left + bounds.right) * 0.5;
    let cy = (bounds.top + bounds.bottom) * 0.5;
    let rx = bounds.width * 0.5;
    let ry = bounds.height * 0.5;
    let ox = rx * kappa;
    let oy = ry * kappa;
    let line_width = (bounds.height * 0.03).max(1.2);
    operations.push(Operation::new("w", vec![Object::Real(line_width as f32)]));
    operations.push(Operation::new(
        "m",
        vec![Object::Real((cx - rx) as f32), Object::Real(cy as f32)],
    ));
    operations.push(Operation::new(
        "c",
        vec![
            Object::Real((cx - rx) as f32),
            Object::Real((cy + oy) as f32),
            Object::Real((cx - ox) as f32),
            Object::Real((cy + ry) as f32),
            Object::Real(cx as f32),
            Object::Real((cy + ry) as f32),
        ],
    ));
    operations.push(Operation::new(
        "c",
        vec![
            Object::Real((cx + ox) as f32),
            Object::Real((cy + ry) as f32),
            Object::Real((cx + rx) as f32),
            Object::Real((cy + oy) as f32),
            Object::Real((cx + rx) as f32),
            Object::Real(cy as f32),
        ],
    ));
    operations.push(Operation::new(
        "c",
        vec![
            Object::Real((cx + rx) as f32),
            Object::Real((cy - oy) as f32),
            Object::Real((cx + ox) as f32),
            Object::Real((cy - ry) as f32),
            Object::Real(cx as f32),
            Object::Real((cy - ry) as f32),
        ],
    ));
    operations.push(Operation::new(
        "c",
        vec![
            Object::Real((cx - ox) as f32),
            Object::Real((cy - ry) as f32),
            Object::Real((cx - rx) as f32),
            Object::Real((cy - oy) as f32),
            Object::Real((cx - rx) as f32),
            Object::Real(cy as f32),
        ],
    ));
    operations.push(Operation::new("S", vec![]));
}

pub fn render(
    annotation: &ExportPdfAnnotation,
    operations: &mut Vec<Operation>,
    context: &PageRenderContext,
) {
    let (color, rect) = match annotation {
        ExportPdfAnnotation::Square { color, rect, .. }
        | ExportPdfAnnotation::Circle { color, rect, .. } => (parse_rgb(color), rect),
        _ => return,
    };

    let bounds = rect_to_pdf_bounds(rect, context.page_size);
    operations.push(Operation::new("q", vec![]));
    set_stroke_color(operations, color);
    match annotation {
        ExportPdfAnnotation::Square { .. } => draw_rect(bounds, operations),
        ExportPdfAnnotation::Circle { .. } => draw_ellipse(bounds, operations),
        _ => {}
    }
    operations.push(Operation::new("Q", vec![]));
}
