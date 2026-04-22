import type { Session } from "electron";
import { browserNotLoggedIn } from "./browser-action-errors";
import { getPlatformRules } from "./browser-url-helpers";

type CookieLike = {
  name?: string;
};

export async function assertAuthenticatedSession(
  session: Pick<Session, "cookies">,
  platform: string,
  actionType: string,
): Promise<void> {
  const rules = getPlatformRules(platform);
  const cookieSets = await Promise.all(
    rules.cookieOrigins.map((origin) => session.cookies.get({ url: origin }).catch(() => [])),
  );
  if (!hasAuthenticatedCookie(cookieSets, rules.authenticatedCookieNames)) {
    throw browserNotLoggedIn(platform, actionType);
  }
}

export function hasAuthenticatedCookie(
  cookieSets: readonly (readonly CookieLike[])[],
  authenticatedCookieNames?: readonly string[],
): boolean {
  if (!authenticatedCookieNames || authenticatedCookieNames.length === 0) {
    return cookieSets.some((cookies) => cookies.length > 0);
  }
  const expectedNames = new Set(authenticatedCookieNames.map((name) => name.toLowerCase()));
  return cookieSets.some((cookies) =>
    cookies.some((cookie) => cookie.name && expectedNames.has(cookie.name.toLowerCase())),
  );
}

export async function assertAuthenticatedPage(
  getUrl: () => string,
  platform: string,
  actionType: string,
): Promise<void> {
  const finalUrl = getUrl().toLowerCase();
  const rules = getPlatformRules(platform);
  const bouncedToLogin = rules.unauthenticatedUrlMarkers.some((marker) =>
    finalUrl.includes(marker.toLowerCase()),
  );
  if (bouncedToLogin) {
    throw browserNotLoggedIn(platform, actionType);
  }
}
