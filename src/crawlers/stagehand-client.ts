/**
 * Stagehand client for crawling publisher sites that require real browser sessions.
 *
 * Uses Browserbase cloud browsers via @browserbasehq/stagehand.
 * Requires BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID, and ANTHROPIC_API_KEY.
 *
 * IMPORTANT: This is the ONLY approved method for crawling American Legal (AMLegal)
 * and any other publisher behind Cloudflare. NEVER use plain HTTP requests for these.
 */

import type { Page } from 'playwright-core';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StagehandClient {
  private stagehand: any | null = null;
  private page: Page | null = null;
  private minDelayMs: number;
  private lastRequestTime = 0;
  private initializing: Promise<void> | null = null;
  private navigationQueue: Promise<void> = Promise.resolve();

  constructor(options?: { minDelayMs?: number }) {
    this.minDelayMs = options?.minDelayMs ?? 2000;

    if (!process.env.BROWSERBASE_API_KEY || !process.env.BROWSERBASE_PROJECT_ID) {
      throw new Error(
        'StagehandClient requires BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID env vars. ' +
        'Browser automation is required for this publisher — plain HTTP is not supported.'
      );
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'StagehandClient requires ANTHROPIC_API_KEY env var. ' +
        'Stagehand needs an LLM API key to function. Do NOT work around this by switching to plain HTTP.'
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

  async init(): Promise<void> {
    if (this.stagehand) return;

    // Prevent concurrent initialization
    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = (async () => {
      console.log('[stagehand] Initializing Browserbase session...');
      // Dynamic import to avoid loading Stagehand at module level
      const { Stagehand } = await import('@browserbasehq/stagehand');

      const opts: Record<string, any> = {
        env: 'BROWSERBASE',
        apiKey: process.env.BROWSERBASE_API_KEY,
        projectId: process.env.BROWSERBASE_PROJECT_ID,
        verbose: 0,
        domSettleTimeout: 5000,
        disablePino: true,
      };

      // Only configure LLM model if ANTHROPIC_API_KEY is available
      if (process.env.ANTHROPIC_API_KEY) {
        opts.model = {
          modelName: 'anthropic/claude-sonnet-4-5',
          apiKey: process.env.ANTHROPIC_API_KEY,
        };
      }

      this.stagehand = new Stagehand(opts as any);

      await this.stagehand.init();
      // Stagehand v3: page is accessed via context, not directly
      this.page = this.stagehand.context.pages()[0];
      console.log('[stagehand] Session ready');
    })();

    await this.initializing;
    this.initializing = null;
  }

  /**
   * Navigate to a URL and wait for the page to settle.
   * Serialized — only one navigation at a time since we share a single browser page.
   */
  async navigate(url: string): Promise<Page> {
    await this.init();

    // Serialize navigations — a single Stagehand page can't handle concurrent goto() calls
    const prev = this.navigationQueue;
    let resolve!: () => void;
    this.navigationQueue = new Promise<void>(r => { resolve = r; });

    try {
      await prev;
      await this.throttle();

      console.log(`[stagehand] Navigating to ${url}`);
      // Stagehand v3 uses 'timeoutMs' not 'timeout' for the load state wait
      await (this.page! as any).goto(url, { waitUntil: 'domcontentloaded', timeoutMs: 60_000 });
      // Wait for SPA rendering
      await sleep(3000);
      return this.page!;
    } finally {
      resolve();
    }
  }

  /**
   * Extract structured data from the current page using Stagehand's AI.
   * Uses an LLM to interpret the page and extract data matching the schema.
   */
  async extract<T>(instruction: string, schema: any): Promise<T> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'Stagehand extract() requires ANTHROPIC_API_KEY. Set it to enable AI-powered extraction.'
      );
    }
    await this.init();
    console.log(`[stagehand] Extracting: ${instruction}`);
    const result = await this.stagehand!.extract({
      instruction,
      schema,
    });
    return result as T;
  }

  /**
   * Navigate by setting window.location and waiting.
   * Use this for slow SPAs where Stagehand's internal load state timeout (15s) is too short.
   */
  async navigateSlow(url: string, waitMs = 10000): Promise<Page> {
    await this.init();

    const prev = this.navigationQueue;
    let resolve!: () => void;
    this.navigationQueue = new Promise<void>(r => { resolve = r; });

    try {
      await prev;
      await this.throttle();

      console.log(`[stagehand] Navigating (slow) to ${url}`);
      // Use CDP Page.navigate to bypass Stagehand's load state wrapper
      const session = (this.page as any).mainSession || (this.page as any).conn;
      if (session?.send) {
        await session.send('Page.navigate', { url });
      } else {
        // Fallback: use evaluate to set location
        await this.page!.evaluate(`window.location.href = ${JSON.stringify(url)}`);
      }
      await sleep(waitMs);
      return this.page!;
    } finally {
      resolve();
    }
  }

  /**
   * Get the raw page for direct DOM manipulation.
   */
  async getPage(): Promise<Page> {
    await this.init();
    return this.page!;
  }

  /**
   * Get the full rendered HTML of the current page.
   */
  async getRenderedHtml(): Promise<string> {
    await this.init();
    return this.page!.evaluate(() => document.documentElement.outerHTML);
  }

  async dispose(): Promise<void> {
    if (this.stagehand) {
      try {
        await this.stagehand.close();
      } catch {
        // Ignore teardown errors
      }
      this.stagehand = null;
      this.page = null;
      console.log('[stagehand] Session closed');
    }
  }
}
