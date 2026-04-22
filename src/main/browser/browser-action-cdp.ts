import type { WebContents } from "electron";
import { browserNotLoggedIn, browserSelectorDrift, browserVerificationFailed } from "./browser-action-errors";
import { isAppError } from "../errors/index.js";

type RuntimeEvaluateResult = {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string };
};

type ElementProbe = {
  selector: string;
  x: number;
  y: number;
  text: string;
};

const POLL_INTERVAL_MS = 250;

export class BrowserCdpClient {
  private attachedByClient = false;
  private retryCount = 0;

  constructor(
    private readonly webContents: WebContents,
    private readonly platform: string,
    private readonly actionType: string,
  ) {}

  async attach(): Promise<void> {
    if (this.webContents.debugger.isAttached()) return;
    this.webContents.debugger.attach("1.3");
    this.attachedByClient = true;
  }

  async dispose(): Promise<void> {
    if (this.attachedByClient && this.webContents.debugger.isAttached()) {
      this.webContents.debugger.detach();
    }
  }

  getRetryCount(): number {
    return this.retryCount;
  }

  async evaluate<T>(expression: string): Promise<T> {
    await this.attach();
    const response = await this.webContents.debugger.sendCommand("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }) as RuntimeEvaluateResult;
    if (response.exceptionDetails) {
      throw browserVerificationFailed(
        this.platform,
        this.actionType,
        response.exceptionDetails.text ?? "runtime evaluation failed",
      );
    }
    return response.result?.value as T;
  }

  async clickFirst(candidates: readonly string[], selectorKey: string, timeoutMs = 10_000): Promise<string> {
    const element = await this.waitForElement(candidates, selectorKey, timeoutMs);
    await this.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: element.x,
      y: element.y,
      button: "none",
    });
    await this.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: element.x,
      y: element.y,
      button: "left",
      clickCount: 1,
    });
    await this.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: element.x,
      y: element.y,
      button: "left",
      clickCount: 1,
    });
    return element.selector;
  }

  async clickOptional(candidates: readonly string[], selectorKey: string, timeoutMs = 1_500): Promise<string | null> {
    try {
      return await this.clickFirst(candidates, selectorKey, timeoutMs);
    } catch (error) {
      if (!isAppError(error) || error.code !== "browser.selector_drift") throw error;
      return null;
    }
  }

  async waitForFirst(candidates: readonly string[], selectorKey: string, timeoutMs = 10_000): Promise<string> {
    return (await this.waitForElement(candidates, selectorKey, timeoutMs)).selector;
  }

  async waitForAuthenticatedSurface(
    candidates: readonly string[],
    authenticatedCookieNames?: readonly string[],
    timeoutMs = 5_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const selector = await this.evaluate<string | null>(
        buildAuthenticatedSurfaceExpression(candidates, authenticatedCookieNames ?? []),
      );
      if (selector) return selector;
      this.retryCount += 1;
      await delay(POLL_INTERVAL_MS);
    }
    throw browserNotLoggedIn(this.platform, this.actionType);
  }

  async focusAndType(candidates: readonly string[], text: string, selectorKey: string): Promise<string> {
    const selector = await this.clickFirst(candidates, selectorKey);
    await this.webContents.debugger.sendCommand("Input.insertText", { text });
    return selector;
  }

  async waitForText(
    candidates: readonly string[],
    expectedText: string,
    timeoutMs = 12_000,
  ): Promise<void> {
    const fingerprint = expectedText.trim().slice(0, 40);
    if (fingerprint.length === 0) {
      throw browserVerificationFailed(this.platform, this.actionType, "empty text fingerprint");
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const matched = await this.evaluate<boolean>(buildTextMatchExpression(candidates, fingerprint));
      if (matched) return;
      this.retryCount += 1;
      await delay(POLL_INTERVAL_MS);
    }
    throw browserVerificationFailed(this.platform, this.actionType, `text not found after submit: ${fingerprint}`);
  }

  async waitForAnyText(candidates: readonly string[], timeoutMs = 10_000): Promise<string[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const texts = await this.evaluate<string[]>(buildVisibleTextsExpression(candidates));
      if (texts.length > 0) return texts;
      this.retryCount += 1;
      await delay(POLL_INTERVAL_MS);
    }
    throw browserSelectorDrift(this.platform, this.actionType, "content_items");
  }

  private async waitForElement(
    candidates: readonly string[],
    selectorKey: string,
    timeoutMs: number,
  ): Promise<ElementProbe> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const element = await this.evaluate<ElementProbe | null>(buildElementProbeExpression(candidates));
      if (element) return element;
      this.retryCount += 1;
      await delay(POLL_INTERVAL_MS);
    }
    throw browserSelectorDrift(this.platform, this.actionType, selectorKey);
  }
}

function buildElementProbeExpression(candidates: readonly string[]): string {
  return `(() => {
    const candidates = ${JSON.stringify(candidates)};
    for (const selector of candidates) {
      const elements = Array.from(document.querySelectorAll(selector));
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const disabled = element.disabled === true || element.getAttribute("aria-disabled") === "true";
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none" || disabled) continue;
        element.scrollIntoView({ block: "center", inline: "center" });
        const nextRect = element.getBoundingClientRect();
        return {
          selector,
          x: nextRect.left + nextRect.width / 2,
          y: nextRect.top + nextRect.height / 2,
          text: (element.innerText || element.textContent || "").slice(0, 200)
        };
      }
    }
    return null;
  })()`;
}

function buildTextMatchExpression(candidates: readonly string[], fingerprint: string): string {
  return `(() => {
    const candidates = ${JSON.stringify(candidates)};
    const fingerprint = ${JSON.stringify(fingerprint)};
    for (const selector of candidates) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const text = element.innerText || element.textContent || "";
        if (text.includes(fingerprint)) return true;
      }
    }
    return false;
  })()`;
}

function buildVisibleTextsExpression(candidates: readonly string[]): string {
  return `(() => {
    const out = [];
    const candidates = ${JSON.stringify(candidates)};
    for (const selector of candidates) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const text = (element.innerText || element.textContent || "").trim();
        if (text.length > 0) out.push(text.slice(0, 300));
        if (out.length >= 20) return out;
      }
    }
    return out;
  })()`;
}

function buildAuthenticatedSurfaceExpression(
  candidates: readonly string[],
  authenticatedCookieNames: readonly string[],
): string {
  return `(() => {
    const candidates = ${JSON.stringify(candidates)};
    for (const selector of candidates) {
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") continue;
        return selector;
      }
    }
    const cookie = document.cookie || "";
    const authenticatedCookieNames = ${JSON.stringify(authenticatedCookieNames.map((name) => name.toLowerCase()))};
    if (authenticatedCookieNames.length === 0 && cookie.trim().length > 0) return "document.cookie";
    const cookieNames = new Set(cookie.split(";").map((part) => part.split("=")[0]?.trim().toLowerCase()).filter(Boolean));
    for (const name of authenticatedCookieNames) {
      if (cookieNames.has(name)) return "document.cookie:" + name;
    }
    return null;
  })()`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
