import React from 'react'

export type Renderer = (code: string) => React.ReactNode
export type RendererMap = Record<string, Renderer>

const registry: RendererMap = {}

export function registerRenderer(type: string, renderer: Renderer) {
  registry[type] = renderer
}

export function getRenderer(type: string): Renderer | undefined {
  return registry[type]
}

export function listRenderers(): string[] {
  return Object.keys(registry)
}
