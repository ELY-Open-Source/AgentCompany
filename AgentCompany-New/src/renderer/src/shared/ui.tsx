import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

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

function hashName(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function paletteFor(name: string): readonly [string, string] {
  const fallback = palette[0];
  if (!fallback) throw new Error("Avatar palette is empty.");
  return palette[hashName(name) % palette.length] ?? fallback;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export type AvatarSize = "sm" | "" | "lg" | "xl";

export function Avatar({
  name,
  size = "",
  bot = false,
}: {
  name: string;
  size?: AvatarSize;
  bot?: boolean;
}) {
  const [bg, fg] = paletteFor(name);
  const dim = size === "sm" ? 14 : size === "lg" ? 18 : size === "xl" ? 24 : 14;
  return (
    <div className={`avatar ${size}`.trim() + (bot ? " bot" : "")} style={{ background: bg, color: fg }}>
      {bot ? <Icon name="bot" size={dim} /> : initials(name)}
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
}: {
  icon: IconName;
  onClick?: () => void;
  label: string;
  variant?: "ghost" | "solid";
  size?: number;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${variant === "ghost" ? "ghost" : ""}`.trim()}
      aria-label={label}
      title={label}
      onClick={onClick}
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
