/**
 * Compute pixel coordinates of the caret inside a textarea relative to the
 * textarea's own top-left corner. Uses a hidden mirror div that replicates
 * the textarea's type/font metrics so the span we drop at the caret offset
 * lays out in the same position the real caret does.
 */
export function getTextareaCaretCoords(
  textarea: HTMLTextAreaElement,
  caretIndex: number,
): { top: number; left: number } {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const mirrorStyle = mirror.style;

  const copyProps = [
    "boxSizing",
    "width",
    "height",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "fontVariant",
    "lineHeight",
    "letterSpacing",
    "wordSpacing",
    "textTransform",
    "textIndent",
    "whiteSpace",
    "wordWrap",
  ] as const;
  for (const prop of copyProps) {
    mirrorStyle[prop as never] = style[prop as never];
  }
  mirrorStyle.position = "absolute";
  mirrorStyle.visibility = "hidden";
  mirrorStyle.overflow = "hidden";
  mirrorStyle.whiteSpace = "pre-wrap";
  mirrorStyle.wordWrap = "break-word";
  mirrorStyle.top = "0";
  mirrorStyle.left = "-9999px";

  mirror.textContent = textarea.value.slice(0, caretIndex);
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const coords = {
    top: marker.offsetTop - textarea.scrollTop,
    left: marker.offsetLeft - textarea.scrollLeft,
  };
  document.body.removeChild(mirror);
  return coords;
}

export interface CaretMeasurement {
  top: number;
  left: number;
  lineHeight: number;
}

export function measureCaret(
  textarea: HTMLTextAreaElement,
  caretIndex: number,
): CaretMeasurement {
  const coords = getTextareaCaretCoords(textarea, caretIndex);
  const style = window.getComputedStyle(textarea);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
  return { top: coords.top, left: coords.left, lineHeight };
}
