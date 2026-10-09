import { t } from "../../i18n/i18n";

/** Where a setting takes effect: only the current company, every company in this app, or the company with folders on this computer. */
export type SettingScope = "company" | "app" | "company_folders";

/** Says, under a settings section, what a change there affects. */
export function ScopeNote({ scope, company }: { scope: SettingScope; company: string }) {
  const text = scope === "app"
    ? t("Applies to every company in this app.")
    : scope === "company_folders"
      ? t("Applies to {company} only; the folders are on this computer.", { company })
      : t("Applies to {company} only.", { company });
  return <div role="note" className="scope-note" style={{ fontSize: "var(--fs-body)", color: "var(--text-3)", margin: "4px 0 10px" }}>{text}</div>;
}
