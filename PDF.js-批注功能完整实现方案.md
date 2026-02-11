# PDF.js + 自建批注层完整实现方案

## 1. 方案概述

基于 PDF.js 渲染引擎，通过自定义 Canvas/SVG 层实现批注功能，配合虚拟滚动优化内存使用。

## 2. 技术栈

| 组件 | 用途 | 版本/说明 |
|------|------|-----------|
| `pdfjs-dist` | PDF 渲染核心 | ^4.x |
| `react-pdf` (可选) | React 封装 | 简化集成 |
| `pdf-lib` | PDF 导出/编辑 | ^1.17.x |
| `idb-keyval` | IndexedDB 存储 | 本地批注持久化 |
| `use-virtual-list` | 虚拟滚动 | 内存优化 |

## 3. 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    React Component                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │            PdfViewerContainer                   │   │
│  │  ┌─────────────────────────────────────────┐   │   │
│  │  │         VirtualScrollContainer          │   │   │
│  │  │   ┌─────────────────────────────────┐   │   │   │
│  │  │   │     PdfPage (visible pages)     │   │   │   │
│  │  │   │  ┌─────────────────────────┐    │   │   │   │
│  │  │   │  │   PDF.js Canvas Layer   │    │   │   │   │
│  │  │   │  │   - 文本渲染             │    │   │   │   │
│  │  │   │  │   - 图片渲染             │    │   │   │   │
│  │  │   │  └─────────────────────────┘    │   │   │   │
│  │  │   │  ┌─────────────────────────┐    │   │   │   │
│  │  │   │  │   Annotation Layer      │    │   │   │   │
│  │  │   │  │   - 高亮矩形 (SVG)       │    │   │   │   │
│  │  │   │  │   - 下划线               │    │   │   │   │
│  │  │   │  │   - 文本框               │    │   │   │   │
│  │  │   │  │   - 便签 (Popup)         │    │   │   │   │
│  │  │   │  └─────────────────────────┘    │   │   │   │
│  │  │   │  ┌─────────────────────────┐    │   │   │   │
│  │  │   │  │   Interaction Layer     │    │   │   │   │
│  │  │   │  │   - 鼠标事件监听         │    │   │   │   │
│  │  │   │  │   - 文本选择             │    │   │   │   │
│  │  │   │  │   - 绘制交互             │    │   │   │   │
│  │  │   │  └─────────────────────────┘    │   │   │   │
│  │  │   └─────────────────────────────────┘   │   │   │
│  │  └─────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## 4. 目录结构

```
app/src/modules/pdf/
├── components/
│   ├── PdfViewer.tsx           # 主容器组件
│   ├── PdfPage.tsx             # 单页渲染组件
│   ├── AnnotationLayer.tsx     # 批注层组件
│   ├── AnnotationToolbar.tsx   # 批注工具栏
│   └── TextPopup.tsx           # 文本选择弹出菜单
├── hooks/
│   ├── usePdfDocument.ts       # PDF 文档加载
│   ├── useAnnotations.ts       # 批注状态管理
│   ├── useTextSelection.ts     # 文本选择检测
│   └── useVirtualPages.ts      # 虚拟滚动
├── utils/
│   ├── pdfRender.ts            # PDF.js 渲染封装
│   ├── annotationRender.ts     # 批注渲染工具
│   ├── coordinateTransform.ts  # 坐标转换
│   └── pdfExport.ts            # PDF 导出功能
├── types/
│   └── annotation.ts           # 类型定义
└── store/
    └── annotationStore.ts      # 本地存储
```

## 5. 核心类型定义

```typescript
// types/annotation.ts

export type AnnotationType = 
  | 'highlight' 
  | 'underline' 
  | 'strikeout'
  | 'squiggly'
  | 'text' 
  | 'popup'
  | 'stamp'
  | 'ink'  // 手写墨迹

export interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface Annotation {
  id: string
  page: number
  type: AnnotationType
  
  // 位置（PDF 原始坐标系）
  rects: Rect[]  // 支持多段文本
  
  // 样式
  color: string       // #FFEB3B
  opacity: number     // 0.3
  
  // 文本内容（text/popup 类型）
  content?: string
  author?: string
  
  // 墨迹数据（ink 类型）
  inkList?: Array<{ x: number; y: number }[]>
  
  // 时间戳
  createdAt: number
  updatedAt: number
}

// 文档级批注存储
export interface DocumentAnnotations {
  pdfHash: string        // PDF 文件 SHA256
  fileName: string
  pageCount: number
  annotations: Annotation[]
  version: number
  lastModified: number
}

// 渲染上下文
export interface RenderContext {
  scale: number
  pageWidth: number
  pageHeight: number
  rotation: number  // 0, 90, 180, 270
}
```

## 6. 核心组件实现

### 6.1 主容器组件

```typescript
// components/PdfViewer.tsx
import { useState, useCallback, useRef } from 'react'
import { usePdfDocument } from '../hooks/usePdfDocument'
import { useVirtualPages } from '../hooks/useVirtualPages'
import { useAnnotations } from '../hooks/useAnnotations'
import { AnnotationToolbar } from './AnnotationToolbar'
import { PdfPage } from './PdfPage'
import type { AnnotationType } from '../types/annotation'

interface PdfViewerProps {
  filePath: string
  onClose?: () => void
}

export function PdfViewer({ filePath, onClose }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1.5)
  const [activeTool, setActiveTool] = useState<AnnotationType | null>(null)
  
  // 加载 PDF 文档
  const { pdfDocument, pageCount, error, loading } = usePdfDocument(filePath)
  
  // 虚拟滚动（同时只渲染 3-5 页）
  const { visibleRange, onScroll, totalHeight } = useVirtualPages({
    pageCount,
    pageHeight: 800 * scale,
    containerRef,
    bufferSize: 2  // 上下各缓存 2 页
  })
  
  // 批注管理
  const { 
    annotations, 
    addAnnotation, 
    updateAnnotation, 
    deleteAnnotation,
    exportAnnotations
  } = useAnnotations(filePath, pdfDocument)
  
  // 导出带批注的 PDF
  const handleExport = useCallback(async () => {
    const { exportPdfWithAnnotations } = await import('../utils/pdfExport')
    const pdfBytes = await exportPdfWithAnnotations(filePath, annotations)
    // 触发下载或保存
  }, [filePath, annotations])
  
  if (loading) return <div className="pdf-loading">加载中...</div>
  if (error) return <div className="pdf-error">{error}</div>
  
  return (
    <div className="pdf-viewer">
      <AnnotationToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        scale={scale}
        onScaleChange={setScale}
        onExport={handleExport}
        onClose={onClose}
      />
      
      <div 
        ref={containerRef}
        className="pdf-scroll-container"
        onScroll={onScroll}
      >
        {/* 占位撑开滚动条 */}
        <div style={{ height: totalHeight }} />
        
        {/* 可见页面 */}
        {Array.from({ length: visibleRange.end - visibleRange.start }, (_, i) => {
          const pageNum = visibleRange.start + i + 1
          const pageAnnotations = annotations.filter(a => a.page === pageNum)
          
          return (
            <PdfPage
              key={pageNum}
              pdfDocument={pdfDocument}
              pageNumber={pageNum}
              scale={scale}
              annotations={pageAnnotations}
              activeTool={activeTool}
              onAddAnnotation={addAnnotation}
              onUpdateAnnotation={updateAnnotation}
              onDeleteAnnotation={deleteAnnotation}
              style={{
                position: 'absolute',
                top: (pageNum - 1) * 800 * scale
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
```

### 6.2 虚拟滚动 Hook

```typescript
// hooks/useVirtualPages.ts
import { useState, useCallback, useMemo, RefObject } from 'react'

interface UseVirtualPagesOptions {
  pageCount: number
  pageHeight: number
  containerRef: RefObject<HTMLElement>
  bufferSize?: number
}

interface VisibleRange {
  start: number
  end: number
}

export function useVirtualPages({
  pageCount,
  pageHeight,
  containerRef,
  bufferSize = 2
}: UseVirtualPagesOptions) {
  const [visibleRange, setVisibleRange] = useState<VisibleRange>({ 
    start: 0, 
    end: 5 
  })
  
  const totalHeight = useMemo(() => 
    pageCount * pageHeight, 
    [pageCount, pageHeight]
  )
  
  const onScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    
    const scrollTop = container.scrollTop
    const containerHeight = container.clientHeight
    
    // 计算可见页码
    const startPage = Math.floor(scrollTop / pageHeight)
    const endPage = Math.ceil((scrollTop + containerHeight) / pageHeight)
    
    // 添加缓冲
    const bufferedStart = Math.max(0, startPage - bufferSize)
    const bufferedEnd = Math.min(pageCount, endPage + bufferSize)
    
    setVisibleRange({ start: bufferedStart, end: bufferedEnd })
  }, [pageHeight, pageCount, bufferSize])
  
  return { visibleRange, onScroll, totalHeight }
}
```

### 6.3 单页组件

```typescript
// components/PdfPage.tsx
import { useEffect, useRef, useCallback } from 'react'
import { renderPage } from '../utils/pdfRender'
import { AnnotationLayer } from './AnnotationLayer'
import { TextSelectionLayer } from './TextSelectionLayer'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Annotation, AnnotationType } from '../types/annotation'

interface PdfPageProps {
  pdfDocument: PDFDocumentProxy
  pageNumber: number
  scale: number
  annotations: Annotation[]
  activeTool: AnnotationType | null
  onAddAnnotation: (ann: Annotation) => void
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void
  onDeleteAnnotation: (id: string) => void
  style: React.CSSProperties
}

export function PdfPage({
  pdfDocument,
  pageNumber,
  scale,
  annotations,
  activeTool,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  style
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
  
  // 渲染 PDF 页面
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    
    let isCancelled = false
    
    const render = async () => {
      const result = await renderPage({
        pdfDocument,
        pageNumber,
        scale,
        canvas
      })
      
      if (!isCancelled) {
        setPageSize({ width: result.width, height: result.height })
      }
    }
    
    render()
    
    return () => {
      isCancelled = true
    }
  }, [pdfDocument, pageNumber, scale])
  
  // 清理 Canvas 释放内存（页面离开可视区域时）
  useEffect(() => {
    return () => {
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [])
  
  return (
    <div
      ref={containerRef}
      className="pdf-page"
      style={{
        ...style,
        width: pageSize.width,
        height: pageSize.height
      }}
    >
      {/* PDF 渲染层 */}
      <canvas
        ref={canvasRef}
        className="pdf-canvas"
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      
      {/* 批注层 */}
      <AnnotationLayer
        pageNumber={pageNumber}
        scale={scale}
        annotations={annotations}
        activeTool={activeTool}
        onAdd={onAddAnnotation}
        onUpdate={onUpdateAnnotation}
        onDelete={onDeleteAnnotation}
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      
      {/* 文本选择层 */}
      <TextSelectionLayer
        pageNumber={pageNumber}
        scale={scale}
        activeTool={activeTool}
        onCreateHighlight={(rects) => {
          onAddAnnotation({
            id: generateId(),
            page: pageNumber,
            type: 'highlight',
            rects,
            color: '#FFEB3B',
            opacity: 0.3,
            createdAt: Date.now(),
            updatedAt: Date.now()
          })
        }}
      />
    </div>
  )
}
```

### 6.4 批注层组件

```typescript
// components/AnnotationLayer.tsx
import { useMemo } from 'react'
import type { Annotation, AnnotationType } from '../types/annotation'

interface AnnotationLayerProps {
  pageNumber: number
  scale: number
  annotations: Annotation[]
  activeTool: AnnotationType | null
  onAdd: (ann: Annotation) => void
  onUpdate: (id: string, updates: Partial<Annotation>) => void
  onDelete: (id: string) => void
  style: React.CSSProperties
}

export function AnnotationLayer({
  scale,
  annotations,
  onDelete
}: AnnotationLayerProps) {
  // 将 PDF 坐标转换为 CSS 像素
  const toCssRect = (rect: { x1: number; y1: number; x2: number; y2: number }) => ({
    left: rect.x1 * scale,
    top: rect.y1 * scale,
    width: (rect.x2 - rect.x1) * scale,
    height: (rect.y2 - rect.y1) * scale
  })
  
  return (
    <svg
      className="annotation-layer"
      style={{
        ...style,
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      }}
    >
      {annotations.map(annotation => {
        switch (annotation.type) {
          case 'highlight':
          case 'underline':
          case 'strikeout':
            return (
              <g key={annotation.id} className={`annotation-${annotation.type}`}>
                {annotation.rects.map((rect, idx) => {
                  const css = toCssRect(rect)
                  return (
                    <rect
                      key={idx}
                      x={css.left}
                      y={css.top}
                      width={css.width}
                      height={css.height}
                      fill={annotation.type === 'highlight' ? annotation.color : 'none'}
                      fillOpacity={annotation.opacity}
                      stroke={annotation.type !== 'highlight' ? annotation.color : 'none'}
                      strokeWidth={annotation.type === 'underline' ? 2 : 1}
                      style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                      onClick={() => {
                        if (confirm('删除此批注？')) {
                          onDelete(annotation.id)
                        }
                      }}
                    />
                  )
                })}
              </g>
            )
          
          case 'text':
          case 'popup':
            const rect = toCssRect(annotation.rects[0])
            return (
              <foreignObject
                key={annotation.id}
                x={rect.left}
                y={rect.top}
                width={200}
                height={100}
              >
                <div className="annotation-popup">
                  {annotation.content}
                </div>
              </foreignObject>
            )
          
          default:
            return null
        }
      })}
    </svg>
  )
}
```

### 6.5 文本选择检测

```typescript
// hooks/useTextSelection.ts
import { useEffect, useCallback } from 'react'
import type { Rect } from '../types/annotation'

interface UseTextSelectionOptions {
  containerRef: React.RefObject<HTMLElement>
  pageNumber: number
  scale: number
  onSelect: (rects: Rect[]) => void
  enabled: boolean
}

export function useTextSelection({
  containerRef,
  scale,
  onSelect,
  enabled
}: UseTextSelectionOptions) {
  const handleSelection = useCallback(() => {
    if (!enabled) return
    
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    
    const range = selection.getRangeAt(0)
    const container = containerRef.current
    if (!container) return
    
    // 获取所有选区矩形
    const clientRects = range.getClientRects()
    const containerRect = container.getBoundingClientRect()
    
    // 转换为相对于容器的坐标，然后转回 PDF 坐标
    const rects: Rect[] = Array.from(clientRects).map(rect => {
      const relativeX = rect.left - containerRect.left
      const relativeY = rect.top - containerRect.top
      
      return {
        x1: relativeX / scale,
        y1: relativeY / scale,
        x2: (relativeX + rect.width) / scale,
        y2: (relativeY + rect.height) / scale
      }
    })
    
    onSelect(rects)
    selection.removeAllRanges()
  }, [scale, onSelect, enabled])
  
  useEffect(() => {
    document.addEventListener('mouseup', handleSelection)
    return () => document.removeEventListener('mouseup', handleSelection)
  }, [handleSelection])
}
```

## 7. PDF 导出功能

```typescript
// utils/pdfExport.ts
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { invoke } from '@tauri-apps/api/core'
import type { Annotation } from '../types/annotation'

export async function exportPdfWithAnnotations(
  filePath: string,
  annotations: Annotation[]
): Promise<Uint8Array> {
  // 1. 读取原始 PDF
  const result = await invoke<number[]>('read_file_binary', { path: filePath })
  const existingPdfBytes = new Uint8Array(result)
  
  // 2. 加载 PDF
  const pdfDoc = await PDFDocument.load(existingPdfBytes)
  const pages = pdfDoc.getPages()
  
  // 3. 遍历批注并绘制
  for (const annotation of annotations) {
    const page = pages[annotation.page - 1]
    if (!page) continue
    
    const { width, height } = page.getSize()
    
    for (const rect of annotation.rects) {
      // PDF 坐标系：原点在左下角，Y 向上
      const pdfY = height - rect.y2
      
      switch (annotation.type) {
        case 'highlight':
          page.drawRectangle({
            x: rect.x1,
            y: pdfY,
            width: rect.x2 - rect.x1,
            height: rect.y2 - rect.y1,
            color: hexToRgb(annotation.color),
            opacity: annotation.opacity
          })
          break
          
        case 'underline':
          page.drawLine({
            start: { x: rect.x1, y: pdfY + (rect.y2 - rect.y1) },
            end: { x: rect.x2, y: pdfY + (rect.y2 - rect.y1) },
            thickness: 2,
            color: hexToRgb(annotation.color)
          })
          break
          
        case 'text':
          if (annotation.content) {
            page.drawText(annotation.content, {
              x: rect.x1,
              y: pdfY,
              size: 12,
              font: await pdfDoc.embedFont(StandardFonts.Helvetica),
              color: rgb(1, 0, 0)
            })
          }
          break
      }
    }
  }
  
  // 4. 保存
  return await pdfDoc.save()
}

function hexToRgb(hex: string) {
  const num = parseInt(hex.replace('#', ''), 16)
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255
  }
}
```

## 8. 本地存储方案

```typescript
// store/annotationStore.ts
import { get, set, del, keys } from 'idb-keyval'
import type { DocumentAnnotations, Annotation } from '../types/annotation'

const STORE_PREFIX = 'pdf_annotations:'

export async function saveAnnotations(
  pdfHash: string, 
  data: DocumentAnnotations
): Promise<void> {
  await set(`${STORE_PREFIX}${pdfHash}`, data)
}

export async function loadAnnotations(
  pdfHash: string
): Promise<DocumentAnnotations | null> {
  return await get(`${STORE_PREFIX}${pdfHash}`)
}

export async function deleteAnnotations(pdfHash: string): Promise<void> {
  await del(`${STORE_PREFIX}${pdfHash}`)
}

export async function listAllAnnotations(): Promise<DocumentAnnotations[]> {
  const allKeys = await keys()
  const annotationKeys = allKeys.filter(k => 
    typeof k === 'string' && k.startsWith(STORE_PREFIX)
  )
  
  const results = await Promise.all(
    annotationKeys.map(k => get(k))
  )
  
  return results.filter(Boolean)
}

// 计算文件 SHA256
export async function computePdfHash(filePath: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke<string>('compute_file_hash', { path: filePath })
}
```

## 9. 内存优化清单

### 9.1 渲染优化

```typescript
// hooks/usePdfDocument.ts - 配置优化
const loadingTask = pdfjsLib.getDocument({
  url: pdfUrl,
  maxImageSize: 1024 * 1024,     // 限制单图 1MB
  disableAutoFetch: true,         // 禁用自动预加载
  disableStream: true,            // 禁用流式加载
  cMapUrl: undefined,             // 不需要 CMap 时禁用
  cMapPacked: false
})
```

### 9.2 Canvas 清理

```typescript
// components/PdfPage.tsx
useEffect(() => {
  return () => {
    // 组件卸载时清理 Canvas
    const canvas = canvasRef.current
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
      canvas.width = 0
      canvas.height = 0
    }
  }
}, [])
```

### 9.3 配置参数

| 参数 | 推荐值 | 说明 |
|------|--------|------|
| `maxRenderedPages` | 5 | 同时渲染最大页数 |
| `bufferSize` | 2 | 虚拟滚动缓冲页数 |
| `scale` | 1.0-1.5 | 渲染精度（2.0 占用 4 倍内存） |
| `maxImageSize` | 1MB | 图片大小限制 |

## 10. Rust 端命令补充

```rust
// src-tauri/src/lib.rs

#[tauri::command]
async fn read_file_binary(
  path: String,
) -> Result<Vec<u8>, String> {
  use tokio::fs;
  
  fs::read(&path)
    .await
    .map_err(|e| format!("读取文件失败: {e}"))
}

#[tauri::command]
async fn compute_file_hash(path: String) -> Result<String, String> {
  use sha2::{Sha256, Digest};
  use tokio::fs;
  
  let bytes = fs::read(&path)
    .await
    .map_err(|e| format!("读取失败: {e}"))?;
  
  let mut hasher = Sha256::new();
  hasher.update(&bytes);
  let result = hasher.finalize();
  
  Ok(format!("{:x}", result))
}
```

## 11. 性能指标参考

| 场景 | 内存占用 | 首次渲染 | 滚动流畅度 |
|------|----------|----------|------------|
| 10 页 PDF（无优化） | 150 MB | 快 | 流畅 |
| 100 页 PDF（无优化） | 800 MB+ | 慢 | 卡顿 |
| 100 页 PDF（虚拟滚动） | 120 MB | 快 | 流畅 |
| 100 页 PDF（虚拟+低精度） | 80 MB | 快 | 流畅 |

## 12. 总结

本方案通过以下策略实现高性能 PDF 批注：

1. **虚拟滚动**：只渲染可视区域页面，内存占用与总页数无关
2. **分层架构**：PDF 层 + 批注层 + 交互层，职责清晰
3. **坐标转换**：支持 PDF 原始坐标与屏幕坐标的双向转换
4. **本地存储**：使用 IndexedDB 持久化批注数据
5. **导出集成**：pdf-lib 实现带批注的 PDF 导出

**适用场景**：
- Markdown 编辑器的 PDF 预览/批注功能
- 中等规模 PDF（< 500 页）
- 需要完全自定义 UI 的场景
