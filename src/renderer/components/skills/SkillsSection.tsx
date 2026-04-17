import { useCallback, useEffect, useState } from "react";
import {
  MagnifyingGlass,
  Plus,
} from "../ui/icons";
import type { AgentRecord } from "@shared/types";
import { useAppStore } from "../../state/store";
import { ActionButton, EmptyState } from "../ui";
import { SkillList } from "./SkillList";
import { SkillImportModal } from "./SkillImportModal";
import { SkillDetail } from "./SkillDetail";
import { useT } from "../../i18n";

export function SkillsSection({
  companyId,
  agents,
  onRefresh: _onRefresh,
}: {
  companyId: string;
  agents: AgentRecord[];
  onRefresh: () => void;
}) {
  const t = useT();
  const skills = useAppStore((s) => s.skills);
  const setSkills = useAppStore((s) => s.setSkills);
  const selectedSkillId = useAppStore((s) => s.selectedSkillId);
  const setSelectedSkillId = useAppStore((s) => s.setSelectedSkillId);
  const skillImportModalOpen = useAppStore((s) => s.skillImportModalOpen);
  const setSkillImportModalOpen = useAppStore((s) => s.setSkillImportModalOpen);
  const addToast = useAppStore((s) => s.addToast);

  const [skillFilter, setSkillFilter] = useState("");

  const loadSkills = useCallback(async () => {
    try {
      const result = await window.agentCompany.listSkills(companyId);
      if (result.ok) {
        setSkills(result.data);
      } else {
        addToast(result.error.message, "danger");
      }
    } catch (error) {
      addToast(error instanceof Error ? error.message : "Failed to load skills", "danger");
    }
  }, [companyId, setSkills, addToast]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const handleImported = useCallback(() => {
    void loadSkills();
  }, [loadSkills]);

  const handleSelectSkill = useCallback(
    (id: string) => {
      setSelectedSkillId(id);
    },
    [setSelectedSkillId],
  );

  return (
    <div className="grid h-full grid-cols-1 xl:grid-cols-[19rem_minmax(0,1fr)]">
      {/* Left column -- skill list sidebar */}
      <aside className="flex flex-col overflow-y-auto border-r border-border">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 px-4 py-3">
          <h2 className="text-[20px] font-bold tracking-[-0.025em] text-foreground">
            {t("skills.title")}
          </h2>
          {skills.length > 0 && (
            <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
              {skills.length}
            </span>
          )}
          <button
            type="button"
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={() => setSkillImportModalOpen(true)}
            aria-label={t("skills.importAria")}
          >
            <Plus size={16} weight="bold" />
          </button>
        </div>

        {/* Filter input */}
        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 w-full rounded-lg border border-border bg-card py-2 pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground"
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              placeholder={t("skills.filterPlaceholder")}
              aria-label={t("skills.filterAria")}
            />
          </div>
        </div>

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto">
          {skills.length === 0 ? (
            <EmptyState
              title={t("skills.emptyTitle")}
              detail={t("skills.emptyDetail")}
              action={
                <ActionButton
                  label={t("skills.importButton")}
                  icon={Plus}
                  tone="accent"
                  onClick={() => setSkillImportModalOpen(true)}
                />
              }
            />
          ) : (
            <SkillList
              skills={skills}
              selectedSkillId={selectedSkillId}
              skillFilter={skillFilter}
              onSelectSkill={handleSelectSkill}
            />
          )}
        </div>
      </aside>

      {/* Right column -- skill detail */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {selectedSkillId ? (
          <SkillDetail
            companyId={companyId}
            skillId={selectedSkillId}
            agents={agents}
            onDeleted={() => { setSelectedSkillId(null); void loadSkills(); }}
            onRefresh={() => void loadSkills()}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              title={t("skills.selectToViewTitle")}
              detail={t("skills.selectToViewDetail")}
            />
          </div>
        )}
      </div>

      {/* Import modal */}
      <SkillImportModal
        open={skillImportModalOpen}
        onClose={() => setSkillImportModalOpen(false)}
        companyId={companyId}
        onImported={handleImported}
      />
    </div>
  );
}
