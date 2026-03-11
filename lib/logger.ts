import * as dgram from 'dgram';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogTransport {
  log(level: LogLevel, message: string, source: string, data?: Record<string, unknown>): void;
  close?(): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private readonly source: string;
  private readonly transports: LogTransport[];
  private readonly minLevel: number;

  constructor(source: string, transports: LogTransport[], level: LogLevel = 'info') {
    this.source = source;
    this.transports = transports;
    this.minLevel = LEVEL_ORDER[level];
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.emit('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.emit('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.emit('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.emit('error', message, data);
  }

  child(source: string): Logger {
    const level = (Object.entries(LEVEL_ORDER).find(
      ([, v]) => v === this.minLevel,
    ) as [LogLevel, number])[0];
    return new Logger(source, this.transports, level);
  }

  private emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;
    for (const transport of this.transports) {
      transport.log(level, message, this.source, data);
    }
  }
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

export class ConsoleTransport implements LogTransport {
  log(level: LogLevel, message: string, source: string, data?: Record<string, unknown>): void {
    const formatted = `${LEVEL_LABELS[level]} [${source}] ${message}`;
    const args: unknown[] = [formatted];
    if (data) args.push(data);

    if (level === 'error') {
      console.error(...args);
    } else if (level === 'warn') {
      console.warn(...args);
    } else {
      console.log(...args);
    }
  }
}

/** RFC 5424 severity mapping */
const SYSLOG_SEVERITY: Record<LogLevel, number> = {
  debug: 7,
  info: 6,
  warn: 4,
  error: 3,
};

const SYSLOG_FACILITY = 1; // user-level

export class SyslogTransport implements LogTransport {
  private readonly socket: dgram.Socket;
  private readonly host: string;
  private readonly port: number;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
    this.socket = dgram.createSocket('udp4');
    this.socket.unref(); // Don't prevent process exit
  }

  log(level: LogLevel, message: string, source: string, data?: Record<string, unknown>): void {
    const severity = SYSLOG_SEVERITY[level];
    const priority = SYSLOG_FACILITY * 8 + severity;
    const timestamp = new Date().toISOString();
    const hostname = '-';
    const appName = 'prism';
    const msgContent = data ? `${message} ${JSON.stringify(data)}` : message;

    // RFC 5424: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID MSG
    const syslogMsg = `<${priority}>1 ${timestamp} ${hostname} ${appName} ${process.pid} ${source} ${msgContent}`;
    this.sendMessage(syslogMsg);
  }

  close(): void {
    this.socket.close();
  }

  private sendMessage(message: string): void {
    const buf = Buffer.from(message);
    this.socket.send(buf, 0, buf.length, this.port, this.host);
  }
}

/**
 * Create a logger configured from environment variables.
 *
 * - LOG_LEVEL: debug | info | warn | error (default: info)
 * - LOG_TRANSPORT: console | syslog (default: console)
 * - SYSLOG_HOST: hostname (default: localhost)
 * - SYSLOG_PORT: port (default: 514)
 *
 * When LOG_TRANSPORT=syslog, both console and syslog transports are active.
 */
export function createLogger(source: string): Logger {
  const level = (process.env.LOG_LEVEL || 'info') as LogLevel;
  const transportMode = process.env.LOG_TRANSPORT || 'console';

  const transports: LogTransport[] = [new ConsoleTransport()];

  if (transportMode === 'syslog') {
    const host = process.env.SYSLOG_HOST || 'localhost';
    const port = parseInt(process.env.SYSLOG_PORT || '514', 10);
    transports.push(new SyslogTransport(host, port));
  }

  return new Logger(source, transports, level);
}
