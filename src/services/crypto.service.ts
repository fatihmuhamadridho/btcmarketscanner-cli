export class CryptoService {
  private readonly enc = new TextEncoder();
  private readonly dec = new TextDecoder();

  private hasSubtle(): boolean {
    return typeof globalThis !== 'undefined' && !!globalThis.crypto?.subtle;
  }

  private b64encode(str: string): string {
    if (typeof btoa !== 'undefined') return btoa(str);
    return Buffer.from(str, 'utf8').toString('base64');
  }

  private toBase64Url(uint8: Uint8Array): string {
    return this.b64encode(String.fromCodePoint(...uint8))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }

  private fromBase64Url(str: string): Uint8Array {
    const base64 = str.replaceAll('-', '+').replaceAll('_', '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const binary = atob(base64 + pad);

    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.codePointAt(i) ?? 0;
    }

    return new Uint8Array(bytes.buffer);
  }

  async encrypt<T>(data: T, secret: string): Promise<{ iv: string; data: string; plain?: true }> {
    if (!this.hasSubtle()) {
      const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
      return { iv: 'plain', data: encoded, plain: true };
    }

    const keyData = this.enc.encode(secret.padEnd(32, '0').slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = this.enc.encode(JSON.stringify(data));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return { iv: this.toBase64Url(iv), data: this.toBase64Url(new Uint8Array(cipher)) };
  }

  async decrypt<T = unknown>(encrypted: { iv?: string; data?: string }, secret: string): Promise<T | string> {
    if (!encrypted?.iv || !encrypted?.data) {
      throw new Error('Invalid encrypted object: missing iv or data');
    }

    if (encrypted.iv === 'plain' || !this.hasSubtle()) {
      const decoded = Buffer.from(encrypted.data, 'base64').toString('utf8');
      try {
        return JSON.parse(decoded);
      } catch {
        return decoded;
      }
    }

    const keyData = this.enc.encode(secret.padEnd(32, '0').slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['decrypt']);

    const iv = this.fromBase64Url(encrypted.iv);
    const data = this.fromBase64Url(encrypted.data);

    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv.slice(0) }, key, data.slice(0));

    const text = this.dec.decode(plainBuffer);

    try {
      return JSON.parse(text) as T;
    } catch {
      return text;
    }
  }
}
