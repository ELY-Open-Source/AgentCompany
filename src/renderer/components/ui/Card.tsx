import { type ReactNode } from "react";

export function Card({
  children,
  className = "",
  padded = true,
  padding,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "section" | "article";
}) {
  const resolvedPadding = padding ?? (padded ? "md" : "none");
  const paddingClass =
    resolvedPadding === "lg"
      ? "p-5"
      : resolvedPadding === "sm"
        ? "px-4 py-3"
        : resolvedPadding === "none"
          ? ""
          : "p-4";
  return (
    <Tag className={`rounded-lg border border-border bg-card ${paddingClass} ${className}`}>
      {children}
    </Tag>
  );
}
