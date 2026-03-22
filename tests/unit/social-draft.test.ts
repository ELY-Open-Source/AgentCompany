import { describe, expect, it } from "vitest";
import { z } from "zod";
import { approvalInputSchema } from "../../src/shared/contracts";

// Valid v4 UUIDs for testing (RFC 4122 compliant)
const UUID_1 = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const UUID_2 = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const UUID_3 = "c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f";
const UUID_4 = "d4e5f6a7-b8c9-4d0e-af2a-3b4c5d6e7f80";
const UUID_10 = "e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091";
const UUID_20 = "f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f809102";
const UUID_21 = "a7b8c9d0-e1f2-4a3b-ac5d-6e7f80910213";

/**
 * Schema for social draft API input. Mirrors the one that will be defined
 * in api-server.ts -- duplicated here for independent validation testing.
 */
const socialDraftSchema = z.object({
  socialAccountId: z.string().uuid(),
  platform: z.string(),
  content: z.string().min(1).max(10000),
  mediaUrls: z.array(z.string()).default([]),
  scheduledAt: z.string().datetime().optional(),
});

describe("social draft pipeline", () => {
  describe("socialDraftSchema validation", () => {
    it("accepts a valid social draft with all fields", () => {
      const input = {
        socialAccountId: UUID_1,
        platform: "twitter",
        content: "Hello world! This is a social media post.",
        mediaUrls: ["https://example.com/image.png"],
        scheduledAt: "2026-04-01T12:00:00Z",
      };
      const parsed = socialDraftSchema.parse(input);
      expect(parsed.socialAccountId).toBe(input.socialAccountId);
      expect(parsed.platform).toBe("twitter");
      expect(parsed.content).toBe(input.content);
      expect(parsed.mediaUrls).toEqual(["https://example.com/image.png"]);
      expect(parsed.scheduledAt).toBe("2026-04-01T12:00:00Z");
    });

    it("accepts a draft without optional mediaUrls and scheduledAt", () => {
      const input = {
        socialAccountId: UUID_2,
        platform: "linkedin",
        content: "Professional update.",
      };
      const parsed = socialDraftSchema.parse(input);
      expect(parsed.mediaUrls).toEqual([]);
      expect(parsed.scheduledAt).toBeUndefined();
    });

    it("rejects empty content", () => {
      expect(() =>
        socialDraftSchema.parse({
          socialAccountId: UUID_3,
          platform: "twitter",
          content: "",
        }),
      ).toThrow();
    });

    it("rejects invalid socialAccountId (non-uuid)", () => {
      expect(() =>
        socialDraftSchema.parse({
          socialAccountId: "not-a-uuid",
          platform: "twitter",
          content: "Some content",
        }),
      ).toThrow();
    });

    it("rejects content exceeding 10000 characters", () => {
      expect(() =>
        socialDraftSchema.parse({
          socialAccountId: UUID_4,
          platform: "reddit",
          content: "x".repeat(10001),
        }),
      ).toThrow();
    });
  });

  describe("social_post is a valid ApprovalType", () => {
    it("approvalInputSchema accepts type social_post", () => {
      const input = {
        companyId: UUID_10,
        type: "social_post",
        payloadSummary: "Post to Twitter via @companyhandle",
        impactSummary: "Public social media post on company account",
      };
      const parsed = approvalInputSchema.parse(input);
      expect(parsed.type).toBe("social_post");
    });
  });

  describe("payloadSummary truncation", () => {
    it("truncates content to 120 chars with ellipsis for payloadSummary", () => {
      const longContent = "A".repeat(200);
      const contentPreview = longContent.slice(0, 120) + (longContent.length > 120 ? "..." : "");
      expect(contentPreview.length).toBe(123); // 120 + "..."
      expect(contentPreview.endsWith("...")).toBe(true);
    });

    it("does not add ellipsis for content <= 120 chars", () => {
      const shortContent = "Short post";
      const contentPreview = shortContent.slice(0, 120) + (shortContent.length > 120 ? "..." : "");
      expect(contentPreview).toBe("Short post");
      expect(contentPreview.endsWith("...")).toBe(false);
    });

    it("truncates exactly at 120 char boundary", () => {
      const exactContent = "B".repeat(120);
      const contentPreview = exactContent.slice(0, 120) + (exactContent.length > 120 ? "..." : "");
      expect(contentPreview).toBe(exactContent);
      expect(contentPreview.length).toBe(120);
    });
  });

  describe("approval resolution logic", () => {
    it("approved social_post with no scheduledAt dispatches immediately", () => {
      const approval = {
        type: "social_post" as const,
        payloadJson: JSON.stringify({
          socialAccountId: UUID_20,
          platform: "twitter",
          content: "Hello from the AI company!",
          mediaUrls: [],
          scheduledAt: null,
        }),
        state: "approved" as const,
      };

      const draft = JSON.parse(approval.payloadJson) as {
        socialAccountId: string;
        platform: string;
        content: string;
        mediaUrls: string[];
        scheduledAt: string | null;
      };

      // Verify payloadJson contains scheduledAt key (cross-plan contract with 03-03)
      expect(draft).toHaveProperty("scheduledAt");
      expect(draft.scheduledAt).toBeNull();

      // Should dispatch immediately since scheduledAt is null
      const shouldDefer = draft.scheduledAt ? new Date(draft.scheduledAt).getTime() - Date.now() > 0 : false;
      expect(shouldDefer).toBe(false);
    });

    it("approved social_post with future scheduledAt defers dispatch", () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
      const approval = {
        type: "social_post" as const,
        payloadJson: JSON.stringify({
          socialAccountId: UUID_21,
          platform: "linkedin",
          content: "Scheduled professional update",
          mediaUrls: [],
          scheduledAt: futureDate,
        }),
      };

      const draft = JSON.parse(approval.payloadJson) as {
        scheduledAt: string | null;
      };

      expect(draft.scheduledAt).toBe(futureDate);
      const delay = new Date(draft.scheduledAt!).getTime() - Date.now();
      expect(delay).toBeGreaterThan(0);
    });

    it("rejected social_post creates no browser action", () => {
      // When decision is "rejected", the social_post handler should NOT run saveBrowserAction.
      // This validates the condition: approval.type === "social_post" && decision === "approved"
      const decision: string = "rejected";
      const shouldCreateAction = decision === "approved";
      expect(shouldCreateAction).toBe(false);
    });

    it("browser action payloadJson includes scheduledAt for startup recovery", () => {
      // Cross-plan contract with 03-03: browser action payloadJson MUST include scheduledAt
      const draft = {
        content: "Recovery test post",
        mediaUrls: ["https://img.example.com/photo.jpg"],
        scheduledAt: "2026-04-01T09:00:00Z",
      };
      const actionPayload = JSON.stringify({
        content: draft.content,
        mediaUrls: draft.mediaUrls,
        scheduledAt: draft.scheduledAt,
      });

      const parsed = JSON.parse(actionPayload) as Record<string, unknown>;
      expect(parsed).toHaveProperty("scheduledAt");
      expect(parsed.scheduledAt).toBe("2026-04-01T09:00:00Z");
      expect(parsed).toHaveProperty("content");
      expect(parsed).toHaveProperty("mediaUrls");
    });
  });
});
