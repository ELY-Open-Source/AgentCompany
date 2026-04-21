import type { DepartmentId } from "./types";

export const DEPARTMENT_LABELS: Record<DepartmentId, string> = {
  executive: "Executive Suite",
  engineering: "Engineering",
  product: "Product & Design",
  marketing: "Marketing",
  sales: "Sales & BD",
  hr: "People & Culture",
  finance: "Finance & Legal",
  legal: "Legal",
  operations: "Operations",
  customer_support: "Customer Success",
  research: "Research",
  design: "Design",
};

export const DEPARTMENT_OPTIONS: Array<{ value: DepartmentId | ""; label: string }> = [
  { value: "", label: "Any department" },
  ...(Object.entries(DEPARTMENT_LABELS) as [DepartmentId, string][]).map(([value, label]) => ({ value, label })),
];

export const DEPARTMENT_COLORS: Record<DepartmentId, string> = {
  executive: "var(--primary)",
  engineering: "var(--kami-ink)",
  product: "var(--kami-dark-warm)",
  marketing: "var(--kami-olive)",
  sales: "var(--kami-olive)",
  hr: "var(--kami-charcoal)",
  finance: "var(--kami-charcoal)",
  legal: "var(--kami-stone)",
  operations: "var(--kami-dark-warm)",
  customer_support: "var(--kami-stone)",
  research: "var(--kami-ink)",
  design: "var(--primary)",
};
