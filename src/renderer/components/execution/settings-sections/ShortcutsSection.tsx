import { Eyebrow } from "../../ui";
import { useT } from "../../../i18n";
import { isMac } from "../../../lib/platform";

/**
 * Read-only keyboard shortcut reference. Listed in the settings page
 * because this is where users look when they want to remember how to
 * invoke a hotkey; it is NOT a configurable surface — so the visuals
 * are lighter than the other settings sections (no active state, no
 * action buttons).
 */
export function ShortcutsSection() {
  const t = useT();
  const mac = isMac();

  const rows: Array<[string, string]> = [
    [mac ? "⌘K" : "Ctrl+K", t("settings.shortcut.commandPalette")],
    [mac ? "⌘Enter" : "Ctrl+Enter", t("settings.shortcut.sendMessage")],
    ["Escape", t("settings.shortcut.closeModal")],
    ["↑ / ↓", t("settings.shortcut.navigatePalette")],
    ["Enter", t("settings.shortcut.selectPaletteResult")],
    ["Tab", t("settings.shortcut.moveFocus")],
  ];

  return (
    <div>
      <Eyebrow className="mb-3">{t("settings.keyboardShortcuts")}</Eyebrow>
      <div className="divide-y divide-border rounded-lg border border-border">
        {rows.map(([key, description]) => (
          <div key={key} className="flex items-center justify-between px-3 py-2 text-[12px]">
            <span className="text-muted-foreground">{description}</span>
            <kbd className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-foreground">
              {key}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
