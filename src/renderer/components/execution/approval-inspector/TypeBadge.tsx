const TYPE_BADGE_CLASSES: Record<string, string> = {
  hire_agent: "bg-accent text-primary",
  approve_ceo_strategy: "bg-warning-muted text-warning",
  secret_access: "bg-destructive-muted text-destructive",
  social_post: "bg-accent text-primary",
  deliverable_review: "bg-accent text-primary",
}

export function TypeBadge({ type }: { type: string }) {
  const className = TYPE_BADGE_CLASSES[type] ?? "bg-muted text-muted-foreground"
  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${className}`}>
      {type.replaceAll("_", " ")}
    </span>
  )
}
