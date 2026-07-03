/** DigiCampus UI — shared design tokens and HTML helpers (no framework, no assets). */

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
      --dc-bg: #f5f6fb;
      --dc-surface: #ffffff;
      --dc-border: #e5e7f0;
      --dc-text: #0f172a;
      --dc-muted: #667085;
      --dc-primary: #4f46e5;
      --dc-primary-600: #4338ca;
      --dc-primary-soft: #eef2ff;
      --dc-success: #15803d;
      --dc-success-soft: #ecfdf3;
      --dc-danger: #b42318;
      --dc-danger-soft: #fef3f2;
      --dc-radius-lg: 20px;
      --dc-radius-md: 12px;
      --dc-radius-sm: 8px;
      --dc-shadow: 0 1px 2px rgba(16,24,40,.04), 0 16px 40px -12px rgba(16,24,40,.16);
      --dc-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
      --dc-mono: ui-monospace, "SF Mono", Menlo, monospace;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: var(--dc-font);
      color: var(--dc-text);
      background: var(--dc-bg) radial-gradient(circle at 50% -10%, #eef1ff 0%, var(--dc-bg) 55%);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 32px 20px 48px;
      min-height: 100%;
    }
    .dc-shell { width: 100%; max-width: 480px; }
    .dc-card {
      background: var(--dc-surface);
      border: 1px solid var(--dc-border);
      border-radius: var(--dc-radius-lg);
      box-shadow: var(--dc-shadow);
      padding: 28px 28px 24px;
    }
    .dc-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .dc-mark {
      width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0;
      background: linear-gradient(135deg, var(--dc-primary), #7c6ff0);
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-weight: 700; font-size: 17px; letter-spacing: -0.02em;
    }
    .dc-brand h1 { font-size: 18px; margin: 0; line-height: 1.25; letter-spacing: -0.02em; }
    .dc-brand p { font-size: 13px; color: var(--dc-muted); margin: 2px 0 0; }
    .dc-lead { font-size: 13.5px; color: var(--dc-muted); line-height: 1.55; margin: 0 0 20px; }

    .dc-status { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-radius: var(--dc-radius-md); background: var(--dc-primary-soft); margin-bottom: 16px; }
    .dc-status.success { background: var(--dc-success-soft); }
    .dc-status.error { background: var(--dc-danger-soft); }
    .dc-status p { margin: 0; font-size: 13.5px; font-weight: 600; }
    .dc-status.success p { color: var(--dc-success); }
    .dc-status.error p { color: var(--dc-danger); }
    .dc-status:not(.success):not(.error) p { color: var(--dc-primary-600); }
    .dc-live { font-size: 13px; color: var(--dc-muted); min-height: 1.4em; margin: 0 0 18px; line-height: 1.45; }

    .dc-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
    .dc-step {
      display: grid;
      grid-template-columns: 28px 1fr;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--dc-border);
    }
    .dc-step:last-child { border-bottom: 0; padding-bottom: 0; }
    .dc-step-icon { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; }
    .dc-step-body h3 { margin: 0 0 2px; font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
    .dc-step-body p { margin: 0; font-size: 12.5px; color: var(--dc-muted); line-height: 1.45; }
    .dc-step-detail { margin-top: 4px; font-size: 12px; color: var(--dc-primary-600); font-weight: 500; }
    .dc-step.pending h3 { color: var(--dc-muted); font-weight: 500; }
    .dc-step.skipped .dc-step-body h3 { color: var(--dc-muted); text-decoration: line-through; }
    .dc-step.skipped .dc-step-body p { opacity: 0.7; }

    .dc-ring {
      width: 22px; height: 22px; border-radius: 50%;
      border: 2px solid var(--dc-border);
    }
    .dc-step.active .dc-ring {
      border-color: transparent;
      border-top-color: var(--dc-primary);
      animation: dc-spin 0.75s linear infinite;
    }
    .dc-step.done .dc-ring {
      border-color: var(--dc-success);
      background: var(--dc-success);
      position: relative;
    }
    .dc-step.done .dc-ring::after {
      content: "";
      position: absolute; left: 6px; top: 3px;
      width: 5px; height: 9px;
      border: solid #fff; border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .dc-step.error .dc-ring {
      border-color: var(--dc-danger);
      background: var(--dc-danger);
    }
  @keyframes dc-spin { to { transform: rotate(360deg); } }

    .dc-copy { font-size: 13px; color: var(--dc-muted); line-height: 1.55; margin: 0 0 14px; }
    .dc-copy code { background: var(--dc-primary-soft); color: var(--dc-primary-600); padding: 2px 5px; border-radius: 5px; font-family: var(--dc-mono); font-size: 11.5px; }
    .dc-note { border: 1px solid var(--dc-border); border-radius: var(--dc-radius-md); padding: 14px; margin: 16px 0; background: #fbfcff; }
    .dc-note strong { display: block; font-size: 13.5px; margin-bottom: 4px; }
    .dc-note p { margin: 0; font-size: 12.5px; color: var(--dc-muted); line-height: 1.5; }
    details.dc-advanced { border-top: 1px solid var(--dc-border); padding-top: 16px; margin-top: 16px; }
    details.dc-advanced summary { cursor: pointer; font-size: 13px; color: var(--dc-muted); font-weight: 700; }
    textarea.dc-input {
      width: 100%; min-height: 64px; font-family: var(--dc-mono); font-size: 12.5px;
      padding: 10px; border: 1px solid var(--dc-border); border-radius: var(--dc-radius-sm);
      resize: vertical; margin-top: 8px;
    }
    textarea.dc-input:focus { outline: 2px solid var(--dc-primary); outline-offset: 1px; border-color: transparent; }
    .dc-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      width: 100%; margin-top: 10px; background: var(--dc-text); color: #fff;
      border: 0; padding: 10px 16px; border-radius: var(--dc-radius-sm);
      font-weight: 600; font-size: 13.5px; cursor: pointer; transition: opacity .15s;
      text-decoration: none;
    }
    .dc-btn:hover { opacity: 0.88; }
    .dc-btn.primary { background: var(--dc-primary); }
    .dc-summary {
      margin-top: 16px; padding: 14px; border-radius: var(--dc-radius-md);
      background: var(--dc-success-soft); border: 1px solid #bbf7d0;
      font-size: 13px; line-height: 1.55; color: #166534;
    }
    .dc-summary strong { display: block; margin-bottom: 6px; font-size: 14px; }
    .dc-footer { text-align: center; margin-top: 18px; font-size: 11.5px; color: var(--dc-muted); }
  `;
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
  <div class="dc-shell">${body}</div>
</body>
</html>`;
}

export function brandHeader(subtitle: string): string {
  return `<div class="dc-brand">
    <div class="dc-mark">DC</div>
    <div>
      <h1>DigiCampus</h1>
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
