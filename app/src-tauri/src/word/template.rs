use super::super::*;
use super::model::*;
use super::render::*;
use std::collections::HashMap;

pub(crate) fn resolve_word_template_paths(
    app: &AppHandle,
    template_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let templates_dir = crate::platform::resolve_word_templates_dir(app)?;
    let stem = format!("template_{template_id}");
    let docx_path = templates_dir.join(format!("{stem}.docx"));
    let json_path = templates_dir.join(format!("{stem}.json"));
    if !docx_path.exists() {
        return Err(format!("未找到模板文件: {}", docx_path.display()));
    }
    if !json_path.exists() {
        return Err(format!("未找到模板配置文件: {}", json_path.display()));
    }
    Ok((docx_path, json_path))
}

pub(crate) fn build_template_replacements(
    template_cfg: &WordTemplateConfigCfg,
    model: &serde_json::Value,
    rich_blocks: &HashMap<String, Vec<WordBlockCfg>>,
) -> Result<Vec<TemplateReplacement>, String> {
    let mut render_state = WordRenderState {
        next_rel_id: 3,
        next_doc_pr_id: 1,
        style_settings: crate::resolve_word_export_style_settings(None),
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
