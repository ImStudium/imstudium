/** ImStudium UI — shared design tokens and HTML helpers (no framework, no assets). */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function designSystemStyles(): string {
  return `
    :root {
      --is-bg: #f5f6fb;
      --is-surface: #ffffff;
      --is-border: #e5e7f0;
      --is-text: #0f172a;
      --is-muted: #667085;
      --is-primary: #4f46e5;
      --is-primary-600: #4338ca;
      --is-primary-soft: #eef2ff;
      --is-success: #15803d;
      --is-success-soft: #ecfdf3;
      --is-danger: #b42318;
      --is-danger-soft: #fef3f2;
      --is-radius-lg: 20px;
      --is-radius-md: 12px;
      --is-radius-sm: 8px;
      --is-shadow: 0 1px 2px rgba(16,24,40,.04), 0 16px 40px -12px rgba(16,24,40,.16);
      --is-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
      --is-mono: ui-monospace, "SF Mono", Menlo, monospace;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: var(--is-font);
      color: var(--is-text);
      background: var(--is-bg) radial-gradient(circle at 50% -10%, #eef1ff 0%, var(--is-bg) 55%);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 32px 20px 48px;
      min-height: 100%;
    }
    .is-shell { width: 100%; max-width: 480px; }
    .is-card {
      background: var(--is-surface);
      border: 1px solid var(--is-border);
      border-radius: var(--is-radius-lg);
      box-shadow: var(--is-shadow);
      padding: 28px 28px 24px;
    }
    .is-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .is-mark {
      width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
      background: linear-gradient(135deg, var(--is-primary), #7c6ff0);
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 700; font-size: 17px; letter-spacing: -0.02em;
    }
    .is-brand h1 { font-size: 18px; margin: 0; line-height: 1.25; letter-spacing: -0.02em; }
    .is-brand p { font-size: 13px; color: var(--is-muted); margin: 2px 0 0; }
    .is-lead { font-size: 13.5px; color: var(--is-muted); line-height: 1.55; margin: 0 0 20px; }

    .is-status { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: var(--is-radius-md); background: var(--is-primary-soft); margin-bottom: 16px; }
    .is-status.success { background: var(--is-success-soft); }
    .is-status.error { background: var(--is-danger-soft); }
    .is-status p { margin: 0; font-size: 13.5px; font-weight: 600; }
    .is-status.success p { color: var(--is-success); }
    .is-status.error p { color: var(--is-danger); }
    .is-status:not(.success):not(.error) p { color: var(--is-primary-600); }
    .is-live { font-size: 13px; color: var(--is-muted); min-height: 1.4em; margin: 0 0 18px; line-height: 1.45; }

    .is-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
    .is-step {
      display: grid;
      grid-template-columns: 28px 1fr;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--is-border);
    }
    .is-step:last-child { border-bottom: 0; padding-bottom: 0; }
    .is-step-icon { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; }
    .is-step-body h3 { margin: 0 0 2px; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
    .is-step-body p { margin: 0; font-size: 12.5px; color: var(--is-muted); line-height: 1.45; }
    .is-step-detail { margin-top: 4px; font-size: 12px; color: var(--is-primary-600); font-weight: 500; }
    .is-step.pending h3 { color: var(--is-muted); font-weight: 500; }
    .is-step.skipped .is-step-body h3 { color: var(--is-muted); text-decoration: line-through; }
    .is-step.skipped .is-step-body p { opacity: 0.7; }

    .is-ring {
      width: 22px; height: 22px; border-radius: 50%;
      border: 2px solid var(--is-border);
    }
    .is-step.active .is-ring {
      border-color: transparent;
      border-top-color: var(--is-primary);
      animation: is-spin 0.75s linear infinite;
    }
    .is-step.done .is-ring {
      border-color: var(--is-success);
      background: var(--is-success);
      position: relative;
    }
    .is-step.done .is-ring::after {
      content: "";
      position: absolute; left: 6px; top: 3px;
      width: 5px; height: 9px;
      border: solid #fff; border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .is-step.error .is-ring {
      border-color: var(--is-danger);
      background: var(--is-danger);
    }
  @keyframes is-spin { to { transform: rotate(360deg); } }

    .is-copy { font-size: 13px; color: var(--is-muted); line-height: 1.55; margin: 0 0 14px; }
    .is-copy code { background: var(--is-primary-soft); color: var(--is-primary-600); padding: 2px 5px; border-radius: 5px; font-family: var(--is-mono); font-size: 11.5px; }
    .is-note { border: 1px solid var(--is-border); border-radius: var(--is-radius-md); padding: 14px; margin: 16px 0; background: #fbfcff; }
    .is-note strong { display: block; font-size: 13.5px; margin-bottom: 4px; }
    .is-note p { margin: 0; font-size: 12.5px; color: var(--is-muted); line-height: 1.5; }
    details.is-advanced { border-top: 1px solid var(--is-border); padding-top: 16px; margin-top: 16px; }
    details.is-advanced summary { cursor: pointer; font-size: 13px; color: var(--is-muted); font-weight: 700; }
    textarea.is-input {
      width: 100%; min-height: 64px; font-family: var(--is-mono); font-size: 12.5px;
      padding: 10px; border: 1px solid var(--is-border); border-radius: var(--is-radius-sm);
      resize: vertical; margin-top: 8px;
    }
    textarea.is-input:focus { outline: 2px solid var(--is-primary); outline-offset: 1px; border-color: transparent; }
    .is-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; margin-top: 10px; background: var(--is-text); color: #fff;
      border: 0; padding: 10px 16px; border-radius: var(--is-radius-sm);
      font-weight: 600; font-size: 13.5px; cursor: pointer; transition: opacity .15s;
      text-decoration: none;
    }
    .is-btn:hover { opacity: 0.88; }
    .is-btn.primary { background: var(--is-primary); }
    .is-summary {
      margin-top: 16px; padding: 14px; border-radius: var(--is-radius-md);
      background: var(--is-success-soft); border: 1px solid #bbf7d0;
      font-size: 13px; line-height: 1.55; color: #166534;
    }
    .is-summary strong { display: block; margin-bottom: 6px; font-size: 14px; }
    .is-footer { text-align: center; margin-top: 18px; font-size: 11.5px; color: var(--is-muted); }
  `;
}

/** TRACE-inspired confirmation UI — dark, centered, type-forward (Patrick Schröppel design system). */
export function traceConfirmationStyles(): string {
  return `
    :root {
      --ground: #0A0A09;
      --ground-raise: #111110;
      --ink: #F2F0EB;
      --ink-dim: #8C8A83;
      --rule: #232321;
      --pulse: #FF5A1F;
      --pulse-dim: #451C06;
      /* System fonts only — the local sign-in pages make no third-party requests. */
      --font-display: "Bricolage Grotesque", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      --font-text: "Archivo", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      --font-mono: "IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace;
      --display-md: clamp(2rem, 6vw, 3.25rem);
      --display-sm: clamp(1.5rem, 4vw, 2.25rem);
      --text-lg: clamp(1.0625rem, 1.5vw, 1.25rem);
      --mono-sm: 0.8125rem;
      --t-fill: 600ms;
      --t-draw: 900ms;
      --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      min-height: 100%;
      font-family: var(--font-text);
      color: var(--ink);
      background: var(--ground);
      -webkit-font-smoothing: antialiased;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: clamp(24px, 5vh, 48px) 20px;
    }
    .is-confirm-shell {
      width: 100%;
      max-width: 480px;
      position: relative;
    }
    .is-confirm-card {
      background: var(--ground-raise);
      border: 1px solid var(--rule);
      padding: clamp(36px, 6vh, 52px) clamp(28px, 5vw, 40px);
      text-align: center;
    }
    .is-confirm-rail {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--pulse-dim);
    }
    .is-confirm-rail::after {
      content: "";
      position: absolute;
      left: -3px;
      top: clamp(36px, 6vh, 52px);
      width: 8px;
      height: 8px;
      background: var(--pulse);
      box-shadow: 0 0 0 4px var(--pulse-dim);
    }
    .is-stamp {
      display: block;
      font-family: var(--font-mono);
      font-size: var(--mono-sm);
      letter-spacing: 0.04em;
      text-transform: lowercase;
      color: var(--ink-dim);
      margin-bottom: clamp(24px, 4vh, 32px);
    }
    .is-stamp .alive { color: var(--pulse); }
    .is-stamp .delta { color: var(--pulse); }
    .is-done-icon {
      display: flex;
      justify-content: center;
      margin-bottom: clamp(20px, 3vh, 28px);
    }
    .is-done-icon svg {
      width: 48px;
      height: 48px;
    }
    .is-done-icon .wire-draw {
      stroke-dasharray: 120;
      stroke-dashoffset: 120;
      animation: is-draw var(--t-draw) var(--ease-out-expo) forwards;
    }
    .is-display {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: var(--display-md);
      line-height: 0.92;
      letter-spacing: -0.02em;
      text-transform: uppercase;
      margin-bottom: clamp(16px, 3vh, 24px);
    }
    .is-display.hollow {
      color: transparent;
      -webkit-text-stroke: 1.5px var(--ink);
      transition: color var(--t-fill) var(--ease-out-expo),
                  -webkit-text-stroke-color var(--t-fill) var(--ease-out-expo);
    }
    .is-display.hollow.is-filled {
      color: var(--ink);
      -webkit-text-stroke-color: transparent;
    }
    .is-lead {
      font-size: var(--text-lg);
      line-height: 1.55;
      color: var(--ink);
      max-width: 36ch;
      margin: 0 auto clamp(20px, 3vh, 28px);
    }
    .is-lead strong {
      font-weight: 600;
      color: var(--ink);
    }
    .is-rule-line {
      height: 1px;
      background: var(--rule);
      margin: 0 auto clamp(20px, 3vh, 28px);
      max-width: 120px;
    }
    .is-hint {
      font-family: var(--font-mono);
      font-size: var(--mono-sm);
      color: var(--ink-dim);
      letter-spacing: 0.02em;
      line-height: 1.6;
    }
    .is-footer-stamp {
      margin-top: clamp(28px, 4vh, 36px);
      margin-bottom: 0;
      font-size: 0.6875rem;
      opacity: 0.85;
    }
    @keyframes is-draw {
      to { stroke-dashoffset: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .is-done-icon .wire-draw { stroke-dashoffset: 0; animation: none; }
      .is-display.hollow { color: var(--ink); -webkit-text-stroke-color: transparent; }
    }
  `;
}

export function confirmationPageShell(title: string, body: string, script = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${traceConfirmationStyles()}</style>
</head>
<body>
  <div class="is-confirm-shell">
    <div class="is-confirm-rail" aria-hidden="true"></div>
    ${body}
  </div>
  ${script}
</body>
</html>`;
}

export function wireDoneIcon(): string {
  return `<div class="is-done-icon" aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path class="wire-draw" d="M4 24 H16" stroke="#451C06" stroke-width="2" stroke-linecap="square"/>
      <path class="wire-draw" d="M32 24 H44" stroke="#451C06" stroke-width="2" stroke-linecap="square" style="animation-delay: 120ms"/>
      <rect x="16" y="16" width="16" height="16" fill="#FF5A1F"/>
      <path d="M21 24 L25 28 L33 20" stroke="#0A0A09" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/>
    </svg>
  </div>`;
}

export function traceStamp(parts: { label: string; alive?: string; delta?: string }): string {
  const alive = parts.alive
    ? ` · <span class="alive">${escapeHtml(parts.alive)}</span>`
    : "";
  const delta = parts.delta ? ` · <span class="delta">Δ ${escapeHtml(parts.delta)}</span>` : "";
  return `<span class="is-stamp">${escapeHtml(parts.label)}${alive}${delta}</span>`;
}

export function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${designSystemStyles()}</style>
</head>
<body>
  <div class="is-shell">${body}</div>
</body>
</html>`;
}

export function brandHeader(subtitle: string): string {
  return `<div class="is-brand">
    <div class="is-mark">IS</div>
    <div>
      <h1>ImStudium</h1>
      <p>${escapeHtml(subtitle)}</p>
    </div>
  </div>`;
}

function checkIcon(): string {
  return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill="#15803d"/><path d="M6 10.5l2.5 2.5L14 7" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function warnIcon(): string {
  return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="10" fill="#b42318"/><path d="M10 6v5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="13.5" r="1" fill="#fff"/></svg>`;
}

export { checkIcon, warnIcon };
