// src/web/logger.ts
// 简化的日志器（浏览器专用）

/**
 * 浏览器专用日志器
 * 不依赖chalk，直接使用浏览器console API
 */
export class BrowserLogger {
  debug(message: string, context?: Record<string, unknown>): void {
    if (context) {
      console.debug(`[DEBUG] ${message}`, context)
    } else {
      console.debug(`[DEBUG] ${message}`)
    }
  }

  info(message: string, context?: Record<string, unknown>): void {
    if (context) {
      console.log(`[INFO] ${message}`, context)
    } else {
      console.log(`[INFO] ${message}`)
    }
  }

  warn(message: string, context?: Record<string, unknown>): void {
    if (context) {
      console.warn(`[WARN] ${message}`, context)
    } else {
      console.warn(`[WARN] ${message}`)
    }
  }

  error(message: string, context?: Record<string, unknown>): void {
    if (context) {
      console.error(`[ERROR] ${message}`, context)
    } else {
      console.error(`[ERROR] ${message}`)
    }
  }
}
