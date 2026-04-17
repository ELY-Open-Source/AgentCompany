export function Badge({ count, tone = "default" }: { count: number; tone?: "default" | "warn" | "danger" }) {
  if (count <= 0) return null;
  const toneClass = tone === "danger" ? "bg-destructive text-primary-foreground" : tone === "warn" ? "bg-warning text-primary-foreground" : "bg-[color:var(--muted-foreground)] text-primary-foreground";
  return (
    <span className={`ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${toneClass}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
