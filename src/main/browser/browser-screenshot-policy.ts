import type { BrowserAction } from "./browser-types";

export function shouldCaptureSuccessScreenshot(action: BrowserAction): boolean {
  return action.actionType === "screenshot"
    || action.payload.captureSuccessScreenshot === true
    || action.payload.retainSuccessScreenshot === true;
}
