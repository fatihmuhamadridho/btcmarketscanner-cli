import { BASE_API_BINANCE } from '../configs/base.config.js';
export class FetchService {
    options;
    constructor(options) {
        this.options = {
            baseURL: options?.baseURL ?? BASE_API_BINANCE ?? '',
            defaultHeaders: options?.defaultHeaders ?? { 'Content-Type': 'application/json' },
            cookieHeader: options?.cookieHeader ?? '',
        };
    }
    buildUrl(path) {
        const prefix = path.slice(0, 8).toLowerCase();
        if (prefix.startsWith('http://') || prefix.startsWith('https://'))
            return path;
        const base = this.stripTrailingSlashes(this.options.baseURL ?? '');
        const relative = this.stripLeadingSlashes(path);
        return `${base}/${relative}`;
    }
    stripTrailingSlashes(value) {
        let end = value.length;
        while (end > 0 && value.codePointAt(end - 1) === 47 /* '/' */)
            end--;
        return end === value.length ? value : value.slice(0, end);
    }
    stripLeadingSlashes(value) {
        let start = 0;
        while (start < value.length && value.codePointAt(start) === 47 /* '/' */)
            start++;
        return start === 0 ? value : value.slice(start);
    }
    buildHeaders(extra) {
        const headers = { ...this.options.defaultHeaders, ...extra };
        return headers;
    }
    async request(method, url, body, headers) {
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
        if (!text)
            return undefined;
        return JSON.parse(text);
    }
    get(url, headers) {
        return this.request('GET', url, undefined, headers);
    }
    post(url, data, headers) {
        return this.request('POST', url, data, headers);
    }
    put(url, data, headers) {
        return this.request('PUT', url, data, headers);
    }
    patch(url, data, headers) {
        return this.request('PATCH', url, data, headers);
    }
    delete(url, headers) {
        return this.request('DELETE', url, undefined, headers);
    }
}
