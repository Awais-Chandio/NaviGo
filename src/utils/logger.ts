type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

class Logger {
  private readonly isDevelopment =
    typeof __DEV__ === 'boolean' ? __DEV__ : false;

  private formatMessage(level: LogLevel, tag: string, message: string): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      module: tag,
      message,
    });
  }

  public debug(tag: string, message: string, ...args: unknown[]): void {
    if (this.isDevelopment) {
      console.debug(this.formatMessage('debug', tag, message), ...args);
    }
  }

  public info(tag: string, message: string, ...args: unknown[]): void {
    if (this.isDevelopment) {
      console.info(this.formatMessage('info', tag, message), ...args);
    }
  }

  public warn(tag: string, message: string, ...args: unknown[]): void {
    console.warn(this.formatMessage('warn', tag, message), ...args);
  }

  public error(tag: string, message: string, ...args: unknown[]): void {
    console.error(this.formatMessage('error', tag, message), ...args);
  }
}

export const logger = new Logger();
