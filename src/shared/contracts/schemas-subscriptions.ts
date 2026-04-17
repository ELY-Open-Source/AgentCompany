import { z } from "zod";

export const subscribeThreadSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
  subscriberId: z.string(),
  subscriberType: z.enum(["agent", "user", "system"]),
  notifyOn: z.enum(["all", "mentions", "none"]).default("all"),
});

export const unsubscribeThreadSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
  subscriberId: z.string(),
});

export const listSubscriptionsSchema = z.object({
  threadId: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const listSubscribedThreadsSchema = z.object({
  subscriberId: z.string(),
  companyId: z.string().uuid(),
});
