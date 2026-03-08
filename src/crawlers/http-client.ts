/**
 * Rate-limited HTTP client for crawling publisher APIs.
 */

export interface HttpClientOptions {
  minDelayMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  userAgent?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpClient {
  private minDelayMs: number;
  private maxRetries: number;
  private timeoutMs: number;
  private userAgent: string;
  private lastRequestTime = 0;

  constructor(options?: HttpClientOptions) {
    this.minDelayMs = options?.minDelayMs ?? 500;
    this.maxRetries = options?.maxRetries ?? 3;
    this.timeoutMs = options?.timeoutMs ?? 30_000;
    this.userAgent =
      options?.userAgent ??
      'OpenLegalCodes/0.1 (open-source municipal code archive)';
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minDelayMs) {
      await sleep(this.minDelayMs - elapsed);
    }
    this.lastRequestTime = Date.now();
  }

  async get(url: string, params?: Record<string, string>): Promise<Response> {
    const fullUrl = params
      ? `${url}?${new URLSearchParams(params).toString()}`
      : url;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = Math.pow(2, attempt - 1) * 1000;
        console.log(`  [retry ${attempt}/${this.maxRetries}] waiting ${backoff}ms...`);
        await sleep(backoff);
      }

      await this.throttle();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(fullUrl, {
          headers: { 'User-Agent': this.userAgent },
          signal: controller.signal,
        });

        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
          console.warn(`  [http] ${res.status} ${fullUrl}`);
          continue;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}: ${fullUrl}`);
        }

        return res;
      } catch (err: any) {
        if (err.name === 'AbortError') {
          lastError = new Error(`Timeout after ${this.timeoutMs}ms: ${fullUrl}`);
          console.warn(`  [http] timeout ${fullUrl}`);
          continue;
        }
        lastError = err;
        if (attempt < this.maxRetries) continue;
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError ?? new Error(`Request failed: ${fullUrl}`);
  }

  async getJson<T>(url: string, params?: Record<string, string>): Promise<T> {
    const res = await this.get(url, params);
    return res.json() as Promise<T>;
  }

  async getHtml(url: string, params?: Record<string, string>): Promise<string> {
    const res = await this.get(url, params);
    return res.text();
  }
}
