import { z } from "zod";

export const workProductTypeEnum = z.enum([
  "file",
  "link",
  "pull_request",
  "branch",
  "commit",
  "artifact",
  "document",
  "preview_url",
  "runtime_service",
]);

export const workProductProviderEnum = z.enum([
  "filesystem",
  "external",
  "agentcompany",
  "github",
  "custom",
]);

export const workProductStatusEnum = z.enum([
  "active",
  "ready_for_review",
  "approved",
  "merged",
  "closed",
  "failed",
  "draft",
  "archived",
]);

export const workProductReviewStateEnum = z.enum([
  "none",
  "needs_board_review",
  "approved",
  "changes_requested",
]);

export type WorkProductType = z.infer<typeof workProductTypeEnum>;
export type WorkProductProvider = z.infer<typeof workProductProviderEnum>;
export type WorkProductStatus = z.infer<typeof workProductStatusEnum>;
export type WorkProductReviewState = z.infer<typeof workProductReviewStateEnum>;

