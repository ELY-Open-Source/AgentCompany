import { describe, it, expect } from "vitest";
import {
  formatDateLabel,
  formatPlainLabel,
  shouldRenderLabel,
} from "../../src/renderer/components/dashboard/charts/ChartTooltip";

// The <ChartTooltip /> component itself is a thin shell around three pure
// helpers. Testing the helpers covers every branch of the rendered output:
//
//   formatDateLabel    → "date" mode default formatter
//   formatPlainLabel   → "plain" mode default formatter
//   shouldRenderLabel  → whether the top label row is rendered at all
//
// Rendering JSX here would require adding @testing-library/react + jsdom just
// to re-check what the helpers already decide. The vitest config also only
// picks up *.test.ts (not .tsx), so keeping the test purely functional avoids
// expanding the harness for one component.

describe("formatDateLabel (date mode)", () => {
  it("formats a valid ISO date string into Mon DD, YYYY", () => {
    expect(formatDateLabel("2026-03-15")).toBe("Mar 15, 2026");
  });

  it("falls back to the original string on an Invalid Date", () => {
    // "not-a-date" cannot be parsed; formatter must return the input verbatim
    // rather than "Invalid Date" leaking to the UI.
    expect(formatDateLabel("not-a-date")).toBe("not-a-date");
  });

  it("stringifies non-string labels (numbers) instead of trying to parse them", () => {
    expect(formatDateLabel(42)).toBe("42");
  });
});

describe("formatPlainLabel (plain mode)", () => {
  it("passes a regular string through unchanged", () => {
    expect(formatPlainLabel("Alice")).toBe("Alice");
  });

  it("stringifies numbers", () => {
    expect(formatPlainLabel(7)).toBe("7");
  });

  it("returns empty string for null/undefined instead of 'null'/'undefined'", () => {
    expect(formatPlainLabel(undefined)).toBe("");
    // @ts-expect-error — runtime behavior for null is the contract we care about
    expect(formatPlainLabel(null)).toBe("");
  });
});

describe("shouldRenderLabel (empty label suppression)", () => {
  it("returns false for undefined", () => {
    expect(shouldRenderLabel(undefined)).toBe(false);
  });

  it("returns false for null", () => {
    // @ts-expect-error — recharts can hand us null at runtime
    expect(shouldRenderLabel(null)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(shouldRenderLabel("")).toBe(false);
  });

  it("returns true for a non-empty string", () => {
    expect(shouldRenderLabel("2026-03-15")).toBe(true);
  });

  it("returns true for a number (including 0)", () => {
    expect(shouldRenderLabel(0)).toBe(true);
    expect(shouldRenderLabel(42)).toBe(true);
  });
});
