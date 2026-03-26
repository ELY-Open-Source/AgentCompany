import { useCallback, useEffect, useState } from "react";
import {
  MagnifyingGlass,
  Plus,
  PuzzlePiece,
} from "@phosphor-icons/react";
import type { AgentRecord } from "@shared/types";
import { useAppStore } from "../../state/store";
import { EmptyState } from "../ui";
import { SkillList } from "./SkillList";
import { SkillImportModal } from "./SkillImportModal";

export function SkillsSection({
  companyId,
  agents: _agents,
  onRefresh: _onRefresh,
}: {
  companyId: string;
  agents: AgentRecord[];
  onRefresh: () => void;
}) {
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

  const selectedSkill = skills.find((s) => s.id === selectedSkillId);

  return (
    <div className="grid h-full grid-cols-1 xl:grid-cols-[19rem_minmax(0,1fr)]">
      {/* Left column -- skill list sidebar */}
      <aside className="flex flex-col overflow-y-auto border-r border-[color:var(--line)]">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 px-4 py-3">
          <h2 className="text-[20px] font-bold tracking-[-0.025em] text-[color:var(--text)]">
            Skills
          </h2>
          {skills.length > 0 && (
            <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[color:var(--panel-soft)] px-1.5 text-[11px] font-semibold text-[color:var(--muted-strong)]">
              {skills.length}
            </span>
          )}
          <button
            type="button"
            className="focus-ring ml-auto flex h-7 w-7 items-center justify-center rounded-[6px] text-[color:var(--muted)] transition hover:bg-[color:var(--panel-soft)] hover:text-[color:var(--text)]"
            onClick={() => setSkillImportModalOpen(true)}
            aria-label="Import skill"
          >
            <Plus size={16} weight="bold" />
          </button>
        </div>

        {/* Filter input */}
        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <MagnifyingGlass
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]"
              aria-hidden="true"
            />
            <input
              className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] py-2 pl-8 pr-3 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]"
              value={skillFilter}
              onChange={(e) => setSkillFilter(e.target.value)}
              placeholder="Filter skills..."
              aria-label="Filter skills"
            />
          </div>
        </div>

        {/* Skill list */}
        <div className="flex-1 overflow-y-auto">
          {skills.length === 0 ? (
            <EmptyState
              title="No skills imported"
              detail="Import skills from GitHub, a local path, or skills.sh to get started."
              action={
                <button
                  type="button"
                  className="focus-ring inline-flex items-center gap-2 rounded-[8px] border border-transparent bg-[color:var(--accent)] px-4 py-2.5 text-[12px] font-bold text-[color:var(--text-on-accent)] shadow-[0_1px_3px_rgba(74,93,122,0.35)] transition hover:bg-[color:var(--accent-hover)]"
                  onClick={() => setSkillImportModalOpen(true)}
                >
                  <Plus size={14} weight="bold" />
                  Import Skill
                </button>
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
        {selectedSkill ? (
          <div className="flex flex-1 items-center justify-center p-8 text-[color:var(--muted)]">
            <div className="text-center">
              <PuzzlePiece size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-[14px] font-medium text-[color:var(--text)]">{selectedSkill.name}</p>
              <p className="mt-1 text-[13px]">Skill detail pane -- Plan 02</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState
              title="Select a skill to view details"
              detail="Choose a skill from the list to see its content, file tree, and configuration."
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
