use super::types::ExportPdfRect;
use lopdf::{Document, Object, ObjectId};

#[derive(Debug, Clone, Copy)]
pub struct PdfPageSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct PdfBounds {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct PdfPoint {
    pub x: f64,
    pub y: f64,
}

fn object_to_f64(object: &Object) -> Option<f64> {
    match object {
        Object::Integer(value) => Some(*value as f64),
        Object::Real(value) => Some(*value as f64),
        _ => None,
    }
}

pub fn resolve_page_size(doc: &Document, page_id: ObjectId) -> Result<PdfPageSize, String> {
    let page = doc
        .get_object(page_id)
        .map_err(|error| format!("读取页面对象失败: {error}"))?
        .as_dict()
        .map_err(|error| format!("页面对象不是字典: {error}"))?;

    let media_box = page
        .get(b"MediaBox")
        .or_else(|_| page.get(b"CropBox"))
        .map_err(|_| "页面缺少 MediaBox/CropBox".to_string())?
        .as_array()
        .map_err(|error| format!("页面边界格式无效: {error}"))?;

    if media_box.len() != 4 {
        return Err("页面边界长度无效".to_string());
    }

    let left = object_to_f64(&media_box[0]).ok_or_else(|| "MediaBox left 无效".to_string())?;
    let bottom = object_to_f64(&media_box[1]).ok_or_else(|| "MediaBox bottom 无效".to_string())?;
    let right = object_to_f64(&media_box[2]).ok_or_else(|| "MediaBox right 无效".to_string())?;
    let top = object_to_f64(&media_box[3]).ok_or_else(|| "MediaBox top 无效".to_string())?;

    Ok(PdfPageSize {
        width: (right - left).abs(),
        height: (top - bottom).abs(),
    })
}

pub fn rect_to_pdf_bounds(rect: &ExportPdfRect, page_size: PdfPageSize) -> PdfBounds {
    let left = rect.x1 * page_size.width;
    let right = rect.x2 * page_size.width;
    let top = page_size.height - rect.y1 * page_size.height;
    let bottom = page_size.height - rect.y2 * page_size.height;

    PdfBounds {
        left,
        right,
        top,
        bottom,
        width: (right - left).abs(),
        height: (top - bottom).abs(),
    }
}

pub fn point_to_pdf(x: f64, y: f64, page_size: PdfPageSize) -> PdfPoint {
    PdfPoint {
        x: x * page_size.width,
        y: page_size.height - y * page_size.height,
    }
}
