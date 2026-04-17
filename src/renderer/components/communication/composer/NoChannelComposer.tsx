import { ChatCircle } from "../../ui/icons";
import { useT } from "../../../i18n";

export function NoChannelComposer() {
  const t = useT();
  return (
    <div className="border-t border-border bg-card px-4 py-2.5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <ChatCircle size={14} />
        <span>{t("comm.selectChannelSend")}</span>
      </div>
    </div>
  );
}
