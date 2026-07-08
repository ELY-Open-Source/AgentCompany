/** AgentCompany glass-bloom brand mark. */
export function IconMark({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/icon.png?v=2"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      decoding="async"
      className="block shrink-0"
      style={{ width: size, height: size }}
    />
  );
}
