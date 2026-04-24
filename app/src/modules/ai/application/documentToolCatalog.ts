export function buildDocumentToolCatalogPrompt(): string {
  return (
    '\n\n当前可用文档保存/导出工具。\n' +
    '当用户明确要求保存当前文档、导出当前文档、保存为 md、保存为 word/docx、保存为 html 时，应优先考虑 save_or_export_current_document，而不是只给文字说明。\n' +
    '当用户明确要求“删除”“删除当前文档”“把当前文档删掉”时，应使用 delete_current_document。删除必须先确认，不能直接删除。\n' +
    '当用户明确要求“删除文件夹”“删除当前文件夹”时，应使用 delete_current_folder。仅删除当前文件浏览器已选中的文件夹，且必须先确认。\n' +
    '当用户明确要求“删除 temp 下的 demo 文件夹”“删除 temp 下的 hello.md”这类在当前工作区内按名称删除目标时，应使用 delete_workspace_entry。删除必须先确认，不能直接删除。\n' +
    '当用户明确要求“重命名为 demo”“把当前文档重命名为 demo”时，应使用 rename_current_document。重命名仅修改当前文档文件名，不修改目录。\n' +
    '当用户明确要求“把 temp 下的 hello.md 重命名为 hi.md”“把 temp 下的 demo 文件夹改名为 demo2”时，应使用 rename_workspace_entry。\n' +
    '当用户明确要求“创建 demo 目录”“创建 demo 文件夹”时，应使用 create_directory_under_selection。当前选中目录时，在该目录下创建；当前选中文件时，在同级目录创建。\n' +
    '当用户明确要求“在 temp 下创建 demo 目录”“在离散数学下创建教案文件夹”时，应使用 create_directory_in_workspace。\n' +
    '参数规则：format 当前支持 md、word、html。\n' +
    'target=current_file_dir 表示保存到当前文件所在目录。\n' +
    'target=workspace_directory 表示保存到文件浏览器挂载目录树中的某个目录，此时必须提供 targetDirectory，例如“网络笔记”或“离散数学/教案”。\n' +
    '如果用户明确指定了文件名，例如“保存为 demo.md”“导出为 教案.docx”，应填写 fileName。fileName 只能是文件名，不能包含目录。\n' +
    '如果用户明确要求重命名，rename_current_document 的 fileName 只填写目标文件名，例如“demo”“demo.md”。\n' +
    '如果用户明确要求创建目录，create_directory_under_selection 的 directoryName 只填写目录名，例如“demo”“离散数学”。不能包含路径。\n' +
    '如果用户明确要求在当前工作区内按名称操作，delete_workspace_entry 和 rename_workspace_entry 的 targetPath 只填写工作区内名称或相对路径，例如“temp/hello.md”“temp/demo”。\n' +
    'create_directory_in_workspace 的 parentPath 只填写工作区内父目录名称或相对路径，directoryName 只填写新目录名称。\n' +
    '如果用户只说“保存文档”，默认 format=md；如果用户明确说“保存为 word/docx”，使用 format=word；如果明确说“保存为 html”，使用 format=html。\n' +
    '如果用户说“保存到某个目录”，且该目录明显是文件浏览器中的课程目录/子目录，应使用 target=workspace_directory，而不是 current_file_dir。\n' +
    '示例映射：\n' +
    '- “保存文档” -> format=md, target=current_file_dir\n' +
    '- “保存为word” -> format=word, target=current_file_dir\n' +
    '- “保存为 demo.md” -> format=md, target=current_file_dir, fileName=demo.md\n' +
    '- “保存word到离散数学” -> format=word, target=workspace_directory, targetDirectory=离散数学\n' +
    '- “保存html到离散数学/教案” -> format=html, target=workspace_directory, targetDirectory=离散数学/教案\n' +
    '- “删除当前文档” -> delete_current_document\n' +
    '- “删除当前文件夹” -> delete_current_folder\n' +
    '- “删除 temp 下的 demo 文件夹” -> delete_workspace_entry, targetPath=temp/demo, targetKind=dir\n' +
    '- “删除 temp 下的 hello.md” -> delete_workspace_entry, targetPath=temp/hello.md, targetKind=file\n' +
    '- “重命名为 demo” -> rename_current_document, fileName=demo\n' +
    '- “把 temp 下的 hello.md 重命名为 hi.md” -> rename_workspace_entry, targetPath=temp/hello.md, newName=hi.md, targetKind=file\n' +
    '- “创建 demo 目录” -> create_directory_under_selection, directoryName=demo\n' +
    '- “在 temp 下创建 demo 目录” -> create_directory_in_workspace, parentPath=temp, directoryName=demo'
  )
}
