import type { DepartmentId } from "./types";

export const DEPARTMENT_LABELS: Record<string, string> = {
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
  { value: "executive", label: "Executive" },
  { value: "engineering", label: "Engineering" },
  { value: "product", label: "Product" },
  { value: "marketing", label: "Marketing" },
  { value: "sales", label: "Sales" },
  { value: "hr", label: "Human Resources" },
  { value: "finance", label: "Finance" },
  { value: "legal", label: "Legal" },
  { value: "operations", label: "Operations" },
  { value: "customer_support", label: "Customer Support" },
  { value: "research", label: "Research" },
  { value: "design", label: "Design" },
];

export const DEPARTMENT_COLORS: Record<DepartmentId, string> = {
  executive: "#8b5cf6",
  engineering: "#3b82f6",
  product: "#f59e0b",
  marketing: "#ec4899",
  sales: "#10b981",
  hr: "#6366f1",
  finance: "#14b8a6",
  legal: "#a78bfa",
  operations: "#f97316",
  customer_support: "#06b6d4",
  research: "#8b5cf6",
  design: "#f43f5e",
};
