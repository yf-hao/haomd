export type AppCommand = () => void | Promise<void>

export type CommandRegistry = Record<string, AppCommand>
