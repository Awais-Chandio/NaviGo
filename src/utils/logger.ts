type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

class Logger {
  private readonly isDevelopment =
    typeof __DEV__ === 'boolean' ? __DEV__ : false;

  private formatMessage(
    level: LogLevel,
    tag: string,
    message: string,
    context: unknown[],
  ): string {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      module: tag,
      message,
      ...(context.length > 0
        ? { context: context.map(value => this.normalizeContext(value)) }
        : {}),
    };

    try {
      return JSON.stringify(payload);
    } catch {
      return JSON.stringify({
        timestamp: payload.timestamp,
        level,
        module: tag,
        message,
        context: '[Unserializable log context]',
      });
    }
  }

  private normalizeContext(value: unknown): unknown {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: this.isDevelopment ? value.stack : undefined,
      };
    }
    return value;
  }

  public debug(tag: string, message: string, ...args: unknown[]): void {
    if (this.isDevelopment) {
      console.debug(this.formatMessage('debug', tag, message, args));
    }
  }

  public info(tag: string, message: string, ...args: unknown[]): void {
    if (this.isDevelopment) {
      console.info(this.formatMessage('info', tag, message, args));
    }
  }

  public warn(tag: string, message: string, ...args: unknown[]): void {
    console.warn(this.formatMessage('warn', tag, message, args));
  }

  public error(tag: string, message: string, ...args: unknown[]): void {
    console.error(this.formatMessage('error', tag, message, args));
  }

  public performance(
    sourceModule: string,
    operation: string,
    startedAtMs: number,
    context?: LogContext,
  ): void {
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    this.debug('Performance', operation, {
      sourceModule,
      durationMs,
      ...context,
    });
  }
}

export const logger = new Logger();
