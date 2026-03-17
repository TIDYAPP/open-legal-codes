/**
 * Playwright-based HTTP client for bypassing Cloudflare and other bot protection.
 * Uses a real Chromium browser locally — no external service needed.
 * Lazily launches browser on first request; reuses for subsequent ones.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PlaywrightHttpClient {
  private minDelayMs: number;
  private lastRequestTime = 0;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private launchPromise: Promise<void> | null = null;

  constructor(options?: { minDelayMs?: number }) {
    this.minDelayMs = options?.minDelayMs ?? 2000;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minDelayMs) {
      await sleep(this.minDelayMs - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context;

    // Prevent concurrent launches
    if (this.launchPromise) {
      await this.launchPromise;
      return this.context!;
    }

    this.launchPromise = (async () => {
      console.log('[playwright] Launching Chromium...');
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
      });
      console.log('[playwright] Browser ready');
    })();

    await this.launchPromise;
    return this.context!;
  }

  private async withPage<T>(task: (page: Page) => Promise<T>): Promise<T> {
    const context = await this.ensureContext();
    const page = await context.newPage();

    try {
      return await task(page);
    } finally {
      try {
        await page.close();
      } catch {
        // Ignore page teardown errors on shutdown/races.
      }
    }
  }

  async getHtml(url: string, params?: Record<string, string>): Promise<string> {
    const fullUrl = params
      ? `${url}?${new URLSearchParams(params).toString()}`
      : url;

    await this.throttle();

    return this.withPage(async (page) => {
      console.log(`[playwright] Navigating to ${fullUrl}`);
      await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 60_000 });

      // Wait a bit for any JS to finish rendering
      await sleep(1000);

      const html = await page.content();

      if (!html || html.length < 200) {
        throw new Error(`Empty or blocked response from ${fullUrl}`);
      }

      return html;
    });
  }

  async get(url: string, params?: Record<string, string>): Promise<Response> {
    const html = await this.getHtml(url, params);
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }

  async getJson<T>(url: string, params?: Record<string, string>): Promise<T> {
    const fullUrl = params
      ? `${url}?${new URLSearchParams(params).toString()}`
      : url;

    await this.throttle();

    return this.withPage(async (page) => {
      console.log(`[playwright] Fetching JSON from ${fullUrl}`);
      await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 60_000 });
      const text = await page.evaluate(() => document.body.innerText);
      return JSON.parse(text) as T;
    });
  }

  async dispose(): Promise<void> {
    if (this.context) {
      try { await this.context.close(); } catch { /* ignore */ }
      this.context = null;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
    }
    this.launchPromise = null;
    console.log('[playwright] Browser closed');
  }
}

/**
 * Check if Playwright's Chromium is available on this system.
 * Returns true if we can use PlaywrightHttpClient.
 */
export async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}
