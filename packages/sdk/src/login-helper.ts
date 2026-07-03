/**
 * DigiCampus login UI — uses shared design system from ui.ts
 */
import { brandHeader, checkIcon, escapeHtml, pageShell, warnIcon } from "./ui.js";

export function buildLoginHelperHtml(opts: {
  origin: string;
  loginUrl: string;
  captureUrl?: string;
  error?: string;
}): string {
  const host = new URL(opts.origin).hostname;
  const error = opts.error
    ? `<div class="dc-status error">${warnIcon()}<p>${escapeHtml(opts.error)}</p></div>`
    : "";

  const connectBtn = opts.captureUrl
    ? `<p class="dc-copy">On the DigiCampus tab after sign-in, click:</p>
       <p><a class="dc-btn primary" href="${escapeHtml(buildConnectBookmarklet(opts.captureUrl))}">Connect DigiCampus</a></p>
       <p class="dc-copy">Drag that button to your bookmarks bar if the click does not work from the DigiCampus tab.</p>`
    : "";

  const body = `<main class="dc-card">
    ${brandHeader(`Sign in setup for ${host}`)}

    ${error}

    <div class="dc-note">
      <strong>① Log in</strong>
      <p>Open ${escapeHtml(host)} and sign in (MFA if asked).</p>
      <p style="margin-top:12px"><a class="dc-btn primary" href="${escapeHtml(opts.loginUrl)}" target="_blank" rel="noopener">Open DigiCampus login</a></p>
    </div>

    <div class="dc-note">
      <strong>② Connect</strong>
      ${connectBtn}
      <details class="dc-advanced">
        <summary>Expert: paste session manually</summary>
        <form method="POST" action="/submit">
          <textarea class="dc-input" name="cookie" placeholder="Paste Seminar_Session value"></textarea>
          <button class="dc-btn" type="submit">Save session</button>
        </form>
      </details>
    </div>

    <p class="dc-footer">Runs only on your machine — session is stored locally.</p>
  </main>`;

  return pageShell("DigiCampus — Sign in", body);
}

export function buildLoginSuccessHtml(): string {
  const body = `<main class="dc-card">
    <div class="dc-status success">${checkIcon()}<p>Session saved. You can close this tab.</p></div>
  </main>`;
  return pageShell("DigiCampus — Signed in", body);
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

function buildConnectBookmarklet(captureUrl: string): string {
  const target = `${captureUrl}?cookie=`;
  const js = `(function(){var m=document.cookie.match(/Seminar_Session=([^;]+)/);if(!m){alert('Sign in to DigiCampus first');return;}location.href=${JSON.stringify(target)}+encodeURIComponent(m[1]);})()`;
  return `javascript:${encodeURIComponent(js)}`;
}
