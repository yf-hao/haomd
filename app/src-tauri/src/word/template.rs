use super::super::*;
use super::model::*;
use super::render::*;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;

pub(crate) fn resolve_word_template_paths(
    app: &AppHandle,
    template_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let template_dir = crate::platform::resolve_word_template_dir(app, template_id)?;
    let (json_path, _, _) = crate::platform::build_word_template_asset_paths(&template_dir);
    let docx_path = resolve_word_template_docx_path(app, template_id)?;
    if !json_path.exists() {
        return Err(format!("未找到模板配置文件: {}", json_path.display()));
    }
    Ok((docx_path, json_path))
}

pub(crate) fn resolve_word_template_docx_path(
    app: &AppHandle,
    template_id: &str,
) -> Result<PathBuf, String> {
    let template_dir = crate::platform::resolve_word_template_dir(app, template_id)?;
    let (_, _, docx_path) = crate::platform::build_word_template_asset_paths(&template_dir);
    if !docx_path.exists() {
        return Err(format!("未找到模板文件: {}", docx_path.display()));
    }
    Ok(docx_path)
}

pub(crate) fn build_template_replacements(
    template_cfg: &WordTemplateConfigCfg,
    model: &serde_json::Value,
    rich_blocks: &HashMap<String, Vec<WordBlockCfg>>,
    template_styles: Option<&WordTemplateConventionStylesResolved>,
) -> Result<Vec<TemplateReplacement>, String> {
    let mut render_state = WordRenderState {
        next_rel_id: 3,
        next_doc_pr_id: 1,
        style_settings: crate::resolve_word_export_style_settings(None),
        template_styles: template_styles.cloned(),
        ..Default::default()
    };
    let mut replacements = Vec::new();

    for binding in &template_cfg.bindings {
        if binding.binding_type == "richText" {
            let rendered = rich_blocks
                .get(&binding.field)
                .map(|blocks| render_word_blocks(blocks, &mut render_state, 0, None))
                .transpose()?
                .unwrap_or_default();
            replacements.push(TemplateReplacement::Paragraph {
                placeholder: binding.placeholder.clone(),
                xml: rendered,
            });
        } else {
            let raw_value = get_json_value_by_path(model, &binding.field)
                .map(stringify_template_value)
                .unwrap_or_default();
            replacements.push(TemplateReplacement::Text {
                placeholder: binding.placeholder.clone(),
                value: crate::escape_xml_text(&raw_value),
            });
        }
    }

    Ok(replacements)
}

fn get_json_value_by_path<'a>(
    value: &'a serde_json::Value,
    path: &str,
) -> Option<&'a serde_json::Value> {
    let mut current = value;
    for segment in path.split('.') {
        current = current.get(segment)?;
    }
    Some(current)
}

fn stringify_template_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(text) => text.clone(),
        serde_json::Value::Bool(flag) => {
            if *flag {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        serde_json::Value::Number(num) => num.to_string(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(stringify_template_value)
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        serde_json::Value::Object(_) => serde_json::to_string_pretty(value).unwrap_or_default(),
    }
}

pub(crate) enum TemplateReplacement {
    Text { placeholder: String, value: String },
    Paragraph { placeholder: String, xml: String },
}

#[derive(Debug, Clone, Default)]
pub(crate) struct WordTemplateDocxOverlay {
    pub(crate) styles_xml: Option<String>,
    pub(crate) section_properties_xml: Option<String>,
    pub(crate) convention_styles: WordTemplateConventionStylesResolved,
    pub(crate) additional_parts: Vec<WordTemplateDocxPart>,
    pub(crate) document_relationships: Vec<WordTemplateDocxRelationship>,
    pub(crate) content_type_defaults: std::collections::BTreeMap<String, String>,
    pub(crate) content_type_overrides: std::collections::BTreeMap<String, String>,
    pub(crate) styles_relationship_id: u32,
    pub(crate) numbering_relationship_id: u32,
    pub(crate) next_available_relationship_id: u32,
}

#[derive(Debug, Clone)]
pub(crate) struct WordTemplateDocxPart {
    pub(crate) path: String,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub(crate) struct WordTemplateDocxRelationship {
    pub(crate) id: String,
    pub(crate) rel_type: String,
    pub(crate) target: String,
    pub(crate) target_mode: Option<String>,
}

type ContentTypeMap = std::collections::BTreeMap<String, String>;

pub(crate) fn load_word_template_docx_overlay(
    template_docx: &Path,
) -> Result<WordTemplateDocxOverlay, String> {
    let bytes = std::fs::read(template_docx).map_err(|e| format!("读取模板文件失败: {e}"))?;
    let reader = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("读取模板 docx 失败: {e}"))?;

    let styles_xml = read_optional_docx_entry_as_string(&mut archive, "word/styles.xml")?;
    let document_xml = read_optional_docx_entry_as_string(&mut archive, "word/document.xml")?;
    let document_relationships = read_document_relationships(&mut archive)?;
    let (content_type_defaults, content_type_overrides) = read_content_type_maps(&mut archive)?;
    let additional_parts = collect_template_additional_parts(&mut archive)?;
    let available_style_ids = styles_xml
        .as_deref()
        .map(parse_style_ids_from_styles_xml)
        .transpose()?
        .unwrap_or_default();
    let (styles_relationship_id, numbering_relationship_id, next_available_relationship_id) =
        reserve_relationship_ids(&document_relationships);

    Ok(WordTemplateDocxOverlay {
        styles_xml,
        section_properties_xml: document_xml
            .as_deref()
            .and_then(extract_section_properties_xml),
        convention_styles: resolve_template_convention_styles(&available_style_ids),
        additional_parts,
        document_relationships,
        content_type_defaults,
        content_type_overrides,
        styles_relationship_id,
        numbering_relationship_id,
        next_available_relationship_id,
    })
}

pub(crate) fn rewrite_docx_template(
    template_docx: &Path,
    output_docx: &Path,
    replacements: &[TemplateReplacement],
) -> Result<(), String> {
    let bytes = std::fs::read(template_docx).map_err(|e| format!("读取模板文件失败: {e}"))?;
    let reader = Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("读取模板 docx 失败: {e}"))?;

    let file = std::fs::File::create(output_docx).map_err(|e| format!("创建输出文件失败: {e}"))?;
    let mut writer = ZipWriter::new(file);

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取模板条目失败: {e}"))?;
        let entry_name = entry.name().to_string();
        let options = SimpleFileOptions::default().compression_method(entry.compression());

        if entry.is_dir() {
            writer
                .add_directory(entry_name, options)
                .map_err(|e| format!("写入模板目录失败: {e}"))?;
            continue;
        }

        let mut data = Vec::new();
        entry
            .read_to_end(&mut data)
            .map_err(|e| format!("读取模板内容失败: {e}"))?;

        writer
            .start_file(entry_name.clone(), options)
            .map_err(|e| format!("创建模板输出条目失败: {e}"))?;

        if entry_name == "word/document.xml" {
            let xml =
                String::from_utf8(data).map_err(|e| format!("读取模板 document.xml 失败: {e}"))?;
            let rendered = apply_template_replacements(&xml, replacements);
            writer
                .write_all(rendered.as_bytes())
                .map_err(|e| format!("写入模板 document.xml 失败: {e}"))?;
        } else {
            writer
                .write_all(&data)
                .map_err(|e| format!("写入模板条目失败: {e}"))?;
        }
    }

    writer
        .finish()
        .map_err(|e| format!("完成模板 docx 生成失败: {e}"))?;
    Ok(())
}

fn apply_template_replacements(document_xml: &str, replacements: &[TemplateReplacement]) -> String {
    let mut xml = document_xml.to_string();
    for replacement in replacements {
        match replacement {
            TemplateReplacement::Text { placeholder, value } => {
                xml = xml.replace(placeholder, value);
            }
            TemplateReplacement::Paragraph {
                placeholder,
                xml: rendered,
            } => {
                xml = replace_placeholder_paragraph(&xml, placeholder, rendered);
            }
        }
    }
    xml
}

fn read_optional_docx_entry_as_string<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    entry_name: &str,
) -> Result<Option<String>, String> {
    let Ok(mut entry) = archive.by_name(entry_name) else {
        return Ok(None);
    };
    let mut data = Vec::new();
    entry
        .read_to_end(&mut data)
        .map_err(|e| format!("读取模板内容失败: {e}"))?;
    let xml = String::from_utf8(data).map_err(|e| format!("解析模板 XML 失败: {e}"))?;
    Ok(Some(xml))
}

fn read_document_relationships<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<Vec<WordTemplateDocxRelationship>, String> {
    let Some(xml) = read_optional_docx_entry_as_string(archive, "word/_rels/document.xml.rels")?
    else {
        return Ok(Vec::new());
    };

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut relationships = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                if event.name().as_ref() != b"Relationship" {
                    continue;
                }
                let mut id = None;
                let mut rel_type = None;
                let mut target = None;
                let mut target_mode = None;
                for attr in event.attributes() {
                    let attr = attr.map_err(|e| format!("读取模板关系属性失败: {e}"))?;
                    let value = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("读取模板关系值失败: {e}"))?
                        .into_owned();
                    match attr.key.as_ref() {
                        b"Id" => id = Some(value),
                        b"Type" => rel_type = Some(value),
                        b"Target" => target = Some(value),
                        b"TargetMode" => target_mode = Some(value),
                        _ => {}
                    }
                }
                let Some(id) = id else { continue };
                let Some(rel_type) = rel_type else { continue };
                let Some(target) = target else { continue };
                if !should_keep_template_relationship(&rel_type) {
                    continue;
                }
                relationships.push(WordTemplateDocxRelationship {
                    id,
                    rel_type,
                    target,
                    target_mode,
                });
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析模板关系失败: {err}")),
            _ => {}
        }
    }

    Ok(relationships)
}

fn should_keep_template_relationship(rel_type: &str) -> bool {
    matches!(
        rel_type,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
            | "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable"
            | "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings"
            | "http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings"
            | "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
            | "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"
    )
}

fn read_content_type_maps<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<(ContentTypeMap, ContentTypeMap), String> {
    let Some(xml) = read_optional_docx_entry_as_string(archive, "[Content_Types].xml")? else {
        return Ok((Default::default(), Default::default()));
    };
    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut defaults = std::collections::BTreeMap::new();
    let mut overrides = std::collections::BTreeMap::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                if event.name().as_ref() == b"Default" {
                    let mut ext = None;
                    let mut content_type = None;
                    for attr in event.attributes() {
                        let attr = attr.map_err(|e| format!("读取模板 ContentTypes 失败: {e}"))?;
                        let value = attr
                            .decode_and_unescape_value(reader.decoder())
                            .map_err(|e| format!("读取模板 ContentTypes 值失败: {e}"))?
                            .into_owned();
                        match attr.key.as_ref() {
                            b"Extension" => ext = Some(value),
                            b"ContentType" => content_type = Some(value),
                            _ => {}
                        }
                    }
                    if let (Some(ext), Some(content_type)) = (ext, content_type) {
                        defaults.insert(ext, content_type);
                    }
                } else if event.name().as_ref() == b"Override" {
                    let mut part_name = None;
                    let mut content_type = None;
                    for attr in event.attributes() {
                        let attr = attr.map_err(|e| format!("读取模板 Override 失败: {e}"))?;
                        let value = attr
                            .decode_and_unescape_value(reader.decoder())
                            .map_err(|e| format!("读取模板 Override 值失败: {e}"))?
                            .into_owned();
                        match attr.key.as_ref() {
                            b"PartName" => part_name = Some(value),
                            b"ContentType" => content_type = Some(value),
                            _ => {}
                        }
                    }
                    if let (Some(part_name), Some(content_type)) = (part_name, content_type) {
                        overrides.insert(part_name, content_type);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析模板 ContentTypes 失败: {err}")),
            _ => {}
        }
    }

    Ok((defaults, overrides))
}

fn collect_template_additional_parts<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<Vec<WordTemplateDocxPart>, String> {
    let mut parts = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取模板条目失败: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let path = entry.name().to_string();
        if !should_copy_template_part(&path) {
            continue;
        }
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("读取模板部件失败: {e}"))?;
        parts.push(WordTemplateDocxPart { path, bytes });
    }
    Ok(parts)
}

fn should_copy_template_part(path: &str) -> bool {
    matches!(
        path,
        "word/fontTable.xml"
            | "word/settings.xml"
            | "word/webSettings.xml"
            | "word/_rels/document.xml.rels"
    ) || path.starts_with("word/theme/")
        || path.starts_with("word/header")
        || path.starts_with("word/footer")
        || path.starts_with("word/_rels/header")
        || path.starts_with("word/_rels/footer")
        || path.starts_with("word/media/")
}

fn reserve_relationship_ids(relationships: &[WordTemplateDocxRelationship]) -> (u32, u32, u32) {
    let mut used = std::collections::BTreeSet::new();
    for rel in relationships {
        if let Some(id) = parse_relationship_numeric_id(&rel.id) {
            used.insert(id);
        }
    }

    let styles_id = first_unused_relationship_id(&used, 1);
    used.insert(styles_id);
    let numbering_id = first_unused_relationship_id(&used, 1);
    used.insert(numbering_id);
    let next_available = used.iter().max().copied().unwrap_or(0) + 1;
    (styles_id, numbering_id, next_available.max(3))
}

fn first_unused_relationship_id(used: &std::collections::BTreeSet<u32>, start: u32) -> u32 {
    let mut candidate = start.max(1);
    while used.contains(&candidate) {
        candidate += 1;
    }
    candidate
}

fn parse_relationship_numeric_id(id: &str) -> Option<u32> {
    id.strip_prefix("rId")?.parse::<u32>().ok()
}

fn parse_style_ids_from_styles_xml(
    styles_xml: &str,
) -> Result<std::collections::HashSet<String>, String> {
    let mut reader = Reader::from_str(styles_xml);
    reader.config_mut().trim_text(true);
    let mut style_ids = std::collections::HashSet::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                if event.name().as_ref() == b"w:style" {
                    for attr in event.attributes() {
                        let attr = attr.map_err(|e| format!("读取模板样式属性失败: {e}"))?;
                        if attr.key.as_ref() == b"w:styleId" {
                            let value = attr
                                .decode_and_unescape_value(reader.decoder())
                                .map_err(|e| format!("读取模板样式 ID 失败: {e}"))?;
                            style_ids.insert(value.into_owned());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析模板样式失败: {err}")),
            _ => {}
        }
    }

    Ok(style_ids)
}

fn resolve_template_convention_styles(
    available_style_ids: &std::collections::HashSet<String>,
) -> WordTemplateConventionStylesResolved {
    let heading_style_ids = std::array::from_fn(|index| match index {
        0 => select_first_style_id(available_style_ids, &["Heading1", "heading 1"]),
        1 => select_first_style_id(available_style_ids, &["Heading2", "heading 2"]),
        2 => select_first_style_id(available_style_ids, &["Heading3", "heading 3"]),
        3 => select_first_style_id(available_style_ids, &["Heading4", "heading 4"]),
        4 => select_first_style_id(available_style_ids, &["Heading5", "heading 5"]),
        _ => select_first_style_id(available_style_ids, &["Heading6", "heading 6"]),
    });

    WordTemplateConventionStylesResolved {
        heading_style_ids,
        body_paragraph_style_id: select_first_style_id(
            available_style_ids,
            &["BodyText", "Body", "Normal"],
        ),
        list_paragraph_style_id: select_first_style_id(
            available_style_ids,
            &["ListParagraph", "BodyText", "Normal"],
        ),
        quote_style_id: select_first_style_id(
            available_style_ids,
            &["Quote", "IntenseQuote", "BodyText", "Normal"],
        ),
        code_block_style_id: select_first_style_id(
            available_style_ids,
            &[
                "CodeBlock",
                "Code",
                "HTMLPreformatted",
                "BodyText",
                "Normal",
            ],
        ),
        formula_block_style_id: select_first_style_id(
            available_style_ids,
            &["FormulaBlock", "Formula", "Equation", "BodyText", "Normal"],
        ),
        figure_paragraph_style_id: select_first_style_id(
            available_style_ids,
            &["Figure", "Caption", "BodyText", "Normal"],
        ),
    }
}

fn select_first_style_id(
    available_style_ids: &std::collections::HashSet<String>,
    candidates: &[&str],
) -> Option<String> {
    candidates
        .iter()
        .find_map(|candidate| available_style_ids.get(*candidate).cloned())
}

fn extract_section_properties_xml(document_xml: &str) -> Option<String> {
    let start = document_xml.rfind("<w:sectPr")?;
    let tail = &document_xml[start..];
    let end_rel = tail.find("</w:sectPr>")?;
    let end = start + end_rel + "</w:sectPr>".len();
    Some(document_xml[start..end].to_string())
}

fn replace_placeholder_paragraph(
    document_xml: &str,
    placeholder: &str,
    replacement_xml: &str,
) -> String {
    let mut xml = document_xml.to_string();
    while let Some(placeholder_index) = xml.find(placeholder) {
        let Some((paragraph_start, paragraph_end)) =
            find_enclosing_paragraph_range(&xml, placeholder_index)
        else {
            xml = xml.replacen(placeholder, replacement_xml, 1);
            continue;
        };

        let mut out = String::with_capacity(
            xml.len().saturating_sub(paragraph_end - paragraph_start) + replacement_xml.len(),
        );
        out.push_str(&xml[..paragraph_start]);
        out.push_str(replacement_xml);
        out.push_str(&xml[paragraph_end..]);
        xml = out;
    }
    xml
}

fn find_enclosing_paragraph_range(
    document_xml: &str,
    target_index: usize,
) -> Option<(usize, usize)> {
    for (start, end) in iter_paragraph_ranges(document_xml) {
        if start <= target_index && target_index < end {
            return Some((start, end));
        }
    }
    None
}

fn iter_paragraph_ranges(document_xml: &str) -> Vec<(usize, usize)> {
    let bytes = document_xml.as_bytes();
    let mut ranges = Vec::new();
    let mut current_start: Option<usize> = None;
    let mut index = 0usize;

    while index < bytes.len() {
        if bytes[index] != b'<' {
            index += 1;
            continue;
        }

        if document_xml[index..].starts_with("<w:p>") {
            current_start = Some(index);
            index += "<w:p>".len();
            continue;
        }

        if document_xml[index..].starts_with("<w:p ") {
            current_start = Some(index);
            if let Some(tag_end_rel) = document_xml[index..].find('>') {
                index += tag_end_rel + 1;
                continue;
            }
            break;
        }

        if document_xml[index..].starts_with("</w:p>") {
            if let Some(start) = current_start.take() {
                ranges.push((start, index + "</w:p>".len()));
            }
            index += "</w:p>".len();
            continue;
        }

        index += 1;
    }

    ranges
}
