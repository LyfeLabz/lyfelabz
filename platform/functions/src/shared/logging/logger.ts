import { logger } from "firebase-functions";

export type LogPayload = Readonly<Record<string, unknown>>;

export const log = {
  info(event: string, payload: LogPayload): void {
    logger.info(event, payload);
  },
  warn(event: string, payload: LogPayload): void {
    logger.warn(event, payload);
  },
  error(event: string, payload: LogPayload): void {
    logger.error(event, payload);
  },
};
