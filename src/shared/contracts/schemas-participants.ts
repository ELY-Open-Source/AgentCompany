import { z } from "zod";

export const listParticipantsSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const addParticipantSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
  participantId: z.string(),
  participantType: z.enum(["agent", "user", "system"]),
  role: z.enum(["owner", "member", "observer"]).default("member"),
});

export const removeParticipantSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
  participantId: z.string(),
});
