/**
 * ImStudium login UI — uses shared design system from ui.ts
 */
import {
  brandHeader,
  confirmationPageShell,
  escapeHtml,
  pageShell,
  traceStamp,
  warnIcon,
  wireDoneIcon,
} from "./ui.js";

export function buildLoginHelperHtml(opts: {
  origin: string;
  loginUrl: string;
  captureUrl?: string;
  error?: string;
}): string {
  const host = new URL(opts.origin).hostname;
  const error = opts.error
    ? `<div class="is-status error">${warnIcon()}<p>${escapeHtml(opts.error)}</p></div>`
    : "";

  const connectBtn = opts.captureUrl
    ? `<p class="is-copy">On the ${escapeHtml(host)} tab after sign-in, click:</p>
       <p><a class="is-btn primary" href="${escapeHtml(buildConnectBookmarklet(opts.captureUrl))}">Connect ImStudium</a></p>
       <p class="is-copy">Drag that button to your bookmarks bar if the click does not work from the Stud.IP tab.</p>`
    : "";

  const body = `<main class="is-card">
    ${brandHeader(`Sign in setup for ${host}`)}

    ${error}

    <div class="is-note">
      <strong>① Log in</strong>
      <p>Open ${escapeHtml(host)} and sign in (MFA if asked).</p>
      <p style="margin-top:12px"><a class="is-btn primary" href="${escapeHtml(opts.loginUrl)}" target="_blank" rel="noopener">Open Stud.IP login</a></p>
    </div>

    <div class="is-note">
      <strong>② Connect</strong>
      ${connectBtn}
      <details class="is-advanced">
        <summary>Expert: paste session manually</summary>
        <form method="POST" action="/submit">
          <textarea class="is-input" name="cookie" placeholder="Paste Seminar_Session value"></textarea>
          <button class="is-btn" type="submit">Save session</button>
        </form>
      </details>
    </div>

    <p class="is-footer">Runs only on your machine — session is stored locally.</p>
  </main>`;

  return pageShell("ImStudium — Sign in", body);
}

export function buildLoginSuccessHtml(opts?: {
  userName?: string;
  host?: string;
}): string {
  const host = opts?.host || "ImStudium";
  const savedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  const who = opts?.userName
    ? `<strong>${escapeHtml(opts.userName)}</strong> — `
    : "";

  const body = `<main class="is-confirm-card">
    ${traceStamp({ label: `imstudium · ${host} · session`, alive: "live" })}
    ${wireDoneIcon()}
    <h1 class="is-display hollow" id="done-word">Signed<br />in.</h1>
    <p class="is-lead">${who}Session stored on this device. You can sync and use MCP tools from your terminal.</p>
    <div class="is-rule-line" aria-hidden="true"></div>
    <p class="is-hint">Close this tab when ready.<br />Return to your terminal to continue.</p>
    ${traceStamp({ label: `studium os · saved ${savedAt}`, delta: "connected" })}
  </main>`;

  const script = `<script>
    (function () {
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var el = document.getElementById("done-word");
      if (!el) return;
      if (reduce) { el.classList.add("is-filled"); return; }
      setTimeout(function () { el.classList.add("is-filled"); }, 480);
    })();
  </script>`;

  return confirmationPageShell("ImStudium — Signed in", body, script);
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
  const js = `(function(){var m=document.cookie.match(/Seminar_Session=([^;]+)/);if(!m){alert('Sign in to Stud.IP first');return;}location.href=${JSON.stringify(target)}+encodeURIComponent(m[1]);})()`;
  return `javascript:${encodeURIComponent(js)}`;
}
