// Fractal-noise film grain (inline data URI, allowed by img-src 'self' data:).
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")";

const AURORA_WASH =
  "radial-gradient(60% 55% at 26% 16%, var(--aurora-mint) 0%, transparent 62%)," +
  "radial-gradient(52% 52% at 84% 84%, var(--aurora-teal) 0%, transparent 60%)," +
  "radial-gradient(46% 48% at 60% 50%, var(--aurora-lime) 0%, transparent 66%)";

/** Ambient color wash derived from `ambientSrc`, given the src's own path. */
export function ambientFor(src: string): string {
  return src.replace("/images/", "/images/ambient/");
}

/**
 * A product screenshot floating over an atmospheric wash painted from its own
 * colours (a heavily blurred thumbnail), plus the aurora and a fine film grain.
 */
export function ArtStage({
  src,
  alt,
  priority = false,
  className = "",
  stageClassName = "p-5 sm:p-8 md:p-10",
  contentClassName = "w-full",
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
  stageClassName?: string;
  contentClassName?: string;
}) {
  return (
    <div className={`relative isolate overflow-hidden rounded-2xl border border-[var(--border)] ${className}`}>
      <img
        src={ambientFor(src)}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-75 blur-3xl saturate-[1.7]"
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10" style={{ background: AURORA_WASH }} />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: "linear-gradient(150deg, rgba(94,236,151,0.16) 0%, transparent 42%, rgba(45,212,191,0.12) 100%)" }}
      />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[var(--bg)]/28" />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-[0.14] mix-blend-overlay"
        style={{ backgroundImage: GRAIN }}
      />
      <div className={`relative ${stageClassName}`}>
        <img
          src={src}
          alt={alt}
          width={2400}
          height={1600}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          className={`block rounded-lg border border-black/5 shadow-[0_30px_80px_-28px_rgba(10,29,8,0.5)] md:rounded-xl ${contentClassName}`}
        />
      </div>
    </div>
  );
}
