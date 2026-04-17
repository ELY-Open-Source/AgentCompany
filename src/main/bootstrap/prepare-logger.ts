import { app } from "electron";
import log from "electron-log/main.js";

export function prepareLogger() {
  log.initialize();
  log.transports.console.format = "[{h}:{i}:{s}] [{level}] {text}";
  log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
  if (app.isPackaged) {
    log.transports.console.level = "warn";
    log.transports.file.level = "info";
  } else {
    log.transports.console.level = "info";
    log.transports.file.level = "debug";
  }
  return log;
}
