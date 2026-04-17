import * as operatingEn from "./operating-en";
import * as systemEn from "./system-en";

export type OperatingMessages = typeof operatingEn;
export type SystemMessages = typeof systemEn;

export function getOperatingMessages(): OperatingMessages {
  return operatingEn;
}

export function getSystemMessages(): SystemMessages {
  return systemEn;
}
