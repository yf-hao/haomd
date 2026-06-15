use super::*;
use crate::editor_settings::clamp_image_to_long_edge;
use crate::word::render::{
    fit_image_to_page_width, mathml_to_omml, render_paragraph_xml,
    render_table_cell_properties_xml, render_table_properties_xml, render_text_run_xml,
    resolve_image_dimensions, RenderTextRunOptions,
};
use std::fs;
use std::io::Read;

fn unique_test_path(prefix: &str, ext: Option<&str>) -> std::path::PathBuf {
    let mut path =
        std::env::temp_dir().join(format!("{prefix}-{}", new_trace_id().replace("trace_", "")));
    if let Some(ext) = ext {
        path.set_extension(ext);
    }
    path
}

#[test]
fn should_build_minimal_docx_package() {
    let work_dir = unique_test_path("haomd-word-test", None);
    let output_path = unique_test_path("haomd-word-test", Some("docx"));

    let payload = WordDocPayloadCfg {
            title: "Sample".to_string(),
            blocks: vec![
                WordBlockCfg::Heading {
                    level: 1,
                    text: vec![WordInlineRunCfg::Text {
                        value: "Hello".to_string(),
                        bold: Some(true),
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Paragraph {
                    text: vec![WordInlineRunCfg::Text {
                        value: "World".to_string(),
                        bold: None,
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Image {
                    asset_id: "asset_0".to_string(),
                    alt: Some("tiny".to_string()),
                    width_px: Some(1),
                    height_px: Some(1),
                    width_percent: None,
                    max_width_percent: None,
                },
            ],
            assets: vec![WordAssetCfg::EmbeddedImage {
                id: "asset_0".to_string(),
                file_name: "tiny.png".to_string(),
                mime_type: "image/png".to_string(),
                base64_data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9WQAAAAASUVORK5CYII=".to_string(),
                width_px: Some(1),
                height_px: Some(1),
            }],
            style_settings: None,
        };

    build_word_export_workspace(&work_dir, &payload).expect("workspace should build");
    package_docx_workspace(&work_dir, &output_path).expect("docx package should build");

    let bytes = std::fs::read(&output_path).expect("docx should exist");
    assert!(
        bytes.starts_with(&[0x50, 0x4b]),
        "docx should be a zip package"
    );

    let _ = std::fs::remove_dir_all(&work_dir);
    let _ = std::fs::remove_file(&output_path);
}

#[test]
fn should_build_docx_package_with_chinese_text_and_embedded_image() {
    let work_dir = unique_test_path("haomd-word-zh-image", None);
    let output_path = unique_test_path("haomd-word-zh-image", Some("docx"));

    let payload = WordDocPayloadCfg {
            title: "论文导出示例".to_string(),
            blocks: vec![
                WordBlockCfg::Heading {
                    level: 1,
                    text: vec![WordInlineRunCfg::Text {
                        value: "第一章 绪论".to_string(),
                        bold: Some(true),
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Paragraph {
                    text: vec![WordInlineRunCfg::Text {
                        value: "这是一个用于 Windows CI 验证的中文段落。".to_string(),
                        bold: None,
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Image {
                    asset_id: "asset_cn_0".to_string(),
                    alt: Some("示意图".to_string()),
                    width_px: Some(1),
                    height_px: Some(1),
                    width_percent: None,
                    max_width_percent: None,
                },
            ],
            assets: vec![WordAssetCfg::EmbeddedImage {
                id: "asset_cn_0".to_string(),
                file_name: "figure.png".to_string(),
                mime_type: "image/png".to_string(),
                base64_data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9WQAAAAASUVORK5CYII=".to_string(),
                width_px: Some(1),
                height_px: Some(1),
            }],
            style_settings: None,
        };

    build_word_export_workspace(&work_dir, &payload).expect("workspace should build");
    package_docx_workspace(&work_dir, &output_path).expect("docx package should build");

    let bytes = std::fs::read(&output_path).expect("docx should exist");
    assert!(
        bytes.starts_with(&[0x50, 0x4b]),
        "docx should be a zip package"
    );

    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).expect("docx package should be readable as zip");

    let mut document_xml = String::new();
    archive
        .by_name("word/document.xml")
        .expect("document.xml should exist")
        .read_to_string(&mut document_xml)
        .expect("document.xml should be readable");
    assert!(document_xml.contains("第一章 绪论"));
    assert!(document_xml.contains("这是一个用于 Windows CI 验证的中文段落。"));

    let image_entry = archive
        .by_name("word/media/figure.png")
        .expect("embedded image should exist");
    assert!(image_entry.size() > 0, "embedded image should not be empty");

    let _ = std::fs::remove_dir_all(&work_dir);
    let _ = std::fs::remove_file(&output_path);
}

#[test]
fn should_generate_editable_word_xml_for_core_blocks() {
    let work_dir = unique_test_path("haomd-word-xml", None);
    let payload = WordDocPayloadCfg {
            title: "Regression".to_string(),
            blocks: vec![
                WordBlockCfg::Heading {
                    level: 2,
                    text: vec![WordInlineRunCfg::Text {
                        value: "Section".to_string(),
                        bold: None,
                        italic: None,
                        code: None,
                        strike: None,
                        underline: None,
                        color: None,
                        background_color: None,
                        font_size_pt: None,
                        font_family: None,
                    }],
                    style: None,
                },
                WordBlockCfg::Paragraph {
                    text: vec![
                        WordInlineRunCfg::Text {
                            value: "Visit ".to_string(),
                            bold: None,
                            italic: None,
                            code: None,
                            strike: None,
                            underline: None,
                            color: None,
                            background_color: None,
                            font_size_pt: None,
                            font_family: None,
                        },
                        WordInlineRunCfg::Link {
                            value: "OpenAI".to_string(),
                            href: "https://openai.com".to_string(),
                        },
                    ],
                    style: None,
                },
                WordBlockCfg::List {
                    ordered: false,
                    items: vec![vec![WordBlockCfg::Paragraph {
                        text: vec![WordInlineRunCfg::Text {
                            value: "Item one".to_string(),
                            bold: None,
                            italic: None,
                            code: None,
                            strike: None,
                            underline: None,
                            color: None,
                            background_color: None,
                            font_size_pt: None,
                            font_family: None,
                        }],
                        style: None,
                    }]],
                },
                WordBlockCfg::Table {
                    style: Some(WordTableStyleCfg {
                        align: Some("center".to_string()),
                        border_color: None,
                        width_percent: Some(80.0),
                        width_px: None,
                        max_width_percent: Some(90.0),
                        layout: Some("fixed".to_string()),
                        column_widths: Some(vec![
                            WordTableColumnWidthCfg {
                                width_percent: Some(30.0),
                                width_px: None,
                            },
                            WordTableColumnWidthCfg {
                                width_percent: Some(70.0),
                                width_px: None,
                            },
                        ]),
                    }),
                    rows: vec![
                        WordTableRowCfg {
                            cells: vec![
                                WordTableCellCfg {
                                    blocks: vec![WordBlockCfg::Paragraph {
                                        text: vec![WordInlineRunCfg::Text {
                                            value: "Name".to_string(),
                                            bold: None,
                                            italic: None,
                                            code: None,
                                            strike: None,
                                            underline: None,
                                            color: None,
                                            background_color: None,
                                            font_size_pt: None,
                                            font_family: None,
                                        }],
                                        style: None,
                                    }],
                                    style: Some(WordTableCellStyleCfg {
                                        background_color: Some("E0F2FE".to_string()),
                                        align: Some("center".to_string()),
                                        border_color: None,
                                        border_top_color: Some("D1D5DB".to_string()),
                                        border_right_color: Some("111827".to_string()),
                                        border_bottom_color: Some("9CA3AF".to_string()),
                                        border_left_color: Some("2563EB".to_string()),
                                    }),
                                    col_span: Some(2),
                                    row_span: None,
                                    merge_continue: None,
                                },
                            ],
                        },
                        WordTableRowCfg {
                            cells: vec![
                                WordTableCellCfg {
                                    blocks: vec![WordBlockCfg::Paragraph {
                                        text: vec![WordInlineRunCfg::Text {
                                            value: "HTML".to_string(),
                                            bold: None,
                                            italic: None,
                                            code: None,
                                            strike: None,
                                            underline: None,
                                            color: None,
                                            background_color: None,
                                            font_size_pt: None,
                                            font_family: None,
                                        }],
                                        style: None,
                                    }],
                                    style: None,
                                    col_span: None,
                                    row_span: None,
                                    merge_continue: None,
                                },
                                WordTableCellCfg {
                                    blocks: vec![WordBlockCfg::Paragraph {
                                        text: vec![WordInlineRunCfg::Text {
                                            value: "Value".to_string(),
                                            bold: None,
                                            italic: None,
                                            code: None,
                                            strike: None,
                                            underline: None,
                                            color: None,
                                            background_color: None,
                                            font_size_pt: None,
                                            font_family: None,
                                        }],
                                        style: None,
                                    }],
                                    style: None,
                                    col_span: None,
                                    row_span: None,
                                    merge_continue: None,
                                },
                            ],
                        },
                    ],
                },
                WordBlockCfg::Image {
                    asset_id: "asset_0".to_string(),
                    alt: Some("tiny".to_string()),
                    width_px: Some(1),
                    height_px: Some(1),
                    width_percent: None,
                    max_width_percent: None,
                },
            ],
            assets: vec![WordAssetCfg::EmbeddedImage {
                id: "asset_0".to_string(),
                file_name: "tiny.png".to_string(),
                mime_type: "image/png".to_string(),
                base64_data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9l9WQAAAAASUVORK5CYII=".to_string(),
                width_px: Some(1),
                height_px: Some(1),
            }],
            style_settings: None,
        };

    build_word_export_workspace(&work_dir, &payload).expect("workspace should build");

    let document_xml = fs::read_to_string(work_dir.join("word").join("document.xml"))
        .expect("document xml should exist");
    let rels_xml = fs::read_to_string(
        work_dir
            .join("word")
            .join("_rels")
            .join("document.xml.rels"),
    )
    .expect("relationships xml should exist");

    assert!(document_xml.contains(r#"<w:pStyle w:val="Heading2"/>"#));
    assert!(document_xml.contains(r#"<w:hyperlink r:id=""#));
    assert!(document_xml.contains(r#"<w:numId w:val="1"/>"#));
    assert!(document_xml.contains("<w:tbl>"));
    assert!(document_xml.contains(r#"<w:gridSpan w:val="2"/>"#));
    assert!(document_xml.contains(r#"<w:tblW w:w="4000" w:type="pct"/>"#));
    assert!(document_xml.contains(r#"<w:tblLayout w:type="fixed"/>"#));
    assert!(document_xml
        .contains(r#"<w:tblGrid><w:gridCol w:w="2166"/><w:gridCol w:w="5055"/></w:tblGrid>"#));
    assert!(document_xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="E0F2FE"/>"#));
    assert!(
        document_xml.contains(r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="D1D5DB"/>"#)
    );
    assert!(
        document_xml.contains(r#"<w:right w:val="single" w:sz="4" w:space="0" w:color="111827"/>"#)
    );
    assert!(document_xml
        .contains(r#"<w:bottom w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/>"#));
    assert!(
        document_xml.contains(r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="2563EB"/>"#)
    );
    assert!(document_xml.contains(r#"<w:jc w:val="center"/>"#));
    assert!(document_xml.contains("Item one"));
    assert!(document_xml.contains("OpenAI"));
    assert!(document_xml.contains("tiny"));

    assert!(rels_xml.contains(
        r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink""#,
    ));
    assert!(rels_xml.contains(
        r#"Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image""#,
    ));

    let _ = std::fs::remove_dir_all(&work_dir);
}

#[test]
fn should_reject_remote_images_for_word_export() {
    let work_dir = unique_test_path("haomd-word-remote", None);
    let payload = WordDocPayloadCfg {
        title: "Remote".to_string(),
        blocks: vec![WordBlockCfg::Image {
            asset_id: "asset_0".to_string(),
            alt: Some("remote".to_string()),
            width_px: None,
            height_px: None,
            width_percent: None,
            max_width_percent: None,
        }],
        assets: vec![WordAssetCfg::Image {
            id: "asset_0".to_string(),
            source_path: "https://example.com/remote.png".to_string(),
            mime_type: Some("image/png".to_string()),
            width_px: Some(10),
            height_px: Some(10),
        }],
        style_settings: None,
    };

    let error =
        build_word_export_workspace(&work_dir, &payload).expect_err("remote image should fail");
    assert!(error.contains("暂不支持远程图片"));

    let _ = std::fs::remove_dir_all(&work_dir);
}

#[test]
fn should_scale_large_images_to_fit_page_width() {
    let (width, height) = fit_image_to_page_width(2000, 1000, 0, None, 1440);
    assert_eq!(width, 553);
    assert_eq!(height, 276);

    let (nested_width, nested_height) = fit_image_to_page_width(2000, 1000, 1, Some(1), 1440);
    assert!(nested_width < width);
    assert!(nested_height < height);
}

#[test]
fn should_clamp_editor_background_to_1080_long_edge() {
    let (landscape_w, landscape_h) = clamp_image_to_long_edge(4000, 2000, 1080);
    assert_eq!(landscape_w, 1080);
    assert_eq!(landscape_h, 540);

    let (portrait_w, portrait_h) = clamp_image_to_long_edge(1200, 2400, 1080);
    assert_eq!(portrait_w, 540);
    assert_eq!(portrait_h, 1080);

    let (small_w, small_h) = clamp_image_to_long_edge(900, 600, 1080);
    assert_eq!(small_w, 900);
    assert_eq!(small_h, 600);
}

#[test]
fn should_only_cleanup_managed_editor_background_files() {
    let backgrounds_dir = std::env::temp_dir().join(format!(
        "haomd-editor-backgrounds-{}",
        new_trace_id().replace("trace_", "")
    ));
    let managed = backgrounds_dir.join("old.png");
    let next = backgrounds_dir.join("new.png");
    let external = std::env::temp_dir().join(format!(
        "haomd-external-bg-{}.png",
        new_trace_id().replace("trace_", "")
    ));

    fs::create_dir_all(&backgrounds_dir).expect("background dir");
    fs::write(&managed, b"old").expect("managed");
    fs::write(&next, b"new").expect("next");
    fs::write(&external, b"external").expect("external");

    assert!(should_cleanup_managed_editor_background(
        &backgrounds_dir,
        &managed,
        &next
    ));
    assert!(!should_cleanup_managed_editor_background(
        &backgrounds_dir,
        &external,
        &next
    ));
    assert!(!should_cleanup_managed_editor_background(
        &backgrounds_dir,
        &next,
        &next
    ));

    let _ = fs::remove_dir_all(&backgrounds_dir);
    let _ = fs::remove_file(&external);
}

#[test]
fn should_resolve_percentage_based_image_widths() {
    let (width, height) = resolve_image_dimensions(2000, 1000, Some(50.0), None, 0, None, 1440);
    assert_eq!(width, 277);
    assert_eq!(height, 138);

    let (clamped_width, clamped_height) =
        resolve_image_dimensions(2000, 1000, None, Some(40.0), 0, None, 1440);
    assert_eq!(clamped_width, 221);
    assert_eq!(clamped_height, 110);
}

#[test]
fn should_render_rowspan_as_vertical_merge() {
    let tc_start = render_table_cell_properties_xml(None, None, Some(2), None);
    let tc_continue = render_table_cell_properties_xml(None, None, None, Some(true));

    assert!(tc_start.contains(r#"<w:vMerge w:val="restart"/>"#));
    assert!(tc_continue.contains(r#"<w:vMerge/>"#));
}

#[test]
fn should_render_table_layout_modes() {
    let (fixed_xml, _) = render_table_properties_xml(
        Some(&WordTableStyleCfg {
            align: None,
            border_color: None,
            width_percent: None,
            width_px: None,
            max_width_percent: None,
            layout: Some("fixed".to_string()),
            column_widths: None,
        }),
        1440,
    );
    let (auto_xml, _) = render_table_properties_xml(
        Some(&WordTableStyleCfg {
            align: None,
            border_color: None,
            width_percent: None,
            width_px: None,
            max_width_percent: None,
            layout: Some("auto".to_string()),
            column_widths: None,
        }),
        1440,
    );

    assert!(fixed_xml.contains(r#"<w:tblLayout w:type="fixed"/>"#));
    assert!(auto_xml.contains(r#"<w:tblLayout w:type="autofit"/>"#));
}

#[test]
fn should_include_math_content_in_document_xml() {
    let work_dir = unique_test_path("haomd-word-math", None);
    let payload = WordDocPayloadCfg {
            title: "Math".to_string(),
            blocks: vec![
                WordBlockCfg::Paragraph {
                    text: vec![
                        WordInlineRunCfg::Text {
                            value: "Energy: ".to_string(),
                            bold: None,
                            italic: None,
                            code: None,
                            strike: None,
                            underline: None,
                            color: None,
                            background_color: None,
                            font_size_pt: None,
                            font_family: None,
                        },
                        WordInlineRunCfg::Math {
                            value: "E = mc^2".to_string(),
                            math_ml: Some("<math xmlns=\"http://www.w3.org/1998/Math/MathML\"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow></semantics></math>".to_string()),
                        },
                    ],
                    style: None,
                },
                WordBlockCfg::Math {
                    content: "\\frac{a}{b}".to_string(),
                    math_ml: Some("<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><semantics><mrow><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><msup><mi>x</mi><mi>i</mi></msup><mo>+</mo><mfrac><mi>a</mi><mi>b</mi></mfrac></mrow></semantics></math>".to_string()),
                },
            ],
            assets: vec![],
            style_settings: None,
        };

    build_word_export_workspace(&work_dir, &payload).expect("workspace should build");
    let document_xml = fs::read_to_string(work_dir.join("word").join("document.xml"))
        .expect("document xml should exist");

    assert!(document_xml.contains("<m:oMath>"));
    assert!(document_xml.contains("<m:sSup>"));
    assert!(document_xml.contains("<m:nary>"));
    assert!(document_xml.contains("<m:f>"));
    assert!(document_xml.contains("E"));
    assert!(document_xml.contains("∑"));
    assert!(document_xml.contains(r#"<m:e><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>i</m:t></m:r></m:sup></m:sSup>"#));
    assert!(document_xml.contains(r#"<w:jc w:val="left"/>"#));

    let _ = std::fs::remove_dir_all(&work_dir);
}

#[test]
fn should_convert_mathml_alignment_table_to_word_matrix() {
    let math_ml = "<math xmlns=\"http://www.w3.org/1998/Math/MathML\" display=\"block\"><semantics><mtable rowspacing=\"0.25em\" columnalign=\"right left\" columnspacing=\"0em\"><mtr><mtd></mtd><mtd><mstyle scriptlevel=\"0\" displaystyle=\"true\"><mi>a</mi></mstyle></mtd><mtd><mstyle scriptlevel=\"0\" displaystyle=\"true\"><mrow><mrow></mrow><mo>=</mo><mi>b</mi><mo>+</mo><mi>c</mi></mrow></mstyle></mtd><mtd></mtd><mtd></mtd></mtr><mtr><mtd></mtd><mtd><mstyle scriptlevel=\"0\" displaystyle=\"true\"><mrow><mi>d</mi><mo>+</mo><mi>e</mi></mrow></mstyle></mtd><mtd><mstyle scriptlevel=\"0\" displaystyle=\"true\"><mrow><mrow></mrow><mo>=</mo><mi>f</mi></mrow></mstyle></mtd><mtd></mtd><mtd></mtd></mtr></mtable></semantics></math>";

    let omml = mathml_to_omml(math_ml).expect("mtable mathml should convert");

    assert!(omml.contains("<m:m>"));
    assert!(omml.contains(r#"<m:mcJc m:val="right"/>"#));
    assert!(omml.contains(r#"<m:mcJc m:val="left"/>"#));
    assert_eq!(omml.matches("<m:mr>").count(), 2);
    assert_eq!(omml.matches("<m:e>").count(), 4);
    assert!(omml.contains("<m:t>a</m:t>"));
    assert!(omml.contains("<m:t>=</m:t>"));
    assert!(omml.contains("<m:t>d</m:t>"));
    assert!(omml.contains("<m:t>f</m:t>"));
}

#[test]
fn should_convert_parenthesized_mathml_table_to_word_delimiter_matrix() {
    let math_ml = concat!(
        r#"<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics>"#,
        r#"<mrow><mi>A</mi><mo>=</mo><mrow><mo>(</mo>"#,
        r#"<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>0</mn></mtd></mtr>"#,
        r#"<mtr><mtd><mn>0</mn></mtd><mtd><mn>1</mn></mtd></mtr></mtable>"#,
        r#"<mo>)</mo></mrow></mrow>"#,
        r#"</semantics></math>"#
    );

    let omml = mathml_to_omml(math_ml).expect("parenthesized mtable should convert");

    assert!(omml.contains("<m:d>"));
    assert!(omml.contains(r#"<m:begChr m:val="("/>"#));
    assert!(omml.contains(r#"<m:endChr m:val=")"/>"#));
    assert!(omml.contains(r#"<m:grow m:val="1"/>"#));
    assert!(omml.contains("<m:m>"));
    assert!(omml.contains("<m:t>A</m:t>"));
    assert!(omml.contains("<m:t>=</m:t>"));
}

#[test]
fn should_apply_custom_word_style_settings_to_styles_and_layout() {
    let work_dir = unique_test_path("haomd-word-style", None);
    let payload = WordDocPayloadCfg {
        title: "Styled".to_string(),
        blocks: vec![
            WordBlockCfg::Heading {
                level: 1,
                text: vec![WordInlineRunCfg::Text {
                    value: "Heading".to_string(),
                    bold: None,
                    italic: None,
                    code: None,
                    strike: None,
                    underline: None,
                    color: None,
                    background_color: None,
                    font_size_pt: None,
                    font_family: None,
                }],
                style: None,
            },
            WordBlockCfg::Paragraph {
                text: vec![WordInlineRunCfg::Text {
                    value: "Body".to_string(),
                    bold: None,
                    italic: None,
                    code: None,
                    strike: None,
                    underline: None,
                    color: None,
                    background_color: None,
                    font_size_pt: None,
                    font_family: None,
                }],
                style: None,
            },
            WordBlockCfg::Code {
                language: Some("ts".to_string()),
                content: "const value = 1;".to_string(),
            },
        ],
        assets: vec![],
        style_settings: Some(WordExportStyleSettingsCfg {
            body_font_family: Some("Calibri".to_string()),
            body_font_size_pt: Some(11.0),
            heading_font_family: Some("Times New Roman".to_string()),
            heading1_size_pt: Some(20.0),
            heading2_size_pt: Some(18.0),
            heading3_size_pt: Some(16.0),
            paragraph_spacing_after_pt: Some(12.0),
            line_spacing: Some(1.5),
            code_font_size_pt: Some(9.0),
            page_margin_cm: Some(3.0),
            enable_inkscape_for_word_export: Some(false),
            mermaid_export_format: Some("png".to_string()),
            inkscape_fallback: Some("png".to_string()),
            selected_word_template_id: None,
        }),
    };

    build_word_export_workspace(&work_dir, &payload).expect("workspace should build");

    let styles_xml =
        fs::read_to_string(work_dir.join("word").join("styles.xml")).expect("styles xml");
    let document_xml = fs::read_to_string(work_dir.join("word").join("document.xml"))
        .expect("document xml should exist");

    assert!(styles_xml.contains(
        r#"<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/>"#
    ));
    assert!(styles_xml.contains(r#"<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:b/><w:sz w:val="40"/>"#));
    assert!(styles_xml.contains(r#"<w:spacing w:after="240" w:line="360" w:lineRule="auto"/>"#));
    assert!(document_xml
        .contains(r#"<w:pgMar w:top="1701" w:right="1701" w:bottom="1701" w:left="1701""#));
    assert!(document_xml
        .contains(r#"<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo" w:cs="Menlo"/><w:sz w:val="18"/>"#));

    let _ = std::fs::remove_dir_all(&work_dir);
}

#[test]
fn should_render_text_run_color_and_underline_styles() {
    let run_xml = render_text_run_xml(RenderTextRunOptions {
        value: "Styled",
        bold: false,
        italic: false,
        code: false,
        strike: false,
        underline: true,
        color: Some("1D4ED8"),
        background_color: Some("FFF59D"),
        font_size_pt: Some(13.5),
        font_family: Some("Microsoft YaHei"),
        code_font_size_half_points: 21,
    });

    assert!(run_xml.contains(r#"<w:u w:val="single"/>"#));
    assert!(run_xml.contains(r#"<w:color w:val="1D4ED8"/>"#));
    assert!(run_xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="FFF59D"/>"#));
    assert!(run_xml.contains(
        r#"<w:rFonts w:ascii="Microsoft YaHei" w:hAnsi="Microsoft YaHei" w:cs="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/>"#
    ));
    assert!(run_xml.contains(r#"<w:sz w:val="27"/>"#));
    assert!(run_xml.contains("Styled"));
}

#[test]
fn should_normalize_songti_font_to_word_cjk_font() {
    let run_xml = render_text_run_xml(RenderTextRunOptions {
        value: "中文",
        bold: false,
        italic: false,
        code: false,
        strike: false,
        underline: false,
        color: None,
        background_color: None,
        font_size_pt: Some(12.0),
        font_family: Some("songti"),
        code_font_size_half_points: 21,
    });

    assert!(run_xml.contains(
        r#"<w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:cs="宋体" w:eastAsia="宋体"/>"#
    ));
}

#[test]
fn should_render_paragraph_alignment_and_spacing_styles() {
    let paragraph_xml = render_paragraph_xml(
        "<w:r><w:t>Styled paragraph</w:t></w:r>".to_string(),
        None,
        Some(&WordParagraphStyleCfg {
            align: Some("center".to_string()),
            line_height: Some(1.5),
            spacing_after_pt: Some(12.0),
            background_color: Some("FFF59D".to_string()),
            border_color: None,
            border_top_color: Some("111827".to_string()),
            border_right_color: None,
            border_bottom_color: None,
            border_left_color: Some("EF4444".to_string()),
        }),
        0,
        None,
        false,
        false,
    );

    assert!(paragraph_xml.contains(r#"<w:jc w:val="center"/>"#));
    assert!(paragraph_xml.contains(r#"<w:spacing w:after="240" w:line="360" w:lineRule="auto"/>"#));
    assert!(paragraph_xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="FFF59D"/>"#));
    assert!(paragraph_xml.contains(r#"<w:pBdr>"#));
    assert!(
        paragraph_xml.contains(r#"<w:top w:val="single" w:sz="4" w:space="0" w:color="111827"/>"#)
    );
    assert!(
        paragraph_xml.contains(r#"<w:left w:val="single" w:sz="4" w:space="0" w:color="EF4444"/>"#)
    );
}
