use lopdf::{content::Operation, Object};
use std::fs;
use std::path::{Path, PathBuf};
use ttf_parser::{Face, GlyphId, OutlineBuilder};

pub struct LoadedFont {
    pub bytes: Vec<u8>,
    pub face_index: u32,
}

fn supports_text(face: &Face<'_>, text: &str) -> usize {
    text.chars()
        .filter(|ch| !ch.is_whitespace() && !ch.is_control())
        .filter(|ch| face.glyph_index(*ch).is_some())
        .count()
}

pub fn load_export_font(text: &str) -> Result<LoadedFont, String> {
    let candidates = [
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKSC-Regular.otf",
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
        "C:\\Windows\\Fonts\\simsun.ttc",
    ];

    let required_glyphs = text
        .chars()
        .filter(|ch| !ch.is_whitespace() && !ch.is_control())
        .count();
    let mut best_match: Option<LoadedFont> = None;
    let mut best_coverage = 0usize;

    for raw_path in candidates {
        let path = PathBuf::from(raw_path);
        if !Path::new(&path).exists() {
            continue;
        }
        let bytes = fs::read(&path).map_err(|error| format!("读取字体失败: {error}"))?;
        for face_index in 0..8 {
            let Ok(face) = Face::parse(&bytes, face_index) else {
                continue;
            };
            let coverage = supports_text(&face, text);
            if coverage >= required_glyphs {
                return Ok(LoadedFont { bytes, face_index });
            }
            if coverage > best_coverage {
                best_coverage = coverage;
                best_match = Some(LoadedFont {
                    bytes: bytes.clone(),
                    face_index,
                });
            }
        }
    }

    best_match.ok_or_else(|| "未找到可用导出字体".to_string())
}

pub fn glyph_advance(face: &Face<'_>, glyph_id: GlyphId, scale: f64) -> f64 {
    face.glyph_hor_advance(glyph_id)
        .map(|advance| advance as f64 * scale)
        .unwrap_or(0.0)
}

pub fn wrap_text_lines(face: &Face<'_>, text: &str, scale: f64, max_width: f64) -> Vec<String> {
    let mut result = Vec::new();
    for raw_line in text.lines() {
        let mut current = String::new();
        let mut current_width = 0.0;
        for ch in raw_line.chars() {
            let glyph = face.glyph_index(ch).or_else(|| face.glyph_index('□'));
            let advance = glyph
                .map(|glyph_id| glyph_advance(face, glyph_id, scale))
                .unwrap_or(scale * 0.6);
            if !current.is_empty() && current_width + advance > max_width {
                result.push(current);
                current = String::new();
                current_width = 0.0;
            }
            current.push(ch);
            current_width += advance;
        }
        result.push(current);
    }
    if result.is_empty() {
        result.push(String::new());
    }
    result
}

struct PdfOutlineBuilder<'a> {
    operations: &'a mut Vec<Operation>,
    pen_x: f64,
    pen_y: f64,
    scale: f64,
}

impl OutlineBuilder for PdfOutlineBuilder<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.operations.push(Operation::new(
            "m",
            vec![
                Object::Real((self.pen_x + x as f64 * self.scale) as f32),
                Object::Real((self.pen_y + y as f64 * self.scale) as f32),
            ],
        ));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.operations.push(Operation::new(
            "l",
            vec![
                Object::Real((self.pen_x + x as f64 * self.scale) as f32),
                Object::Real((self.pen_y + y as f64 * self.scale) as f32),
            ],
        ));
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let current = self
            .operations
            .last()
            .and_then(|operation| {
                operation
                    .operands
                    .get(operation.operands.len().saturating_sub(2)..)
            })
            .and_then(|coords| {
                if coords.len() == 2 {
                    Some((
                        coords[0].as_float().ok()? as f64,
                        coords[1].as_float().ok()? as f64,
                    ))
                } else {
                    None
                }
            })
            .unwrap_or((self.pen_x, self.pen_y));

        let cx0 = current.0;
        let cy0 = current.1;
        let cx1 = self.pen_x + x1 as f64 * self.scale;
        let cy1 = self.pen_y + y1 as f64 * self.scale;
        let cx2 = self.pen_x + x as f64 * self.scale;
        let cy2 = self.pen_y + y as f64 * self.scale;

        let c1x = cx0 + (2.0 / 3.0) * (cx1 - cx0);
        let c1y = cy0 + (2.0 / 3.0) * (cy1 - cy0);
        let c2x = cx2 + (2.0 / 3.0) * (cx1 - cx2);
        let c2y = cy2 + (2.0 / 3.0) * (cy1 - cy2);

        self.operations.push(Operation::new(
            "c",
            vec![
                Object::Real(c1x as f32),
                Object::Real(c1y as f32),
                Object::Real(c2x as f32),
                Object::Real(c2y as f32),
                Object::Real(cx2 as f32),
                Object::Real(cy2 as f32),
            ],
        ));
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.operations.push(Operation::new(
            "c",
            vec![
                Object::Real((self.pen_x + x1 as f64 * self.scale) as f32),
                Object::Real((self.pen_y + y1 as f64 * self.scale) as f32),
                Object::Real((self.pen_x + x2 as f64 * self.scale) as f32),
                Object::Real((self.pen_y + y2 as f64 * self.scale) as f32),
                Object::Real((self.pen_x + x as f64 * self.scale) as f32),
                Object::Real((self.pen_y + y as f64 * self.scale) as f32),
            ],
        ));
    }

    fn close(&mut self) {
        self.operations.push(Operation::new("h", vec![]));
    }
}

pub fn draw_text_line_outline(
    operations: &mut Vec<Operation>,
    face: &Face<'_>,
    text: &str,
    start_x: f64,
    baseline: f64,
    scale: f64,
) {
    let mut cursor_x = start_x;
    for ch in text.chars() {
        if let Some(glyph_id) = face.glyph_index(ch).or_else(|| face.glyph_index('□')) {
            let mut builder = PdfOutlineBuilder {
                operations,
                pen_x: cursor_x,
                pen_y: baseline,
                scale,
            };
            let _ = face.outline_glyph(glyph_id, &mut builder);
            operations.push(Operation::new("f", vec![]));
            cursor_x += glyph_advance(face, glyph_id, scale);
        } else {
            cursor_x += scale * 0.6;
        }
    }
}
