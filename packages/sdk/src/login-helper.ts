export function buildLoginHelperHtml(opts: {
  origin: string;
  loginUrl: string;
  error?: string;
}): string {
  const host = new URL(opts.origin).hostname;
  const err = opts.error
    ? `<p class="err">${escapeHtml(opts.error)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DigiCampus Login</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
    h1 { font-size: 1.25rem; }
    .step { margin: 1.25rem 0; padding: 1rem; border: 1px solid #ddd; border-radius: 8px; }
    a.btn { display: inline-block; background: #1a56db; color: #fff; padding: 0.6rem 1rem; border-radius: 6px; text-decoration: none; font-weight: 600; }
    a.btn:hover { background: #1344b0; }
    textarea { width: 100%; min-height: 4rem; font-family: ui-monospace, monospace; font-size: 0.85rem; padding: 0.5rem; }
    button { margin-top: 0.5rem; background: #111; color: #fff; border: 0; padding: 0.6rem 1.2rem; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .err { color: #b42318; background: #fef3f2; padding: 0.75rem; border-radius: 6px; }
    .hint { color: #555; font-size: 0.9rem; }
    code { background: #f4f4f5; padding: 0.1rem 0.3rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>DigiCampus — Anmelden</h1>
  <p class="hint">Saved passwords work. No extra apps or permissions.</p>
  ${err}
  <div class="step">
    <strong>① Log in</strong>
    <p>Open ${escapeHtml(host)} and sign in (MFA if asked).</p>
    <p><a class="btn" href="${escapeHtml(opts.loginUrl)}" target="_blank" rel="noopener">Open DigiCampus login</a></p>
  </div>
  <div class="step">
    <strong>② Paste session</strong>
    <p>On ${escapeHtml(host)} after login: DevTools → Application → Cookies → <code>Seminar_Session</code> → copy <em>Value</em>.</p>
    <p class="hint">Or Console: <code>copy(document.cookie.match(/Seminar_Session=([^;]+)/)?.[1])</code></p>
    <form method="POST" action="/submit">
      <textarea name="cookie" placeholder="Paste Seminar_Session value here" required autofocus></textarea>
      <button type="submit">Save session</button>
    </form>
  </div>
</body>
</html>`;
}

export function buildLoginSuccessHtml(): string {
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8" /><title>Logged in</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;margin:4rem 1rem;} h1{color:#067647;}</style>
</head><body><h1>✓ Logged in</h1><p>You can close this tab and return to the terminal.</p></body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function readRequestBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

export function parseFormBody(body: string, field: string): string {
  const params = new URLSearchParams(body);
  return params.get(field) ?? "";
}
