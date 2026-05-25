/**
 * Build the sandbox-safe HTML document that gets injected into an email-body
 * <iframe> via `srcdoc`. Returns a complete `<!DOCTYPE html>...</html>` string
 * with theme-aware text/link colors and a tiny inline script that opens all
 * links in a new tab.
 *
 * Shared between the desktop EmailViewer and the mobile EmailScreen so both
 * surfaces render the body consistently.
 */
export interface BuildEmailIframeDocOptions {
  bodyHtml: string;
  isDark: boolean;
  /** If true, also adds mobile-specific overrides (overflow-x scroll, force max-width). */
  mobile?: boolean;
}

export function buildEmailIframeDoc({ bodyHtml, isDark, mobile = false }: BuildEmailIframeDocOptions): string {
  const mobileExtras = mobile
    ? `
  body { overflow-x: auto; }
  img, table { max-width: 100% !important; height: auto; }
  table { width: auto !important; }
`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: ${isDark ? '#d1d5db' : '#374151'};
    background: transparent;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  a { color: ${isDark ? '#60a5fa' : '#2563eb'}; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100% !important; }
  pre, code { white-space: pre-wrap; word-wrap: break-word; }
  blockquote {
    border-left: 3px solid ${isDark ? '#4b5563' : '#d1d5db'};
    margin: 8px 0;
    padding: 4px 12px;
    color: ${isDark ? '#9ca3af' : '#6b7280'};
  }${mobileExtras}
</style>
</head>
<body>${bodyHtml}</body>
<script>document.querySelectorAll('a[href]').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });</script>
</html>`;
}
