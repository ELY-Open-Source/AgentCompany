import { useState, useCallback } from "react";
import {
  CaretDown,
  CaretRight,
  FolderSimple,
  GithubLogo,
  Globe,
  Link,
  PuzzlePiece,
} from "@phosphor-icons/react";
import type { SkillRecord } from "@shared/types";
import { SkillFileTree, buildTree } from "./SkillFileTree";

const sourceIconMap: Record<string, typeof GithubLogo> = {
  github: GithubLogo,
  local_path: FolderSimple,
  url: Link,
  skills_sh: Globe,
  managed: PuzzlePiece,
};

export function SkillList({
  skills,
  selectedSkillId,
  skillFilter,
  onSelectSkill,
}: {
  skills: SkillRecord[];
  selectedSkillId: string | null;
  skillFilter: string;
  onSelectSkill: (id: string) => void;
}) {
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, Set<string>>>({});
  const [selectedPaths, setSelectedPaths] = useState<Record<string, string>>({});

  const filteredSkills = skills.filter((skill) => {
    const haystack = `${skill.name} ${skill.key} ${skill.slug}`.toLowerCase();
    return haystack.includes(skillFilter.toLowerCase());
  });

  const handleToggleSkill = useCallback((skillId: string) => {
    setExpandedSkillId((prev) => (prev === skillId ? null : skillId));
  }, []);

  const handleToggleDir = useCallback((skillId: string, path: string) => {
    setExpandedDirs((prev) => {
      const current = prev[skillId] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { ...prev, [skillId]: next };
    });
  }, []);

  const handleSelectPath = useCallback((skillId: string, path: string) => {
    setSelectedPaths((prev) => ({ ...prev, [skillId]: path }));
  }, []);

  if (filteredSkills.length === 0) {
    return (
      <div className="px-4 py-6 text-[13px] text-[color:var(--muted)]">
        No skills match this filter.
      </div>
    );
  }

  return (
    <div>
      {filteredSkills.map((skill) => {
        const isExpanded = expandedSkillId === skill.id;
        const isSelected = skill.id === selectedSkillId;
        const tree = buildTree(skill.fileInventory);
        const SourceIcon = sourceIconMap[skill.sourceType] ?? PuzzlePiece;
        const dirState = expandedDirs[skill.id] ?? new Set<string>();
        const filePath = selectedPaths[skill.id] ?? "SKILL.md";

        return (
          <div key={skill.id} className="border-b border-[color:var(--line)]">
            <div
              className={`group flex items-center gap-2 px-3 py-1.5 hover:bg-[color:var(--panel-soft)] ${
                isSelected ? "text-[color:var(--text)]" : "text-[color:var(--muted)]"
              }`}
            >
              <SourceIcon
                size={14}
                className="shrink-0 opacity-75 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectSkill(skill.id)}
              >
                <span className="text-[13px] font-medium leading-5 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
                  {skill.name}
                </span>
              </button>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-[color:var(--muted)] opacity-60 transition-opacity hover:bg-[color:var(--panel-soft)] hover:opacity-100"
                onClick={() => handleToggleSkill(skill.id)}
                aria-label={isExpanded ? "Collapse file tree" : "Expand file tree"}
              >
                {isExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
              </button>
            </div>
            <div
              className="overflow-hidden transition-[grid-template-rows] duration-200"
              style={{
                display: "grid",
                gridTemplateRows: isExpanded ? "1fr" : "0fr",
              }}
            >
              <div className="min-h-0">
                {tree.length > 0 && (
                  <SkillFileTree
                    nodes={tree}
                    selectedPath={filePath}
                    expandedDirs={dirState}
                    onToggleDir={(path) => handleToggleDir(skill.id, path)}
                    onSelectPath={(path) => handleSelectPath(skill.id, path)}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
