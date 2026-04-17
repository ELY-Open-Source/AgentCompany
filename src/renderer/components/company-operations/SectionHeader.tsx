import { Plus } from "../ui/icons";
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
        <div className="text-[16px] font-semibold text-foreground">{title}</div>
        <div className="text-[12px] text-muted-foreground">{count} item{count === 1 ? "" : "s"}</div>
      </div>
      <ActionButton label="New" icon={Plus} tone="accent" onClick={action} />
    </div>
  );
}
