// Brand-kit inference — paste your homepage URL, get a proposed brand kit.
//
// v1 ships a heuristic extractor that parses the URL's HTML for inline
// colors + font-family declarations + meta tags. No LLM dependency —
// works against any URL with reachable HTML, demoable without an API
// key configured.
//
// v2 layers an LLM call on top when ANTHROPIC_API_KEY is set: pass the
// rendered DOM + screenshot to Claude with a structured prompt and let
// it propose the palette + tone-of-voice with judgment instead of regex.
// The heuristic path becomes the fallback for keyless dev.

const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 2_000_000;

export interface BrandKitProposal {
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  fontPrimary: string | null;
  fontSecondary: string | null;
  toneOfVoice: string | null;
  logoUrl: string | null;
  sourceUrl: string;
  inferenceMeta: {
    method: "heuristic" | "llm";
    palette: string[];
    fonts: string[];
    metaDescription: string | null;
    pageTitle: string | null;
  };
}

export class BrandKitInferenceError extends Error {
  constructor(message: string) {
    super(message.slice(0, 1800));
    this.name = "BrandKitInferenceError";
  }
}

/**
 * Heuristic extraction. Fetches the URL, regex-extracts:
 *   - palette: top 5 most-frequent hex colors in CSS
 *   - fonts: first 2 distinct font-family values
 *   - tone: meta description (if present)
 *   - logo: first <img> with "logo" in src or alt
 *   - title: <title> tag
 *
 * Heuristics deliberate; not perfect. The user reviews the proposal
 * before saving — the inference is the "wow moment", the human judgment
 * is the safety gate.
 */
export async function inferBrandKitFromUrl(rawUrl: string): Promise<BrandKitProposal> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BrandKitInferenceError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrandKitInferenceError(`Only http/https URLs supported, got ${url.protocol}`);
  }

  let html: string;
  try {
    const resp = await fetch(url.toString(), {
      headers: {
        // Identify ourselves so a site that wants to reject scrapers can
        // see the request cleanly. Most CDNs allow this UA fine; brittle
        // sites get the same fallback (heuristic with what we have).
        "User-Agent": "Mozilla/5.0 (compatible; ClipstackBrandKitImporter/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!resp.ok) {
      throw new BrandKitInferenceError(`Fetch ${url} returned HTTP ${resp.status}`);
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > MAX_HTML_BYTES) {
      // Truncate at the byte cap; usually plenty for above-the-fold CSS.
      html = new TextDecoder("utf-8", { fatal: false }).decode(
        buf.slice(0, MAX_HTML_BYTES),
      );
    } else {
      html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    }
  } catch (err) {
    if (err instanceof BrandKitInferenceError) throw err;
    throw new BrandKitInferenceError(
      `Could not fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // ─── Extract palette: top 5 most-frequent #RRGGBB / #RGB hex colors ─────
  // Skips whites, blacks, near-whites/blacks (those are usually default
  // browser styles or backgrounds, not brand colors). Normalizes #RGB to
  // #RRGGBB for consistent counting.
  const palette = extractPalette(html);

  // ─── Extract fonts: first 2 distinct font-family values ─────────────────
  const fonts = extractFonts(html);

  // ─── Extract meta + title ──────────────────────────────────────────────
  const metaDescription = extractMetaDescription(html);
  const pageTitle = extractPageTitle(html);

  // ─── Extract logo URL ──────────────────────────────────────────────────
  const logoUrl = extractLogoUrl(html, url);

  // Tone-of-voice — heuristic v1 is the meta description verbatim. v2
  // layers an LLM call to write a proper editorial tone summary.
  const toneOfVoice = metaDescription
    ? `Inferred from page meta: "${metaDescription.slice(0, 240)}"`
    : null;

  return {
    primaryColor: palette[0] ?? null,
    secondaryColor: palette[1] ?? null,
    accentColor: palette[2] ?? null,
    fontPrimary: fonts[0] ?? null,
    fontSecondary: fonts[1] ?? null,
    toneOfVoice,
    logoUrl,
    sourceUrl: url.toString(),
    inferenceMeta: {
      method: "heuristic",
      palette,
      fonts,
      metaDescription,
      pageTitle,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const NEAR_WHITE = (r: number, g: number, b: number): boolean =>
  r > 240 && g > 240 && b > 240;
const NEAR_BLACK = (r: number, g: number, b: number): boolean =>
  r < 16 && g < 16 && b < 16;

function extractPalette(html: string): string[] {
  // Match #RRGGBB and #RGB. Lowercase, dedupe later.
  const matches = html.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi);
  const counts = new Map<string, number>();
  for (const match of matches) {
    let hex = match[1]!.toLowerCase();
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (NEAR_WHITE(r, g, b) || NEAR_BLACK(r, g, b)) continue;
    const norm = `#${hex}`;
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([color]) => color);
}

function extractFonts(html: string): string[] {
  // Regex on font-family: declarations. Real CSS families look like
  // `font-family: "Inter", -apple-system, sans-serif;`. We split by comma,
  // trim, strip quotes, exclude generic fallbacks (sans-serif, serif,
  // system-ui, etc).
  const generics = new Set([
    "inherit",
    "initial",
    "monospace",
    "sans-serif",
    "serif",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "ui-rounded",
    "-apple-system",
    "blinkmacsystemfont",
    "segoe ui",
    "roboto",
    "helvetica",
    "arial",
  ]);
  const seen = new Set<string>();
  const ordered: string[] = [];
  const matches = html.matchAll(/font-family\s*:\s*([^;}\n"]+(?:"[^"]*"[^;}\n]*)*)/gi);
  for (const match of matches) {
    const stack = match[1] ?? "";
    const families = stack
      .split(",")
      .map((f) => f.trim().replace(/^["']|["']$/g, ""))
      .filter((f) => f.length > 0 && !generics.has(f.toLowerCase()));
    for (const f of families) {
      const norm = f;
      if (!seen.has(norm.toLowerCase())) {
        seen.add(norm.toLowerCase());
        ordered.push(norm);
      }
      if (ordered.length >= 4) break;
    }
    if (ordered.length >= 4) break;
  }
  return ordered.slice(0, 2);
}

function extractMetaDescription(html: string): string | null {
  // <meta name="description" content="..."> or <meta property="og:description">
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  ];
  for (const re of patterns) {
    const match = re.exec(html);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractPageTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match?.[1]?.trim() ?? null;
}

function extractLogoUrl(html: string, base: URL): string | null {
  // First <img> with "logo" in src/alt/class. Resolve relative URLs.
  const candidates = html.matchAll(
    /<img[^>]+(?:src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["']|class=["']([^"']*)["'])|(?:alt=["']([^"']*)["']|class=["']([^"']*)["'])[^>]*src=["']([^"']+)["'])/gi,
  );
  for (const c of candidates) {
    const src = c[1] ?? c[6];
    const alt = (c[2] ?? c[4] ?? "").toLowerCase();
    const cls = (c[3] ?? c[5] ?? "").toLowerCase();
    if (!src) continue;
    if (
      alt.includes("logo") ||
      cls.includes("logo") ||
      src.toLowerCase().includes("logo")
    ) {
      try {
        return new URL(src, base).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}
