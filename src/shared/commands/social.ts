import type { SocialPlatform } from "../domain";

export interface CreateSocialAccountInput {
  orgId: string;
  platform: SocialPlatform;
  handle: string;
  displayName: string;
  createdByEmployeeId: string;
  authorizedEmployeeId: string | null;
}

export interface LaunchSocialLoginInput {
  orgId: string;
  socialAccountId: string;
  employeeId: string;
}

export interface CreateScheduledPostInput {
  orgId: string;
  socialAccountId: string;
  bodyMd: string;
  scheduledFor: string;
  createdByEmployeeId: string;
}

export interface SetScheduledPostStateInput {
  orgId: string;
  scheduledPostId: string;
  state: "draft" | "scheduled" | "published" | "cancelled";
  employeeId: string;
}
