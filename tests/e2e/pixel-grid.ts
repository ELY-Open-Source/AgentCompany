import type { Page } from "@playwright/test";

/** Visible text off the pixel font's grid: a size other than its 1x or 2x, or added letter spacing; code excepted. */
export function offGridText(page: Page) {
  return page.evaluate(() => {
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px"));
    const sizes = [12 * scale, 24 * scale];
    const odd: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const own = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "");
      if (!own || element.closest("svg, canvas, .sr-only")) continue;
      const style = getComputedStyle(element);
      if (style.fontFamily.includes("Geist Mono") || element.getClientRects().length === 0) continue;
      const size = parseFloat(style.fontSize);
      const spaced = style.letterSpacing !== "normal" && parseFloat(style.letterSpacing) !== 0;
      if (spaced || !sizes.some((grid) => Math.abs(grid - size) < 0.01)) odd.push(`${element.tagName}.${element.className} ${size}px ${style.letterSpacing} "${element.textContent!.trim().slice(0, 30)}"`);
    }
    return odd;
  });
}
