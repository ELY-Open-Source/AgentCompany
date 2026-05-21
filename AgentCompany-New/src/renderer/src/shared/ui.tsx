import type { ReactNode } from "react";
import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  FileText,
  Filter,
  Folder,
  Grid2X2,
  Hash,
  Home,
  Inbox,
  List,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  approve: ShieldCheck,
  attach: Paperclip,
  bell: Bell,
  bot: Bot,
  chat: MessageCircle,
  check: Check,
  chevronDown: ChevronDown,
  docs: FileText,
  file: FileText,
  filter: Filter,
  folder: Folder,
  grid: Grid2X2,
  hash: Hash,
  home: Home,
  inbox: Inbox,
  list: List,
  lock: Lock,
  more: MoreHorizontal,
  plus: Plus,
  search: Search,
  send: Send,
  settings: Settings,
  social: Sparkles,
  team: Users,
  upload: Upload,
  work: Inbox,
  x: X,
};

const palette = [
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

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = icons[name] ?? FileText;
  return <Component size={size} strokeWidth={1.7} />;
}

export function Avatar({ name, size = "", bot = false }: { name: string; size?: "sm" | ""; bot?: boolean }) {
  const initials = name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const [background, color] = palette[hashName(name) % palette.length];
  return (
    <div className={`avatar ${size} ${bot ? "bot" : ""}`} style={{ background, color }}>
      {bot ? <Icon name="bot" size={size === "sm" ? 13 : 16} /> : initials}
    </div>
  );
}

export function Pill({
  children,
  tone,
  dot = false,
}: {
  children: ReactNode;
  tone?: "amber" | "green" | "violet";
  dot?: boolean;
}) {
  return (
    <span className={`pill ${tone ?? ""}`}>
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
}: {
  children: ReactNode;
  tone?: "primary" | "ghost";
  size?: "small";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`button ${tone ?? ""} ${size ?? ""}`}>
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  onClick,
  label,
}: {
  icon: string;
  onClick?: () => void;
  label: string;
}) {
  return (
    <button type="button" className="icon-button ghost" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
