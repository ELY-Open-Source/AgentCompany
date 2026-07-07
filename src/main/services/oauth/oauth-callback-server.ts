import { createServer } from "node:http";
import { oauthErrorHtml, oauthSuccessHtml } from "./oauth-page";

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" } as const;

export interface OAuthCallbackResult {
  code: string;
  state: string | null;
}

export interface OAuthCallbackServer {
  /** Resolves when the provider redirects with a code; rejects on provider
   * error or cancellation. */
  waitForCode(): Promise<OAuthCallbackResult>;
  close(): void;
}

/**
 * Bind a loopback HTTP server that captures the OAuth authorization-code
 * redirect. The provider's OAuth client is registered with the exact loopback
 * redirect URI, so the port and path must match the flow's REDIRECT_URI.
 */
export function startOAuthCallbackServer(options: {
  port: number;
  path: string;
  signal?: AbortSignal;
}): Promise<OAuthCallbackServer> {
  const { port, path, signal } = options;
  return new Promise<OAuthCallbackServer>((resolve, reject) => {
    let settle: ((value: OAuthCallbackResult) => void) | null = null;
    let failWait: ((error: Error) => void) | null = null;
    const codePromise = new Promise<OAuthCallbackResult>((resolveCode, rejectCode) => {
      settle = resolveCode;
      failWait = rejectCode;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "", `http://127.0.0.1:${port}`);
      if (url.pathname !== path) {
        res.writeHead(404, HTML_HEADERS);
        res.end(oauthErrorHtml("Callback route not found."));
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(400, HTML_HEADERS);
        res.end(oauthErrorHtml("Sign-in did not complete.", error));
        failWait?.(new Error(`Sign-in failed: ${error}`));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, HTML_HEADERS);
        res.end(oauthErrorHtml("Missing authorization code."));
        return;
      }
      res.writeHead(200, HTML_HEADERS);
      res.end(oauthSuccessHtml("Sign-in complete. You can close this window and return to AgentCompany."));
      settle?.({ code, state: url.searchParams.get("state") });
    });

    const onAbort = () => failWait?.(new Error("Login cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });

    server.on("error", (err) => reject(err));
    server.listen(port, "127.0.0.1", () => {
      resolve({
        waitForCode: () => codePromise,
        close: () => {
          signal?.removeEventListener("abort", onAbort);
          server.close();
        },
      });
    });
  });
}
