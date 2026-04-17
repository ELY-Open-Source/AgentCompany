import { useEffect } from "react";
import { SkillAgentToggles } from "../../../../skills/SkillAgentToggles";
import { useAppStore } from "../../../../../state/store";
import { useT } from "../../../../../i18n";
import { SectionHeader } from "./SectionHeader";

interface SkillsSectionProps {
  companyId: string;
  agentId: string;
}

/**
 * Skills assignment for this agent. Pulls the company skill catalog via
 * the store (fetched lazily if not already populated) and renders
 * SkillAgentToggles inside the shared SectionHeader so it reads with the
 * same rhythm as Identity / Runtime / Constraints.
 */
export function SkillsSection({ companyId, agentId }: SkillsSectionProps) {
  const t = useT();
  const skills = useAppStore((s) => s.skills);
  const setSkills = useAppStore((s) => s.setSkills);

  useEffect(() => {
    if (skills.length === 0 && companyId) {
      window.agentCompany.listSkills(companyId).then((result) => {
        if (result.ok) setSkills(result.data);
      });
    }
  }, [companyId, skills.length, setSkills]);

  return (
    <SectionHeader title={t("agent.skills")}>
      <SkillAgentToggles mode="agent" companyId={companyId} agentId={agentId} skills={skills} />
    </SectionHeader>
  );
}
