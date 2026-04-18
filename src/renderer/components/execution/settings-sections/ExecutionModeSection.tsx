import { useState } from "react";
import type { CompanyRecord } from "@shared/types";
import { Eyebrow } from "../../ui";
import { useT } from "../../../i18n";
import { unwrap } from "../../../lib/desktop";
import { describeActionError } from "../execution-utils";
import { useAppStore } from "../../../state/store";

interface ExecutionModeSectionProps {
  company: CompanyRecord;
  onSaved: () => Promise<void>;
}

/**
 * AI CEO vs AI Co-Founder toggle — company-scoped. The header line
 * makes the scope explicit ("当前公司：X") so multi-company users know
 * which company they are changing.
 */
export function ExecutionModeSection({ company, onSaved }: ExecutionModeSectionProps) {
  const t = useT();
  const addToast = useAppStore((s) => s.addToast);
  const [error, setError] = useState<string | null>(null);
  const isCeo = company.executionMode !== "ai_cofounder";

  const applyMode = async (mode: "ai_ceo" | "ai_cofounder") => {
    if ((mode === "ai_ceo" && isCeo) || (mode === "ai_cofounder" && !isCeo)) return;
    setError(null);
    try {
      unwrap(
        await window.agentCompany.saveCompany({
          id: company.id,
          name: company.name,
          description: company.description,
          status: company.status,
          autoApproveHires: mode === "ai_ceo",
          reviewDeliverables: mode === "ai_cofounder",
          executionMode: mode,
        }),
      );
      await onSaved();
      addToast(t("exec.modeSwitched"), "success");
    } catch (err) {
      setError(describeActionError(err));
    }
  };

  return (
    <div>
      <Eyebrow className="mb-1">{t("exec.executionMode")}</Eyebrow>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {t("settings.modeScope").replace("{company}", company.name)}
      </p>
      <div className="space-y-3">
        <ModeCard
          label="AI CEO"
          tag={t("exec.modeCeoTag")}
          description={t("exec.modeCeoDesc")}
          selected={isCeo}
          onClick={() => void applyMode("ai_ceo")}
        />
        <ModeCard
          label="AI Co-Founder"
          tag={t("exec.modeCofounderTag")}
          description={t("exec.modeCofounderDesc")}
          selected={!isCeo}
          onClick={() => void applyMode("ai_cofounder")}
        />
      </div>
      {error ? <p className="mt-3 text-[12px] text-destructive">{error}</p> : null}
    </div>
  );
}

function ModeCard({
  label,
  tag,
  description,
  selected,
  onClick,
}: {
  label: string;
  tag: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full rounded-lg border-2 px-4 py-3 text-left transition ${
        selected
          ? "border-[color:var(--primary)] bg-accent"
          : "cursor-pointer border-border bg-muted hover:border-[color:var(--muted-foreground)]"
      }`}
    >
      <div className="text-[13px] font-semibold text-foreground">
        {label}
        <span className="ml-2 text-[10px] font-normal text-muted-foreground">{tag}</span>
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</div>
    </button>
  );
}
