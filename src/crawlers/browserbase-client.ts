/**
 * Browserbase + Stagehand HTTP client for crawling publisher sites
 * that block simple HTTP requests.
 *
 * Uses Stagehand (Browserbase's AI browser automation framework) to:
 * - Navigate pages with a real Chrome browser (bypasses Cloudflare, etc.)
 * - Extract structured content using AI when CSS selectors fail
 *
 * Implements the same interface as HttpClient so adapters can use it
 * as a drop-in replacement.
 *
 * Requires env vars: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID
 * Optional: ANTHROPIC_API_KEY (for AI-powered extract())
 */

import { Stagehand } from '@browserbasehq/stagehand';
import { HttpClient } from './http-client.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BrowserbaseHttpClient {
  private minDelayMs: number;
  private stagehand: Stagehand | null = null;
  private page: any = null;
  private lastRequestTime = 0;

  constructor(options?: { minDelayMs?: number }) {
    this.minDelayMs = options?.minDelayMs ?? 2000;
    if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
      throw new Error(
        'BrowserbaseHttpClient requires BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID env vars'
      );
    }
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minDelayMs) {
      await sleep(this.minDelayMs - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  private async ensureSession(): Promise<{ page: any; stagehand: Stagehand }> {
    if (this.page && this.stagehand) return { page: this.page, stagehand: this.stagehand };

    console.log('[stagehand] Creating new session...');
    const stagehand = new Stagehand({
      env: 'BROWSERBASE',
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      model: {
        modelName: 'claude-sonnet-4-5-20250929',
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    });
    await stagehand.init();
    console.log('[stagehand] Session initialized');

    this.stagehand = stagehand;
    const activePage = stagehand.context.activePage();
    if (!activePage) {
      throw new Error('Stagehand session has no active page');
    }
    this.page = activePage;
    return { page: this.page, stagehand: this.stagehand };
  }

  private buildUrl(url: string, params?: Record<string, string>): string {
    if (!params) return url;
    return `${url}?${new URLSearchParams(params).toString()}`;
  }

  async getHtml(url: string, params?: Record<string, string>): Promise<string> {
    const fullUrl = this.buildUrl(url, params);
    const { page } = await this.ensureSession();
    await this.throttle();

    console.log(`[stagehand] Navigating to ${fullUrl}`);
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeoutMs: 60_000 });
    const html = await page.evaluate(() => document.documentElement.outerHTML);

    if (!html || html.length < 100) {
      throw new Error(`Empty or blocked response from ${fullUrl}`);
    }

    return html;
  }

  async get(url: string, params?: Record<string, string>): Promise<Response> {
    const html = await this.getHtml(url, params);
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }

  async getJson<T>(url: string, params?: Record<string, string>): Promise<T> {
    const fullUrl = this.buildUrl(url, params);
    const { page } = await this.ensureSession();
    await this.throttle();

    console.log(`[stagehand] Fetching JSON from ${fullUrl}`);
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeoutMs: 60_000 });
    const text = await page.evaluate(() => document.body.innerText);
    return JSON.parse(text) as T;
  }

  /**
   * Get the Stagehand instance for AI-powered extraction.
   * Use this when CSS selectors aren't reliable enough.
   */
  async getStagehand(): Promise<Stagehand> {
    const { stagehand } = await this.ensureSession();
    return stagehand;
  }

  async dispose(): Promise<void> {
    if (this.stagehand) {
      try { await this.stagehand.close(); } catch { /* ignore */ }
      this.stagehand = null;
      this.page = null;
    }
    console.log('[stagehand] Session closed');
  }
}

/**
 * HTTP client that tries plain fetch first, falls back to Browserbase
 * when the request is blocked (403, Cloudflare challenge, empty response).
 * Lazily creates the Browserbase session only when needed.
 */
export class FallbackHttpClient {
  private plainHttp: HttpClient;
  private bbClient: BrowserbaseHttpClient | null = null;
  private bbAvailable: boolean;
  private bbOptions: { minDelayMs?: number };
  private useBrowserbase = false;

  constructor(options?: { minDelayMs?: number }) {
    this.plainHttp = new HttpClient({ minDelayMs: options?.minDelayMs ?? 500 });
    this.bbAvailable = !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
    this.bbOptions = options ?? {};
  }

  private getBrowserbase(): BrowserbaseHttpClient {
    if (!this.bbClient) {
      this.bbClient = new BrowserbaseHttpClient(this.bbOptions);
    }
    return this.bbClient;
  }

  private isBlocked(html: string): boolean {
    if (!html || html.length < 200) return true;
    const lower = html.toLowerCase();
    return lower.includes('cloudflare') && lower.includes('challenge') ||
      lower.includes('just a moment') && lower.includes('cf-') ||
      lower.includes('access denied') && html.length < 2000;
  }

  async getHtml(url: string, params?: Record<string, string>): Promise<string> {
    if (this.useBrowserbase && this.bbAvailable) {
      return this.getBrowserbase().getHtml(url, params);
    }

    try {
      const html = await this.plainHttp.getHtml(url, params);
      if (this.isBlocked(html) && this.bbAvailable) {
        console.log(`[fallback] Plain HTTP returned blocked response, switching to Browserbase`);
        this.useBrowserbase = true;
        return this.getBrowserbase().getHtml(url, params);
      }
      return html;
    } catch (err: any) {
      if (this.bbAvailable && (err.message?.includes('403') || err.message?.includes('503'))) {
        console.log(`[fallback] Plain HTTP failed (${err.message}), switching to Browserbase`);
        this.useBrowserbase = true;
        return this.getBrowserbase().getHtml(url, params);
      }
      throw err;
    }
  }

  async get(url: string, params?: Record<string, string>): Promise<Response> {
    const html = await this.getHtml(url, params);
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }

  async getJson<T>(url: string, params?: Record<string, string>): Promise<T> {
    if (this.useBrowserbase && this.bbAvailable) {
      return this.getBrowserbase().getJson<T>(url, params);
    }

    try {
      return await this.plainHttp.getJson<T>(url, params);
    } catch (err: any) {
      if (this.bbAvailable && (err.message?.includes('403') || err.message?.includes('503'))) {
        console.log(`[fallback] Plain HTTP JSON failed (${err.message}), switching to Browserbase`);
        this.useBrowserbase = true;
        return this.getBrowserbase().getJson<T>(url, params);
      }
      throw err;
    }
  }

  async getStagehand(): Promise<Stagehand> {
    return this.getBrowserbase().getStagehand();
  }

  async dispose(): Promise<void> {
    if (this.bbClient) {
      await this.bbClient.dispose();
    }
  }
}

/**
 * Returns a FallbackHttpClient that tries plain HTTP first,
 * falling back to Browserbase when blocked.
 */
export function createFallbackClient(
  options?: { minDelayMs?: number }
): FallbackHttpClient {
  return new FallbackHttpClient(options);
}

/**
 * Returns a BrowserbaseHttpClient if env vars are set, otherwise null.
 */
export function createBrowserbaseClient(
  options?: { minDelayMs?: number }
): BrowserbaseHttpClient | null {
  if (process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID) {
    return new BrowserbaseHttpClient(options);
  }
  return null;
}
