const DEFAULT_ITERATIONS = 210_000;
const DEFAULT_KEY_LENGTH = 32;
const DEFAULT_SALT_BYTES = 16;
const DEFAULT_ALGORITHM = 'sha256';
export class HashService {
    static encoder = new TextEncoder();
    static async hash(value) {
        if (!value) {
            throw new Error('Cannot hash an empty value');
        }
        const salt = this.createSalt(DEFAULT_SALT_BYTES);
        const derivedKey = await this.deriveKey(value, salt, DEFAULT_ITERATIONS, DEFAULT_KEY_LENGTH);
        return ['pbkdf2', DEFAULT_ALGORITHM, DEFAULT_ITERATIONS, DEFAULT_KEY_LENGTH, salt, this.toBase64Url(derivedKey)].join('$');
    }
    static async compare(value, hashedValue) {
        if (!value || !hashedValue) {
            return false;
        }
        const parts = hashedValue.split('$');
        if (parts.length !== 6 || parts[0] !== 'pbkdf2') {
            return false;
        }
        const [, algorithm, iterationsRaw, keyLengthRaw, salt, encodedHash] = parts;
        const iterations = Number(iterationsRaw);
        const keyLength = Number(keyLengthRaw);
        if (algorithm !== DEFAULT_ALGORITHM || !Number.isFinite(iterations) || !Number.isFinite(keyLength) || !salt) {
            return false;
        }
        const derivedKey = await this.deriveKey(value, salt, iterations, keyLength);
        const expected = this.fromBase64Url(encodedHash);
        if (expected.length !== derivedKey.length) {
            return false;
        }
        return this.timingSafeEqual(expected, derivedKey);
    }
    static async deriveKey(value, salt, iterations, keyLength) {
        const crypto = this.getCrypto();
        const baseKey = await crypto.subtle.importKey('raw', this.encoder.encode(value), { name: 'PBKDF2' }, false, [
            'deriveBits',
        ]);
        const bits = await crypto.subtle.deriveBits({
            name: 'PBKDF2',
            salt: this.encoder.encode(salt),
            iterations,
            hash: DEFAULT_ALGORITHM,
        }, baseKey, keyLength * 8);
        return new Uint8Array(bits);
    }
    static createSalt(bytes) {
        const buffer = new Uint8Array(bytes);
        this.getCrypto().getRandomValues(buffer);
        return this.toBase64Url(buffer);
    }
    static getCrypto() {
        if (!globalThis.crypto?.subtle) {
            throw new Error('Web Crypto API is unavailable');
        }
        return globalThis.crypto;
    }
    static toBase64Url(bytes) {
        const binary = String.fromCodePoint(...bytes);
        const base64 = typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
        return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    }
    static fromBase64Url(value) {
        const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
        const paddingLength = base64.length % 4 === 0 ? 0 : 4 - (base64.length % 4);
        const padded = base64 + '='.repeat(paddingLength);
        const binary = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.codePointAt(index) ?? 0;
        }
        return bytes;
    }
    static timingSafeEqual(left, right) {
        let result = 0;
        for (let index = 0; index < left.length; index += 1) {
            result |= left[index] ^ right[index];
        }
        return result === 0;
    }
}
