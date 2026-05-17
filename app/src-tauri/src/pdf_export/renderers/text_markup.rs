use crate::pdf_export::coords::{rect_to_pdf_bounds, PdfBounds};
use crate::pdf_export::renderers::PageRenderContext;
use crate::pdf_export::types::ExportPdfAnnotation;
use lopdf::{content::Operation, Object};

fn parse_rgb(color: &str) -> [f32; 3] {
    let hex = color.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return [1.0, 0.84, 0.04];
    }

    let parse_channel = |slice: &str| {
        u8::from_str_radix(slice, 16)
            .ok()
            .map(|value| value as f32 / 255.0)
    };

    match (
        parse_channel(&hex[0..2]),
        parse_channel(&hex[2..4]),
        parse_channel(&hex[4..6]),
    ) {
        (Some(red), Some(green), Some(blue)) => [red, green, blue],
        _ => [1.0, 0.84, 0.04],
    }
}

fn set_fill_color(operations: &mut Vec<Operation>, color: [f32; 3]) {
    operations.push(Operation::new(
        "rg",
        vec![
            Object::Real(color[0]),
            Object::Real(color[1]),
            Object::Real(color[2]),
        ],
    ));
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

fn draw_highlight(bounds: PdfBounds, operations: &mut Vec<Operation>, context: &PageRenderContext) {
    if let Some(name) = &context.ext_gstate_name {
        operations.push(Operation::new(
            "gs",
            vec![Object::Name(name.as_bytes().to_vec())],
        ));
    }
    operations.push(Operation::new(
        "re",
        vec![
            Object::Real(bounds.left as f32),
            Object::Real(bounds.bottom as f32),
            Object::Real(bounds.width as f32),
            Object::Real(bounds.height as f32),
        ],
    ));
    operations.push(Operation::new("f", vec![]));
}

fn draw_underline(bounds: PdfBounds, operations: &mut Vec<Operation>) {
    let y = bounds.bottom + bounds.height * 0.18;
    let line_width = (bounds.height * 0.08).max(0.8);
    operations.push(Operation::new("w", vec![Object::Real(line_width as f32)]));
    operations.push(Operation::new(
        "m",
        vec![Object::Real(bounds.left as f32), Object::Real(y as f32)],
    ));
    operations.push(Operation::new(
        "l",
        vec![Object::Real(bounds.right as f32), Object::Real(y as f32)],
    ));
    operations.push(Operation::new("S", vec![]));
}

fn draw_strikeout(bounds: PdfBounds, operations: &mut Vec<Operation>) {
    let y = bounds.bottom + bounds.height * 0.5;
    let line_width = (bounds.height * 0.08).max(0.8);
    operations.push(Operation::new("w", vec![Object::Real(line_width as f32)]));
    operations.push(Operation::new(
        "m",
        vec![Object::Real(bounds.left as f32), Object::Real(y as f32)],
    ));
    operations.push(Operation::new(
        "l",
        vec![Object::Real(bounds.right as f32), Object::Real(y as f32)],
    ));
    operations.push(Operation::new("S", vec![]));
}

fn draw_squiggly(bounds: PdfBounds, operations: &mut Vec<Operation>) {
    let baseline = bounds.bottom + bounds.height * 0.18;
    let amplitude = (bounds.height * 0.12).max(1.0);
    let step = (bounds.height * 0.28).max(4.0);
    let line_width = (bounds.height * 0.06).max(0.8);
    operations.push(Operation::new("w", vec![Object::Real(line_width as f32)]));
    let mut current_x = bounds.left;
    let mut up = true;
    operations.push(Operation::new(
        "m",
        vec![
            Object::Real(current_x as f32),
            Object::Real(baseline as f32),
        ],
    ));
    while current_x < bounds.right {
        let next_x = (current_x + step).min(bounds.right);
        let next_y = if up {
            baseline + amplitude
        } else {
            baseline - amplitude
        };
        operations.push(Operation::new(
            "l",
            vec![Object::Real(next_x as f32), Object::Real(next_y as f32)],
        ));
        current_x = next_x;
        up = !up;
    }
    operations.push(Operation::new("S", vec![]));
}

pub fn render(
    annotation: &ExportPdfAnnotation,
    operations: &mut Vec<Operation>,
    context: &PageRenderContext,
) {
    let (color, rects) = match annotation {
        ExportPdfAnnotation::Highlight { color, rects, .. }
        | ExportPdfAnnotation::Underline { color, rects, .. }
        | ExportPdfAnnotation::Strikeout { color, rects, .. }
        | ExportPdfAnnotation::Squiggly { color, rects, .. } => (parse_rgb(color), rects),
        _ => return,
    };

    operations.push(Operation::new("q", vec![]));
    set_fill_color(operations, color);
    set_stroke_color(operations, color);

    for rect in rects {
        let bounds = rect_to_pdf_bounds(rect, context.page_size);
        match annotation {
            ExportPdfAnnotation::Highlight { .. } => draw_highlight(bounds, operations, context),
            ExportPdfAnnotation::Underline { .. } => draw_underline(bounds, operations),
            ExportPdfAnnotation::Strikeout { .. } => draw_strikeout(bounds, operations),
            ExportPdfAnnotation::Squiggly { .. } => draw_squiggly(bounds, operations),
            _ => {}
        }
    }

    operations.push(Operation::new("Q", vec![]));
}
