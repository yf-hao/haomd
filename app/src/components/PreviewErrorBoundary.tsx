import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

class PreviewErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PreviewErrorBoundary]', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.handleReset)
      }
      return (
        <section className="pane preview">
          <div className="preview-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#f87171' }}>预览渲染出错</div>
            <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 400, wordBreak: 'break-word', textAlign: 'center' }}>{error.message}</div>
            <button
              type="button"
              onClick={this.handleReset}
              style={{ marginTop: 4, padding: '4px 12px', fontSize: 12, borderRadius: 4, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)', color: '#e8ecf5', cursor: 'pointer' }}
            >
              重试
            </button>
          </div>
        </section>
      )
    }
    return this.props.children
  }
}

export default PreviewErrorBoundary
