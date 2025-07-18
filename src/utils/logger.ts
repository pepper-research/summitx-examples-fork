import chalk from "chalk"

export type LogLevel = "info" | "success" | "warn" | "error" | "debug"

class Logger {
  private timestamp(): string {
    return new Date().toISOString()
  }

  private formatMessage(level: LogLevel, message: string, data?: any): string {
    const timestamp = chalk.gray(`[${this.timestamp()}]`)
    const levelTag = this.getLevelTag(level)
    
    let output = `${timestamp} ${levelTag} ${message}`
    
    if (data) {
      if (typeof data === "object") {
        // Handle BigInt serialization
        const replacer = (key: string, value: any) => {
          if (typeof value === 'bigint') {
            return value.toString()
          }
          return value
        }
        output += "\n" + JSON.stringify(data, replacer, 2)
      } else {
        output += ` ${data}`
      }
    }
    
    return output
  }

  private getLevelTag(level: LogLevel): string {
    switch (level) {
      case "info":
        return chalk.blue("[INFO]")
      case "success":
        return chalk.green("[SUCCESS]")
      case "warn":
        return chalk.yellow("[WARN]")
      case "error":
        return chalk.red("[ERROR]")
      case "debug":
        return chalk.gray("[DEBUG]")
      default:
        return "[LOG]"
    }
  }

  info(message: string, data?: any): void {
    console.log(this.formatMessage("info", message, data))
  }

  success(message: string, data?: any): void {
    console.log(this.formatMessage("success", message, data))
  }

  warn(message: string, data?: any): void {
    console.warn(this.formatMessage("warn", message, data))
  }

  error(message: string, error?: any): void {
    if (error instanceof Error) {
      console.error(this.formatMessage("error", message, {
        message: error.message,
        stack: error.stack,
      }))
    } else {
      console.error(this.formatMessage("error", message, error))
    }
  }

  debug(message: string, data?: any): void {
    if (process.env.DEBUG) {
      console.log(this.formatMessage("debug", message, data))
    }
  }

  divider(): void {
    console.log(chalk.gray("─".repeat(60)))
  }

  header(title: string): void {
    this.divider()
    console.log(chalk.bold.white(title))
    this.divider()
  }
}

export const logger = new Logger()