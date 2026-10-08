import { ProviderHttpError } from "../provider-http";

/** How long one sign-in or renewal request may take, body included. */
export const OAUTH_REQUEST_TIMEOUT_MS = 30_000;

/** A sign-in or renewal request that ends on the user's cancel or a stalled server; runs stop only their own wait, since refreshes are shared. */
export async function oauthFetch(url: string, init: RequestInit, cancel?: AbortSignal): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (cancel?.aborted) controller.abort();
  else cancel?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, OAUTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, text: await response.text() };
  } catch (error) {
    if (cancel?.aborted) throw new Error("Login cancelled");
    if (controller.signal.aborted) throw new ProviderHttpError(`Sign-in request to ${new URL(url).host} timed out.`, null, null, true);
    throw error;
  } finally {
    clearTimeout(timer);
    cancel?.removeEventListener("abort", abort);
  }
}
