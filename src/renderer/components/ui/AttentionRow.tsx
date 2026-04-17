import type { ElementType, ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "./icons";

const ATTENTION_STAGGER_MAX = 8;
const ATTENTION_STAGGER_STEP = 0.04;

export type AttentionTone = "warn" | "danger" | "info" | "neutral";

export interface AttentionRowProps {
  icon: ElementType;
  tone?: AttentionTone;
  title: ReactNode;
  subtitle?: ReactNode;
  onClick?: () => void;
  index?: number;
  rightMeta?: ReactNode;
  iconColor?: string;
  iconTileBg?: string;
  rowBgClass?: string;
  borderAccentClass?: string;
  showArrow?: boolean;
  iconWeight?: "fill" | "bold" | "regular";
}

const toneIconClass: Record<AttentionTone, string> = {
  warn: "text-warning",
  danger: "text-destructive",
  info: "text-primary",
  neutral: "text-muted-foreground",
};

const toneBgClass: Record<AttentionTone, string> = {
  warn: "bg-warning-muted",
  danger: "bg-destructive-muted",
  info: "bg-accent",
  neutral: "bg-muted",
};

export function AttentionRow({
  icon: Icon,
  tone = "neutral",
  title,
  subtitle,
  onClick,
  index = 0,
  rightMeta,
  iconColor,
  iconTileBg,
  rowBgClass,
  borderAccentClass,
  showArrow = true,
  iconWeight,
}: AttentionRowProps) {
  const iconClass = iconColor ? "" : toneIconClass[tone];
  const bgClass = rowBgClass ?? toneBgClass[tone];
  const delay = Math.min(index, ATTENTION_STAGGER_MAX) * ATTENTION_STAGGER_STEP;
  const borderClass = borderAccentClass ?? "border-[color:var(--destructive)] border-opacity-20 hover:border-opacity-40";
  const isButton = typeof onClick === "function";
  const commonClass = `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex w-full items-center gap-3 rounded-lg border ${borderClass} ${bgClass} px-4 py-3 text-left transition`;

  const iconElement = iconTileBg ? (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
      style={{ backgroundColor: iconTileBg }}
    >
      <Icon size={18} weight={iconWeight} className={iconClass} style={iconColor ? { color: iconColor } : undefined} />
    </div>
  ) : (
    <Icon size={18} weight={iconWeight} className={`shrink-0 ${iconClass}`} style={iconColor ? { color: iconColor } : undefined} />
  );

  const inner = (
    <>
      {iconElement}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{title}</div>
        {subtitle ? <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div> : null}
      </div>
      {rightMeta}
      {showArrow ? <ArrowRight size={14} className="shrink-0 text-muted-foreground" /> : null}
    </>
  );

  if (isButton) {
    return (
      <motion.button
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, delay, ease: [0.16, 1, 0.3, 1] }}
        type="button"
        onClick={onClick}
        className={commonClass}
      >
        {inner}
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay, ease: [0.16, 1, 0.3, 1] }}
      className={commonClass}
    >
      {inner}
    </motion.div>
  );
}
