import { useState } from "react";
import type { ProfileSnapshot } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { COMPAT_SLOTS } from "./ModelManagementShared";
import { NativeProviderCard } from "./NativeProviderCard";
import { CompatProviderCard } from "./CompatProviderCard";

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

interface ModelManagementProps {
  connectors: ProfileSnapshot["connectors"];
  locale: AppLocale;
  onSaved: () => Promise<void>;
}

export function ModelManagement({
  connectors,
  locale,
  onSaved,
}: ModelManagementProps) {
  const zh = locale === "zh";
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const claudeConnector = connectors.find((c) => c.id === "claude_local");
  const codexConnector = connectors.find((c) => c.id === "codex_local");
  const geminiConnector = connectors.find((c) => c.id === "gemini_local");

  const activeCompatSlots = COMPAT_SLOTS.filter((id) => {
    const c = connectors.find((conn) => conn.id === id);
    return (
      c &&
      (c.envBindingText.includes("ANTHROPIC_BASE_URL") ||
        c.envBindingText.includes("ANTHROPIC_API_KEY"))
    );
  });
  const nextAvailableSlot =
    COMPAT_SLOTS.find((id) => !activeCompatSlots.includes(id)) ?? null;
  const visibleCompatSlots = [...activeCompatSlots];
  if (nextAvailableSlot && !visibleCompatSlots.includes(nextAvailableSlot)) {
    visibleCompatSlots.push(nextAvailableSlot);
  }

  const toggle = (card: string) =>
    setExpandedCard((prev) => (prev === card ? null : card));

  return (
    <div className="space-y-3">
      {claudeConnector ? (
        <NativeProviderCard
          connector={claudeConnector}
          zh={zh}
          onSaved={onSaved}
          expanded={expandedCard === "claude_local"}
          onToggle={() => toggle("claude_local")}
        />
      ) : null}

      {codexConnector ? (
        <NativeProviderCard
          connector={codexConnector}
          zh={zh}
          onSaved={onSaved}
          expanded={expandedCard === "codex_local"}
          onToggle={() => toggle("codex_local")}
        />
      ) : null}

      {geminiConnector ? (
        <NativeProviderCard
          connector={geminiConnector}
          zh={zh}
          onSaved={onSaved}
          expanded={expandedCard === "gemini_local"}
          onToggle={() => toggle("gemini_local")}
        />
      ) : null}

      {visibleCompatSlots.map((slotId) => (
        <CompatProviderCard
          key={slotId}
          slotId={slotId}
          connector={connectors.find((c) => c.id === slotId) ?? null}
          zh={zh}
          onSaved={onSaved}
          expanded={expandedCard === slotId}
          onToggle={() => toggle(slotId)}
          onCleared={() => setExpandedCard(null)}
        />
      ))}
    </div>
  );
}
