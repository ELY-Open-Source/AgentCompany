import { ChartLine } from "@phosphor-icons/react";

interface ChartCardProps {
  title: string;
  period?: string;
  isEmpty?: boolean;
  emptyHeading?: string;
  emptyBody?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}

export function ChartCard({
  title,
  period = "14d",
  isEmpty = false,
  emptyHeading = "No activity yet",
  emptyBody = "Charts will appear once your company starts running tasks.",
  ariaLabel,
  children,
}: ChartCardProps) {
  return (
    <div
      className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-4"
      role="img"
      aria-label={ariaLabel}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[color:var(--text)]">
          {title}
        </span>
        <span className="text-[11px] text-[color:var(--muted)]">
          {period}
        </span>
      </div>
      {isEmpty ? (
        <div className="flex h-[220px] flex-col items-center justify-center gap-2">
          <ChartLine
            size={32}
            className="text-[color:var(--muted)] opacity-50"
          />
          <span className="text-[13px] font-semibold text-[color:var(--muted)]">
            {emptyHeading}
          </span>
          <span className="max-w-[200px] text-center text-[11px] text-[color:var(--muted)]">
            {emptyBody}
          </span>
        </div>
      ) : (
        <div style={{ height: 220 }}>{children}</div>
      )}
    </div>
  );
}
