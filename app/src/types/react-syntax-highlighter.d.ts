declare module 'react-syntax-highlighter' {
  import type { ComponentType, CSSProperties, ReactNode } from 'react'

  export type SyntaxHighlighterProps = {
    language?: string
    style?: { [key: string]: CSSProperties }
    customStyle?: CSSProperties
    codeTagProps?: {
      style?: CSSProperties
      [key: string]: unknown
    }
    showLineNumbers?: boolean
    wrapLines?: boolean
    children?: ReactNode
    [key: string]: unknown
  }

  export const Prism: ComponentType<SyntaxHighlighterProps>
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  import type { CSSProperties } from 'react'

  export const oneDark: { [key: string]: CSSProperties }
  export const oneLight: { [key: string]: CSSProperties }
}
