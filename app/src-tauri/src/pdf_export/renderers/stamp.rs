use crate::pdf_export::coords::rect_to_pdf_bounds;
use crate::pdf_export::renderers::PageRenderContext;
use crate::pdf_export::types::ExportPdfAnnotation;
use lopdf::{content::Operation, Object};

fn parse_rgb(color: &str) -> [f32; 3] {
    let hex = color.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return [1.0, 0.0, 0.0];
    }
    let parse = |slice: &str| u8::from_str_radix(slice, 16).ok().map(|value| value as f32 / 255.0);
    match (parse(&hex[0..2]), parse(&hex[2..4]), parse(&hex[4..6])) {
        (Some(red), Some(green), Some(blue)) => [red, green, blue],
        _ => [1.0, 0.0, 0.0],
    }
}

fn icon_square_bounds(left: f64, bottom: f64, width: f64, height: f64) -> (f64, f64, f64) {
    let size = width.min(height);
    let origin_x = left + (width - size) / 2.0;
    let origin_y = bottom + (height - size) / 2.0;
    (origin_x, origin_y, size)
}

fn icon_x(left: f64, bottom: f64, width: f64, height: f64, x: f64) -> f64 {
    let (origin_x, _, size) = icon_square_bounds(left, bottom, width, height);
    origin_x + size * (x / 20.0)
}

fn icon_y(left: f64, bottom: f64, width: f64, height: f64, y: f64) -> f64 {
    let (_, origin_y, size) = icon_square_bounds(left, bottom, width, height);
    origin_y + size * ((20.0 - y) / 20.0)
}

fn move_to(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64, x: f64, y: f64) {
    operations.push(Operation::new(
        "m",
        vec![
            Object::Real(icon_x(left, bottom, width, height, x) as f32),
            Object::Real(icon_y(left, bottom, width, height, y) as f32),
        ],
    ));
}

fn line_to(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64, x: f64, y: f64) {
    operations.push(Operation::new(
        "l",
        vec![
            Object::Real(icon_x(left, bottom, width, height, x) as f32),
            Object::Real(icon_y(left, bottom, width, height, y) as f32),
        ],
    ));
}

fn cubic_to(
    operations: &mut Vec<Operation>,
    left: f64,
    bottom: f64,
    width: f64,
    height: f64,
    c1x: f64,
    c1y: f64,
    c2x: f64,
    c2y: f64,
    x: f64,
    y: f64,
) {
    operations.push(Operation::new(
        "c",
        vec![
            Object::Real(icon_x(left, bottom, width, height, c1x) as f32),
            Object::Real(icon_y(left, bottom, width, height, c1y) as f32),
            Object::Real(icon_x(left, bottom, width, height, c2x) as f32),
            Object::Real(icon_y(left, bottom, width, height, c2y) as f32),
            Object::Real(icon_x(left, bottom, width, height, x) as f32),
            Object::Real(icon_y(left, bottom, width, height, y) as f32),
        ],
    ));
}

fn circle_path(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64, cx: f64, cy: f64, r: f64) {
    let kappa = 0.552_284_749_831_f64;
    let ox = r * kappa;
    let oy = r * kappa;
    move_to(operations, left, bottom, width, height, cx - r, cy);
    cubic_to(operations, left, bottom, width, height, cx - r, cy + oy, cx - ox, cy + r, cx, cy + r);
    cubic_to(operations, left, bottom, width, height, cx + ox, cy + r, cx + r, cy + oy, cx + r, cy);
    cubic_to(operations, left, bottom, width, height, cx + r, cy - oy, cx + ox, cy - r, cx, cy - r);
    cubic_to(operations, left, bottom, width, height, cx - ox, cy - r, cx - r, cy - oy, cx - r, cy);
}

fn draw_important(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64) {
    move_to(operations, left, bottom, width, height, 10.0, 3.6);
    line_to(operations, left, bottom, width, height, 11.6, 8.2);
    line_to(operations, left, bottom, width, height, 16.5, 8.3);
    line_to(operations, left, bottom, width, height, 12.6, 11.2);
    line_to(operations, left, bottom, width, height, 14.1, 15.9);
    line_to(operations, left, bottom, width, height, 10.0, 13.0);
    line_to(operations, left, bottom, width, height, 5.9, 15.9);
    line_to(operations, left, bottom, width, height, 7.4, 11.2);
    line_to(operations, left, bottom, width, height, 3.5, 8.3);
    line_to(operations, left, bottom, width, height, 8.4, 8.2);
    operations.push(Operation::new("f", vec![]));
}

fn draw_question(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64) {
    operations.push(Operation::new("J", vec![1.into()]));
    operations.push(Operation::new("j", vec![1.into()]));
    move_to(operations, left, bottom, width, height, 7.3, 7.6);
    cubic_to(operations, left, bottom, width, height, 7.5, 5.9, 8.8, 4.9, 10.5, 4.9);
    cubic_to(operations, left, bottom, width, height, 12.3, 4.9, 13.6, 6.0, 13.6, 7.6);
    cubic_to(operations, left, bottom, width, height, 13.6, 8.8, 12.9, 9.5, 11.9, 10.1);
    cubic_to(operations, left, bottom, width, height, 10.9, 10.7, 10.3, 11.3, 10.3, 12.4);
    line_to(operations, left, bottom, width, height, 10.3, 12.8);
    operations.push(Operation::new("S", vec![]));
    circle_path(operations, left, bottom, width, height, 10.3, 15.4, 1.1);
    operations.push(Operation::new("f", vec![]));
}

fn draw_todo(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64) {
    let (_, _, size) = icon_square_bounds(left, bottom, width, height);
    operations.push(Operation::new("J", vec![1.into()]));
    operations.push(Operation::new("j", vec![1.into()]));
    operations.push(Operation::new(
        "re",
        vec![
            Object::Real(icon_x(left, bottom, width, height, 4.7) as f32),
            Object::Real(icon_y(left, bottom, width, height, 15.3) as f32),
            Object::Real((size * 10.6 / 20.0) as f32),
            Object::Real((size * 10.6 / 20.0) as f32),
        ],
    ));
    operations.push(Operation::new("S", vec![]));
    move_to(operations, left, bottom, width, height, 7.5, 10.2);
    line_to(operations, left, bottom, width, height, 9.1, 11.8);
    line_to(operations, left, bottom, width, height, 12.7, 8.2);
    operations.push(Operation::new("S", vec![]));
}

fn draw_done(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64) {
    operations.push(Operation::new("J", vec![1.into()]));
    operations.push(Operation::new("j", vec![1.into()]));
    circle_path(operations, left, bottom, width, height, 10.0, 10.0, 5.8);
    operations.push(Operation::new("S", vec![]));
    move_to(operations, left, bottom, width, height, 7.2, 10.2);
    line_to(operations, left, bottom, width, height, 9.2, 12.2);
    line_to(operations, left, bottom, width, height, 13.0, 8.4);
    operations.push(Operation::new("S", vec![]));
}

fn draw_warning(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64) {
    operations.push(Operation::new("J", vec![1.into()]));
    operations.push(Operation::new("j", vec![1.into()]));
    move_to(operations, left, bottom, width, height, 10.0, 4.2);
    line_to(operations, left, bottom, width, height, 15.8, 14.7);
    line_to(operations, left, bottom, width, height, 4.2, 14.7);
    line_to(operations, left, bottom, width, height, 10.0, 4.2);
    operations.push(Operation::new("S", vec![]));
    move_to(operations, left, bottom, width, height, 10.0, 8.0);
    line_to(operations, left, bottom, width, height, 10.0, 11.1);
    operations.push(Operation::new("S", vec![]));
    circle_path(operations, left, bottom, width, height, 10.0, 13.4, 1.0);
    operations.push(Operation::new("f", vec![]));
}

fn draw_info(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64) {
    operations.push(Operation::new("J", vec![1.into()]));
    operations.push(Operation::new("j", vec![1.into()]));
    circle_path(operations, left, bottom, width, height, 10.0, 10.0, 5.8);
    operations.push(Operation::new("S", vec![]));
    move_to(operations, left, bottom, width, height, 10.0, 9.0);
    line_to(operations, left, bottom, width, height, 10.0, 13.0);
    operations.push(Operation::new("S", vec![]));
    circle_path(operations, left, bottom, width, height, 10.0, 6.4, 1.0);
    operations.push(Operation::new("f", vec![]));
}

fn draw_flag(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64) {
    operations.push(Operation::new("J", vec![1.into()]));
    operations.push(Operation::new("j", vec![1.into()]));
    move_to(operations, left, bottom, width, height, 6.0, 4.5);
    line_to(operations, left, bottom, width, height, 6.0, 15.5);
    operations.push(Operation::new("S", vec![]));
    move_to(operations, left, bottom, width, height, 6.8, 5.2);
    line_to(operations, left, bottom, width, height, 14.8, 5.2);
    line_to(operations, left, bottom, width, height, 12.6, 8.4);
    line_to(operations, left, bottom, width, height, 14.8, 11.4);
    line_to(operations, left, bottom, width, height, 6.8, 11.4);
    line_to(operations, left, bottom, width, height, 6.8, 5.2);
    operations.push(Operation::new("S", vec![]));
}

fn draw_pin(operations: &mut Vec<Operation>, left: f64, bottom: f64, width: f64, height: f64) {
    operations.push(Operation::new("J", vec![1.into()]));
    operations.push(Operation::new("j", vec![1.into()]));
    move_to(operations, left, bottom, width, height, 8.1, 5.3);
    cubic_to(operations, left, bottom, width, height, 8.1, 4.2, 9.0, 3.3, 10.1, 3.3);
    cubic_to(operations, left, bottom, width, height, 11.2, 3.3, 12.1, 4.2, 12.1, 5.3);
    cubic_to(operations, left, bottom, width, height, 12.1, 5.9, 11.8, 6.5, 11.3, 6.9);
    line_to(operations, left, bottom, width, height, 13.2, 9.6);
    line_to(operations, left, bottom, width, height, 10.8, 10.1);
    line_to(operations, left, bottom, width, height, 10.3, 15.5);
    line_to(operations, left, bottom, width, height, 9.6, 15.5);
    line_to(operations, left, bottom, width, height, 9.1, 10.1);
    line_to(operations, left, bottom, width, height, 6.7, 9.6);
    line_to(operations, left, bottom, width, height, 8.7, 6.9);
    cubic_to(operations, left, bottom, width, height, 8.3, 6.5, 8.1, 5.9, 8.1, 5.3);
    operations.push(Operation::new("S", vec![]));
}

pub fn render(
    annotation: &ExportPdfAnnotation,
    operations: &mut Vec<Operation>,
    context: &PageRenderContext,
) {
    let (color, rect, stamp_kind) = match annotation {
        ExportPdfAnnotation::Stamp {
            color,
            rect,
            stamp_kind,
            ..
        } => (parse_rgb(color), rect, stamp_kind.as_str()),
        _ => return,
    };

    let bounds = rect_to_pdf_bounds(rect, context.page_size);

    operations.push(Operation::new("q", vec![]));
    operations.push(Operation::new(
        "rg",
        vec![Object::Real(color[0]), Object::Real(color[1]), Object::Real(color[2])],
    ));
    operations.push(Operation::new(
        "RG",
        vec![Object::Real(color[0]), Object::Real(color[1]), Object::Real(color[2])],
    ));
    operations.push(Operation::new("w", vec![Object::Real(((bounds.height * 0.08).max(1.2)) as f32)]));
    match stamp_kind {
        "important" => draw_important(operations, bounds.left, bounds.bottom, bounds.width, bounds.height),
        "question" => draw_question(operations, bounds.left, bounds.bottom, bounds.width, bounds.height),
        "todo" => draw_todo(operations, bounds.left, bounds.bottom, bounds.width, bounds.height),
        "done" => draw_done(operations, bounds.left, bounds.bottom, bounds.width, bounds.height),
        "warning" => draw_warning(operations, bounds.left, bounds.bottom, bounds.width, bounds.height),
        "info" => draw_info(operations, bounds.left, bounds.bottom, bounds.width, bounds.height),
        "flag" => draw_flag(operations, bounds.left, bounds.bottom, bounds.width, bounds.height),
        "pin" => draw_pin(operations, bounds.left, bounds.bottom, bounds.width, bounds.height),
        _ => draw_info(operations, bounds.left, bounds.bottom, bounds.width, bounds.height),
    }
    operations.push(Operation::new("Q", vec![]));
}
