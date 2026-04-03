use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordDocPayloadCfg {
    pub(crate) title: String,
    pub(crate) blocks: Vec<WordBlockCfg>,
    pub(crate) assets: Vec<WordAssetCfg>,
    #[serde(default)]
    #[serde(rename = "styleSettings")]
    pub(crate) style_settings: Option<WordExportStyleSettingsCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTemplateFillBindingCfg {
    pub(crate) field: String,
    pub(crate) placeholder: String,
    #[serde(rename = "type")]
    pub(crate) binding_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTemplateConfigCfg {
    pub(crate) template_id: String,
    pub(crate) name: Option<String>,
    pub(crate) bindings: Vec<WordTemplateFillBindingCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum WordBlockCfg {
    Heading {
        level: u8,
        text: Vec<WordInlineRunCfg>,
        #[serde(default)]
        style: Option<WordParagraphStyleCfg>,
    },
    Paragraph {
        text: Vec<WordInlineRunCfg>,
        #[serde(default)]
        style: Option<WordParagraphStyleCfg>,
    },
    Blockquote {
        children: Vec<WordBlockCfg>,
    },
    Math {
        content: String,
        #[serde(default)]
        #[serde(rename = "mathMl")]
        math_ml: Option<String>,
    },
    Code {
        language: Option<String>,
        content: String,
    },
    List {
        ordered: bool,
        items: Vec<Vec<WordBlockCfg>>,
    },
    Table {
        rows: Vec<WordTableRowCfg>,
        #[serde(default)]
        style: Option<WordTableStyleCfg>,
    },
    Image {
        #[serde(rename = "assetId")]
        asset_id: String,
        alt: Option<String>,
        #[serde(rename = "widthPx")]
        width_px: Option<u32>,
        #[serde(rename = "heightPx")]
        height_px: Option<u32>,
        #[serde(default)]
        #[serde(rename = "widthPercent")]
        width_percent: Option<f32>,
        #[serde(default)]
        #[serde(rename = "maxWidthPercent")]
        max_width_percent: Option<f32>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordParagraphStyleCfg {
    #[serde(default)]
    pub(crate) align: Option<String>,
    #[serde(default)]
    pub(crate) line_height: Option<f32>,
    #[serde(default)]
    pub(crate) spacing_after_pt: Option<f32>,
    #[serde(default)]
    pub(crate) background_color: Option<String>,
    #[serde(default)]
    pub(crate) border_color: Option<String>,
    #[serde(default)]
    pub(crate) border_top_color: Option<String>,
    #[serde(default)]
    pub(crate) border_right_color: Option<String>,
    #[serde(default)]
    pub(crate) border_bottom_color: Option<String>,
    #[serde(default)]
    pub(crate) border_left_color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTableRowCfg {
    pub(crate) cells: Vec<WordTableCellCfg>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTableStyleCfg {
    #[serde(default)]
    pub(crate) align: Option<String>,
    #[serde(default)]
    pub(crate) width_percent: Option<f32>,
    #[serde(default)]
    pub(crate) width_px: Option<u32>,
    #[serde(default)]
    pub(crate) max_width_percent: Option<f32>,
    #[serde(default)]
    pub(crate) layout: Option<String>,
    #[serde(default)]
    pub(crate) column_widths: Option<Vec<WordTableColumnWidthCfg>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTableColumnWidthCfg {
    #[serde(default)]
    pub(crate) width_percent: Option<f32>,
    #[serde(default)]
    pub(crate) width_px: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTableCellStyleCfg {
    #[serde(default)]
    pub(crate) background_color: Option<String>,
    #[serde(default)]
    pub(crate) align: Option<String>,
    #[serde(default)]
    pub(crate) border_color: Option<String>,
    #[serde(default)]
    pub(crate) border_top_color: Option<String>,
    #[serde(default)]
    pub(crate) border_right_color: Option<String>,
    #[serde(default)]
    pub(crate) border_bottom_color: Option<String>,
    #[serde(default)]
    pub(crate) border_left_color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordTableCellCfg {
    pub(crate) blocks: Vec<WordBlockCfg>,
    #[serde(default)]
    pub(crate) style: Option<WordTableCellStyleCfg>,
    #[serde(default)]
    #[serde(rename = "colSpan")]
    pub(crate) col_span: Option<u32>,
    #[serde(default)]
    #[serde(rename = "rowSpan")]
    pub(crate) row_span: Option<u32>,
    #[serde(default)]
    #[serde(rename = "mergeContinue")]
    pub(crate) merge_continue: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum WordInlineRunCfg {
    Text {
        value: String,
        #[serde(default)]
        bold: Option<bool>,
        #[serde(default)]
        italic: Option<bool>,
        #[serde(default)]
        code: Option<bool>,
        #[serde(default)]
        strike: Option<bool>,
        #[serde(default)]
        underline: Option<bool>,
        #[serde(default)]
        color: Option<String>,
        #[serde(default)]
        background_color: Option<String>,
        #[serde(default)]
        font_size_pt: Option<f32>,
        #[serde(default)]
        font_family: Option<String>,
    },
    Math {
        value: String,
        #[serde(default)]
        #[serde(rename = "mathMl")]
        math_ml: Option<String>,
    },
    Link {
        value: String,
        href: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum WordAssetCfg {
    Image {
        id: String,
        #[serde(rename = "sourcePath")]
        source_path: String,
        #[serde(default)]
        #[serde(rename = "mimeType")]
        mime_type: Option<String>,
        #[serde(default)]
        #[serde(rename = "widthPx")]
        width_px: Option<u32>,
        #[serde(default)]
        #[serde(rename = "heightPx")]
        height_px: Option<u32>,
    },
    EmbeddedImage {
        id: String,
        #[serde(rename = "fileName")]
        file_name: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(rename = "base64Data")]
        base64_data: String,
        #[serde(default)]
        #[serde(rename = "widthPx")]
        width_px: Option<u32>,
        #[serde(default)]
        #[serde(rename = "heightPx")]
        height_px: Option<u32>,
    },
}

#[derive(Debug, Clone)]
pub(crate) struct WordAssetRuntime {
    pub(crate) rel_id: String,
    pub(crate) target: String,
    pub(crate) width_px: u32,
    pub(crate) height_px: u32,
}

#[derive(Debug, Clone)]
pub(crate) struct WordExportStyleSettingsResolved {
    pub(crate) body_font_family: String,
    pub(crate) body_font_size_half_points: u32,
    pub(crate) heading_font_family: String,
    pub(crate) heading1_size_half_points: u32,
    pub(crate) heading2_size_half_points: u32,
    pub(crate) heading3_size_half_points: u32,
    pub(crate) paragraph_spacing_after_twips: u32,
    pub(crate) line_spacing_twips: u32,
    pub(crate) code_font_size_half_points: u32,
    pub(crate) page_margin_twips: u32,
}

#[derive(Debug)]
pub(crate) struct WordRenderState {
    pub(crate) next_rel_id: u32,
    pub(crate) next_doc_pr_id: u32,
    pub(crate) image_assets: HashMap<String, WordAssetRuntime>,
    pub(crate) hyperlinks: Vec<(String, String)>,
    pub(crate) style_settings: WordExportStyleSettingsResolved,
}

impl Default for WordRenderState {
    fn default() -> Self {
        Self {
            next_rel_id: 0,
            next_doc_pr_id: 0,
            image_assets: HashMap::new(),
            hyperlinks: Vec::new(),
            style_settings: crate::resolve_word_export_style_settings(None),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WordExportStyleSettingsCfg {
    #[serde(default)]
    pub(crate) body_font_family: Option<String>,
    #[serde(default)]
    pub(crate) body_font_size_pt: Option<f32>,
    #[serde(default)]
    pub(crate) heading_font_family: Option<String>,
    #[serde(default)]
    pub(crate) heading1_size_pt: Option<f32>,
    #[serde(default)]
    pub(crate) heading2_size_pt: Option<f32>,
    #[serde(default)]
    pub(crate) heading3_size_pt: Option<f32>,
    #[serde(default)]
    pub(crate) paragraph_spacing_after_pt: Option<f32>,
    #[serde(default)]
    pub(crate) line_spacing: Option<f32>,
    #[serde(default)]
    pub(crate) code_font_size_pt: Option<f32>,
    #[serde(default)]
    pub(crate) page_margin_cm: Option<f32>,
    #[serde(default)]
    pub(crate) enable_inkscape_for_word_export: Option<bool>,
    #[serde(default)]
    pub(crate) mermaid_export_format: Option<String>,
    #[serde(default)]
    pub(crate) inkscape_fallback: Option<String>,
    #[serde(default)]
    pub(crate) selected_word_template_id: Option<String>,
}
