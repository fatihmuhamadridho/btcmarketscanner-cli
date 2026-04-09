import { BASE_API_BINANCE } from '@configs/base.config';

export interface FetchServiceOptions {
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  cookieHeader?: string;
}

export class FetchService {
  private readonly options: Required<FetchServiceOptions>;

  constructor(options?: FetchServiceOptions) {
    this.options = {
      baseURL: options?.baseURL ?? BASE_API_BINANCE ?? '',
      defaultHeaders: options?.defaultHeaders ?? { 'Content-Type': 'application/json' },
      cookieHeader: options?.cookieHeader ?? '',
    };
  }

  private buildUrl(path: string) {
    const prefix = path.slice(0, 8).toLowerCase();
    if (prefix.startsWith('http://') || prefix.startsWith('https://')) return path;
    const base = this.stripTrailingSlashes(this.options.baseURL ?? '');
    const relative = this.stripLeadingSlashes(path);
    return `${base}/${relative}`;
  }

  private stripTrailingSlashes(value: string) {
    let end = value.length;
    while (end > 0 && value.codePointAt(end - 1) === 47 /* '/' */) end--;
    return end === value.length ? value : value.slice(0, end);
  }

  private stripLeadingSlashes(value: string) {
    let start = 0;
    while (start < value.length && value.codePointAt(start) === 47 /* '/' */) start++;
    return start === 0 ? value : value.slice(start);
  }

  private buildHeaders(extra?: Record<string, string>) {
    const headers: Record<string, string> = { ...this.options.defaultHeaders, ...extra };
    return headers;
  }

  private async request<T, B = unknown>(
    method: string,
    url: string,
    body?: B,
    headers?: Record<string, string>
  ): Promise<T> {
    const response = await fetch(this.buildUrl(url), {
      method,
      headers: this.buildHeaders(headers),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed with status ${response.status}`);
    }

    const text = await response.text();
    if (!text) return undefined as unknown as T;
    return JSON.parse(text) as T;
  }

  get<T = unknown>(url: string, headers?: Record<string, string>) {
    return this.request<T>('GET', url, undefined, headers);
  }

  post<T = unknown, B = unknown>(url: string, data?: B, headers?: Record<string, string>) {
    return this.request<T>('POST', url, data, headers);
  }

  put<T = unknown, B = unknown>(url: string, data?: B, headers?: Record<string, string>) {
    return this.request<T>('PUT', url, data, headers);
  }

  patch<T = unknown, B = unknown>(url: string, data?: B, headers?: Record<string, string>) {
    return this.request<T>('PATCH', url, data, headers);
  }

  delete<T = unknown>(url: string, headers?: Record<string, string>) {
    return this.request<T>('DELETE', url, undefined, headers);
  }
}
