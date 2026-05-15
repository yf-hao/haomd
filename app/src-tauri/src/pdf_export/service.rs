use super::coords::resolve_page_size;
use super::renderers::{render_annotation, PageRenderContext};
use super::types::{ExportPdfAnnotation, ExportPdfAppendixNote, ExportPdfDocument};
use super::text_outlines::{draw_text_line_outline, load_export_font, wrap_text_lines};
use lopdf::{content::Content, dictionary, Dictionary, Document, Object, ObjectId, Stream};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use ttf_parser::Face;

fn get_or_create_page_resources<'a>(
    doc: &'a mut Document,
    page_id: ObjectId,
) -> Result<&'a mut Dictionary, String> {
    let resources_reference = {
        let page = doc
            .get_object_mut(page_id)
            .map_err(|error| format!("读取页面对象失败: {error}"))?
            .as_dict_mut()
            .map_err(|error| format!("页面对象不是字典: {error}"))?;

        if page.get(b"Resources").is_err() {
            page.set("Resources", dictionary! {});
        }

        match page
            .get_mut(b"Resources")
            .map_err(|error| format!("读取页面资源失败: {error}"))?
        {
            Object::Reference(reference) => Some(*reference),
            Object::Dictionary(_) => None,
            _ => return Err("页面资源对象类型无效".to_string()),
        }
    };

    if let Some(reference) = resources_reference {
        return doc
            .get_object_mut(reference)
            .map_err(|error| format!("读取资源引用失败: {error}"))?
            .as_dict_mut()
            .map_err(|error| format!("页面资源引用不是字典: {error}"));
    }

    let page = doc
        .get_object_mut(page_id)
        .map_err(|error| format!("读取页面对象失败: {error}"))?
        .as_dict_mut()
        .map_err(|error| format!("页面对象不是字典: {error}"))?;

    match page
        .get_mut(b"Resources")
        .map_err(|error| format!("读取页面资源失败: {error}"))?
    {
        Object::Dictionary(dictionary) => Ok(dictionary),
        _ => Err("页面资源对象类型无效".to_string()),
    }
}

fn ensure_ext_gstate_for_page(
    doc: &mut Document,
    page_id: ObjectId,
    opacity: f32,
    name_seed: usize,
) -> Result<String, String> {
    let ext_gstate_name = format!("GSANN{}", name_seed);
    let ext_gstate_id = doc.add_object(dictionary! {
        "Type" => "ExtGState",
        "CA" => opacity,
        "ca" => opacity,
    });
    let resources = get_or_create_page_resources(doc, page_id)?;
    let ext_gstate = match resources.get_mut(b"ExtGState") {
        Ok(object) => object
            .as_dict_mut()
            .map_err(|error| format!("ExtGState 资源格式无效: {error}"))?,
        Err(_) => {
            resources.set("ExtGState", dictionary! {});
            resources
                .get_mut(b"ExtGState")
                .map_err(|error| format!("创建 ExtGState 资源失败: {error}"))?
                .as_dict_mut()
                .map_err(|error| format!("ExtGState 资源格式无效: {error}"))?
        }
    };
    ext_gstate.set(ext_gstate_name.as_str(), ext_gstate_id);
    Ok(ext_gstate_name)
}

fn append_content_stream(doc: &mut Document, page_id: ObjectId, stream_id: ObjectId) -> Result<(), String> {
    let page = doc
        .get_object_mut(page_id)
        .map_err(|error| format!("读取页面对象失败: {error}"))?
        .as_dict_mut()
        .map_err(|error| format!("页面对象不是字典: {error}"))?;

    let new_ref = Object::Reference(stream_id);
    match page.get_mut(b"Contents") {
        Ok(contents) => match contents {
            Object::Reference(existing) => {
                *contents = Object::Array(vec![Object::Reference(*existing), new_ref]);
            }
            Object::Array(items) => items.push(new_ref),
            ref other => {
                let old = (*other).clone();
                *contents = Object::Array(vec![old, new_ref]);
            }
        },
        Err(_) => {
            page.set("Contents", new_ref);
        }
    }

    Ok(())
}

fn get_pages_root_id(doc: &Document) -> Result<ObjectId, String> {
    let root_id = doc
        .trailer
        .get(b"Root")
        .map_err(|_| "PDF 缺少 Root".to_string())?
        .as_reference()
        .map_err(|error| format!("PDF Root 引用无效: {error}"))?;
    let catalog = doc
        .get_object(root_id)
        .map_err(|error| format!("读取 Catalog 失败: {error}"))?
        .as_dict()
        .map_err(|error| format!("Catalog 不是字典: {error}"))?;
    catalog
        .get(b"Pages")
        .map_err(|_| "Catalog 缺少 Pages".to_string())?
        .as_reference()
        .map_err(|error| format!("Pages 引用无效: {error}"))
}

fn append_new_page(
    doc: &mut Document,
    pages_root_id: ObjectId,
    page_size: super::coords::PdfPageSize,
    operations: Vec<lopdf::content::Operation>,
) -> Result<(), String> {
    let encoded = Content { operations }
        .encode()
        .map_err(|error| format!("编码附录页面内容失败: {error}"))?;
    let content_id = doc.add_object(Stream::new(dictionary! {}, encoded));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => Object::Reference(pages_root_id),
        "MediaBox" => Object::Array(vec![
            0.into(),
            0.into(),
            Object::Real(page_size.width as f32),
            Object::Real(page_size.height as f32),
        ]),
        "Resources" => dictionary! {},
        "Contents" => Object::Reference(content_id),
    });

    let pages = doc
        .get_object_mut(pages_root_id)
        .map_err(|error| format!("读取 Pages 根节点失败: {error}"))?
        .as_dict_mut()
        .map_err(|error| format!("Pages 根节点不是字典: {error}"))?;

    match pages.get_mut(b"Kids") {
        Ok(kids) => kids
            .as_array_mut()
            .map_err(|error| format!("Pages Kids 无效: {error}"))?
            .push(Object::Reference(page_id)),
        Err(_) => pages.set("Kids", Object::Array(vec![Object::Reference(page_id)])),
    }

    let current_count = pages
        .get(b"Count")
        .ok()
        .and_then(|value| value.as_i64().ok())
        .unwrap_or(0);
    pages.set("Count", current_count + 1);

    Ok(())
}

struct AppendixBlock {
    page: u32,
    kind: String,
    quote_lines: Vec<String>,
    note_lines: Vec<String>,
    height: f64,
}

fn build_appendix_blocks(
    notes: &[ExportPdfAppendixNote],
    face: &Face<'_>,
    body_scale: f64,
    max_width: f64,
    body_line_height: f64,
) -> Vec<AppendixBlock> {
    notes
        .iter()
        .map(|entry| {
            let quote_lines = entry
                .quote
                .as_deref()
                .filter(|quote| !quote.trim().is_empty())
                .map(|quote| wrap_text_lines(face, quote.trim(), body_scale, max_width))
                .unwrap_or_default();
            let note_lines = wrap_text_lines(face, entry.note.trim(), body_scale, max_width);
            let quote_height = if quote_lines.is_empty() {
                0.0
            } else {
                18.0 + body_line_height * quote_lines.len() as f64 + 6.0
            };
            let note_height = 18.0 + body_line_height * note_lines.len() as f64;
            AppendixBlock {
                page: entry.page,
                kind: entry.annotation_kind.clone(),
                quote_lines,
                note_lines,
                height: 24.0 + quote_height + note_height + 18.0,
            }
        })
        .collect()
}

fn render_appendix_pages(
    doc: &mut Document,
    pages_root_id: ObjectId,
    page_size: super::coords::PdfPageSize,
    notes: &[ExportPdfAppendixNote],
) -> Result<(), String> {
    if notes.is_empty() {
        return Ok(());
    }

    let joined_text = notes
        .iter()
        .map(|entry| {
            let quote = entry.quote.clone().unwrap_or_default();
            format!("批注备注附录 第{}页 {} 摘录 {} 备注 {}", entry.page, entry.annotation_kind, quote, entry.note)
        })
        .collect::<Vec<_>>()
        .join("\n");
    let loaded_font = load_export_font(&joined_text)?;
    let face = Face::parse(&loaded_font.bytes, loaded_font.face_index)
        .map_err(|_| "导出附录字体解析失败".to_string())?;

    let margin_x = 48.0;
    let margin_top = 56.0;
    let margin_bottom = 56.0;
    let title_font_size = 20.0;
    let heading_font_size = 11.0;
    let body_font_size = 10.5;
    let title_line_height = title_font_size * 1.35;
    let heading_line_height = heading_font_size * 1.35;
    let body_line_height = body_font_size * 1.45;
    let title_scale = title_font_size / face.units_per_em() as f64;
    let heading_scale = heading_font_size / face.units_per_em() as f64;
    let body_scale = body_font_size / face.units_per_em() as f64;
    let max_width = (page_size.width - margin_x * 2.0 - 24.0).max(160.0);
    let blocks = build_appendix_blocks(notes, &face, body_scale, max_width, body_line_height);

    let mut page_operations = vec![
        lopdf::content::Operation::new("q", vec![]),
        lopdf::content::Operation::new("rg", vec![0.into(), 0.into(), 0.into()]),
    ];
    let mut current_y = page_size.height - margin_top;
    let flush_page = |doc: &mut Document,
                      pages_root_id: ObjectId,
                      page_size: super::coords::PdfPageSize,
                      operations: &mut Vec<lopdf::content::Operation>| -> Result<(), String> {
        operations.push(lopdf::content::Operation::new("Q", vec![]));
        let rendered = std::mem::take(operations);
        append_new_page(doc, pages_root_id, page_size, rendered)
    };

    draw_text_line_outline(
        &mut page_operations,
        &face,
        "批注备注附录",
        margin_x,
        current_y,
        title_scale,
    );
    current_y -= title_line_height + 10.0;

    for block in blocks {
        if current_y - block.height < margin_bottom {
            flush_page(doc, pages_root_id, page_size, &mut page_operations)?;
            page_operations = vec![
                lopdf::content::Operation::new("q", vec![]),
                lopdf::content::Operation::new("rg", vec![0.into(), 0.into(), 0.into()]),
            ];
            current_y = page_size.height - margin_top;
            draw_text_line_outline(
                &mut page_operations,
                &face,
                "批注备注附录（续）",
                margin_x,
                current_y,
                title_scale,
            );
            current_y -= title_line_height + 10.0;
        }

        let heading = format!("第 {} 页 · {}", block.page, block.kind);
        draw_text_line_outline(
            &mut page_operations,
            &face,
            &heading,
            margin_x,
            current_y,
            heading_scale,
        );
        current_y -= heading_line_height + 6.0;

        if !block.quote_lines.is_empty() {
            draw_text_line_outline(
                &mut page_operations,
                &face,
                "摘录：",
                margin_x,
                current_y,
                body_scale,
            );
            current_y -= body_line_height;
            for line in &block.quote_lines {
                draw_text_line_outline(
                    &mut page_operations,
                    &face,
                    line,
                    margin_x + 18.0,
                    current_y,
                    body_scale,
                );
                current_y -= body_line_height;
            }
            current_y -= 6.0;
        }

        draw_text_line_outline(
            &mut page_operations,
            &face,
            "备注：",
            margin_x,
            current_y,
            body_scale,
        );
        current_y -= body_line_height;
        for line in &block.note_lines {
            draw_text_line_outline(
                &mut page_operations,
                &face,
                line,
                margin_x + 18.0,
                current_y,
                body_scale,
            );
            current_y -= body_line_height;
        }
        current_y -= 18.0;
    }

    flush_page(doc, pages_root_id, page_size, &mut page_operations)?;
    Ok(())
}

pub fn export_pdf_with_annotations(
    source_path: &str,
    output_path: &str,
    document: &ExportPdfDocument,
) -> Result<(), String> {
    if document.annotations.is_empty() && document.appendix_notes.is_empty() {
      if let Some(parent) = Path::new(output_path).parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建输出目录失败: {error}"))?;
      }
      fs::copy(source_path, output_path).map_err(|error| format!("复制原 PDF 失败: {error}"))?;
      return Ok(());
    }

    let mut pdf_document = Document::load(source_path).map_err(|error| format!("读取 PDF 失败: {error}"))?;
    let pages = pdf_document.get_pages();
    let pages_root_id = get_pages_root_id(&pdf_document)?;
    let appendix_page_size = pages
        .iter()
        .next()
        .map(|(_, page_id)| resolve_page_size(&pdf_document, *page_id))
        .transpose()?
        .unwrap_or(super::coords::PdfPageSize {
            width: 595.0,
            height: 842.0,
        });

    let mut annotations_by_page = BTreeMap::<u32, Vec<&ExportPdfAnnotation>>::new();
    for annotation in &document.annotations {
        let page = match annotation {
            ExportPdfAnnotation::Highlight { page, .. }
            | ExportPdfAnnotation::Underline { page, .. }
            | ExportPdfAnnotation::Strikeout { page, .. }
            | ExportPdfAnnotation::Squiggly { page, .. }
            | ExportPdfAnnotation::Square { page, .. }
            | ExportPdfAnnotation::Circle { page, .. }
            | ExportPdfAnnotation::Line { page, .. }
            | ExportPdfAnnotation::Arrow { page, .. }
            | ExportPdfAnnotation::Stamp { page, .. }
            | ExportPdfAnnotation::FreeText { page, .. } => *page,
        };
        annotations_by_page.entry(page).or_default().push(annotation);
    }

    let mut ext_gstate_counter = 0usize;
    for (page_number, page_id) in pages {
        let Some(page_annotations) = annotations_by_page.get(&page_number) else {
            continue;
        };

        let page_size = resolve_page_size(&pdf_document, page_id)?;
        let highlight_opacity = page_annotations.iter().find_map(|annotation| {
            if let ExportPdfAnnotation::Highlight { opacity, .. } = annotation {
                Some(*opacity)
            } else {
                None
            }
        });

        let ext_gstate_name = if let Some(opacity) = highlight_opacity {
            ext_gstate_counter += 1;
            Some(ensure_ext_gstate_for_page(&mut pdf_document, page_id, opacity, ext_gstate_counter)?)
        } else {
            None
        };
        let context = PageRenderContext {
            page_size,
            ext_gstate_name,
        };

        let mut operations = Vec::new();
        for annotation in page_annotations {
            render_annotation(annotation, &mut operations, &context);
        }
        if operations.is_empty() {
            continue;
        }

        let content = Content { operations };
        let encoded = content
            .encode()
            .map_err(|error| format!("编码页面批注流失败: {error}"))?;
        let stream_id = pdf_document.add_object(Stream::new(dictionary! {}, encoded));
        append_content_stream(&mut pdf_document, page_id, stream_id)?;
    }

    render_appendix_pages(
        &mut pdf_document,
        pages_root_id,
        appendix_page_size,
        &document.appendix_notes,
    )?;

    if let Some(parent) = Path::new(output_path).parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建输出目录失败: {error}"))?;
    }
    pdf_document.compress();
    pdf_document
        .save(output_path)
        .map_err(|error| format!("写出 PDF 失败: {error}"))?;
    Ok(())
}
