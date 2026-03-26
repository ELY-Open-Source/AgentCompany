import type { AgentRecord } from "@shared/types";

interface SkillsSectionProps {
  companyId: string;
  agents: AgentRecord[];
  onRefresh: () => void;
}

export function SkillsSection({ companyId: _companyId, agents: _agents, onRefresh: _onRefresh }: SkillsSectionProps) {
  return (
    <div className="h-full">
      <p className="text-[color:var(--muted)]">Skills section placeholder -- Task 2</p>
    </div>
  );
}
