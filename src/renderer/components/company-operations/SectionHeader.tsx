import { Plus } from "@phosphor-icons/react";
import { ActionButton } from "../ui";

export function SectionHeader({
  title,
  count,
  action,
}: {
  title: string;
  count: number;
  action: () => void;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <div className="text-[16px] font-semibold text-[color:var(--text)]">{title}</div>
        <div className="text-[12px] text-[color:var(--muted)]">{count} item{count === 1 ? "" : "s"}</div>
      </div>
      <ActionButton label="New" icon={Plus} tone="accent" onClick={action} />
    </div>
  );
}
