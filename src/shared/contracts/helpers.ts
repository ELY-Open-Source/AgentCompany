import { z } from "zod";

export const optionalId = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().uuid().nullable().optional(),
);

/** Canonical department identifiers shared across agent and automation schemas. */
export const DEPARTMENT_IDS = z.enum([
  "executive", "engineering", "product", "marketing", "sales",
  "hr", "finance", "legal", "operations", "customer_support", "research", "design",
]);

/** Canonical message channel types shared across messaging schemas. */
export const MESSAGE_CHANNELS = z.enum([
  "direct", "department", "company", "project", "incident",
]);
