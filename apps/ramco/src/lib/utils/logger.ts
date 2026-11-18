/**
 * Structured Logging Utility
 *
 * Provides consistent, structured logging across the application
 * with log levels, timestamps, and context
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4
}

interface LogContext {
  [key: string]: any;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

class Logger {
  private logLevel: LogLevel;
  private namespace: string;

  constructor(namespace: string = 'ramco-mcp', logLevel: LogLevel = LogLevel.WARN) {
    this.namespace = namespace;
    // Read from environment or default to WARN (only warnings and errors)
    const envLogLevel = process.env.LOG_LEVEL?.toUpperCase();
    this.logLevel = envLogLevel && LogLevel[envLogLevel as keyof typeof LogLevel] !== undefined
      ? LogLevel[envLogLevel as keyof typeof LogLevel]
      : logLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.logLevel;
  }

  private formatLog(level: string, message: string, context?: LogContext): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: `[${this.namespace}] ${message}`
    };

    if (context && Object.keys(context).length > 0) {
      // Sanitize sensitive data
      const sanitized = { ...context };
      if (sanitized.apiKey) sanitized.apiKey = '***REDACTED***';
      if (sanitized.key) sanitized.key = '***REDACTED***';
      if (sanitized.password) sanitized.password = '***REDACTED***';
      if (sanitized.token) sanitized.token = '***REDACTED***';

      entry.context = sanitized;
    }

    return entry;
  }

  private output(entry: LogEntry): void {
    // In production, you might want to send to a logging service
    // For now, output to console with proper formatting
    const output = JSON.stringify(entry);

    switch (entry.level) {
      case 'ERROR':
        console.error(output);
        break;
      case 'WARN':
        console.warn(output);
        break;
      case 'DEBUG':
      case 'TRACE':
        console.debug(output);
        break;
      default:
        console.log(output);
    }
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;

    const entry = this.formatLog('ERROR', message, context);

    if (error) {
      if (error instanceof Error) {
        entry.error = {
          message: error.message,
          stack: error.stack,
          code: (error as any).code
        };
      } else {
        entry.error = {
          message: String(error)
        };
      }
    }

    this.output(entry);
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.WARN)) return;
    this.output(this.formatLog('WARN', message, context));
  }

  info(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.INFO)) return;
    this.output(this.formatLog('INFO', message, context));
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;
    this.output(this.formatLog('DEBUG', message, context));
  }

  trace(message: string, context?: LogContext): void {
    if (!this.shouldLog(LogLevel.TRACE)) return;
    this.output(this.formatLog('TRACE', message, context));
  }

  /**
   * Create a child logger with a sub-namespace
   */
  child(subNamespace: string): Logger {
    return new Logger(`${this.namespace}:${subNamespace}`, this.logLevel);
  }
}

// Export singleton instance
export const logger = new Logger('ramco-mcp');

// Export factory for creating namespaced loggers
export function createLogger(namespace: string, logLevel?: LogLevel): Logger {
  return new Logger(namespace, logLevel);
}
