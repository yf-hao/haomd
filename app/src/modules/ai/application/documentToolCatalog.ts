export function buildDocumentToolCatalogPrompt(): string {
  return (
    '\n\n当前可用文档保存/导出工具。\n' +
    '当用户明确要求保存当前文档、导出当前文档、保存为 md、保存为 word/docx、保存为 html 时，应优先考虑 save_or_export_current_document，而不是只给文字说明。\n' +
    '参数规则：format 当前支持 md、word、html。\n' +
    'target=current_file_dir 表示保存到当前文件所在目录。\n' +
    'target=workspace_directory 表示保存到文件浏览器挂载目录树中的某个目录，此时必须提供 targetDirectory，例如“网络笔记”或“离散数学/教案”。\n' +
    '如果用户明确指定了文件名，例如“保存为 demo.md”“导出为 教案.docx”，应填写 fileName。fileName 只能是文件名，不能包含目录。\n' +
    '如果用户只说“保存文档”，默认 format=md；如果用户明确说“保存为 word/docx”，使用 format=word；如果明确说“保存为 html”，使用 format=html。\n' +
    '如果用户说“保存到某个目录”，且该目录明显是文件浏览器中的课程目录/子目录，应使用 target=workspace_directory，而不是 current_file_dir。\n' +
    '示例映射：\n' +
    '- “保存文档” -> format=md, target=current_file_dir\n' +
    '- “保存为word” -> format=word, target=current_file_dir\n' +
    '- “保存为 demo.md” -> format=md, target=current_file_dir, fileName=demo.md\n' +
    '- “保存word到离散数学” -> format=word, target=workspace_directory, targetDirectory=离散数学\n' +
    '- “保存html到离散数学/教案” -> format=html, target=workspace_directory, targetDirectory=离散数学/教案'
  )
}
