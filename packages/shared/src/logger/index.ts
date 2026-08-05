export interface LogContext {
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

export const logger = {
  info: (message: string, context?: LogContext) => {
    console.log(JSON.stringify({ level: "info", message, timestamp: new Date().toISOString(), ...context }));
  },
  warn: (message: string, context?: LogContext) => {
    console.warn(JSON.stringify({ level: "warn", message, timestamp: new Date().toISOString(), ...context }));
  },
  error: (message: string, context?: LogContext) => {
    console.error(JSON.stringify({ level: "error", message, timestamp: new Date().toISOString(), ...context }));
  },
};
