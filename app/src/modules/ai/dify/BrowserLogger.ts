// 浏览器专用日志器，来源于 web-chat/src/web/logger.ts，略作命名规范调整

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
