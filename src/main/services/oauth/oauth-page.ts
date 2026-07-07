/** Minimal HTML shown in the user's browser after the OAuth redirect. */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage(heading: string, message: string, details?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(heading)}</title>
  <style>
    * { box-sizing: border-box; }
    html { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px; background: #09090b; color: #fafafa; text-align: center;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    main { width: 100%; max-width: 520px; }
    h1 { margin: 0 0 10px; font-size: 26px; font-weight: 650; }
    p { margin: 0; line-height: 1.7; color: #a1a1aa; font-size: 15px; }
    .details { margin-top: 14px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; color: #a1a1aa; word-break: break-word; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
    ${details ? `<div class="details">${escapeHtml(details)}</div>` : ""}
  </main>
</body>
</html>`;
}

export function oauthSuccessHtml(message: string): string {
  return renderPage("Authentication successful", message);
}

export function oauthErrorHtml(message: string, details?: string): string {
  return renderPage("Authentication failed", message, details);
}
