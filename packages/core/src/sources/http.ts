/**
 * Minimal fetch wrapper: timeouts, bounded retry with backoff, and a
 * per-host minimum interval so we stay inside NCBI's rate limits.
 */
export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  /** Minimum gap between requests to the same host. */
  minIntervalMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const lastRequestAt = new Map<string, number>();

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

async function throttle(host: string, minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return;
  const previous = lastRequestAt.get(host) ?? 0;
  const wait = previous + minIntervalMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt.set(host, Date.now());
}

export async function httpGet(url: string, options: HttpOptions = {}): Promise<string> {
  const { timeoutMs = 15_000, retries = 2, minIntervalMs = 0 } = options;
  const host = new URL(url).host;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host, minIntervalMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onParentAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onParentAbort);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json, text/xml, */*', ...options.headers },
      });
      if (!response.ok) {
        // 4xx other than 429 will not fix themselves; fail fast.
        if (response.status < 500 && response.status !== 429) {
          throw new HttpError(`HTTP ${response.status} for ${url}`, response.status, url);
        }
        throw new HttpError(`HTTP ${response.status} for ${url}`, response.status, url);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onParentAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

export async function httpGetJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const body = await httpGet(url, options);
  return JSON.parse(body) as T;
}

export function buildUrl(base: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}
