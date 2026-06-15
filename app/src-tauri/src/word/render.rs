use super::super::*;
use super::model::*;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::collections::HashMap;

pub(crate) fn build_document_xml_with_section_properties(
    payload: &WordDocPayloadCfg,
    render_state: &mut WordRenderState,
    section_properties_xml: Option<&str>,
) -> Result<String, String> {
    let body = render_word_blocks(&payload.blocks, render_state, 0, None)?;
    let margin = render_state.style_settings.page_margin_twips;
    let section_xml = section_properties_xml
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            format!(
                r#"<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="{}" w:right="{}" w:bottom="{}" w:left="{}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>"#,
                margin, margin, margin, margin
            )
        });
    Ok(format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" "#,
            r#"xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" "#,
            r#"xmlns:o="urn:schemas-microsoft-com:office:office" "#,
            r#"xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" "#,
            r#"xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" "#,
            r#"xmlns:v="urn:schemas-microsoft-com:vml" "#,
            r#"xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" "#,
            r#"xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" "#,
            r#"xmlns:w10="urn:schemas-microsoft-com:office:word" "#,
            r#"xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" "#,
            r#"xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" "#,
            r#"xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" "#,
            r#"xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" "#,
            r#"xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" "#,
            r#"xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" "#,
            r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" "#,
            r#"xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" "#,
            r#"mc:Ignorable="w14 wp14"><w:body>{}"#,
            r#"{}"#,
            r#"</w:body></w:document>"#
        ),
        body, section_xml
    ))
}

pub(crate) fn render_word_blocks(
    blocks: &[WordBlockCfg],
    render_state: &mut WordRenderState,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
) -> Result<String, String> {
    let mut xml = String::new();
    let mut first_list_consumed = false;
    for block in blocks {
        let current_list = if !first_list_consumed {
            list_info
        } else {
            None
        };
        if current_list.is_some() {
            first_list_consumed = true;
        }
        xml.push_str(&render_word_block(
            block,
            render_state,
            quote_depth,
            current_list,
        )?);
    }
    Ok(xml)
}

fn render_word_block(
    block: &WordBlockCfg,
    render_state: &mut WordRenderState,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
) -> Result<String, String> {
    match block {
        WordBlockCfg::Heading { level, text, style } => Ok(render_paragraph_xml(
            render_inline_runs_xml(text, render_state),
            resolve_heading_style_id(render_state, *level),
            style.as_ref(),
            quote_depth,
            list_info,
            false,
            false,
        )),
        WordBlockCfg::Paragraph { text, style } => Ok(render_paragraph_xml(
            render_inline_runs_xml(text, render_state),
            resolve_paragraph_style_id(render_state, quote_depth, list_info, false, false),
            style.as_ref(),
            quote_depth,
            list_info,
            false,
            false,
        )),
        WordBlockCfg::Math { content, math_ml } => {
            let paragraph_style = crate::left_aligned_math_paragraph_style();
            Ok(render_paragraph_xml(
                render_math_run_xml(content, math_ml.as_deref(), true),
                resolve_paragraph_style_id(render_state, quote_depth, list_info, false, true),
                Some(&paragraph_style),
                quote_depth,
                list_info,
                false,
                true,
            ))
        }
        WordBlockCfg::Code {
            language: _,
            content,
        } => {
            let runs = render_code_runs_xml(
                content,
                render_state.style_settings.code_font_size_half_points,
            );
            Ok(render_paragraph_xml(
                runs,
                resolve_paragraph_style_id(render_state, quote_depth, list_info, true, false),
                None,
                quote_depth,
                list_info,
                true,
                false,
            ))
        }
        WordBlockCfg::Image {
            asset_id,
            alt,
            width_px,
            height_px,
            width_percent,
            max_width_percent,
        } => Ok(render_image_paragraph_xml(RenderImageParagraphOptions {
            asset_id,
            alt: alt.as_deref(),
            width_px: *width_px,
            height_px: *height_px,
            width_percent: *width_percent,
            max_width_percent: *max_width_percent,
            style_id: resolve_figure_style_id(render_state),
            render_state,
            quote_depth,
            list_info,
        })?),
        WordBlockCfg::Blockquote { children } => {
            render_word_blocks(children, render_state, quote_depth + 1, list_info)
        }
        WordBlockCfg::List { ordered, items } => {
            let mut xml = String::new();
            for item in items {
                xml.push_str(&render_word_blocks(
                    item,
                    render_state,
                    quote_depth,
                    Some((*ordered, quote_depth)),
                )?);
            }
            Ok(xml)
        }
        WordBlockCfg::Table { rows, style } => {
            render_table_xml(rows, style.as_ref(), render_state, quote_depth)
        }
    }
}

fn render_table_xml(
    rows: &[WordTableRowCfg],
    table_style: Option<&WordTableStyleCfg>,
    render_state: &mut WordRenderState,
    quote_depth: usize,
) -> Result<String, String> {
    let mut rows_xml = String::new();
    for row in rows {
        if row.cells.is_empty() {
            continue;
        }

        let mut normalized_cells = String::new();
        for cell in &row.cells {
            let cell_content = render_table_cell_blocks_xml(
                &cell.blocks,
                cell.style.as_ref(),
                render_state,
                quote_depth,
            )?;
            let content = if cell_content.trim().is_empty() {
                "<w:p/>".to_string()
            } else {
                cell_content
            };
            let tc_pr = render_table_cell_properties_xml(
                cell.style.as_ref(),
                cell.col_span,
                cell.row_span,
                cell.merge_continue,
            );
            normalized_cells.push_str(&format!("<w:tc>{}{}</w:tc>", tc_pr, content));
        }
        rows_xml.push_str(&format!("<w:tr>{}</w:tr>", normalized_cells));
    }

    Ok(format!(
        concat!(
            "<w:tbl>",
            r#"<w:tblPr>{}{}</w:tblPr>"#,
            "{}",
            "{}",
            "</w:tbl>"
        ),
        render_table_properties_xml(table_style, render_state.style_settings.page_margin_twips).0,
        render_table_borders_xml(table_style),
        render_table_grid_xml(table_style, render_state.style_settings.page_margin_twips),
        rows_xml
    ))
}

fn render_table_borders_xml(table_style: Option<&WordTableStyleCfg>) -> String {
    let border_color = table_style
        .and_then(|style| style.border_color.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if matches!(border_color, Some(value) if value.eq_ignore_ascii_case("none")) {
        return concat!(
            r#"<w:tblBorders>"#,
            r#"<w:top w:val="nil"/>"#,
            r#"<w:left w:val="nil"/>"#,
            r#"<w:bottom w:val="nil"/>"#,
            r#"<w:right w:val="nil"/>"#,
            r#"<w:insideH w:val="nil"/>"#,
            r#"<w:insideV w:val="nil"/>"#,
            r#"</w:tblBorders>"#
        )
        .to_string();
    }

    let color = border_color.unwrap_or("D9D9D9");
    let color = crate::escape_xml_attr(color);
    format!(
        concat!(
            r#"<w:tblBorders>"#,
            r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
            r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
            r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
            r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
            r#"<w:insideH w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
            r#"<w:insideV w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
            r#"</w:tblBorders>"#
        ),
        color
    )
}

pub(crate) fn render_table_properties_xml(
    style: Option<&WordTableStyleCfg>,
    page_margin_twips: u32,
) -> (String, u32) {
    let mut tbl_pr = String::new();
    let (table_width, resolved_width_twips) = resolve_table_width_xml(style, page_margin_twips);
    tbl_pr.push_str(&table_width);

    if let Some(align) = style
        .and_then(|style| style.align.as_deref())
        .filter(|value| matches!(*value, "left" | "center" | "right"))
    {
        tbl_pr.push_str(&format!(r#"<w:jc w:val="{}"/>"#, align));
    }

    if let Some(layout) = style
        .and_then(|style| style.layout.as_deref())
        .filter(|value| matches!(*value, "fixed" | "auto"))
    {
        let layout = if layout == "auto" { "autofit" } else { "fixed" };
        tbl_pr.push_str(&format!(r#"<w:tblLayout w:type="{}"/>"#, layout));
    }

    (tbl_pr, resolved_width_twips)
}

fn resolve_table_width_xml(
    style: Option<&WordTableStyleCfg>,
    page_margin_twips: u32,
) -> (String, u32) {
    let Some(style) = style else {
        let body_twips = WORD_PAGE_WIDTH_TWIPS.saturating_sub(page_margin_twips * 2);
        return (r#"<w:tblW w:w="0" w:type="auto"/>"#.to_string(), body_twips);
    };

    let body_twips = WORD_PAGE_WIDTH_TWIPS.saturating_sub(page_margin_twips * 2);
    let max_percent = style
        .max_width_percent
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.min(100.0));

    if let Some(width_percent) = style
        .width_percent
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.min(100.0))
    {
        let width_percent = max_percent
            .map(|max| width_percent.min(max))
            .unwrap_or(width_percent);
        let pct = ((width_percent * 50.0).round() as u32).max(1);
        let resolved = ((body_twips as f32) * (width_percent / 100.0)).round() as u32;
        return (
            format!(r#"<w:tblW w:w="{}" w:type="pct"/>"#, pct),
            resolved.max(1),
        );
    }

    if let Some(width_px) = style.width_px.filter(|value| *value > 0) {
        let mut width_twips = width_px.saturating_mul(TWIPS_PER_PX_AT_96_DPI);
        if let Some(max_percent) = max_percent {
            let max_twips = ((body_twips as f32) * (max_percent / 100.0)).round() as u32;
            width_twips = width_twips.min(max_twips.max(1));
        }
        let width_twips = width_twips.max(1);
        return (
            format!(r#"<w:tblW w:w="{}" w:type="dxa"/>"#, width_twips),
            width_twips,
        );
    }

    (r#"<w:tblW w:w="0" w:type="auto"/>"#.to_string(), body_twips)
}

fn render_table_grid_xml(style: Option<&WordTableStyleCfg>, page_margin_twips: u32) -> String {
    let Some(style) = style else {
        return String::new();
    };
    let Some(column_widths) = style
        .column_widths
        .as_ref()
        .filter(|widths| !widths.is_empty())
    else {
        return String::new();
    };

    let (_, table_width_twips) = resolve_table_width_xml(Some(style), page_margin_twips);
    let mut cols_xml = String::new();
    let mut has_any = false;
    for width in column_widths {
        if let Some(grid_width) = resolve_table_column_width_twips(width, table_width_twips) {
            has_any = true;
            cols_xml.push_str(&format!(r#"<w:gridCol w:w="{}"/>"#, grid_width.max(1)));
        }
    }

    if has_any {
        format!("<w:tblGrid>{}</w:tblGrid>", cols_xml)
    } else {
        String::new()
    }
}

fn resolve_table_column_width_twips(
    width: &WordTableColumnWidthCfg,
    table_width_twips: u32,
) -> Option<u32> {
    if let Some(width_percent) = width
        .width_percent
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value.min(100.0))
    {
        let twips = ((table_width_twips as f32) * (width_percent / 100.0)).round() as u32;
        return Some(twips.max(1));
    }

    width
        .width_px
        .filter(|value| *value > 0)
        .map(|value| value.saturating_mul(TWIPS_PER_PX_AT_96_DPI).max(1))
}

fn resolve_heading_style_id(render_state: &WordRenderState, level: u8) -> Option<String> {
    let level = level.clamp(1, 6) as usize;
    render_state
        .template_styles
        .as_ref()
        .and_then(|styles| styles.heading_style_ids[level - 1].clone())
        .or_else(|| Some(format!("Heading{level}")))
}

fn resolve_paragraph_style_id(
    render_state: &WordRenderState,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
    code_block: bool,
    math_block: bool,
) -> Option<String> {
    let styles = render_state.template_styles.as_ref()?;
    if code_block {
        return styles.code_block_style_id.clone();
    }
    if math_block {
        return styles.formula_block_style_id.clone();
    }
    if list_info.is_some() {
        return styles
            .list_paragraph_style_id
            .clone()
            .or_else(|| styles.body_paragraph_style_id.clone());
    }
    if quote_depth > 0 {
        return styles
            .quote_style_id
            .clone()
            .or_else(|| styles.body_paragraph_style_id.clone());
    }
    styles.body_paragraph_style_id.clone()
}

fn resolve_figure_style_id(render_state: &WordRenderState) -> Option<String> {
    render_state
        .template_styles
        .as_ref()
        .and_then(|styles| styles.figure_paragraph_style_id.clone())
}

fn render_table_cell_blocks_xml(
    blocks: &[WordBlockCfg],
    cell_style: Option<&WordTableCellStyleCfg>,
    render_state: &mut WordRenderState,
    quote_depth: usize,
) -> Result<String, String> {
    let mut xml = String::new();
    for block in blocks {
        xml.push_str(&render_word_block_in_table_cell(
            block,
            cell_style,
            render_state,
            quote_depth,
            None,
        )?);
    }
    Ok(xml)
}

fn render_word_block_in_table_cell(
    block: &WordBlockCfg,
    cell_style: Option<&WordTableCellStyleCfg>,
    render_state: &mut WordRenderState,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
) -> Result<String, String> {
    let cell_paragraph_style = cell_style.and_then(table_cell_style_to_paragraph_style);
    match block {
        WordBlockCfg::Heading { level, text, style } => {
            let merged_style = merge_paragraph_style(style.as_ref(), cell_paragraph_style.as_ref());
            Ok(render_paragraph_xml(
                render_inline_runs_xml(text, render_state),
                resolve_heading_style_id(render_state, *level),
                merged_style.as_ref(),
                quote_depth,
                list_info,
                false,
                false,
            ))
        }
        WordBlockCfg::Paragraph { text, style } => {
            let merged_style = merge_paragraph_style(style.as_ref(), cell_paragraph_style.as_ref());
            Ok(render_paragraph_xml(
                render_inline_runs_xml(text, render_state),
                resolve_paragraph_style_id(render_state, quote_depth, list_info, false, false),
                merged_style.as_ref(),
                quote_depth,
                list_info,
                false,
                false,
            ))
        }
        WordBlockCfg::Blockquote { children } => {
            let mut xml = String::new();
            for child in children {
                xml.push_str(&render_word_block_in_table_cell(
                    child,
                    cell_style,
                    render_state,
                    quote_depth + 1,
                    list_info,
                )?);
            }
            Ok(xml)
        }
        WordBlockCfg::List { ordered, items } => {
            let mut xml = String::new();
            for item in items {
                for child in item {
                    xml.push_str(&render_word_block_in_table_cell(
                        child,
                        cell_style,
                        render_state,
                        quote_depth,
                        Some((*ordered, quote_depth)),
                    )?);
                }
            }
            Ok(xml)
        }
        _ => render_word_block(block, render_state, quote_depth, list_info),
    }
}

pub(crate) fn render_table_cell_properties_xml(
    style: Option<&WordTableCellStyleCfg>,
    col_span: Option<u32>,
    row_span: Option<u32>,
    merge_continue: Option<bool>,
) -> String {
    let mut tc_pr = String::new();
    if let Some(col_span) = col_span.filter(|value| *value > 1) {
        tc_pr.push_str(&format!(r#"<w:gridSpan w:val="{}"/>"#, col_span));
    }
    if merge_continue.unwrap_or(false) {
        tc_pr.push_str(r#"<w:vMerge/>"#);
    } else if row_span.unwrap_or(1) > 1 {
        tc_pr.push_str(r#"<w:vMerge w:val="restart"/>"#);
    }
    if let Some(style) = style {
        if let Some(background_color) = style
            .background_color
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            tc_pr.push_str(&format!(
                r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
                crate::escape_xml_attr(background_color)
            ));
        }
        if let Some(border_color) = style
            .border_color
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            if border_color.trim().eq_ignore_ascii_case("none") {
                tc_pr.push_str(concat!(
                    r#"<w:tcBorders>"#,
                    r#"<w:top w:val="nil"/>"#,
                    r#"<w:left w:val="nil"/>"#,
                    r#"<w:bottom w:val="nil"/>"#,
                    r#"<w:right w:val="nil"/>"#,
                    r#"</w:tcBorders>"#
                ));
                return format!("<w:tcPr>{}</w:tcPr>", tc_pr);
            }
            let border_color = crate::escape_xml_attr(border_color);
            tc_pr.push_str(&format!(
                concat!(
                    r#"<w:tcBorders>"#,
                    r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                    r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                    r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                    r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                    r#"</w:tcBorders>"#
                ),
                border_color
            ));
        } else {
            let top = style
                .border_top_color
                .as_deref()
                .filter(|value| !value.trim().is_empty());
            let right = style
                .border_right_color
                .as_deref()
                .filter(|value| !value.trim().is_empty());
            let bottom = style
                .border_bottom_color
                .as_deref()
                .filter(|value| !value.trim().is_empty());
            let left = style
                .border_left_color
                .as_deref()
                .filter(|value| !value.trim().is_empty());

            if top.is_some() || right.is_some() || bottom.is_some() || left.is_some() {
                tc_pr.push_str("<w:tcBorders>");
                if let Some(color) = top {
                    tc_pr.push_str(&format!(
                        r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
                        crate::escape_xml_attr(color)
                    ));
                }
                if let Some(color) = left {
                    tc_pr.push_str(&format!(
                        r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
                        crate::escape_xml_attr(color)
                    ));
                }
                if let Some(color) = bottom {
                    tc_pr.push_str(&format!(
                        r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
                        crate::escape_xml_attr(color)
                    ));
                }
                if let Some(color) = right {
                    tc_pr.push_str(&format!(
                        r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
                        crate::escape_xml_attr(color)
                    ));
                }
                tc_pr.push_str("</w:tcBorders>");
            }
        }
    }

    if tc_pr.is_empty() {
        "<w:tcPr/>".to_string()
    } else {
        format!("<w:tcPr>{}</w:tcPr>", tc_pr)
    }
}

fn table_cell_style_to_paragraph_style(
    style: &WordTableCellStyleCfg,
) -> Option<WordParagraphStyleCfg> {
    let align = style
        .align
        .as_deref()
        .filter(|value| matches!(*value, "left" | "center" | "right" | "justify"))
        .map(|value| value.to_string());

    align.as_ref()?;

    Some(WordParagraphStyleCfg {
        align,
        line_height: None,
        spacing_after_pt: None,
        background_color: None,
        border_color: None,
        border_top_color: None,
        border_right_color: None,
        border_bottom_color: None,
        border_left_color: None,
    })
}

fn merge_paragraph_style(
    base: Option<&WordParagraphStyleCfg>,
    fallback: Option<&WordParagraphStyleCfg>,
) -> Option<WordParagraphStyleCfg> {
    match (base, fallback) {
        (None, None) => None,
        (Some(base), None) => Some(base.clone()),
        (None, Some(fallback)) => Some(fallback.clone()),
        (Some(base), Some(fallback)) => Some(WordParagraphStyleCfg {
            align: base.align.clone().or_else(|| fallback.align.clone()),
            line_height: base.line_height.or(fallback.line_height),
            spacing_after_pt: base.spacing_after_pt.or(fallback.spacing_after_pt),
            background_color: base
                .background_color
                .clone()
                .or_else(|| fallback.background_color.clone()),
            border_color: base
                .border_color
                .clone()
                .or_else(|| fallback.border_color.clone()),
            border_top_color: base
                .border_top_color
                .clone()
                .or_else(|| fallback.border_top_color.clone()),
            border_right_color: base
                .border_right_color
                .clone()
                .or_else(|| fallback.border_right_color.clone()),
            border_bottom_color: base
                .border_bottom_color
                .clone()
                .or_else(|| fallback.border_bottom_color.clone()),
            border_left_color: base
                .border_left_color
                .clone()
                .or_else(|| fallback.border_left_color.clone()),
        }),
    }
}

pub(crate) fn render_paragraph_xml(
    content_xml: String,
    style: Option<String>,
    paragraph_style: Option<&WordParagraphStyleCfg>,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
    code_block: bool,
    center: bool,
) -> String {
    let mut ppr = String::new();
    if let Some(style_id) = style {
        ppr.push_str(&format!(r#"<w:pStyle w:val="{}"/>"#, style_id));
    }
    if let Some((ordered, level)) = list_info {
        ppr.push_str(&format!(
            r#"<w:numPr><w:ilvl w:val="{}"/><w:numId w:val="{}"/></w:numPr>"#,
            level,
            if ordered { 2 } else { 1 }
        ));
    }
    if quote_depth > 0 || code_block {
        let left = (quote_depth as i32 * 720 + if code_block { 360 } else { 0 }).max(0);
        ppr.push_str(&format!(r#"<w:ind w:left="{}"/>"#, left));
    }
    if quote_depth > 0 {
        ppr.push_str(
            r#"<w:pBdr><w:left w:val="single" w:sz="8" w:space="8" w:color="C9CDD1"/></w:pBdr>"#,
        );
    }
    if code_block {
        ppr.push_str(r#"<w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>"#);
    }
    if let Some(paragraph_style) = paragraph_style {
        if let Some(align) = paragraph_style.align.as_deref() {
            if matches!(align, "left" | "center" | "right" | "justify") {
                ppr.push_str(&format!(r#"<w:jc w:val="{}"/>"#, align));
            }
        }
        if paragraph_style.line_height.is_some() || paragraph_style.spacing_after_pt.is_some() {
            let after = paragraph_style
                .spacing_after_pt
                .map(crate::editor_settings::pt_to_twips)
                .unwrap_or(render_state_default_spacing_after_twips());
            let line = paragraph_style
                .line_height
                .map(crate::editor_settings::line_spacing_to_twips)
                .unwrap_or(render_state_default_line_spacing_twips());
            ppr.push_str(&format!(
                r#"<w:spacing w:after="{}" w:line="{}" w:lineRule="auto"/>"#,
                after, line
            ));
        }
        if let Some(background_color) = paragraph_style
            .background_color
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            ppr.push_str(&format!(
                r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
                crate::escape_xml_attr(background_color)
            ));
        }
        let border_xml = render_paragraph_border_xml(paragraph_style);
        if !border_xml.is_empty() {
            ppr.push_str(&border_xml);
        }
    }
    if center && !ppr.contains("<w:jc") {
        ppr.push_str(r#"<w:jc w:val="center"/>"#);
    }
    let ppr_xml = if ppr.is_empty() {
        String::new()
    } else {
        format!("<w:pPr>{}</w:pPr>", ppr)
    };
    format!("<w:p>{}{}</w:p>", ppr_xml, content_xml)
}

fn render_state_default_spacing_after_twips() -> u32 {
    crate::editor_settings::pt_to_twips(8.0)
}

fn render_state_default_line_spacing_twips() -> u32 {
    crate::editor_settings::line_spacing_to_twips(1.25)
}

fn render_paragraph_border_xml(style: &WordParagraphStyleCfg) -> String {
    if let Some(border_color) = style
        .border_color
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        let border_color = crate::escape_xml_attr(border_color);
        return format!(
            concat!(
                r#"<w:pBdr>"#,
                r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="{0}"/>"#,
                r#"</w:pBdr>"#
            ),
            border_color
        );
    }

    let top = style
        .border_top_color
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let right = style
        .border_right_color
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let bottom = style
        .border_bottom_color
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let left = style
        .border_left_color
        .as_deref()
        .filter(|value| !value.trim().is_empty());

    if top.is_none() && right.is_none() && bottom.is_none() && left.is_none() {
        return String::new();
    }

    let mut xml = String::from("<w:pBdr>");
    if let Some(color) = top {
        xml.push_str(&format!(
            r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
            crate::escape_xml_attr(color)
        ));
    }
    if let Some(color) = left {
        xml.push_str(&format!(
            r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
            crate::escape_xml_attr(color)
        ));
    }
    if let Some(color) = bottom {
        xml.push_str(&format!(
            r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
            crate::escape_xml_attr(color)
        ));
    }
    if let Some(color) = right {
        xml.push_str(&format!(
            r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="{}"/>"#,
            crate::escape_xml_attr(color)
        ));
    }
    xml.push_str("</w:pBdr>");
    xml
}

fn render_inline_runs_xml(runs: &[WordInlineRunCfg], render_state: &mut WordRenderState) -> String {
    let mut xml = String::new();
    for run in runs {
        match run {
            WordInlineRunCfg::Text {
                value,
                bold,
                italic,
                code,
                strike,
                underline,
                color,
                background_color,
                font_size_pt,
                font_family,
            } => {
                xml.push_str(&render_text_run_xml(RenderTextRunOptions {
                    value,
                    bold: bold.unwrap_or(false),
                    italic: italic.unwrap_or(false),
                    code: code.unwrap_or(false),
                    strike: strike.unwrap_or(false),
                    underline: underline.unwrap_or(false),
                    color: color.as_deref(),
                    background_color: background_color.as_deref(),
                    font_size_pt: *font_size_pt,
                    font_family: font_family.as_deref(),
                    code_font_size_half_points: render_state
                        .style_settings
                        .code_font_size_half_points,
                }));
            }
            WordInlineRunCfg::Math { value, math_ml } => {
                xml.push_str(&render_math_run_xml(value, math_ml.as_deref(), false));
            }
            WordInlineRunCfg::Link { value, href } => {
                let rel_id = next_relationship_id(render_state);
                render_state.hyperlinks.push((rel_id.clone(), href.clone()));
                xml.push_str(&format!(
                    r#"<w:hyperlink r:id="{}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">{}</w:t></w:r></w:hyperlink>"#,
                    rel_id,
                    crate::escape_xml_text(value)
                ));
            }
        }
    }
    xml
}

pub(crate) struct RenderTextRunOptions<'a> {
    pub(crate) value: &'a str,
    pub(crate) bold: bool,
    pub(crate) italic: bool,
    pub(crate) code: bool,
    pub(crate) strike: bool,
    pub(crate) underline: bool,
    pub(crate) color: Option<&'a str>,
    pub(crate) background_color: Option<&'a str>,
    pub(crate) font_size_pt: Option<f32>,
    pub(crate) font_family: Option<&'a str>,
    pub(crate) code_font_size_half_points: u32,
}

pub(crate) fn render_text_run_xml(options: RenderTextRunOptions<'_>) -> String {
    let RenderTextRunOptions {
        value,
        bold,
        italic,
        code,
        strike,
        underline,
        color,
        background_color,
        font_size_pt,
        font_family,
        code_font_size_half_points,
    } = options;
    let mut rpr = String::new();
    if bold {
        rpr.push_str("<w:b/>");
    }
    if italic {
        rpr.push_str("<w:i/>");
    }
    if strike {
        rpr.push_str("<w:strike/>");
    }
    if underline {
        rpr.push_str(r#"<w:u w:val="single"/>"#);
    }
    if let Some(color) = color.filter(|value| !value.trim().is_empty()) {
        rpr.push_str(&format!(
            r#"<w:color w:val="{}"/>"#,
            crate::escape_xml_attr(color)
        ));
    }
    if let Some(background_color) = background_color.filter(|value| !value.trim().is_empty()) {
        rpr.push_str(&format!(
            r#"<w:shd w:val="clear" w:color="auto" w:fill="{}"/>"#,
            crate::escape_xml_attr(background_color)
        ));
    }
    if let Some(font_family) = font_family.filter(|value| !value.trim().is_empty()) {
        rpr.push_str(&render_word_font_family_xml(font_family));
    }
    if let Some(font_size_half_points) = font_size_pt_to_half_points(font_size_pt) {
        rpr.push_str(&format!(r#"<w:sz w:val="{}"/>"#, font_size_half_points));
    }
    if code {
        rpr.push_str(&format!(
            r#"<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Menlo"/><w:sz w:val="{}"/><w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/>"#,
            code_font_size_half_points
        ));
    }
    let rpr_xml = if rpr.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{}</w:rPr>", rpr)
    };
    let mut body = String::new();
    let segments: Vec<&str> = value.split('\n').collect();
    for (idx, segment) in segments.iter().enumerate() {
        if idx > 0 {
            body.push_str("<w:br/>");
        }
        body.push_str(&format!(
            r#"<w:t xml:space="preserve">{}</w:t>"#,
            crate::escape_xml_text(segment)
        ));
    }
    format!("<w:r>{}{}</w:r>", rpr_xml, body)
}

fn render_code_runs_xml(content: &str, code_font_size_half_points: u32) -> String {
    render_text_run_xml(RenderTextRunOptions {
        value: content,
        bold: false,
        italic: false,
        code: true,
        strike: false,
        underline: false,
        color: None,
        background_color: None,
        font_size_pt: None,
        font_family: None,
        code_font_size_half_points,
    })
}

fn font_size_pt_to_half_points(size_pt: Option<f32>) -> Option<u32> {
    let value = size_pt?;
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    Some((value * 2.0).round() as u32)
}

fn render_word_font_family_xml(font_family: &str) -> String {
    let font_family = normalize_word_font_family(font_family);
    let escaped = crate::escape_xml_attr(&font_family);
    format!(
        r#"<w:rFonts w:ascii="{0}" w:hAnsi="{0}" w:cs="{0}" w:eastAsia="{0}"/>"#,
        escaped
    )
}

fn normalize_word_font_family(font_family: &str) -> String {
    let trimmed = font_family.trim();
    if trimmed.eq_ignore_ascii_case("songti")
        || trimmed.eq_ignore_ascii_case("songti sc")
        || trimmed.eq_ignore_ascii_case("simsun")
        || trimmed.eq_ignore_ascii_case("sim sun")
    {
        return "宋体".to_string();
    }
    trimmed.to_string()
}

#[derive(Debug, Clone, Default)]
struct MathMlNode {
    name: String,
    text: String,
    attrs: HashMap<String, String>,
    children: Vec<MathMlNode>,
}

fn render_math_run_xml(value: &str, math_ml: Option<&str>, display_mode: bool) -> String {
    if let Some(math_ml) = math_ml {
        if let Ok(omml) = mathml_to_omml(math_ml) {
            return format!(r#"<m:oMath>{}</m:oMath>"#, omml);
        }
    }

    let mut rpr = String::from(
        r#"<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Cambria Math"/>"#,
    );
    if display_mode {
        rpr.push_str(r#"<w:sz w:val="24"/>"#);
    }
    let rpr_xml = format!("<w:rPr>{}</w:rPr>", rpr);
    format!(
        r#"<w:r>{}<w:t xml:space="preserve">{}</w:t></w:r>"#,
        rpr_xml,
        crate::escape_xml_text(value)
    )
}

pub(crate) fn mathml_to_omml(math_ml: &str) -> Result<String, String> {
    let root = parse_mathml(math_ml)?;
    let math_root = find_math_expression_root(&root);
    Ok(convert_mathml_node(math_root))
}

fn parse_mathml(math_ml: &str) -> Result<MathMlNode, String> {
    let mut reader = Reader::from_str(math_ml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut stack: Vec<MathMlNode> = Vec::new();
    let mut root: Option<MathMlNode> = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let mut attrs = HashMap::new();
                for attr in event.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_string();
                    let value = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("解析 MathML 属性失败: {e}"))?
                        .into_owned();
                    attrs.insert(key, value);
                }
                stack.push(MathMlNode {
                    name: String::from_utf8_lossy(event.local_name().as_ref()).to_string(),
                    attrs,
                    ..Default::default()
                });
            }
            Ok(Event::Empty(event)) => {
                let mut attrs = HashMap::new();
                for attr in event.attributes().flatten() {
                    let key = String::from_utf8_lossy(attr.key.local_name().as_ref()).to_string();
                    let value = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|e| format!("解析 MathML 属性失败: {e}"))?
                        .into_owned();
                    attrs.insert(key, value);
                }
                let node = MathMlNode {
                    name: String::from_utf8_lossy(event.local_name().as_ref()).to_string(),
                    attrs,
                    ..Default::default()
                };
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(node);
                } else {
                    root = Some(node);
                }
            }
            Ok(Event::Text(event)) => {
                if let Some(current) = stack.last_mut() {
                    let text = event
                        .decode()
                        .map_err(|e| format!("解析 MathML 文本失败: {e}"))?;
                    current.text.push_str(&text);
                }
            }
            Ok(Event::CData(event)) => {
                if let Some(current) = stack.last_mut() {
                    let text = event
                        .decode()
                        .map_err(|e| format!("解析 MathML CDATA 失败: {e}"))?;
                    current.text.push_str(&text);
                }
            }
            Ok(Event::End(_)) => {
                if let Some(node) = stack.pop() {
                    if let Some(parent) = stack.last_mut() {
                        parent.children.push(node);
                    } else {
                        root = Some(node);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(err) => return Err(format!("解析 MathML 失败: {err}")),
        }
        buf.clear();
    }

    root.ok_or_else(|| "MathML 为空".to_string())
}

fn find_math_expression_root(node: &MathMlNode) -> &MathMlNode {
    match node.name.as_str() {
        "math" => node
            .children
            .iter()
            .find(|child| child.name == "semantics")
            .and_then(|semantics| {
                semantics
                    .children
                    .iter()
                    .find(|child| child.name != "annotation")
            })
            .or_else(|| {
                node.children
                    .iter()
                    .find(|child| child.name != "annotation")
            })
            .unwrap_or(node),
        "semantics" => node
            .children
            .iter()
            .find(|child| child.name != "annotation")
            .unwrap_or(node),
        _ => node,
    }
}

fn convert_mathml_node(node: &MathMlNode) -> String {
    match node.name.as_str() {
        "math" | "semantics" => node
            .children
            .iter()
            .map(convert_mathml_node)
            .collect::<Vec<_>>()
            .join(""),
        "mtable" => convert_mathml_table(node),
        "mtr" | "mlabeledtr" => convert_mathml_table_row(node, &[]),
        "mtd" => convert_mathml_table_cell(node),
        "mrow" => convert_mathml_row(node),
        "annotation" => String::new(),
        "mi" | "mn" | "mo" | "mtext" => render_omml_text_run(&collect_mathml_text(node)),
        "msup" => {
            let base = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let sup = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(
                r#"<m:sSup><m:e>{}</m:e><m:sup>{}</m:sup></m:sSup>"#,
                base, sup
            )
        }
        "msub" => {
            let base = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let sub = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(
                r#"<m:sSub><m:e>{}</m:e><m:sub>{}</m:sub></m:sSub>"#,
                base, sub
            )
        }
        "msubsup" => {
            let base = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let sub = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            let sup = node
                .children
                .get(2)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(
                r#"<m:sSubSup><m:e>{}</m:e><m:sub>{}</m:sub><m:sup>{}</m:sup></m:sSubSup>"#,
                base, sub, sup
            )
        }
        "mfrac" => {
            let num = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let den = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(r#"<m:f><m:num>{}</m:num><m:den>{}</m:den></m:f>"#, num, den)
        }
        "msqrt" => {
            let body = node
                .children
                .iter()
                .map(convert_mathml_node)
                .collect::<Vec<_>>()
                .join("");
            format!(
                r#"<m:rad><m:degHide m:val="1"/><m:e>{}</m:e></m:rad>"#,
                body
            )
        }
        "mroot" => {
            let body = node
                .children
                .first()
                .map(convert_mathml_node)
                .unwrap_or_default();
            let degree = node
                .children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default();
            format!(
                r#"<m:rad><m:deg>{}</m:deg><m:e>{}</m:e></m:rad>"#,
                degree, body
            )
        }
        "munderover" => render_nary_or_limit(node, true, true, &[]),
        "munder" => render_nary_or_limit(node, true, false, &[]),
        "mover" => render_nary_or_limit(node, false, true, &[]),
        _ => {
            if !node.children.is_empty() {
                node.children
                    .iter()
                    .map(convert_mathml_node)
                    .collect::<Vec<_>>()
                    .join("")
            } else {
                render_omml_text_run(&collect_mathml_text(node))
            }
        }
    }
}

fn convert_mathml_table(node: &MathMlNode) -> String {
    let raw_rows = node
        .children
        .iter()
        .filter(|child| matches!(child.name.as_str(), "mtr" | "mlabeledtr"))
        .collect::<Vec<_>>();

    let keep_columns = meaningful_table_columns(&raw_rows);
    let rows = raw_rows
        .iter()
        .map(|row| convert_mathml_table_row(row, &keep_columns))
        .filter(|row| !row.is_empty())
        .collect::<Vec<_>>();

    if rows.is_empty() {
        return node
            .children
            .iter()
            .map(convert_mathml_node)
            .collect::<Vec<_>>()
            .join("");
    }

    if rows.len() == 1 {
        return rows.into_iter().next().unwrap_or_default();
    }

    let alignments = column_alignments(node, &keep_columns);
    let columns_xml = alignments
        .iter()
        .map(|align| {
            format!(
                r#"<m:mc><m:mcPr><m:count m:val="1"/><m:mcJc m:val="{}"/></m:mcPr></m:mc>"#,
                crate::escape_xml_attr(align)
            )
        })
        .collect::<Vec<_>>()
        .join("");

    let rows_xml = rows
        .into_iter()
        .map(|row| format!("<m:mr>{}</m:mr>", row))
        .collect::<Vec<_>>()
        .join("");

    format!(
        concat!(
            r#"<m:m><m:mPr><m:mcs>{}</m:mcs>"#,
            r#"<m:cGp m:val="60"/><m:cGpRule m:val="3"/><m:plcHide m:val="1"/>"#,
            r#"</m:mPr>{}</m:m>"#
        ),
        columns_xml, rows_xml
    )
}

fn convert_mathml_table_row(node: &MathMlNode, keep_columns: &[usize]) -> String {
    let source_cells = node
        .children
        .iter()
        .filter(|child| child.name == "mtd")
        .collect::<Vec<_>>();

    if source_cells.is_empty() {
        return node
            .children
            .iter()
            .map(convert_mathml_node)
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>()
            .join("");
    }

    let indices = if keep_columns.is_empty() {
        (0..source_cells.len()).collect::<Vec<_>>()
    } else {
        keep_columns.to_vec()
    };

    indices
        .into_iter()
        .map(|index| {
            let content = source_cells
                .get(index)
                .map(|cell| convert_mathml_table_cell(cell))
                .unwrap_or_default();
            format!("<m:e>{}</m:e>", content)
        })
        .collect::<Vec<_>>()
        .join("")
}

fn convert_mathml_table_cell(node: &MathMlNode) -> String {
    node.children
        .iter()
        .map(convert_mathml_node)
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("")
}

fn meaningful_table_columns(rows: &[&MathMlNode]) -> Vec<usize> {
    let max_cols = rows
        .iter()
        .map(|row| {
            row.children
                .iter()
                .filter(|child| child.name == "mtd")
                .count()
        })
        .max()
        .unwrap_or(0);

    (0..max_cols)
        .filter(|index| {
            rows.iter().any(|row| {
                row.children
                    .iter()
                    .filter(|child| child.name == "mtd")
                    .nth(*index)
                    .map(|cell| !is_mathml_cell_empty(cell))
                    .unwrap_or(false)
            })
        })
        .collect()
}

fn is_mathml_cell_empty(node: &MathMlNode) -> bool {
    if !node.text.trim().is_empty() {
        return false;
    }

    if node.name == "mtd" {
        return node.children.iter().all(is_mathml_cell_empty);
    }

    if matches!(
        node.name.as_str(),
        "mrow" | "mstyle" | "mpadded" | "mphantom" | "semantics"
    ) {
        return node.children.iter().all(is_mathml_cell_empty);
    }

    node.children.is_empty()
}

fn column_alignments(node: &MathMlNode, keep_columns: &[usize]) -> Vec<&'static str> {
    let source: Vec<&'static str> = node
        .attrs
        .get("columnalign")
        .map(|value| {
            value
                .split_whitespace()
                .map(|part| match part {
                    "left" => "left",
                    "right" => "right",
                    "center" => "center",
                    _ => "left",
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if !source.is_empty() && source.len() == keep_columns.len() {
        return source;
    }

    let indices = if keep_columns.is_empty() {
        (0..source.len().max(1)).collect::<Vec<_>>()
    } else {
        keep_columns.to_vec()
    };

    indices
        .into_iter()
        .map(|index| source.get(index).copied().unwrap_or("left"))
        .collect()
}

fn convert_mathml_row(node: &MathMlNode) -> String {
    if let Some(xml) = convert_delimited_mathml_table_row(node) {
        return xml;
    }

    let mut xml = String::new();
    let mut index = 0;
    while index < node.children.len() {
        let child = &node.children[index];
        if is_nary_node(child) {
            let body_nodes = &node.children[index + 1..];
            xml.push_str(&render_nary_or_limit(
                child,
                matches!(child.name.as_str(), "munderover" | "munder"),
                matches!(child.name.as_str(), "munderover" | "mover"),
                body_nodes,
            ));
            break;
        }

        xml.push_str(&convert_mathml_node(child));
        index += 1;
    }
    xml
}

fn convert_delimited_mathml_table_row(node: &MathMlNode) -> Option<String> {
    let meaningful_children = node
        .children
        .iter()
        .filter(|child| !is_ignorable_mathml_node(child))
        .collect::<Vec<_>>();

    if meaningful_children.len() != 3 {
        return None;
    }

    let left = mathml_operator_text(meaningful_children[0])?;
    let table = meaningful_children[1];
    let right = mathml_operator_text(meaningful_children[2])?;

    if table.name != "mtable" || !is_matching_delimiter_pair(&left, &right) {
        return None;
    }

    let table_xml = convert_mathml_table(table);
    Some(format!(
        concat!(
            r#"<m:d><m:dPr><m:begChr m:val="{}"/><m:endChr m:val="{}"/>"#,
            r#"<m:grow m:val="1"/></m:dPr><m:e>{}</m:e></m:d>"#
        ),
        crate::escape_xml_attr(&left),
        crate::escape_xml_attr(&right),
        table_xml
    ))
}

fn mathml_operator_text(node: &MathMlNode) -> Option<String> {
    if node.name != "mo" {
        return None;
    }

    let text = collect_mathml_text(node).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn is_matching_delimiter_pair(left: &str, right: &str) -> bool {
    matches!(
        (left, right),
        ("(", ")") | ("[", "]") | ("{", "}") | ("|", "|") | ("‖", "‖")
    )
}

fn is_ignorable_mathml_node(node: &MathMlNode) -> bool {
    node.text.trim().is_empty() && node.children.is_empty()
}

fn render_nary_or_limit(
    node: &MathMlNode,
    has_sub: bool,
    has_sup: bool,
    body_nodes: &[MathMlNode],
) -> String {
    let base = node.children.first().cloned().unwrap_or_default();
    let operator = collect_mathml_text(&base);
    let is_nary = matches!(operator.as_str(), "∑" | "∏" | "∫" | "⋂" | "⋃");

    if is_nary {
        let sub = if has_sub {
            node.children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default()
        } else {
            String::new()
        };
        let sup = if has_sup {
            let sup_index = if has_sub { 2 } else { 1 };
            node.children
                .get(sup_index)
                .map(convert_mathml_node)
                .unwrap_or_default()
        } else {
            String::new()
        };
        return format!(
            concat!(
                r#"<m:nary><m:naryPr><m:chr m:val="{}"/><m:limLoc m:val="undOvr"/></m:naryPr>"#,
                r#"<m:sub>{}</m:sub><m:sup>{}</m:sup><m:e>{}</m:e></m:nary>"#
            ),
            crate::escape_xml_attr(&operator),
            sub,
            sup,
            body_nodes
                .iter()
                .map(convert_mathml_node)
                .collect::<Vec<_>>()
                .join("")
        );
    }

    let base_xml = convert_mathml_node(&base);
    match (has_sub, has_sup) {
        (true, true) => format!(
            r#"<m:sSubSup><m:e>{}</m:e><m:sub>{}</m:sub><m:sup>{}</m:sup></m:sSubSup>"#,
            base_xml,
            node.children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default(),
            node.children
                .get(2)
                .map(convert_mathml_node)
                .unwrap_or_default()
        ),
        (true, false) => format!(
            r#"<m:sSub><m:e>{}</m:e><m:sub>{}</m:sub></m:sSub>"#,
            base_xml,
            node.children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default()
        ),
        (false, true) => format!(
            r#"<m:sSup><m:e>{}</m:e><m:sup>{}</m:sup></m:sSup>"#,
            base_xml,
            node.children
                .get(1)
                .map(convert_mathml_node)
                .unwrap_or_default()
        ),
        (false, false) => base_xml,
    }
}

fn is_nary_node(node: &MathMlNode) -> bool {
    matches!(node.name.as_str(), "munderover" | "munder" | "mover")
        && matches!(
            collect_mathml_text(node.children.first().unwrap_or(&MathMlNode::default())).as_str(),
            "∑" | "∏" | "∫" | "⋂" | "⋃"
        )
}

fn collect_mathml_text(node: &MathMlNode) -> String {
    let mut text = node.text.clone();
    for child in &node.children {
        text.push_str(&collect_mathml_text(child));
    }
    text
}

fn render_omml_text_run(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    format!(r#"<m:r><m:t>{}</m:t></m:r>"#, crate::escape_xml_text(text))
}

const WORD_PAGE_WIDTH_TWIPS: u32 = 11906;
const WORD_IMAGE_WIDTH_RATIO_NUM: u32 = 92;
const WORD_IMAGE_WIDTH_RATIO_DEN: u32 = 100;
const TWIPS_PER_PX_AT_96_DPI: u32 = 15;

struct RenderImageParagraphOptions<'a> {
    asset_id: &'a str,
    alt: Option<&'a str>,
    width_px: Option<u32>,
    height_px: Option<u32>,
    width_percent: Option<f32>,
    max_width_percent: Option<f32>,
    style_id: Option<String>,
    render_state: &'a mut WordRenderState,
    quote_depth: usize,
    list_info: Option<(bool, usize)>,
}

fn render_image_paragraph_xml(options: RenderImageParagraphOptions<'_>) -> Result<String, String> {
    let RenderImageParagraphOptions {
        asset_id,
        alt,
        width_px,
        height_px,
        width_percent,
        max_width_percent,
        style_id,
        render_state,
        quote_depth,
        list_info,
    } = options;
    let asset = render_state
        .image_assets
        .get(asset_id)
        .ok_or_else(|| format!("缺少图片资源: {asset_id}"))?;
    let (width, height) = resolve_image_dimensions(
        width_px.unwrap_or(asset.width_px).max(1),
        height_px.unwrap_or(asset.height_px).max(1),
        width_percent,
        max_width_percent,
        quote_depth,
        list_info.map(|(_, level)| level),
        render_state.style_settings.page_margin_twips,
    );
    let cx = width as u64 * 9525;
    let cy = height as u64 * 9525;
    let doc_pr_id = render_state.next_doc_pr_id;
    render_state.next_doc_pr_id += 1;

    let drawing = format!(
        concat!(
            r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">"#,
            r#"<wp:extent cx="{}" cy="{}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>"#,
            r#"<wp:docPr id="{}" name="{}" descr="{}"/>"#,
            r#"<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>"#,
            r#"<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">"#,
            r#"<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="{}"/><pic:cNvPicPr/></pic:nvPicPr>"#,
            r#"<pic:blipFill><a:blip r:embed="{}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>"#,
            r#"<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{}" cy="{}"/></a:xfrm>"#,
            r#"<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>"#,
            r#"</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#
        ),
        cx,
        cy,
        doc_pr_id,
        crate::escape_xml_attr(alt.unwrap_or(asset_id)),
        crate::escape_xml_attr(alt.unwrap_or(asset_id)),
        crate::escape_xml_attr(alt.unwrap_or(asset_id)),
        asset.rel_id,
        cx,
        cy
    );

    Ok(render_paragraph_xml(
        drawing,
        style_id,
        None,
        quote_depth,
        list_info,
        false,
        true,
    ))
}

pub(crate) fn fit_image_to_page_width(
    width_px: u32,
    height_px: u32,
    quote_depth: usize,
    list_level: Option<usize>,
    page_margin_twips: u32,
) -> (u32, u32) {
    let (_, _, max_width_px) = image_layout_constraints(quote_depth, list_level, page_margin_twips);

    if width_px <= max_width_px {
        return (width_px, height_px);
    }

    let scaled_height = ((height_px as u64) * (max_width_px as u64) / (width_px as u64))
        .max(1)
        .min(u32::MAX as u64) as u32;
    (max_width_px, scaled_height)
}

pub(crate) fn resolve_image_dimensions(
    width_px: u32,
    height_px: u32,
    width_percent: Option<f32>,
    max_width_percent: Option<f32>,
    quote_depth: usize,
    list_level: Option<usize>,
    page_margin_twips: u32,
) -> (u32, u32) {
    let (_, _, max_width_px) = image_layout_constraints(quote_depth, list_level, page_margin_twips);

    if let Some(percent) = width_percent.filter(|value| value.is_finite() && *value > 0.0) {
        let target_width = (((max_width_px as f32) * (percent.min(100.0) / 100.0)).round() as u32)
            .clamp(1, max_width_px.max(1));
        let target_height = ((height_px as u64) * (target_width as u64) / (width_px as u64))
            .max(1)
            .min(u32::MAX as u64) as u32;
        return (target_width, target_height);
    }

    let (fit_width, fit_height) = fit_image_to_page_width(
        width_px,
        height_px,
        quote_depth,
        list_level,
        page_margin_twips,
    );

    if let Some(percent) = max_width_percent.filter(|value| value.is_finite() && *value > 0.0) {
        let clamp_width =
            (((max_width_px as f32) * (percent.min(100.0) / 100.0)).round() as u32).max(1);
        if fit_width > clamp_width {
            let target_height = ((fit_height as u64) * (clamp_width as u64) / (fit_width as u64))
                .max(1)
                .min(u32::MAX as u64) as u32;
            return (clamp_width, target_height);
        }
    }

    (fit_width, fit_height)
}

fn image_layout_constraints(
    quote_depth: usize,
    list_level: Option<usize>,
    page_margin_twips: u32,
) -> (u32, u32, u32) {
    let page_body_twips = WORD_PAGE_WIDTH_TWIPS.saturating_sub(page_margin_twips * 2);
    let quote_indent_twips = (quote_depth as u32).saturating_mul(720);
    let list_indent_twips = list_level
        .map(|level| ((level as u32) + 1).saturating_mul(720))
        .unwrap_or(0);
    let available_twips = page_body_twips
        .saturating_sub(quote_indent_twips)
        .saturating_sub(list_indent_twips);
    let safe_twips =
        available_twips.saturating_mul(WORD_IMAGE_WIDTH_RATIO_NUM) / WORD_IMAGE_WIDTH_RATIO_DEN;
    let max_width_px = (safe_twips / TWIPS_PER_PX_AT_96_DPI).max(1);
    (available_twips, safe_twips, max_width_px)
}

pub(crate) fn build_document_relationships_xml_with_template(
    render_state: &WordRenderState,
    template_relationships: Option<&[WordTemplateDocxRelationship]>,
    styles_relationship_id: Option<u32>,
    numbering_relationship_id: Option<u32>,
) -> String {
    let styles_relationship_id = styles_relationship_id.unwrap_or(1);
    let numbering_relationship_id = numbering_relationship_id.unwrap_or(2);
    let mut xml = String::from(concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#
    ));
    xml.push_str(&format!(
        r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>"#,
        styles_relationship_id
    ));
    xml.push_str(&format!(
        r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>"#,
        numbering_relationship_id
    ));
    if let Some(template_relationships) = template_relationships {
        for rel in template_relationships {
            xml.push_str(&format!(
                r#"<Relationship Id="{}" Type="{}" Target="{}"{} />"#,
                crate::escape_xml_attr(&rel.id),
                crate::escape_xml_attr(&rel.rel_type),
                crate::escape_xml_attr(&rel.target),
                rel.target_mode
                    .as_deref()
                    .map(|mode| format!(r#" TargetMode="{}""#, crate::escape_xml_attr(mode)))
                    .unwrap_or_default()
            ));
        }
    }
    for asset in render_state.image_assets.values() {
        xml.push_str(&format!(
            r#"<Relationship Id="{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="{}"/>"#,
            asset.rel_id, asset.target
        ));
    }
    for (rel_id, href) in &render_state.hyperlinks {
        xml.push_str(&format!(
            r#"<Relationship Id="{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="{}" TargetMode="External"/>"#,
            rel_id,
            crate::escape_xml_attr(href)
        ));
    }
    xml.push_str("</Relationships>");
    xml
}

pub(crate) fn build_content_types_xml_with_template(
    defaults: &std::collections::BTreeMap<String, String>,
    template_overrides: Option<&std::collections::BTreeMap<String, String>>,
) -> String {
    let mut defaults_xml = String::new();
    for (ext, mime) in defaults {
        defaults_xml.push_str(&format!(
            r#"<Default Extension="{}" ContentType="{}"/>"#,
            crate::escape_xml_attr(ext),
            crate::escape_xml_attr(mime)
        ));
    }
    let mut overrides_xml = String::new();
    if let Some(template_overrides) = template_overrides {
        for (part_name, content_type) in template_overrides {
            if matches!(
                part_name.as_str(),
                "/word/document.xml"
                    | "/word/styles.xml"
                    | "/word/numbering.xml"
                    | "/docProps/core.xml"
                    | "/docProps/app.xml"
            ) {
                continue;
            }
            overrides_xml.push_str(&format!(
                r#"<Override PartName="{}" ContentType="{}"/>"#,
                crate::escape_xml_attr(part_name),
                crate::escape_xml_attr(content_type)
            ));
        }
    }
    format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">"#,
            "{}",
            r#"<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>"#,
            r#"<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>"#,
            r#"<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>"#,
            r#"<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>"#,
            r#"<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>"#,
            "{}",
            r#"</Types>"#
        ),
        defaults_xml,
        overrides_xml
    )
}

pub(crate) fn build_root_relationships_xml() -> String {
    concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
        r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>"#,
        r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>"#,
        r#"<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>"#,
        r#"</Relationships>"#
    )
    .to_string()
}

pub(crate) fn build_core_props_xml(title: &str) -> String {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" "#,
            r#"xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" "#,
            r#"xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">"#,
            r#"<dc:title>{}</dc:title><dc:creator>HaoMD</dc:creator><cp:lastModifiedBy>HaoMD</cp:lastModifiedBy>"#,
            r#"<dcterms:created xsi:type="dcterms:W3CDTF">{}</dcterms:created>"#,
            r#"<dcterms:modified xsi:type="dcterms:W3CDTF">{}</dcterms:modified>"#,
            r#"</cp:coreProperties>"#
        ),
        crate::escape_xml_text(title),
        now,
        now
    )
}

pub(crate) fn build_app_props_xml() -> String {
    concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">"#,
        r#"<Application>HaoMD</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>"#,
        r#"<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Title</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>"#,
        r#"<TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Document</vt:lpstr></vt:vector></TitlesOfParts>"#,
        r#"<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion>"#,
        r#"</Properties>"#
    )
    .to_string()
}

pub(crate) fn build_word_styles_xml(settings: &WordExportStyleSettingsResolved) -> String {
    let body_font_rpr = render_word_font_family_xml(&settings.body_font_family);
    let heading_font_rpr = render_word_font_family_xml(&settings.heading_font_family);
    format!(
        concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">"#,
            r#"<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>"#,
            r#"<w:pPr><w:spacing w:after="{}" w:line="{}" w:lineRule="auto"/></w:pPr>"#,
            r#"<w:rPr>{}<w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr>{}<w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr>{}<w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr>{}<w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr>{}<w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr>{}<w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:rPr>{}<w:b/><w:sz w:val="{}"/></w:rPr></w:style>"#,
            r#"<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>"#,
            r#"</w:styles>"#
        ),
        settings.paragraph_spacing_after_twips,
        settings.line_spacing_twips,
        body_font_rpr,
        settings.body_font_size_half_points,
        heading_font_rpr.clone(),
        settings.heading1_size_half_points,
        heading_font_rpr.clone(),
        settings.heading2_size_half_points,
        heading_font_rpr.clone(),
        settings.heading3_size_half_points,
        heading_font_rpr.clone(),
        settings.heading3_size_half_points,
        heading_font_rpr.clone(),
        settings.heading3_size_half_points,
        heading_font_rpr,
        settings.heading3_size_half_points.saturating_sub(2),
    )
}

pub(crate) fn build_word_numbering_xml() -> String {
    concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">"#,
        r#"<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>"#,
        r#"<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>"#,
        r#"<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>"#,
        r#"<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>"#,
        r#"</w:abstractNum><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>"#
    )
    .to_string()
}

pub(crate) fn detect_asset_extension(
    mime: Option<&str>,
    source_path: Option<&Path>,
    file_name: Option<&str>,
) -> String {
    if let Some(name) = file_name {
        if let Some(ext) = Path::new(name).extension().and_then(|v| v.to_str()) {
            return ext.to_lowercase();
        }
    }
    if let Some(path) = source_path {
        if let Some(ext) = path.extension().and_then(|v| v.to_str()) {
            return ext.to_lowercase();
        }
    }
    match mime.unwrap_or("application/octet-stream") {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/x-emf" | "image/emf" => "emf",
        _ => "bin",
    }
    .to_string()
}

pub(crate) fn mime_for_extension(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "emf" => "image/x-emf",
        _ => "application/octet-stream",
    }
}

pub(crate) fn next_relationship_id(render_state: &mut WordRenderState) -> String {
    let id = format!("rId{}", render_state.next_rel_id);
    render_state.next_rel_id += 1;
    id
}
