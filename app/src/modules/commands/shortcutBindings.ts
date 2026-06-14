export type ShortcutBinding = {
  action: string
  matches: (event: KeyboardEvent, key: string) => boolean
  requireEditorContext?: boolean
}

export const PDF_SHORTCUT_BINDINGS: readonly ShortcutBinding[] = [
  { action: 'pdf_tool_select', matches: (_event, key) => key === 'v' },
  { action: 'pdf_tool_highlight', matches: (_event, key) => key === 'h' },
  { action: 'pdf_tool_underline', matches: (_event, key) => key === 'u' },
  { action: 'pdf_tool_strikeout', matches: (_event, key) => key === 'j' },
  { action: 'pdf_tool_squiggly', matches: (_event, key) => key === 'q' },
  { action: 'pdf_tool_square', matches: (_event, key) => key === 'r' },
  { action: 'pdf_tool_circle', matches: (_event, key) => key === 'o' },
  { action: 'pdf_tool_line', matches: (_event, key) => key === 'l' },
  { action: 'pdf_tool_arrow', matches: (_event, key) => key === 'a' },
  { action: 'pdf_tool_stamp', matches: (_event, key) => key === 't' },
  { action: 'pdf_tool_free_text', matches: (_event, key) => key === 'f' },
  { action: 'pdf_add_note', matches: (event, key) => key === 'n' && !event.shiftKey },
  { action: 'pdf_add_detached_note', matches: (event, key) => key === 'n' && event.shiftKey },
  { action: 'pdf_delete_selected', matches: (_event, key) => key === 'delete' || key === 'backspace' },
  { action: 'pdf_color_1', matches: (event, key) => key === '1' && !event.shiftKey },
  { action: 'pdf_color_2', matches: (event, key) => key === '2' && !event.shiftKey },
  { action: 'pdf_color_3', matches: (event, key) => key === '3' && !event.shiftKey },
  { action: 'pdf_color_4', matches: (event, key) => key === '4' && !event.shiftKey },
  { action: 'pdf_color_5', matches: (event, key) => key === '5' && !event.shiftKey },
  { action: 'pdf_color_6', matches: (event, key) => key === '6' && !event.shiftKey },
  { action: 'pdf_color_7', matches: (event, key) => key === '7' && !event.shiftKey },
  { action: 'pdf_color_8', matches: (event, key) => key === '8' && !event.shiftKey },
  { action: 'pdf_color_9', matches: (event, key) => key === '9' && !event.shiftKey },
] as const

export const FORMAT_SHORTCUT_BINDINGS: readonly ShortcutBinding[] = [
  {
    action: 'format_heading_paragraph',
    matches: (event, key) => key === '0' && !event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
  {
    action: 'format_heading_1',
    matches: (event, key) => key === '1' && !event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
  {
    action: 'format_heading_2',
    matches: (event, key) => key === '2' && !event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
  {
    action: 'format_heading_3',
    matches: (event, key) => key === '3' && !event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
  {
    action: 'format_heading_4',
    matches: (event, key) => key === '4' && !event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
  {
    action: 'format_heading_5',
    matches: (event, key) => key === '5' && !event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
  {
    action: 'format_heading_6',
    matches: (event, key) => key === '6' && !event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
  {
    action: 'format_emphasize_selection',
    matches: (event, key) => key === 'b' && !event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
  {
    action: 'format_insert_table',
    matches: (event, key) => key === 't' && !event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
  {
    action: 'format_insert_code_block',
    matches: (event, key) => key === 'c' && event.altKey && !event.shiftKey,
    requireEditorContext: true,
  },
  {
    action: 'format_insert_front_matter',
    matches: (event, key) => key === 'f' && event.altKey && !event.shiftKey,
    requireEditorContext: true,
  },
  {
    action: 'format_text_color_cycle',
    matches: (event, key) => key === 'c' && event.shiftKey && !event.altKey,
    requireEditorContext: true,
  },
] as const

export const EDITOR_SHORTCUT_SCOPE_SELECTORS = [
  '.cm-editor',
  '.code-editor',
  '.milkdown',
  '.ProseMirror',
  '.wysiwyg-editor',
].join(', ')

export const FORMAT_SHORTCUT_ACTIONS = FORMAT_SHORTCUT_BINDINGS.map((binding) => binding.action)

export const FORMAT_MENU_ACCELERATORS: Readonly<Record<string, string>> = {
  format_heading_paragraph: 'CmdOrCtrl+0',
  format_heading_1: 'CmdOrCtrl+1',
  format_heading_2: 'CmdOrCtrl+2',
  format_heading_3: 'CmdOrCtrl+3',
  format_heading_4: 'CmdOrCtrl+4',
  format_heading_5: 'CmdOrCtrl+5',
  format_heading_6: 'CmdOrCtrl+6',
  format_emphasize_selection: 'CmdOrCtrl+B',
  format_insert_table: 'CmdOrCtrl+T',
  format_insert_code_block: 'CmdOrCtrl+Alt+C',
  format_insert_front_matter: 'CmdOrCtrl+Alt+F',
  format_text_color_cycle: 'CmdOrCtrl+Shift+C',
}

export const GLOBAL_MENU_ACCELERATORS: Readonly<Record<string, string>> = {
  new_file: 'CmdOrCtrl+N',
  open_file: 'CmdOrCtrl+O',
  open_folder: 'CmdOrCtrl+Shift+O',
  save: 'CmdOrCtrl+S',
  save_as: 'CmdOrCtrl+Alt+S',
  toggle_sidebar: 'CmdOrCtrl+Shift+S',
  close_file: 'CmdOrCtrl+W',
  find: 'CmdOrCtrl+F',
  toggle_preview: 'CmdOrCtrl+P',
  toggle_preview_only: 'CmdOrCtrl+Shift+P',
  zoom_in: 'CmdOrCtrl+=',
  zoom_out: 'CmdOrCtrl+-',
  zoom_reset: 'CmdOrCtrl+Shift+0',
  ai_chat: 'CmdOrCtrl+K',
  ai_ask_file: 'CmdOrCtrl+D',
  ai_ask_selection: 'CmdOrCtrl+L',
  tools_calendar: 'CmdOrCtrl+Alt+D',
}
