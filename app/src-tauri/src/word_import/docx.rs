use super::types::{
    ImportedWordBlock, ImportedWordImageAsset, ImportedWordInline, ImportedWordParagraph,
    ImportedWordParagraphKind, ImportedWordTable, ImportedWordTextRun, ParsedImportedWordDocument,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::collections::{BTreeMap, HashMap};
use std::io::{Read, Seek};
use std::path::Path;

#[derive(Debug, Clone)]
struct Relationship {
    target: String,
    external: bool,
}

#[derive(Debug, Default)]
struct ImageRegistry {
    media: HashMap<String, Vec<u8>>,
    assigned: BTreeMap<String, String>,
    emitted: Vec<ImportedWordImageAsset>,
    counter: usize,
}

impl ImageRegistry {
    fn register(&mut self, target: &str) -> Option<String> {
        let normalized = normalize_word_target(target);
        if let Some(existing) = self.assigned.get(&normalized) {
            return Some(existing.clone());
        }
        let bytes = self.media.get(&normalized)?.clone();
        self.counter += 1;
        let ext = Path::new(&normalized)
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("png");
        let file_name = format!("image-{}.{}", self.counter, ext.to_ascii_lowercase());
        self.assigned.insert(normalized, file_name.clone());
        self.emitted.push(ImportedWordImageAsset {
            file_name: file_name.clone(),
            bytes,
        });
        Some(file_name)
    }
}

pub fn import_docx(path: &Path) -> Result<ParsedImportedWordDocument, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("打开 Word 文档失败: {e}"))?;
    let reader = std::io::BufReader::new(file);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| format!("读取 Word 文档压缩包失败: {e}"))?;

    let document_xml = read_required_string(&mut archive, "word/document.xml")?;
    let relationships = read_relationships(&mut archive)?;
    let numbering = read_numbering_map(&mut archive)?;
    let media = read_media_entries(&mut archive)?;

    let mut warnings = Vec::new();
    let mut image_registry = ImageRegistry {
        media,
        ..Default::default()
    };
    let blocks = parse_document(
        &document_xml,
        &relationships,
        &numbering,
        &mut image_registry,
        &mut warnings,
    )?;

    Ok(ParsedImportedWordDocument {
        blocks,
        assets: image_registry.emitted,
        warnings,
    })
}

fn parse_document(
    xml: &str,
    relationships: &HashMap<String, Relationship>,
    numbering: &HashMap<String, bool>,
    image_registry: &mut ImageRegistry,
    warnings: &mut Vec<String>,
) -> Result<Vec<ImportedWordBlock>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut in_body = false;
    let mut blocks = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                if local_name(event.name().as_ref()) == b"body" {
                    in_body = true;
                } else if in_body && local_name(event.name().as_ref()) == b"p" {
                    let paragraph = parse_paragraph(
                        &mut reader,
                        relationships,
                        numbering,
                        image_registry,
                        warnings,
                    )?;
                    blocks.push(ImportedWordBlock::Paragraph(paragraph));
                } else if in_body && local_name(event.name().as_ref()) == b"tbl" {
                    let table = parse_table(&mut reader, relationships, image_registry, warnings)?;
                    blocks.push(ImportedWordBlock::Table(table));
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"body" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析 Word 文档失败: {err}")),
            _ => {}
        }
    }

    Ok(blocks)
}

fn parse_paragraph(
    reader: &mut Reader<&[u8]>,
    relationships: &HashMap<String, Relationship>,
    numbering: &HashMap<String, bool>,
    image_registry: &mut ImageRegistry,
    warnings: &mut Vec<String>,
) -> Result<ImportedWordParagraph, String> {
    let mut style_id: Option<String> = None;
    let mut num_id: Option<String> = None;
    let mut level: usize = 0;
    let mut inlines = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => match local_name(event.name().as_ref()) {
                b"pPr" => {
                    parse_paragraph_properties(reader, &mut style_id, &mut num_id, &mut level)?
                }
                b"r" => {
                    inlines.extend(parse_run(reader, relationships, image_registry, warnings)?);
                }
                b"hyperlink" => {
                    inlines.extend(parse_hyperlink(
                        reader,
                        &event,
                        relationships,
                        image_registry,
                        warnings,
                    )?);
                }
                _ => {}
            },
            Ok(Event::Empty(event)) => {
                if local_name(event.name().as_ref()) == b"hyperlink" {
                    inlines.extend(parse_empty_hyperlink(&event, relationships)?);
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"p" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析段落失败: {err}")),
            _ => {}
        }
    }

    let kind = classify_paragraph_kind(style_id.as_deref(), num_id.as_deref(), level, numbering);
    Ok(ImportedWordParagraph { kind, inlines })
}

fn parse_paragraph_properties(
    reader: &mut Reader<&[u8]>,
    style_id: &mut Option<String>,
    num_id: &mut Option<String>,
    level: &mut usize,
) -> Result<(), String> {
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => match local_name(event.name().as_ref()) {
                b"pStyle" => {
                    *style_id = read_val_attr(&event, reader)?;
                }
                b"numPr" => parse_num_pr(reader, num_id, level)?,
                _ => {}
            },
            Ok(Event::Empty(event)) => match local_name(event.name().as_ref()) {
                b"pStyle" => {
                    *style_id = read_val_attr(&event, reader)?;
                }
                b"ilvl" => {
                    if let Some(value) = read_val_attr(&event, reader)? {
                        *level = value.parse::<usize>().unwrap_or(0);
                    }
                }
                b"numId" => {
                    *num_id = read_val_attr(&event, reader)?;
                }
                _ => {}
            },
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"pPr" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析段落属性失败: {err}")),
            _ => {}
        }
    }
    Ok(())
}

fn parse_num_pr(
    reader: &mut Reader<&[u8]>,
    num_id: &mut Option<String>,
    level: &mut usize,
) -> Result<(), String> {
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => match local_name(event.name().as_ref()) {
                b"ilvl" => {
                    if let Some(value) = read_val_attr(&event, reader)? {
                        *level = value.parse::<usize>().unwrap_or(0);
                    }
                }
                b"numId" => {
                    *num_id = read_val_attr(&event, reader)?;
                }
                _ => {}
            },
            Ok(Event::Empty(event)) => match local_name(event.name().as_ref()) {
                b"ilvl" => {
                    if let Some(value) = read_val_attr(&event, reader)? {
                        *level = value.parse::<usize>().unwrap_or(0);
                    }
                }
                b"numId" => {
                    *num_id = read_val_attr(&event, reader)?;
                }
                _ => {}
            },
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"numPr" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析列表属性失败: {err}")),
            _ => {}
        }
    }
    Ok(())
}

fn parse_run(
    reader: &mut Reader<&[u8]>,
    relationships: &HashMap<String, Relationship>,
    image_registry: &mut ImageRegistry,
    warnings: &mut Vec<String>,
) -> Result<Vec<ImportedWordInline>, String> {
    let mut bold = false;
    let mut italic = false;
    let mut strike = false;
    let mut text = String::new();
    let mut images = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => match local_name(event.name().as_ref()) {
                b"rPr" => parse_run_properties(reader, &mut bold, &mut italic, &mut strike)?,
                b"t" => text.push_str(&read_text_node(reader, b"t")?),
                b"drawing" => {
                    if let Some(file_name) =
                        parse_drawing(reader, relationships, image_registry, warnings)?
                    {
                        images.push(ImportedWordInline::Image { file_name });
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(event)) => match local_name(event.name().as_ref()) {
                b"tab" => text.push('\t'),
                b"br" | b"cr" => text.push('\n'),
                b"t" => {}
                _ => {}
            },
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"r" {
                    break;
                }
            }
                Ok(Event::Text(text_node)) => {
                    text.push_str(
                        &text_node
                            .decode()
                            .map_err(|e| format!("解析文本失败: {e}"))?,
                    );
                }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析文本运行失败: {err}")),
            _ => {}
        }
    }

    let mut result = Vec::new();
    if !text.is_empty() {
        result.push(ImportedWordInline::Text(ImportedWordTextRun {
            text,
            bold,
            italic,
            strike,
        }));
    }
    result.extend(images);
    Ok(result)
}

fn parse_run_properties(
    reader: &mut Reader<&[u8]>,
    bold: &mut bool,
    italic: &mut bool,
    strike: &mut bool,
) -> Result<(), String> {
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                match local_name(event.name().as_ref()) {
                    b"b" => *bold = true,
                    b"i" => *italic = true,
                    b"strike" | b"dstrike" => *strike = true,
                    _ => {}
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"rPr" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析文本样式失败: {err}")),
            _ => {}
        }
    }
    Ok(())
}

fn parse_drawing(
    reader: &mut Reader<&[u8]>,
    relationships: &HashMap<String, Relationship>,
    image_registry: &mut ImageRegistry,
    warnings: &mut Vec<String>,
) -> Result<Option<String>, String> {
    let mut embed_id: Option<String> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                if local_name(event.name().as_ref()) == b"blip" {
                    embed_id = read_named_attr(&event, reader, b"embed")?;
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"drawing" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析图片节点失败: {err}")),
            _ => {}
        }
    }

    let Some(embed_id) = embed_id else {
        return Ok(None);
    };
    let Some(rel) = relationships.get(&embed_id) else {
        warnings.push(format!("忽略未解析的图片关系: {embed_id}"));
        return Ok(None);
    };
    Ok(image_registry.register(&rel.target))
}

fn parse_hyperlink(
    reader: &mut Reader<&[u8]>,
    start: &BytesStart<'_>,
    relationships: &HashMap<String, Relationship>,
    image_registry: &mut ImageRegistry,
    warnings: &mut Vec<String>,
) -> Result<Vec<ImportedWordInline>, String> {
    let relationship_id = read_named_attr(start, reader, b"id")?;
    let target = relationship_id
        .as_deref()
        .and_then(|id| relationships.get(id))
        .filter(|rel| rel.external)
        .map(|rel| rel.target.clone());

    let mut inlines = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                if local_name(event.name().as_ref()) == b"r" {
                    inlines.extend(parse_run(reader, relationships, image_registry, warnings)?);
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"hyperlink" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析超链接失败: {err}")),
            _ => {}
        }
    }

    if let Some(url) = target {
        let text = flatten_inlines(&inlines);
        Ok(vec![ImportedWordInline::Link { text, url }])
    } else {
        Ok(inlines)
    }
}

fn parse_empty_hyperlink(
    start: &BytesStart<'_>,
    relationships: &HashMap<String, Relationship>,
) -> Result<Vec<ImportedWordInline>, String> {
    let reader = Reader::from_str("");
    let relationship_id = read_named_attr(start, &reader, b"id")?;
    let Some(url) = relationship_id
        .as_deref()
        .and_then(|id| relationships.get(id))
        .filter(|rel| rel.external)
        .map(|rel| rel.target.clone())
    else {
        return Ok(Vec::new());
    };
    Ok(vec![ImportedWordInline::Link {
        text: url.clone(),
        url,
    }])
}

fn parse_table(
    reader: &mut Reader<&[u8]>,
    relationships: &HashMap<String, Relationship>,
    image_registry: &mut ImageRegistry,
    warnings: &mut Vec<String>,
) -> Result<ImportedWordTable, String> {
    let mut rows: Vec<Vec<String>> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                if local_name(event.name().as_ref()) == b"tr" {
                    rows.push(parse_table_row(
                        reader,
                        relationships,
                        image_registry,
                        warnings,
                    )?);
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"tbl" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析表格失败: {err}")),
            _ => {}
        }
    }

    Ok(ImportedWordTable { rows })
}

fn parse_table_row(
    reader: &mut Reader<&[u8]>,
    relationships: &HashMap<String, Relationship>,
    image_registry: &mut ImageRegistry,
    warnings: &mut Vec<String>,
) -> Result<Vec<String>, String> {
    let mut cells = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                if local_name(event.name().as_ref()) == b"tc" {
                    cells.push(parse_table_cell(
                        reader,
                        relationships,
                        image_registry,
                        warnings,
                    )?);
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"tr" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析表格行失败: {err}")),
            _ => {}
        }
    }
    Ok(cells)
}

fn parse_table_cell(
    reader: &mut Reader<&[u8]>,
    relationships: &HashMap<String, Relationship>,
    image_registry: &mut ImageRegistry,
    warnings: &mut Vec<String>,
) -> Result<String, String> {
    let mut parts = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                if local_name(event.name().as_ref()) == b"p" {
                    let paragraph = parse_paragraph(
                        reader,
                        relationships,
                        &HashMap::new(),
                        image_registry,
                        warnings,
                    )?;
                    let text = flatten_inlines(&paragraph.inlines).trim().to_string();
                    if !text.is_empty() {
                        parts.push(text);
                    }
                }
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == b"tc" {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析表格单元格失败: {err}")),
            _ => {}
        }
    }
    Ok(parts.join("<br>"))
}

fn read_relationships<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<HashMap<String, Relationship>, String> {
    let Some(xml) = read_optional_string(archive, "word/_rels/document.xml.rels")? else {
        return Ok(HashMap::new());
    };
    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut map = HashMap::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                if local_name(event.name().as_ref()) != b"Relationship" {
                    continue;
                }
                let mut id = None;
                let mut target = None;
                let mut target_mode = None;
                for attr in event.attributes() {
                    let attr = attr.map_err(|e| format!("读取关系属性失败: {e}"))?;
                    let value = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("读取关系值失败: {e}"))?
                        .into_owned();
                    match attr.key.as_ref() {
                        b"Id" => id = Some(value),
                        b"Target" => target = Some(value),
                        b"TargetMode" => target_mode = Some(value),
                        _ => {}
                    }
                }
                if let (Some(id), Some(target)) = (id, target) {
                    map.insert(
                        id,
                        Relationship {
                            target,
                            external: target_mode.as_deref() == Some("External"),
                        },
                    );
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析文档关系失败: {err}")),
            _ => {}
        }
    }

    Ok(map)
}

fn read_numbering_map<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<HashMap<String, bool>, String> {
    let Some(xml) = read_optional_string(archive, "word/numbering.xml")? else {
        return Ok(HashMap::new());
    };

    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(true);
    let mut abstract_map: HashMap<String, bool> = HashMap::new();
    let mut num_map: HashMap<String, String> = HashMap::new();
    let mut current_abstract: Option<String> = None;
    let mut current_num: Option<String> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                match local_name(event.name().as_ref()) {
                    b"abstractNum" => {
                        current_abstract = read_named_attr(&event, &reader, b"abstractNumId")?
                    }
                    b"num" => current_num = read_named_attr(&event, &reader, b"numId")?,
                    b"numFmt" => {
                        if let Some(abstract_id) = current_abstract.clone() {
                            let value = read_val_attr(&event, &reader)?.unwrap_or_default();
                            abstract_map.insert(abstract_id, value != "bullet");
                        }
                    }
                    b"abstractNumId" => {
                        if let Some(num_id) = current_num.clone() {
                            if let Some(value) = read_val_attr(&event, &reader)? {
                                num_map.insert(num_id, value);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(event)) => match local_name(event.name().as_ref()) {
                b"abstractNum" => current_abstract = None,
                b"num" => current_num = None,
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析 numbering.xml 失败: {err}")),
            _ => {}
        }
    }

    Ok(num_map
        .into_iter()
        .filter_map(|(num_id, abstract_id)| {
            abstract_map
                .get(&abstract_id)
                .copied()
                .map(|ordered| (num_id, ordered))
        })
        .collect())
}

fn read_media_entries<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
) -> Result<HashMap<String, Vec<u8>>, String> {
    let mut map = HashMap::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|e| format!("读取 Word 资源失败: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        if !name.starts_with("word/media/") {
            continue;
        }
        let mut bytes = Vec::new();
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("读取 Word 图片失败: {e}"))?;
        map.insert(name, bytes);
    }
    Ok(map)
}

fn read_required_string<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    path: &str,
) -> Result<String, String> {
    read_optional_string(archive, path)?.ok_or_else(|| format!("Word 文档缺少必需条目: {path}"))
}

fn read_optional_string<R: Read + Seek>(
    archive: &mut zip::ZipArchive<R>,
    path: &str,
) -> Result<Option<String>, String> {
    let Ok(mut entry) = archive.by_name(path) else {
        return Ok(None);
    };
    let mut bytes = Vec::new();
    entry
        .read_to_end(&mut bytes)
        .map_err(|e| format!("读取 Word 条目失败: {e}"))?;
    let text = String::from_utf8(bytes).map_err(|e| format!("解析 Word XML 失败: {e}"))?;
    Ok(Some(text))
}

fn classify_paragraph_kind(
    style_id: Option<&str>,
    num_id: Option<&str>,
    level: usize,
    numbering: &HashMap<String, bool>,
) -> ImportedWordParagraphKind {
    if let Some(style) = style_id {
        let normalized = normalize_style_id(style);
        if let Some(level) = normalized
            .strip_prefix("heading")
            .and_then(|value| value.parse::<u8>().ok())
            .filter(|value| (1..=6).contains(value))
        {
            return ImportedWordParagraphKind::Heading(level);
        }
        if normalized.contains("quote") {
            return ImportedWordParagraphKind::Quote;
        }
    }

    if let Some(num_id) = num_id {
        let ordered = numbering.get(num_id).copied().unwrap_or(false);
        return ImportedWordParagraphKind::ListItem { ordered, level };
    }

    ImportedWordParagraphKind::Normal
}

fn normalize_style_id(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

fn flatten_inlines(inlines: &[ImportedWordInline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline {
            ImportedWordInline::Text(run) => out.push_str(&run.text),
            ImportedWordInline::Link { text, url } => {
                if text.trim().is_empty() {
                    out.push_str(url);
                } else {
                    out.push_str(text);
                }
            }
            ImportedWordInline::Image { .. } => {}
        }
    }
    out
}

fn read_text_node(reader: &mut Reader<&[u8]>, end_name: &[u8]) -> Result<String, String> {
    let mut out = String::new();
    loop {
        match reader.read_event() {
            Ok(Event::Text(text)) => {
                out.push_str(
                    &text
                        .decode()
                        .map_err(|e| format!("解析文本节点失败: {e}"))?,
                );
            }
            Ok(Event::CData(text)) => {
                out.push_str(
                    &text
                        .decode()
                        .map_err(|e| format!("解析 CDATA 节点失败: {e}"))?,
                );
            }
            Ok(Event::End(event)) => {
                if local_name(event.name().as_ref()) == end_name {
                    break;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(format!("解析文本节点失败: {err}")),
            _ => {}
        }
    }
    Ok(out)
}

fn read_val_attr(event: &BytesStart<'_>, reader: &Reader<&[u8]>) -> Result<Option<String>, String> {
    read_named_attr(event, reader, b"val")
}

fn read_named_attr(
    event: &BytesStart<'_>,
    reader: &Reader<&[u8]>,
    wanted_name: &[u8],
) -> Result<Option<String>, String> {
    for attr in event.attributes() {
        let attr = attr.map_err(|e| format!("读取 XML 属性失败: {e}"))?;
        if local_name(attr.key.as_ref()) != wanted_name {
            continue;
        }
        let value = attr
            .decode_and_unescape_value(reader.decoder())
            .map_err(|e| format!("读取 XML 属性值失败: {e}"))?
            .into_owned();
        return Ok(Some(value));
    }
    Ok(None)
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn normalize_word_target(target: &str) -> String {
    let trimmed = target.trim_start_matches('/');
    if trimmed.starts_with("word/") {
        trimmed.to_string()
    } else {
        format!("word/{trimmed}")
    }
}
