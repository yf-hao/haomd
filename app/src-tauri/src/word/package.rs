use super::super::*;
use super::model::*;
use super::render::*;

pub(crate) fn build_word_export_workspace(
    dir: &Path,
    payload: &WordDocPayloadCfg,
) -> Result<(), String> {
    build_word_export_workspace_internal(dir, payload, None)
}

pub(crate) fn build_word_export_workspace_with_template(
    dir: &Path,
    payload: &WordDocPayloadCfg,
    template_overlay: &WordTemplateDocxOverlay,
) -> Result<(), String> {
    build_word_export_workspace_internal(dir, payload, Some(template_overlay))
}

fn build_word_export_workspace_internal(
    dir: &Path,
    payload: &WordDocPayloadCfg,
    template_overlay: Option<&WordTemplateDocxOverlay>,
) -> Result<(), String> {
    std::fs::create_dir_all(dir.join("_rels")).map_err(|e| format!("创建 _rels 目录失败: {e}"))?;
    std::fs::create_dir_all(dir.join("docProps"))
        .map_err(|e| format!("创建 docProps 目录失败: {e}"))?;
    std::fs::create_dir_all(dir.join("word").join("_rels"))
        .map_err(|e| format!("创建 word/_rels 目录失败: {e}"))?;
    std::fs::create_dir_all(dir.join("word").join("media"))
        .map_err(|e| format!("创建 word/media 目录失败: {e}"))?;

    let mut content_type_defaults = std::collections::BTreeMap::<String, String>::new();
    content_type_defaults.insert(
        "rels".to_string(),
        "application/vnd.openxmlformats-package.relationships+xml".to_string(),
    );
    content_type_defaults.insert("xml".to_string(), "application/xml".to_string());

    let mut render_state = WordRenderState {
        next_rel_id: template_overlay
            .map(|overlay| overlay.next_available_relationship_id)
            .unwrap_or(3),
        next_doc_pr_id: 1,
        style_settings: crate::resolve_word_export_style_settings(payload.style_settings.as_ref()),
        template_styles: template_overlay.map(|overlay| overlay.convention_styles.clone()),
        ..Default::default()
    };

    prepare_word_assets(
        &dir.join("word").join("media"),
        &payload.assets,
        &mut render_state,
        &mut content_type_defaults,
    )?;

    if let Some(template_overlay) = template_overlay {
        write_template_additional_parts(dir, template_overlay)?;
        for (ext, mime) in &template_overlay.content_type_defaults {
            content_type_defaults.entry(ext.clone()).or_insert_with(|| mime.clone());
        }
    }

    let document_xml = build_document_xml_with_section_properties(
        payload,
        &mut render_state,
        template_overlay.and_then(|overlay| overlay.section_properties_xml.as_deref()),
    )?;
    let document_rels_xml = build_document_relationships_xml_with_template(
        &render_state,
        template_overlay.map(|overlay| overlay.document_relationships.as_slice()),
        template_overlay.map(|overlay| overlay.styles_relationship_id),
        template_overlay.map(|overlay| overlay.numbering_relationship_id),
    );
    let styles_xml = template_overlay
        .and_then(|overlay| overlay.styles_xml.clone())
        .unwrap_or_else(|| build_word_styles_xml(&render_state.style_settings));
    let numbering_xml = build_word_numbering_xml();
    let content_types_xml = build_content_types_xml_with_template(
        &content_type_defaults,
        template_overlay.map(|overlay| &overlay.content_type_overrides),
    );
    let root_rels_xml = build_root_relationships_xml();
    let core_xml = build_core_props_xml(&payload.title);
    let app_xml = build_app_props_xml();

    std::fs::write(dir.join("[Content_Types].xml"), content_types_xml)
        .map_err(|e| format!("写入 [Content_Types].xml 失败: {e}"))?;
    std::fs::write(dir.join("_rels").join(".rels"), root_rels_xml)
        .map_err(|e| format!("写入根 relationships 失败: {e}"))?;
    std::fs::write(dir.join("docProps").join("core.xml"), core_xml)
        .map_err(|e| format!("写入 core.xml 失败: {e}"))?;
    std::fs::write(dir.join("docProps").join("app.xml"), app_xml)
        .map_err(|e| format!("写入 app.xml 失败: {e}"))?;
    std::fs::write(dir.join("word").join("document.xml"), document_xml)
        .map_err(|e| format!("写入 document.xml 失败: {e}"))?;
    std::fs::write(dir.join("word").join("styles.xml"), styles_xml)
        .map_err(|e| format!("写入 styles.xml 失败: {e}"))?;
    std::fs::write(dir.join("word").join("numbering.xml"), numbering_xml)
        .map_err(|e| format!("写入 numbering.xml 失败: {e}"))?;
    std::fs::write(
        dir.join("word").join("_rels").join("document.xml.rels"),
        document_rels_xml,
    )
    .map_err(|e| format!("写入 document.xml.rels 失败: {e}"))?;

    Ok(())
}

fn write_template_additional_parts(
    dir: &Path,
    template_overlay: &WordTemplateDocxOverlay,
) -> Result<(), String> {
    for part in &template_overlay.additional_parts {
        let target_path = dir.join(&part.path);
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建模板附加部件目录失败: {e}"))?;
        }
        std::fs::write(&target_path, &part.bytes)
            .map_err(|e| format!("写入模板附加部件失败 {}: {e}", part.path))?;
    }
    Ok(())
}

fn prepare_word_assets(
    media_dir: &Path,
    assets: &[WordAssetCfg],
    render_state: &mut WordRenderState,
    content_type_defaults: &mut std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    for asset in assets {
        match asset {
            WordAssetCfg::Image {
                id,
                source_path,
                mime_type,
                width_px,
                height_px,
            } => {
                if source_path.starts_with("http://")
                    || source_path.starts_with("https://")
                    || source_path.starts_with("data:")
                {
                    return Err(format!("Word 导出暂不支持远程图片: {source_path}"));
                }
                let src = PathBuf::from(source_path);
                let ext = detect_asset_extension(mime_type.as_deref(), Some(&src), None);
                let file_name = format!("{id}.{ext}");
                let dest = media_dir.join(&file_name);
                std::fs::copy(&src, &dest)
                    .map_err(|e| format!("复制图片资源失败 {:?}: {e}", &src))?;
                content_type_defaults
                    .entry(ext.clone())
                    .or_insert_with(|| mime_for_extension(&ext).to_string());
                let rel_id = next_relationship_id(render_state);
                render_state.image_assets.insert(
                    id.clone(),
                    WordAssetRuntime {
                        rel_id,
                        target: format!("media/{file_name}"),
                        width_px: width_px.unwrap_or(800),
                        height_px: height_px.unwrap_or(600),
                    },
                );
            }
            WordAssetCfg::EmbeddedImage {
                id,
                file_name,
                mime_type,
                base64_data,
                width_px,
                height_px,
            } => {
                let ext = detect_asset_extension(Some(mime_type.as_str()), None, Some(file_name));
                let final_name = if file_name.contains('.') {
                    file_name.clone()
                } else {
                    format!("{file_name}.{ext}")
                };
                let dest = media_dir.join(&final_name);
                let bytes = base64::decode(base64_data)
                    .map_err(|e| format!("解析内嵌图片 base64 失败: {e}"))?;
                std::fs::write(&dest, bytes)
                    .map_err(|e| format!("写入内嵌图片资源失败 {:?}: {e}", &dest))?;
                content_type_defaults
                    .entry(ext.clone())
                    .or_insert_with(|| mime_for_extension(&ext).to_string());
                let rel_id = next_relationship_id(render_state);
                render_state.image_assets.insert(
                    id.clone(),
                    WordAssetRuntime {
                        rel_id,
                        target: format!("media/{final_name}"),
                        width_px: width_px.unwrap_or(800),
                        height_px: height_px.unwrap_or(600),
                    },
                );
            }
        }
    }
    Ok(())
}

pub(crate) fn package_docx_workspace(work_dir: &Path, output_path: &Path) -> Result<(), String> {
    if output_path.exists() {
        std::fs::remove_file(output_path).map_err(|e| format!("删除旧输出文件失败: {e}"))?;
    }

    package_directory_as_zip(work_dir, output_path)
}

fn package_directory_as_zip(source_dir: &Path, output_path: &Path) -> Result<(), String> {
    let file =
        std::fs::File::create(output_path).map_err(|e| format!("创建 docx 输出文件失败: {e}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    add_directory_to_zip(&mut zip, source_dir, source_dir, options)?;
    zip.finish()
        .map_err(|e| format!("完成 docx 打包失败: {e}"))?;
    Ok(())
}

fn add_directory_to_zip(
    zip: &mut ZipWriter<std::fs::File>,
    base_dir: &Path,
    current_dir: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let entries =
        std::fs::read_dir(current_dir).map_err(|e| format!("读取导出工作目录失败: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取导出条目失败: {e}"))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(base_dir)
            .map_err(|e| format!("计算导出相对路径失败: {e}"))?;
        let zip_path = relative.to_string_lossy().replace('\\', "/");

        if path.is_dir() {
            let dir_name = if zip_path.ends_with('/') {
                zip_path
            } else {
                format!("{zip_path}/")
            };
            zip.add_directory(&dir_name, options)
                .map_err(|e| format!("写入 docx 目录失败 ({dir_name}): {e}"))?;
            add_directory_to_zip(zip, base_dir, &path, options)?;
            continue;
        }

        zip.start_file(&zip_path, options)
            .map_err(|e| format!("写入 docx 文件头失败 ({zip_path}): {e}"))?;
        let mut input = std::fs::File::open(&path)
            .map_err(|e| format!("读取导出文件失败 ({zip_path}): {e}"))?;
        std::io::copy(&mut input, zip)
            .map_err(|e| format!("写入 docx 文件失败 ({zip_path}): {e}"))?;
    }

    Ok(())
}
