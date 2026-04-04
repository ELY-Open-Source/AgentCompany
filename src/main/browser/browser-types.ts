export interface BrowserAction {
  id: string;
  socialAccountId: string;
  platform: string;
  actionType: string;
  payload: Record<string, unknown>;
}

export interface BrowserActionResult {
  success: boolean;
  cancelled: boolean;
  summary: string;
  screenshotPath: string | null;
  error: string | null;
}

export interface QueuedAction {
  action: BrowserAction;
  resolve: (result: BrowserActionResult) => void;
  reject: (error: Error) => void;
}

export interface PlatformRule {
  loginUrl: string;
  authCheckUrl: string;
  allowedHosts: string[];
  cookieOrigins: string[];
  unauthenticatedUrlMarkers: string[];
}

export const PLATFORM_RULES: Record<string, PlatformRule> = {
  twitter: {
    loginUrl: "https://x.com/i/flow/login",
    authCheckUrl: "https://x.com/home",
    allowedHosts: ["x.com", "twitter.com"],
    cookieOrigins: ["https://x.com", "https://twitter.com"],
    unauthenticatedUrlMarkers: ["/i/flow/login", "/login"],
  },
  linkedin: {
    loginUrl: "https://www.linkedin.com/login",
    authCheckUrl: "https://www.linkedin.com/feed/",
    allowedHosts: ["linkedin.com"],
    cookieOrigins: ["https://www.linkedin.com"],
    unauthenticatedUrlMarkers: ["/login", "/checkpoint"],
  },
  instagram: {
    loginUrl: "https://www.instagram.com/accounts/login/",
    authCheckUrl: "https://www.instagram.com/",
    allowedHosts: ["instagram.com"],
    cookieOrigins: ["https://www.instagram.com"],
    unauthenticatedUrlMarkers: ["/accounts/login"],
  },
  facebook: {
    loginUrl: "https://www.facebook.com/login",
    authCheckUrl: "https://www.facebook.com/",
    allowedHosts: ["facebook.com"],
    cookieOrigins: ["https://www.facebook.com"],
    unauthenticatedUrlMarkers: ["/login"],
  },
  reddit: {
    loginUrl: "https://www.reddit.com/login",
    authCheckUrl: "https://www.reddit.com/",
    allowedHosts: ["reddit.com"],
    cookieOrigins: ["https://www.reddit.com"],
    unauthenticatedUrlMarkers: ["/login"],
  },
  youtube: {
    loginUrl: "https://accounts.google.com/signin",
    authCheckUrl: "https://www.youtube.com/",
    allowedHosts: ["youtube.com", "google.com"],
    cookieOrigins: ["https://www.youtube.com", "https://accounts.google.com"],
    unauthenticatedUrlMarkers: ["/signin", "/ServiceLogin"],
  },
  tiktok: {
    loginUrl: "https://www.tiktok.com/login",
    authCheckUrl: "https://www.tiktok.com/foryou",
    allowedHosts: ["tiktok.com"],
    cookieOrigins: ["https://www.tiktok.com"],
    unauthenticatedUrlMarkers: ["/login"],
  },
  bluesky: {
    loginUrl: "https://bsky.app",
    authCheckUrl: "https://bsky.app/",
    allowedHosts: ["bsky.app"],
    cookieOrigins: ["https://bsky.app"],
    unauthenticatedUrlMarkers: ["/login"],
  },
  other: {
    loginUrl: "https://google.com",
    authCheckUrl: "https://google.com",
    allowedHosts: ["google.com"],
    cookieOrigins: ["https://google.com"],
    unauthenticatedUrlMarkers: ["/login"],
  },
};
