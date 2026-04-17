import { useMemo } from "react"
import { Clock } from "../../ui/icons"
import { InlineNotice } from "../../ui"

export type ScheduleMode = "immediate" | "scheduled"

function computeMinDatetime(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function SchedulePicker({
  mode,
  scheduledAt,
  error,
  onModeChange,
  onScheduledAtChange,
  onClearError,
}: {
  mode: ScheduleMode
  scheduledAt: string
  error: string | null
  onModeChange: (mode: ScheduleMode) => void
  onScheduledAtChange: (value: string) => void
  onClearError: () => void
}) {
  const minDatetime = useMemo(computeMinDatetime, [])

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Post timing" className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="schedule-mode"
            value="immediate"
            checked={mode === "immediate"}
            onChange={() => {
              onModeChange("immediate")
              onClearError()
            }}
            className="h-4 w-4 shrink-0 cursor-pointer accent-[color:var(--primary)]"
          />
          <span className="text-[13px] font-medium text-foreground">Post immediately</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="radio"
            name="schedule-mode"
            value="scheduled"
            checked={mode === "scheduled"}
            onChange={() => onModeChange("scheduled")}
            className="h-4 w-4 shrink-0 cursor-pointer accent-[color:var(--primary)]"
          />
          <span className="text-[13px] font-medium text-foreground">Schedule for later</span>
        </label>
      </div>
      {mode === "scheduled" ? (
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-muted-foreground" />
          <input
            type="datetime-local"
            value={scheduledAt}
            min={minDatetime}
            onChange={(e) => {
              onScheduledAtChange(e.target.value)
              onClearError()
            }}
            className="rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13px] text-foreground focus:border-[color:var(--primary)] focus:outline-none"
          />
        </div>
      ) : null}
      {error ? <InlineNotice message={error} /> : null}
    </div>
  )
}
