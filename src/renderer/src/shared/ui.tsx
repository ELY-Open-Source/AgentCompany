import { createContext, useContext, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface AvatarLook {
  emoji: string | null;
  color: string | null;
  /** data-URL portrait; wins over emoji and initials when set. */
  image?: string | null;
}

/**
 * Custom avatar looks by display name, built once from the snapshot (agents
 * and employees). Avatar consumes it directly so every existing call site —
 * chat rows, org chart, office, sidebar — honors a customized avatar without
 * threading props through each page.
 */
export const AvatarDirectoryContext = createContext<ReadonlyMap<string, AvatarLook>>(new Map());

const palette: ReadonlyArray<readonly [string, string]> = [
  ["#5e6ad2", "#fff"],
  ["#e8b339", "#231600"],
  ["#26b69a", "#fff"],
  ["#e57373", "#fff"],
  ["#8b6dd9", "#fff"],
  ["#3a7bd5", "#fff"],
  ["#2a2a2e", "#fff"],
  ["#c2410c", "#fff"],
];

/** Swatch choices for custom avatar backgrounds — the hash palette, curated. */
export const AVATAR_COLORS: readonly string[] = palette.map(([bg]) => bg);

function hashName(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function paletteFor(name: string): readonly [string, string] {
  if (palette.length === 0) throw new Error("Avatar palette is empty.");
  const selected = palette[hashName(name) % palette.length];
  if (!selected) throw new Error("Avatar palette selection failed.");
  return selected;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export type AvatarSize = "sm" | "" | "lg" | "xl";

export function Avatar({
  name,
  size = "",
  bot = false,
  look,
}: {
  name: string;
  size?: AvatarSize;
  bot?: boolean;
  /** Explicit look override; when omitted the directory context is consulted. */
  look?: AvatarLook;
}) {
  const directory = useContext(AvatarDirectoryContext);
  const custom = look ?? directory.get(name);
  const [hashedBg, hashedFg] = paletteFor(name);
  const bg = custom?.color || hashedBg;
  const fg = custom?.color ? "#fff" : hashedFg;
  const dim = size === "sm" ? 14 : size === "lg" ? 18 : size === "xl" ? 24 : 14;
  const emoji = custom?.emoji ?? null;
  const image = custom?.image ?? null;
  return (
    <div className={`avatar ${size}`.trim() + (bot && !emoji && !image ? " bot" : "")} style={{ background: bg, color: fg }}>
      {image ? (
        <img src={image} alt="" className="avatar-image" draggable={false} />
      ) : emoji ? (
        <span aria-hidden>{emoji}</span>
      ) : bot ? (
        <Icon name="bot" size={dim} />
      ) : (
        initials(name)
      )}
    </div>
  );
}

export function AvatarStack({ names, bot = false }: { names: string[]; bot?: boolean }) {
  return (
    <div className="avatar-stack">
      {names.map((name) => (
        <div key={name} className="avatar-ring">
          <Avatar name={name} size="sm" bot={bot} />
        </div>
      ))}
    </div>
  );
}

export function Pill({
  children,
  tone,
  dot = false,
}: {
  children: ReactNode;
  tone?: "amber" | "green" | "violet" | "red";
  dot?: boolean;
}) {
  return (
    <span className={`pill ${tone ?? ""}`.trim()}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

export function Button({
  children,
  tone,
  size,
  onClick,
  type = "button",
  disabled = false,
  title,
}: {
  children: ReactNode;
  tone?: "primary" | "ghost";
  size?: "small";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`button ${tone ?? ""} ${size ?? ""}`.trim()}
    >
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  onClick,
  label,
  variant = "ghost",
  size = 14,
  disabled = false,
}: {
  icon: IconName;
  onClick?: () => void;
  label: string;
  variant?: "ghost" | "solid";
  size?: number;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${variant === "ghost" ? "ghost" : ""}`.trim()}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ id: T; label: string }>;
}) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`segment ${value === option.id ? "active" : ""}`.trim()}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { Icon };
