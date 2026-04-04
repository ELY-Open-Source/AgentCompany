import { BrowserWindow } from "electron";
import log from "electron-log/main.js";
import { PLATFORM_RULES } from "./browser-types";

export function getPlatformRules(platform: string) {
  return PLATFORM_RULES[platform] ?? PLATFORM_RULES.other;
}

export function assertAllowedUrl(platform: string, rawUrl: string, actionType: string) {
  const allowedHosts = getPlatformRules(platform).allowedHosts;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL for ${actionType}: ${rawUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Navigation blocked for ${actionType}. Only https URLs are allowed.`);
  }
  const host = url.hostname.toLowerCase();
  const isAllowed = allowedHosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
  if (!isAllowed) {
    throw new Error(`Navigation blocked for ${actionType}. ${host} is outside the allowed ${platform} domains.`);
  }
}

export function isAllowedNavigation(platform: string, rawUrl: string): boolean {
  try {
    assertAllowedUrl(platform, rawUrl, "navigate");
    return true;
  } catch {
    return false;
  }
}

export function attachWindowSecurity(win: BrowserWindow, platform: string) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedNavigation(platform, url)) {
      return { action: "deny" };
    }
    setImmediate(() => {
      void win.loadURL(url).catch((error) => {
        log.warn(`[browser] Failed to open allowed popup target for ${platform}: ${error instanceof Error ? error.message : String(error)}`);
      });
    });
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    if (isAllowedNavigation(platform, navigationUrl)) {
      return;
    }
    event.preventDefault();
    log.warn(`[browser] Blocked navigation outside allowlist for ${platform}: ${navigationUrl}`);
  });
  win.webContents.on("will-redirect", (event, navigationUrl) => {
    if (isAllowedNavigation(platform, navigationUrl)) {
      return;
    }
    event.preventDefault();
    log.warn(`[browser] Blocked redirect outside allowlist for ${platform}: ${navigationUrl}`);
  });
}

export function getComposeUrl(platform: string): string {
  const urls: Record<string, string> = {
    twitter: "https://x.com/compose/tweet",
    linkedin: "https://www.linkedin.com/feed/",
    instagram: "https://www.instagram.com/",
    facebook: "https://www.facebook.com/",
    reddit: "https://www.reddit.com/submit",
    bluesky: "https://bsky.app/",
    youtube: "https://www.youtube.com/",
    tiktok: "https://www.tiktok.com/",
  };
  return urls[platform] || getPlatformRules(platform).loginUrl;
}

export function getFeedUrl(platform: string): string {
  const urls: Record<string, string> = {
    twitter: "https://x.com/home",
    linkedin: "https://www.linkedin.com/feed/",
    instagram: "https://www.instagram.com/",
    facebook: "https://www.facebook.com/",
    reddit: "https://www.reddit.com/",
    bluesky: "https://bsky.app/",
    youtube: "https://www.youtube.com/",
    tiktok: "https://www.tiktok.com/",
  };
  return urls[platform] || getPlatformRules(platform).loginUrl;
}

export function getSearchUrl(platform: string, query: string): string {
  const q = encodeURIComponent(query);
  const urls: Record<string, string> = {
    twitter: `https://x.com/search?q=${q}`,
    linkedin: `https://www.linkedin.com/search/results/all/?keywords=${q}`,
    reddit: `https://www.reddit.com/search/?q=${q}`,
  };
  return urls[platform] || `https://google.com/search?q=${q}`;
}
