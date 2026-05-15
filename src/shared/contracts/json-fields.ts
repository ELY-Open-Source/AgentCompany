import { z } from "zod";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]));

export const jsonStringArraySchema = z.array(z.string());
export const jsonArraySchema = z.array(jsonValueSchema);

export const meetingActionItemArraySchema = z.array(z.object({
  title: z.string().optional(),
  assigneeAgentId: z.string().optional(),
  description: z.string().optional(),
}).catchall(jsonValueSchema));

export function canonicalizeJsonString<T>(value: string | null | undefined, schema: z.ZodType<T>, fallback: T): string {
  const raw = value ?? JSON.stringify(fallback);
  const parsed = JSON.parse(raw);
  return JSON.stringify(schema.parse(parsed));
}

export function canonicalJsonString<T>(schema: z.ZodType<T>, fallback: T) {
  const fallbackJson = JSON.stringify(fallback);
  return z.string().default(fallbackJson).superRefine((value, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be valid JSON.",
      });
      return;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "JSON value does not match the expected shape.",
      });
    }
  }).transform((value) => canonicalizeJsonString(value, schema, fallback));
}

export function canonicalOptionalJsonString<T>(schema: z.ZodType<T>) {
  return z.string().superRefine((value, ctx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be valid JSON.",
      });
      return;
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "JSON value does not match the expected shape.",
      });
    }
  }).transform((value) => JSON.stringify(schema.parse(JSON.parse(value))));
}
