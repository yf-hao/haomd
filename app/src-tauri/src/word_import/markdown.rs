use super::types::{
    ImportedWordBlock, ImportedWordInline, ImportedWordParagraph, ImportedWordParagraphKind,
    ImportedWordTable, ImportedWordTextRun,
};

pub fn render_markdown(blocks: &[ImportedWordBlock]) -> String {
    let mut parts: Vec<String> = Vec::new();

    for block in blocks {
        match block {
            ImportedWordBlock::Paragraph(paragraph) => {
                let rendered = render_paragraph(paragraph);
                if rendered.trim().is_empty() {
                    continue;
                }
                parts.push(rendered);
            }
            ImportedWordBlock::Table(table) => {
                let rendered = render_table(table);
                if rendered.trim().is_empty() {
                    continue;
                }
                parts.push(rendered);
            }
        }
    }

    let mut markdown = parts.join("\n\n");
    if !markdown.ends_with('\n') {
        markdown.push('\n');
    }
    markdown
}

fn render_paragraph(paragraph: &ImportedWordParagraph) -> String {
    let content = render_inlines(&paragraph.inlines);
    match paragraph.kind {
        ImportedWordParagraphKind::Normal => content,
        ImportedWordParagraphKind::Heading(level) => {
            let safe_level = level.clamp(1, 6) as usize;
            format!("{} {}", "#".repeat(safe_level), content.trim())
        }
        ImportedWordParagraphKind::Quote => {
            if content.is_empty() {
                String::new()
            } else {
                content
                    .lines()
                    .map(|line| format!("> {}", line))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        ImportedWordParagraphKind::ListItem { ordered, level } => {
            let indent = "  ".repeat(level);
            let marker = if ordered { "1. " } else { "- " };
            format!("{indent}{marker}{}", content.trim())
        }
    }
}

fn render_inlines(inlines: &[ImportedWordInline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline {
            ImportedWordInline::Text(run) => out.push_str(&render_text_run(run)),
            ImportedWordInline::Link { text, url } => {
                if text.trim().is_empty() {
                    out.push_str(url);
                } else {
                    out.push_str(&format!("[{}]({})", text, url));
                }
            }
            ImportedWordInline::Image { file_name } => {
                if !out.ends_with('\n') && !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(&format!("![](images/{file_name})"));
            }
        }
    }
    out
}

fn render_text_run(run: &ImportedWordTextRun) -> String {
    let mut text = run.text.clone();
    if text.is_empty() {
        return text;
    }

    if run.bold && run.italic {
        text = format!("***{}***", text);
    } else if run.bold {
        text = format!("**{}**", text);
    } else if run.italic {
        text = format!("*{}*", text);
    }

    if run.strike {
        text = format!("~~{}~~", text);
    }

    text
}

fn render_table(table: &ImportedWordTable) -> String {
    if table.rows.is_empty() {
        return String::new();
    }

    let max_cols = table.rows.iter().map(|row| row.len()).max().unwrap_or(0);
    if max_cols == 0 {
        return String::new();
    }

    let header = pad_row(&table.rows[0], max_cols);
    let separator = vec!["---".to_string(); max_cols];
    let body_rows = if table.rows.len() > 1 {
        table.rows[1..]
            .iter()
            .map(|row| pad_row(row, max_cols))
            .collect::<Vec<_>>()
    } else {
        vec![vec![String::new(); max_cols]]
    };

    let mut lines = Vec::with_capacity(body_rows.len() + 2);
    lines.push(format!("| {} |", header.join(" | ")));
    lines.push(format!("| {} |", separator.join(" | ")));
    for row in body_rows {
        lines.push(format!("| {} |", row.join(" | ")));
    }
    lines.join("\n")
}

fn pad_row(row: &[String], width: usize) -> Vec<String> {
    let mut cells = row
        .iter()
        .map(|cell| cell.replace('\n', "<br>").trim().to_string())
        .collect::<Vec<_>>();
    while cells.len() < width {
        cells.push(String::new());
    }
    cells
}
