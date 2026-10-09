/** An XP-style bar: a framed track filled in pixel blocks, announced as a progress value. */
export function XpBar({ percent, label }: { percent: number; label: string }) {
  const filled = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="xp-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={filled}>
      <div className="xp-fill" style={{ width: `${filled}%` }} />
    </div>
  );
}
