export interface Logger {
  log(msg: string, ...args: any[]): void;
  debug(msg: string, ...args: any[]): void;
  info(msg: string, ...args: any[]): void;
  warn(msg: string, ...args: any[]): void;
  error(msg: string, ...args: any[]): void;
}

export class ConsoleLogger implements Logger {
  constructor(private prefix: string = 'Aurora Shell') {}

  log(msg: string, ...args: any[]): void {
    this.info(msg, ...args);
  }

  debug(msg: string, ...args: any[]): void {
    console.debug(`[${this.prefix}] ${msg}`, ...args);
  }

  info(msg: string, ...args: any[]): void {
    console.log(`[${this.prefix}] ${msg}`, ...args);
  }

  warn(msg: string, ...args: any[]): void {
    console.warn(`[${this.prefix}] ${msg}`, ...args);
  }

  error(msg: string, ...args: any[]): void {
    console.error(`[${this.prefix}] ${msg}`, ...args);
  }
}