import { ChartLine } from "../../ui/icons";
import { useT } from "../../../i18n";

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
  emptyHeading,
  emptyBody,
  ariaLabel,
  children,
}: ChartCardProps) {
  const t = useT();
  const resolvedHeading = emptyHeading ?? t("chart.emptyHeading");
  const resolvedBody = emptyBody ?? t("chart.emptyBody");
  return (
    <div
      className="rounded-lg border border-border bg-card px-4 py-4"
      role="img"
      aria-label={ariaLabel}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-foreground">
          {title}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {period}
        </span>
      </div>
      {isEmpty ? (
        <div className="flex h-[220px] flex-col items-center justify-center gap-2">
          <ChartLine
            size={32}
            className="text-muted-foreground opacity-50"
          />
          <span className="text-[13px] font-semibold text-muted-foreground">
            {resolvedHeading}
          </span>
          <span className="max-w-[200px] text-center text-[11px] text-muted-foreground">
            {resolvedBody}
          </span>
        </div>
      ) : (
        <div style={{ height: 220 }}>{children}</div>
      )}
    </div>
  );
}
