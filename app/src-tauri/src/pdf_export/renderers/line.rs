use crate::pdf_export::coords::{point_to_pdf, PdfPoint};
use crate::pdf_export::renderers::PageRenderContext;
use crate::pdf_export::types::ExportPdfAnnotation;
use lopdf::{content::Operation, Object};

fn parse_rgb(color: &str) -> [f32; 3] {
    let hex = color.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return [1.0, 0.84, 0.04];
    }
    let parse = |slice: &str| u8::from_str_radix(slice, 16).ok().map(|value| value as f32 / 255.0);
    match (parse(&hex[0..2]), parse(&hex[2..4]), parse(&hex[4..6])) {
        (Some(red), Some(green), Some(blue)) => [red, green, blue],
        _ => [1.0, 0.84, 0.04],
    }
}

fn set_stroke_color(operations: &mut Vec<Operation>, color: [f32; 3]) {
    operations.push(Operation::new(
        "RG",
        vec![Object::Real(color[0]), Object::Real(color[1]), Object::Real(color[2])],
    ));
}

fn draw_line(start: PdfPoint, end: PdfPoint, operations: &mut Vec<Operation>) {
    operations.push(Operation::new(
        "m",
        vec![Object::Real(start.x as f32), Object::Real(start.y as f32)],
    ));
    operations.push(Operation::new(
        "l",
        vec![Object::Real(end.x as f32), Object::Real(end.y as f32)],
    ));
    operations.push(Operation::new("S", vec![]));
}

fn draw_arrow_head(start: PdfPoint, end: PdfPoint, operations: &mut Vec<Operation>) {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = (dx * dx + dy * dy).sqrt();
    if length <= 0.1 {
        return;
    }

    let ux = dx / length;
    let uy = dy / length;
    let head_length = (length * 0.12).clamp(8.0, 18.0);
    let head_width = head_length * 0.6;
    let base_x = end.x - ux * head_length;
    let base_y = end.y - uy * head_length;
    let perp_x = -uy;
    let perp_y = ux;
    let left_x = base_x + perp_x * head_width * 0.5;
    let left_y = base_y + perp_y * head_width * 0.5;
    let right_x = base_x - perp_x * head_width * 0.5;
    let right_y = base_y - perp_y * head_width * 0.5;

    operations.push(Operation::new(
        "m",
        vec![Object::Real(left_x as f32), Object::Real(left_y as f32)],
    ));
    operations.push(Operation::new(
        "l",
        vec![Object::Real(end.x as f32), Object::Real(end.y as f32)],
    ));
    operations.push(Operation::new(
        "l",
        vec![Object::Real(right_x as f32), Object::Real(right_y as f32)],
    ));
    operations.push(Operation::new("S", vec![]));
}

pub fn render(
    annotation: &ExportPdfAnnotation,
    operations: &mut Vec<Operation>,
    context: &PageRenderContext,
) {
    let (color, line) = match annotation {
        ExportPdfAnnotation::Line { color, line, .. }
        | ExportPdfAnnotation::Arrow { color, line, .. } => (parse_rgb(color), line),
        _ => return,
    };

    let start = point_to_pdf(line.x1, line.y1, context.page_size);
    let end = point_to_pdf(line.x2, line.y2, context.page_size);

    operations.push(Operation::new("q", vec![]));
    set_stroke_color(operations, color);
    operations.push(Operation::new("w", vec![Object::Real(2.0)]));
    draw_line(start, end, operations);
    if let ExportPdfAnnotation::Arrow { .. } = annotation {
        draw_arrow_head(start, end, operations);
    }
    operations.push(Operation::new("Q", vec![]));
}
