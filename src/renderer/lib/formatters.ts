import { useAppStore } from "../state/store";

function getActiveLocale(): string {
  return useAppStore.getState().locale === "zh" ? "zh-CN" : "en-US";
}

export function formatMoney(value: number | null | undefined) {
  const locale = getActiveLocale();
  if (typeof value !== "number" || Number.isNaN(value)) {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(0);
  }
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatTime(value: string | null | undefined) {
  if (!value) return useAppStore.getState().locale === "zh" ? "未开始" : "Not yet";
  return new Date(value).toLocaleString(getActiveLocale());
}

export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return useAppStore.getState().locale === "zh" ? "从未" : "never";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  const isZh = useAppStore.getState().locale === "zh";
  if (seconds < 60) return isZh ? "刚刚" : "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return isZh ? `${minutes}分钟前` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return isZh ? `${hours}小时前` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return isZh ? `${days}天前` : `${days}d ago`;
}

export function getAgentInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatMessageTime(dateStr: string): string {
  const locale = getActiveLocale();
  const d = new Date(dateStr);
  const now = new Date();
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return `${rtf.format(-1, "day")} ${time}`;
  }
  return `${d.toLocaleDateString(locale, { month: "short", day: "numeric" })} ${time}`;
}
