import { AnimatePresence, motion } from "framer-motion";
import { ArrowBendUpLeft, X } from "../../ui/icons";
import type { AgentMessageRecord, AgentRecord } from "@shared/types";
import { useT } from "../../../i18n";

interface ComposerReplyBannerProps {
  replyTo: AgentMessageRecord | null;
  agents: AgentRecord[];
  onCancel: () => void;
}

export function ComposerReplyBanner({ replyTo, agents, onCancel }: ComposerReplyBannerProps) {
  const t = useT();
  return (
    <AnimatePresence>
      {replyTo ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="mb-2 flex items-center gap-2 overflow-hidden rounded-lg bg-muted px-3 py-2"
        >
          <ArrowBendUpLeft size={12} className="text-primary" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {t("composer.replyingTo")}{" "}
            <span className="font-semibold">
              {agents.find((a) => a.id === replyTo.fromAgentId)?.name ?? t("composer.replyingToAgent")}
            </span>
            {replyTo.subject ? `: ${replyTo.subject}` : ""}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-[4px] p-0.5 text-muted-foreground transition hover:text-foreground"
          >
            <X size={12} />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
