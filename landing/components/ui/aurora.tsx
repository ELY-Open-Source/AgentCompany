/**
 * Northern-lights glow for dark showcase surfaces: three soft, slowly drifting
 * radial blooms in mint / teal / lime. Purely decorative.
 */
export function Aurora({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <div
        className="aurora-layer absolute -inset-[25%]"
        style={{
          filter: "blur(56px)",
          background:
            "radial-gradient(42% 55% at 22% 62%, var(--aurora-mint) 0%, transparent 62%)," +
            "radial-gradient(38% 50% at 72% 38%, var(--aurora-teal) 0%, transparent 60%)," +
            "radial-gradient(34% 44% at 52% 84%, var(--aurora-lime) 0%, transparent 58%)",
        }}
      />
    </div>
  );
}
