import { Avatar, Icon, IconButton, Pill } from "../../shared/ui";
import { humanizeToken } from "../types";
import { t } from "../../i18n/i18n";
import type { AgentActivity, OfficeAgentInput } from "./office-types";

const ACTIVITY_LABEL: Record<AgentActivity, string> = {
  active: t("Active"),
  thinking: t("Thinking"),
  busy: t("Busy"),
  idle: t("Idle"),
};

const ACTIVITY_TONE: Record<AgentActivity, "green" | "violet" | "amber" | undefined> = {
  active: "green",
  thinking: "violet",
  busy: "amber",
  idle: undefined,
};

/**
 * Floating profile card for the agent selected on the office floor. The page
 * owns its placement (it follows the sprite); the card only sizes itself.
 */
export function AgentDetailCard({ agent, onClose }: { agent: OfficeAgentInput; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={t("Agent {name}", { name: agent.name })}
      style={{
        width: 264,
        background: "var(--panel)",
        border: "1px solid var(--border-strong)",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(16,16,24,0.18)",
        padding: 14,
      }}
    >
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <Avatar name={agent.name} size="lg" bot />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, wordBreak: "break-word" }}>{agent.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 1, wordBreak: "break-word" }}>{agent.title}</div>
        </div>
        <IconButton icon="x" label={t("Close agent details")} onClick={onClose} />
      </div>
      <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <Pill>{agent.department}</Pill>
        <Pill>{humanizeToken(agent.roleLevel)}</Pill>
        <Pill tone={ACTIVITY_TONE[agent.activity]} dot>{ACTIVITY_LABEL[agent.activity]}</Pill>
      </div>
      {agent.taskTitle && (
        <div className="row" style={{ gap: 7, marginTop: 12, alignItems: "flex-start" }}>
          <Icon name="work" size={13} color="var(--text-3)" />
          <span
            style={{
              fontSize: 12,
              color: "var(--text-2)",
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {agent.taskTitle}
          </span>
        </div>
      )}
    </div>
  );
}
