import type { ProfileSnapshot } from "@shared/types";
import { Input } from "../ui";
import { useT } from "../../i18n";

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

export { Input };

export interface ModelEntry {
  id: string;
  label: string;
  enabled: boolean;
}

export type ConnectorStatus = ProfileSnapshot["connectors"][number]["status"];

/* ------------------------------------------------------------------ */
/*  StatusBadge                                                        */
/* ------------------------------------------------------------------ */

export function StatusBadge({ status }: { status: ConnectorStatus }) {
  const t = useT();
  if (status === "ready") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-success-muted px-2 py-0.5 text-[11px] font-medium text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {t("models.ready")}
      </span>
    );
  }
  if (status === "not_installed") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        {t("models.notInstalled")}
      </span>
    );
  }
  if (status === "auth_required") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        {t("models.authRequired")}
      </span>
    );
  }
  if (status === "detected" || (status as string) === "checking") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted-foreground border-t-primary" />
        {t("models.checking")}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-caution-muted px-2 py-0.5 text-[11px] font-medium text-caution">
      <span className="h-1.5 w-1.5 rounded-full bg-caution" />
      {status.replaceAll("_", " ")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Toggle switch                                                      */
/* ------------------------------------------------------------------ */

export function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-success" : "bg-muted-foreground/30"}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-[3px]"}`}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Model toggle list                                                  */
/* ------------------------------------------------------------------ */

import { X as XIcon } from "../ui/icons";

export function ModelToggleList({
  models,
  onToggle,
  onRemove,
  canRemove,
}: {
  models: ModelEntry[];
  onToggle: (id: string) => void;
  onRemove?: (id: string) => void;
  canRemove: boolean;
}) {
  const t = useT();
  if (models.length === 0) {
    return (
      <div className="text-[12px] text-muted-foreground">
        {t("models.noModels")}
      </div>
    );
  }
  return (
    <div>
      <div className="space-y-1">
        {models.map((m) => (
          <div
            key={m.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2"
          >
            <div className="flex items-center gap-2.5">
              <ToggleSwitch
                checked={m.enabled}
                onChange={() => onToggle(m.id)}
                label={(m.enabled ? t("models.disableToggle") : t("models.enableToggle")).replace("{name}", m.label)}
              />
              <span
                className={`text-[12px] ${m.enabled ? "text-foreground" : "text-muted-foreground line-through"}`}
              >
                {m.label}
              </span>
            </div>
            {canRemove && onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(m.id)}
                className="text-muted-foreground transition hover:text-destructive"
                aria-label={t("models.removeModel").replace("{name}", m.label)}
              >
                <XIcon size={12} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
