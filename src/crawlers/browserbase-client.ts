/**
 * Browserbase HTTP client for crawling publisher sites that block plain HTTP.
 *
 * Uses Browserbase's cloud browsers via their REST API + Playwright connect.
 * No LLM key needed — just BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID.
 *
 * Flow:
 * 1. Create a session via Browserbase REST API
 * 2. Connect Playwright to the session via CDP
 * 3. Navigate and extract HTML
 * 4. Reuse the session for subsequent requests
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { HttpClient } from './http-client.js';
import { PlaywrightHttpClient } from './playwright-client.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BrowserbaseHttpClient {
  private minDelayMs: number;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionId: string | null = null;
  private lastRequestTime = 0;
  private connecting: Promise<void> | null = null;

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

  private async ensureSession(): Promise<Page> {
    if (this.page) return this.page;

    // Prevent concurrent session creation
    if (this.connecting) {
      await this.connecting;
      return this.page!;
    }

    this.connecting = (async () => {
      const apiKey = process.env.BROWSERBASE_API_KEY!;
      const projectId = process.env.BROWSERBASE_PROJECT_ID!;

      // Step 1: Create a Browserbase session
      console.log('[browserbase] Creating session...');
      const createRes = await fetch('https://api.browserbase.com/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bb-api-key': apiKey,
        },
        body: JSON.stringify({ projectId }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`Browserbase session creation failed (${createRes.status}): ${errText}`);
      }

      const session = await createRes.json() as { id: string; connectUrl?: string };
      this.sessionId = session.id;
      console.log(`[browserbase] Session created: ${session.id}`);

      // Step 2: Connect Playwright via CDP
      const connectUrl = `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${session.id}`;
      this.browser = await chromium.connectOverCDP(connectUrl);
      console.log('[browserbase] Connected via CDP');

      // Get the default context and page
      const contexts = this.browser.contexts();
      this.context = contexts[0] || await this.browser.newContext();
      const pages = this.context.pages();
      this.page = pages[0] || await this.context.newPage();
    })();

    await this.connecting;
    this.connecting = null;
    return this.page!;
  }

  private buildUrl(url: string, params?: Record<string, string>): string {
    if (!params) return url;
    return `${url}?${new URLSearchParams(params).toString()}`;
  }

  async getHtml(url: string, params?: Record<string, string>): Promise<string> {
    const fullUrl = this.buildUrl(url, params);
    const page = await this.ensureSession();
    await this.throttle();

    console.log(`[browserbase] Navigating to ${fullUrl}`);
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 60_000 });

    // Brief wait for any post-load JS
    await sleep(2000);

    const html = await page.evaluate(() => document.documentElement.outerHTML);

    if (!html || html.length < 100) {
      throw new Error(`Empty or blocked response from ${fullUrl}`);
    }

    console.log(`[browserbase] Got ${html.length} chars from ${fullUrl}`);
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
    const page = await this.ensureSession();
    await this.throttle();

    console.log(`[browserbase] Fetching JSON from ${fullUrl}`);
    await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    const text = await page.evaluate(() => document.body.innerText);
    return JSON.parse(text) as T;
  }

  async dispose(): Promise<void> {
    if (this.page) {
      try { await this.page.close(); } catch { /* ignore */ }
      this.page = null;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
    }
    this.context = null;
    this.connecting = null;
    console.log('[browserbase] Session closed');
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
  private pwClient: PlaywrightHttpClient | null = null;
  private bbAvailable: boolean;
  private bbOptions: { minDelayMs?: number };
  private automationMode: 'browserbase' | 'playwright' | null = null;

  constructor(options?: { minDelayMs?: number }) {
    this.plainHttp = new HttpClient({ minDelayMs: options?.minDelayMs ?? 500 });
    this.bbAvailable = !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
    this.bbOptions = options ?? {};
    if (this.bbAvailable) {
      console.log('[fallback] Browserbase available for Cloudflare bypass');
    }
  }

  private getBrowserbase(): BrowserbaseHttpClient {
    if (!this.bbClient) {
      this.bbClient = new BrowserbaseHttpClient(this.bbOptions);
    }
    return this.bbClient;
  }

  private getPlaywright(): PlaywrightHttpClient {
    if (!this.pwClient) {
      this.pwClient = new PlaywrightHttpClient(this.bbOptions);
    }
    return this.pwClient;
  }

  private async getAutomationHtml(url: string, params?: Record<string, string>): Promise<string> {
    if (this.automationMode === 'browserbase' && this.bbAvailable) {
      return this.getBrowserbase().getHtml(url, params);
    }
    if (this.automationMode === 'playwright') {
      return this.getPlaywright().getHtml(url, params);
    }
    throw new Error('No browser automation fallback is active');
  }

  private async getAutomationJson<T>(url: string, params?: Record<string, string>): Promise<T> {
    if (this.automationMode === 'browserbase' && this.bbAvailable) {
      return this.getBrowserbase().getJson<T>(url, params);
    }
    if (this.automationMode === 'playwright') {
      return this.getPlaywright().getJson<T>(url, params);
    }
    throw new Error('No browser automation fallback is active');
  }

  private chooseAutomationMode(reason: string): 'browserbase' | 'playwright' {
    if (this.bbAvailable) {
      console.log(`[fallback] ${reason}, switching to Browserbase`);
      this.automationMode = 'browserbase';
      return this.automationMode;
    }

    console.log(`[fallback] ${reason}, switching to local Playwright`);
    this.automationMode = 'playwright';
    return this.automationMode;
  }

  private isBlocked(html: string): boolean {
    if (!html || html.length < 200) return true;
    const lower = html.toLowerCase();
    return lower.includes('cloudflare') && lower.includes('challenge') ||
      lower.includes('just a moment') && lower.includes('cf-') ||
      lower.includes('access denied') && html.length < 2000;
  }

  async getHtml(url: string, params?: Record<string, string>): Promise<string> {
    if (this.automationMode) {
      return this.getAutomationHtml(url, params);
    }

    try {
      const html = await this.plainHttp.getHtml(url, params);
      if (this.isBlocked(html)) {
        this.chooseAutomationMode('Plain HTTP returned a blocked response');
        return this.getAutomationHtml(url, params);
      }
      return html;
    } catch (err: any) {
      if (err.message?.includes('403') || err.message?.includes('503')) {
        this.chooseAutomationMode(`Plain HTTP failed (${err.message})`);
        return this.getAutomationHtml(url, params);
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
    if (this.automationMode) {
      return this.getAutomationJson<T>(url, params);
    }

    try {
      return await this.plainHttp.getJson<T>(url, params);
    } catch (err: any) {
      if (err.message?.includes('403') || err.message?.includes('503')) {
        this.chooseAutomationMode(`Plain HTTP JSON failed (${err.message})`);
        return this.getAutomationJson<T>(url, params);
      }
      throw err;
    }
  }

  async dispose(): Promise<void> {
    if (this.bbClient) {
      await this.bbClient.dispose();
    }
    if (this.pwClient) {
      await this.pwClient.dispose();
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
