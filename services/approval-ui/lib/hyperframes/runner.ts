// Hyperframes runner — server-only spawn wrapper for `npx hyperframes render`.
//
// HyperFrames is the heygen-com Apache-2.0 framework that renders an HTML
// scene to MP4 via headless Chrome + ffmpeg. We invoke it as a CLI sidecar
// (`npx --yes hyperframes render`) rather than depending on it as an npm
// module — that keeps approval-ui's Node 20 baseline clean while
// HyperFrames itself requires Node 22+.
//
// The runner is intentionally slim: it accepts a render request, writes a
// minimal project skeleton to a temp dir, spawns the CLI, and returns the
// path to the resulting MP4. Project-skeleton sophistication (multi-scene
// composition, brand-kit theming, prompt models like cold_start /
// warm_start / iterative) is in the legacy stack and migrates as Phase B
// of the media-gen sprint. v1 ships a single "describe your scene"
// path that lands an MP4 at the URL the Studio UI displays.
//
// Failure mode is loud: if any prerequisite (Node 22, ffmpeg, npx) is
// missing, the runtime probe surfaces it on the Studio page BEFORE the
// user submits a render. The runner itself throws a structured error
// that the route handler catches and writes into artifacts.error_message.

import { spawn } from "node:child_process";
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface RenderRequest {
  jobId: string;
  prompt: string;
  /** 5-60s, rounded server-side. Hyperframes interprets this as total scene runtime. */
  durationSec: number;
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:5";
}

export interface RenderResult {
  /** Absolute path on disk where the MP4 was written. */
  outputAbsPath: string;
  /** Public URL (path-only) the UI can play via <video src=...>. */
  publicUrl: string;
  /** Echoed back from the CLI for diagnostics. */
  appliedStyleKey: string;
  durationSec: number;
}

export interface RuntimeProbeResult {
  ready: boolean;
  checks: {
    node: { ok: boolean; version: string; satisfies: boolean; want: string };
    ffmpeg: { ok: boolean; version: string };
    npx: { ok: boolean; version: string };
  };
}

const RENDER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — Hyperframes typical render is 30-90s
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Public uploads dir — where the rendered MP4 lands so the browser can
 * fetch it via /uploads/hyperframes/<jobId>.mp4. Defaults to the Next.js
 * `public/` directory under approval-ui so files served via the static
 * pipeline. Override via UPLOADS_DIR env var for production deployments
 * that store on a different volume.
 */
function uploadsDir(): string {
  if (process.env.UPLOADS_DIR) return process.env.UPLOADS_DIR;
  // approval-ui serves /public statically; HyperFrames renders write here.
  return path.resolve(process.cwd(), "public", "uploads", "hyperframes");
}

/**
 * Probe the host environment for the prerequisites HyperFrames needs.
 * Surfaces the result on the Studio page so users know whether to expect
 * a successful render before they submit.
 */
export async function probeRuntime(): Promise<RuntimeProbeResult> {
  const checks: RuntimeProbeResult["checks"] = {
    node: {
      ok: false,
      version: process.version,
      satisfies: false,
      want: ">=22",
    },
    ffmpeg: { ok: false, version: "" },
    npx: { ok: false, version: "" },
  };

  const major = parseInt(process.version.replace(/^v/, "").split(".")[0] ?? "0", 10);
  checks.node.ok = major > 0;
  checks.node.satisfies = major >= 22;

  try {
    const r = await runOnce("ffmpeg", ["-version"], PROBE_TIMEOUT_MS);
    checks.ffmpeg.version = r.stdout.split("\n")[0]?.trim() ?? "";
    checks.ffmpeg.ok = checks.ffmpeg.version.toLowerCase().includes("ffmpeg");
  } catch {
    /* ffmpeg missing — leave defaults */
  }

  try {
    const r = await runOnce("npx", ["--version"], PROBE_TIMEOUT_MS);
    checks.npx.version = r.stdout.trim();
    checks.npx.ok = checks.npx.version.length > 0;
  } catch {
    /* npx missing — leave defaults */
  }

  const ready = checks.node.satisfies && checks.ffmpeg.ok && checks.npx.ok;
  return { ready, checks };
}

/**
 * Render an HTML scene to MP4 via the HyperFrames CLI.
 *
 * Writes a single-scene project (a slim `composition.html` + `manifest.json`)
 * to a temp dir, spawns `npx --yes hyperframes render <project>`, and copies
 * the resulting MP4 into UPLOADS_DIR/<jobId>.mp4. The temp project dir is
 * cleaned up on success; left in place on failure so an operator can
 * inspect what went wrong.
 *
 * Throws on any failure with a structured error message bounded at 800
 * chars so the artifact row's error_message column doesn't overflow.
 */
export async function renderHyperframes(req: RenderRequest): Promise<RenderResult> {
  const probeResult = await probeRuntime();
  if (!probeResult.ready) {
    const missing: string[] = [];
    if (!probeResult.checks.node.satisfies) missing.push(`Node ${probeResult.checks.node.want} (have ${probeResult.checks.node.version})`);
    if (!probeResult.checks.ffmpeg.ok) missing.push("ffmpeg");
    if (!probeResult.checks.npx.ok) missing.push("npx");
    throw new HyperframesRunnerError(
      `Hyperframes runtime not ready — missing: ${missing.join(", ")}. Install via Homebrew (brew install ffmpeg + nvm install 22) or follow the runtime probe guidance in /studio.`,
    );
  }

  const projectDir = path.join(tmpdir(), `hyperframes-${req.jobId}`);
  await mkdir(projectDir, { recursive: true });

  // Slim project skeleton — single scene, brand-neutral defaults. Phase B
  // (multi-scene composition + brand-kit theming) replaces this with a
  // richer scene authoring path; v1 demonstrates the renderer works.
  const compositionHtml = makeSceneHtml(req);
  const manifest = {
    name: `studio-${req.jobId}`,
    version: "1.0.0",
    output: { format: "mp4", aspectRatio: req.aspectRatio, durationSec: req.durationSec },
    scenes: [{ html: "composition.html", durationSec: req.durationSec }],
  };

  await Promise.all([
    writeFile(path.join(projectDir, "composition.html"), compositionHtml, "utf-8"),
    writeFile(path.join(projectDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8"),
  ]);

  const out = await runOnce(
    "npx",
    ["--yes", "hyperframes", "render", projectDir],
    RENDER_TIMEOUT_MS,
    { cwd: projectDir },
  );

  // HyperFrames writes its output as `<projectDir>/output.mp4` by convention.
  const renderedPath = path.join(projectDir, "output.mp4");
  if (!existsSync(renderedPath)) {
    throw new HyperframesRunnerError(
      `Hyperframes CLI returned exit 0 but no output.mp4 found at ${renderedPath}. stderr: ${out.stderr.slice(0, 400)}`,
    );
  }

  // Copy into the canonical uploads dir so the static pipeline can serve it.
  const uploadDir = uploadsDir();
  await mkdir(uploadDir, { recursive: true });
  const outputAbsPath = path.join(uploadDir, `${req.jobId}.mp4`);
  await copyFile(renderedPath, outputAbsPath);
  // Clean up the temp project dir now that the artifact has been moved.
  await rm(projectDir, { recursive: true, force: true }).catch(() => {
    /* nothing left to do — the operator can scrub temp manually */
  });

  return {
    outputAbsPath,
    publicUrl: `/uploads/hyperframes/${req.jobId}.mp4`,
    appliedStyleKey: "default",  // Phase B wires brand-kit theming
    durationSec: req.durationSec,
  };
}

// ─── Scene authoring (v1) ─────────────────────────────────────────────────
// Slim HTML template — full-bleed scene with the prompt as the headline.
// Doc 8 typography (Inter Variable + JetBrains Mono Variable) baked in
// so HyperFrames renders something that visually matches Mission Control.

function makeSceneHtml(req: RenderRequest): string {
  // Aspect-ratio-driven canvas dimensions. HyperFrames reads the manifest
  // for output sizing, but the HTML's intrinsic dimensions matter for the
  // typesetter — we set them explicitly to the canonical 1080p variants.
  const dims = {
    "16:9": { w: 1920, h: 1080 },
    "9:16": { w: 1080, h: 1920 },
    "1:1": { w: 1080, h: 1080 },
    "4:5": { w: 1080, h: 1350 },
  }[req.aspectRatio];

  const escapedPrompt = req.prompt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 800);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
    html, body { margin: 0; padding: 0; width: ${dims.w}px; height: ${dims.h}px; }
    body {
      background: linear-gradient(180deg, #0B0C0E 0%, #14161A 100%);
      color: #F5F5F7;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 80px;
      box-sizing: border-box;
      font-family: 'Inter', -apple-system, sans-serif;
      font-feature-settings: 'cv11', 'ss01';
    }
    .stamp {
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #14B8A6;
      margin-bottom: 32px;
    }
    .headline {
      font-size: 72px;
      line-height: 1.1;
      font-weight: 600;
      max-width: 80%;
      letter-spacing: -0.02em;
    }
    .footer {
      margin-top: auto;
      padding-top: 32px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: rgba(245, 245, 247, 0.4);
      letter-spacing: 0.05em;
      align-self: flex-start;
    }
  </style>
</head>
<body>
  <div class="stamp">CLIPSTACK · HYPERFRAMES</div>
  <h1 class="headline">${escapedPrompt}</h1>
  <div class="footer">job ${req.jobId} · ${req.aspectRatio} · ${req.durationSec}s</div>
</body>
</html>`;
}

// ─── Subprocess helper ────────────────────────────────────────────────────

interface ProcResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runOnce(
  cmd: string,
  args: string[],
  timeoutMs: number,
  opts: { cwd?: string } = {},
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd: opts.cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new HyperframesRunnerError(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    proc.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    proc.on("error", (err) => {
      clearTimeout(t);
      reject(new HyperframesRunnerError(`${cmd} failed: ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) {
        reject(
          new HyperframesRunnerError(
            `${cmd} exited ${code}. stderr: ${stderr.slice(0, 400)}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });
}

export class HyperframesRunnerError extends Error {
  constructor(message: string) {
    // Bound the message so artifact.error_message respects its CHECK.
    super(message.slice(0, 1800));
    this.name = "HyperframesRunnerError";
  }
}
