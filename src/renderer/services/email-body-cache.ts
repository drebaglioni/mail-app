import DOMPurify from "dompurify";
import { replaceRemoteImageSources } from "../../shared/email-image-privacy";

/**
 * Checks if content appears to be HTML.
 * Re-exported so EmailDetail.tsx can use the same check for theme decisions
 * without duplicating the implementation.
 */
export function isHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

/**
 * Detects HTML that is essentially plain text in a minimal wrapper — the actual
 * line breaks are \n characters rather than <br>, <p>, or block-level elements.
 */
function isPlainTextInHtml(html: string): boolean {
  if (/<(?:br|p|blockquote|table|pre|h[1-6])[\s/>]/i.test(html)) return false;
  const divCount = (html.match(/<div[\s>]/gi) || []).length;
  if (divCount > 3) return false;
  const textContent = html.replace(/<[^>]*>/g, "");
  return (textContent.match(/\n/g) || []).length >= 2;
}

/**
 * Detect whether HTML email has its own background colors (rich marketing emails).
 * Re-exported so EmailDetail.tsx can use it for theme decisions.
 *
 * White/transparent backgrounds are excluded — many email clients set an explicit
 * `background-color: white` or `bgcolor="#ffffff"` which is just the default, not
 * an indicator of rich styling.
 */
export function hasRichBackground(html: string): boolean {
  const isDefaultBg = (value: string): boolean => {
    const v = value.trim().toLowerCase();
    return (
      v === "white" ||
      v === "#fff" ||
      v === "#ffffff" ||
      v === "transparent" ||
      v === "none" ||
      v === "inherit" ||
      v === "initial" ||
      v === "unset" ||
      /^rgba?\s*\(\s*255\s*,\s*255\s*,\s*255\s*(?:,\s*[\d.]+)?\s*\)$/.test(v)
    );
  };

  // Check bgcolor HTML attributes for non-white colors
  for (const m of html.matchAll(/bgcolor\s*=\s*["']?([^"'>;]+)["']?/gi)) {
    if (!isDefaultBg(m[1])) return true;
  }
  // Check background-color CSS declarations for non-white colors
  for (const m of html.matchAll(/background-color\s*:\s*([^;}"'!]+)/gi)) {
    if (!isDefaultBg(m[1])) return true;
  }
  // Check background shorthand CSS declarations for non-white colors.
  // Skip url() values — background images (e.g. tracking pixels) aren't "rich" backgrounds.
  for (const m of html.matchAll(/background\s*:\s*([^;}"'!]+)/gi)) {
    const val = m[1].trim().toLowerCase();
    if (/^url\(/.test(val)) continue;
    if (!isDefaultBg(m[1])) return true;
  }

  return false;
}

/**
 * Replace inline data: URIs larger than ~50KB with a lightweight SVG placeholder.
 * Emails can contain multi-MB base64 images/videos that make DOMParser,
 * DOMPurify, and iframe rendering extremely slow. Call this before any heavy
 * processing (quote splitting, sanitization, rendering).
 *
 * Exported so EmailDetail can strip once and pass the light body to both
 * splitQuotedContent and EmailBodyRenderer.
 */
const MAX_DATA_URI_LEN = 50_000; // ~37KB decoded

export function stripLargeDataUris(body: string, useLightMode = true): string {
  if (!body.includes("data:")) return body;

  return body.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*["'])(data:[^"']+)(["'][^>]*>)/gi,
    (_match, before: string, dataUri: string, after: string) => {
      if (dataUri.length < MAX_DATA_URI_LEN) return _match;
      const mimeMatch = dataUri.match(/^data:([^;,]+)/);
      const mime = mimeMatch?.[1] ?? "image";
      const sizeKB = Math.round((dataUri.length * 3) / 4 / 1024);
      const sizeLabel = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`;
      const fill = useLightMode ? "#f3f4f6" : "#374151";
      const textFill = useLightMode ? "#6b7280" : "#9ca3af";
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60">` +
        `<rect width="400" height="60" rx="8" fill="${fill}"/>` +
        `<text x="200" y="35" text-anchor="middle" fill="${textFill}" font-family="system-ui" font-size="13">` +
        `Inline ${mime} (${sizeLabel}) — too large to display inline` +
        `</text></svg>`;
      return `${before}data:image/svg+xml,${encodeURIComponent(svg)}${after}`;
    },
  );
}

const SANITIZE_CONFIG = {
  WHOLE_DOCUMENT: false,
  ALLOWED_TAGS: [
    "p",
    "br",
    "div",
    "span",
    "a",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "ul",
    "ol",
    "li",
    "table",
    "tr",
    "td",
    "th",
    "thead",
    "tbody",
    "tfoot",
    "img",
    "blockquote",
    "pre",
    "code",
    "hr",
    "center",
    "font",
    "section",
    "article",
    "header",
    "footer",
    "nav",
    "aside",
    "style",
  ],
  ALLOWED_ATTR: [
    "href",
    "src",
    "alt",
    "title",
    "style",
    "class",
    "id",
    "target",
    "width",
    "height",
    "border",
    "cellpadding",
    "cellspacing",
    "align",
    "valign",
    "bgcolor",
    "color",
    "face",
    "size",
    "type",
  ],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ["target"],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|data|cid):)/i,
};

function buildIframeHtml(
  sanitizedBody: string,
  useLightMode: boolean,
  needsPreLine: boolean,
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="referrer" content="no-referrer">
  <base target="_blank">
  <style>
    :root {
      color-scheme: ${useLightMode ? "light" : "dark"};
      --capsule-text: ${useLightMode ? "#20201d" : "#f4efe8"};
      --capsule-muted: ${useLightMode ? "#6d7069" : "#aaa89d"};
      --capsule-link: ${useLightMode ? "#4f46e5" : "#a5b4fc"};
      --capsule-rule: ${useLightMode ? "#e7e4dc" : "#34312c"};
      --capsule-soft: ${useLightMode ? "#f7f5ef" : "#181713"};
    }
    html {
      background: transparent;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      line-height: 1.64;
      color: var(--capsule-text);
      background: transparent;
      margin: 0;
      padding: 0;
      word-break: break-word;${needsPreLine ? "\n      white-space: pre-line;" : ""}
      -webkit-font-smoothing: antialiased;
    }
    body > *:first-child { margin-top: 0 !important; }
    body > *:last-child { margin-bottom: 0 !important; }
    img {
      max-width: 100% !important;
      height: auto !important;
      display: block;
      border-radius: 14px;
    }
    img[title*="Remote image blocked"],
    img[alt*="Remote image blocked"] {
      width: min(100%, 640px) !important;
      min-height: 72px;
      object-fit: cover;
      border: 1px solid var(--capsule-rule);
      background: linear-gradient(135deg, var(--capsule-soft), transparent);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.52);
    }
    a {
      color: var(--capsule-link);
      text-decoration-thickness: .08em;
      text-underline-offset: .18em;
    }
    p { margin: 0 0 1em; }
    h1, h2, h3, h4, h5, h6 {
      color: var(--capsule-text);
      letter-spacing: 0;
      line-height: 1.12;
      margin: 1.35em 0 .55em;
    }
    table {
      max-width: 100% !important;
      border-collapse: collapse;
      overflow-wrap: anywhere;
    }
    td, th {
      vertical-align: top;
      max-width: 100%;
    }
    blockquote {
      margin: 1rem 0;
      padding: .1rem 0 .1rem 1rem;
      border-left: 2px solid var(--capsule-rule);
      color: var(--capsule-muted);
    }
    pre {
      max-width: 100%;
      overflow-x: auto;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--capsule-soft);
    }
    ${
      !useLightMode
        ? `
    /* Override inline styles that assume a white background.
       Only applied in dark-content mode (non-rich HTML emails). */
    body, div, p, span, td, th, li, font, h1, h2, h3, h4, h5, h6 {
      color: #e5e7eb !important;
    }
    div, p, span, td, th, li, font, h1, h2, h3, h4, h5, h6,
    table, tr, thead, tbody, tfoot, center, blockquote, pre {
      background-color: transparent !important;
    }
    blockquote, blockquote * { color: #9ca3af !important; background-color: transparent !important; }
    a { color: var(--capsule-link) !important; }
    `
        : ""
    }
  </style>
</head>
<body>${sanitizedBody}</body>
</html>`;
}

export type SanitizedResult =
  | {
      isHtml: true;
      htmlContent: string;
    }
  | {
      isHtml: false;
      htmlContent: null;
    };

/**
 * LRU cache for pre-sanitized email body HTML. Stores the complete iframe HTML
 * document (DOMPurify output + CSS) so switching between emails doesn't
 * re-sanitize each time.
 *
 * Cache key: `${emailId}:${lightMode}` — different themes produce different CSS,
 * so each theme variant is cached separately.
 */
class EmailBodyCache {
  private cache = new Map<string, SanitizedResult>();
  private maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  private makeKey(emailId: string, useLightMode: boolean, allowRemoteImages: boolean): string {
    return `${emailId}:${useLightMode ? "l" : "d"}:${allowRemoteImages ? "remote" : "privacy"}`;
  }

  /**
   * Get cached sanitized HTML, or compute + cache it synchronously.
   *
   * The cache key is `emailId:lightMode` — `body` is only used on cache miss
   * to compute the result. This is correct because Gmail message bodies are
   * immutable: the body for a given emailId never changes.
   */
  getOrCompute(
    emailId: string,
    body: string,
    useLightMode: boolean,
    allowRemoteImages = false,
  ): SanitizedResult {
    const key = this.makeKey(emailId, useLightMode, allowRemoteImages);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Move to end for LRU freshness
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const result = this.compute(body, useLightMode, allowRemoteImages);
    this.set(key, result);
    return result;
  }

  /**
   * Check if a result is already cached.
   */
  has(emailId: string, useLightMode: boolean, allowRemoteImages = false): boolean {
    return this.cache.has(this.makeKey(emailId, useLightMode, allowRemoteImages));
  }

  /**
   * Precompute sanitized HTML in the background without blocking the current render.
   * Uses requestIdleCallback where available, falls back to setTimeout(0).
   * Returns a cancel function so callers can clean up stale precompute requests
   * (e.g., in a useEffect cleanup when the user rapidly switches threads).
   */
  precompute(
    emailId: string,
    body: string,
    useLightMode: boolean,
    allowRemoteImages = false,
  ): () => void {
    const key = this.makeKey(emailId, useLightMode, allowRemoteImages);
    if (this.cache.has(key)) return () => {};

    const useIdleCallback = typeof requestIdleCallback === "function";

    const handle: number = useIdleCallback
      ? requestIdleCallback(() => {
          if (this.cache.has(key)) return;
          const result = this.compute(body, useLightMode, allowRemoteImages);
          this.set(key, result);
        })
      : window.setTimeout(() => {
          if (this.cache.has(key)) return;
          const result = this.compute(body, useLightMode, allowRemoteImages);
          this.set(key, result);
        }, 0);

    return () => {
      if (useIdleCallback) {
        cancelIdleCallback(handle);
      } else {
        clearTimeout(handle);
      }
    };
  }

  /**
   * Invalidate cached entries for an email.
   */
  invalidate(emailId: string): void {
    const toDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${emailId}:`)) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.cache.delete(key);
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private set(key: string, value: SanitizedResult): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest entry (first in Map iteration order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  private compute(
    body: string,
    useLightMode: boolean,
    allowRemoteImages: boolean,
  ): SanitizedResult {
    if (!isHtmlContent(body)) {
      return { isHtml: false, htmlContent: null };
    }

    const stripped = stripLargeDataUris(body, useLightMode);

    const needsPreLine = isPlainTextInHtml(stripped);
    const clean = DOMPurify.sanitize(stripped, SANITIZE_CONFIG);
    const imageSafe = allowRemoteImages ? clean : replaceRemoteImageSources(clean, useLightMode);
    const htmlContent = buildIframeHtml(imageSafe, useLightMode, needsPreLine);

    return { isHtml: true, htmlContent };
  }
}

/** Singleton cache instance shared across all EmailBodyRenderer components */
export const emailBodyCache = new EmailBodyCache();
