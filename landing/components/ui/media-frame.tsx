/** Framed product screenshot panel: rounded, bordered, soft shadow on the page. */
export function MediaFrame({
  src,
  alt,
  priority = false,
  className = "",
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-illustration)] shadow-[0_24px_70px_-28px_rgba(10,29,8,0.3)] md:rounded-2xl ${className}`}
    >
      <img
        src={src}
        alt={alt}
        width={2400}
        height={1600}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        className="block h-auto w-full"
      />
    </div>
  );
}
