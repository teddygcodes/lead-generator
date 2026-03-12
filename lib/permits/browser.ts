/**
 * Shared Playwright browser utilities for permit adapters that require a real
 * Chrome browser (Cherokee, Cobb) to bypass Cloudflare WAF or portal login walls.
 */

import { existsSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Chromium executable discovery
// ---------------------------------------------------------------------------

/**
 * Known Chromium/Chrome executable paths in priority order.
 * The Playwright MCP cache is listed first (already installed); system Chrome
 * is a fallback.
 */
export const CHROMIUM_CANDIDATES = [
  // Playwright MCP cache — arm64 Mac
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
  // System Chrome — Mac (Intel or Apple Silicon via Rosetta)
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  // Override via env var
  process.env.CHROME_PATH ?? '',
]

/**
 * Returns the first Chromium/Chrome executable path that exists on disk.
 * Throws if none are found — caller must install Playwright Chromium or set CHROME_PATH.
 */
export function findChromiumPath(): string {
  for (const p of CHROMIUM_CANDIDATES) {
    if (p && existsSync(p)) return p
  }
  throw new Error(
    '[browser] No Chromium found. Run: pnpm exec playwright install chromium  ' +
      'or set CHROME_PATH env var to an existing Chrome/Chromium executable.',
  )
}
