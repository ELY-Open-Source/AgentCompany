import { useMemo, useState } from "react";
import { IconButton } from "../../shared/ui";
import type { ScheduledPostRecord, SocialAccountRecord, SocialPlatform } from "../../../../shared/domain";
import { PLATFORM_COLOR_TOKENS } from "./platform-tokens";

interface MonthAnchor {
  year: number;
  month: number;
}

export function SocialCalendar({
  posts,
  accounts,
}: {
  posts: ScheduledPostRecord[];
  accounts: SocialAccountRecord[];
}) {
  const [{ year, month }, setMonth] = useState<MonthAnchor>(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });

  const accountPlatform = useMemo(() => buildAccountPlatformIndex(accounts), [accounts]);
  const eventMap = useMemo(() => buildEventMap(posts, accountPlatform), [posts, accountPlatform]);
  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cells = computeCalendarCells(year, month);
  const today = new Date();

  return (
    <div className="card" style={{ padding: 18, height: "fit-content" }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="card-label">{monthLabel}</div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
          <IconButton icon="chevronLeft" label="Previous month" onClick={() => setMonth(stepMonth({ year, month }, -1))} />
          <IconButton icon="chevron" label="Next month" onClick={() => setMonth(stepMonth({ year, month }, 1))} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => (
          <div key={`${label}-${index}`} style={{ fontSize: 10, color: "var(--text-3)", textAlign: "center", fontWeight: 540 }}>{label}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((cell) => {
          const events = cell.inMonth ? eventMap.get(cell.day) ?? [] : [];
          const isToday = cell.inMonth && cell.year === today.getFullYear() && cell.month === today.getMonth() && cell.day === today.getDate();
          return (
            <div
              key={`${cell.year}-${cell.month}-${cell.day}`}
              style={{
                aspectRatio: "1",
                borderRadius: 6,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                fontSize: 12,
                color: cell.inMonth ? "var(--text-2)" : "var(--text-4)",
                fontWeight: isToday ? 600 : 480,
                background: isToday ? "var(--text-1)" : "transparent",
                cursor: cell.inMonth ? "pointer" : "default",
              }}
            >
              <span className="num" style={{ color: isToday ? "#fff" : "inherit" }}>{cell.day}</span>
              {events.length > 0 && (
                <div style={{ display: "flex", gap: 2 }}>
                  {events.slice(0, 3).map((platform, index) => (
                    <span
                      key={`${platform}-${index}`}
                      style={{
                        width: 4,
                        height: 4,
                        borderRadius: 2,
                        background: isToday ? "#fff" : PLATFORM_COLOR_TOKENS[platform],
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 16, fontSize: 12, color: "var(--text-3)", gap: 10 }}>
        <Legend label="X" color="var(--accent)" />
        <Legend label="LinkedIn" color="var(--green)" />
        <Legend label="YouTube" color="var(--amber)" />
        <Legend label="Instagram" color="var(--red)" />
      </div>
    </div>
  );
}

function Legend({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: color }} />
      {label}
    </span>
  );
}

interface CalendarCell {
  year: number;
  month: number;
  day: number;
  inMonth: boolean;
}

function computeCalendarCells(year: number, month: number): CalendarCell[] {
  const firstOfMonth = new Date(year, month, 1);
  const startDay = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: CalendarCell[] = [];
  const prevMonthDate = new Date(year, month, 0).getDate();
  for (let i = startDay; i > 0; i--) {
    cells.push({ year: month === 0 ? year - 1 : year, month: (month + 11) % 12, day: prevMonthDate - i + 1, inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ year, month, day, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const next = cells.length - (startDay + daysInMonth) + 1;
    cells.push({ year: month === 11 ? year + 1 : year, month: (month + 1) % 12, day: next, inMonth: false });
  }
  return cells;
}

function buildAccountPlatformIndex(accounts: SocialAccountRecord[]): Map<string, SocialPlatform> {
  const index = new Map<string, SocialPlatform>();
  for (const account of accounts) index.set(account.id, account.platform);
  return index;
}

function buildEventMap(posts: ScheduledPostRecord[], accountPlatform: Map<string, SocialPlatform>): Map<number, SocialPlatform[]> {
  const eventMap = new Map<number, SocialPlatform[]>();
  for (const post of posts) {
    if (post.state !== "scheduled") continue;
    const date = new Date(post.scheduledFor);
    if (Number.isNaN(date.getTime())) continue;
    const platform = accountPlatform.get(post.socialAccountId);
    if (!platform) continue;
    const day = date.getDate();
    const existing = eventMap.get(day) ?? [];
    existing.push(platform);
    eventMap.set(day, existing);
  }
  return eventMap;
}

function stepMonth({ year, month }: MonthAnchor, delta: number): MonthAnchor {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}
