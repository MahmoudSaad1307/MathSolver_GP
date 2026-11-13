import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageAdapter } from './types.js';

export function signLocalStorageKey(
  key: string,
  expiresAtUnix: number,
  hmacSecret: string,
): string {
  return crypto
    .createHmac('sha256', hmacSecret)
    .update(`${key}:${expiresAtUnix}`)
    .digest('hex');
}

export function verifyLocalStorageSignature(
  key: string,
  expiresAtUnix: number,
  signature: string,
  hmacSecret: string,
): boolean {
  if (!Number.isFinite(expiresAtUnix) || expiresAtUnix < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = signLocalStorageKey(key, expiresAtUnix, hmacSecret);
  if (expected.length !== signature.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
}

export class LocalDiskStorageAdapter implements StorageAdapter {
  private readonly rootDir: string;
  private readonly hmacSecret: string;

  constructor(baseDir: string, hmacSecret: string) {
    this.rootDir = path.resolve(baseDir);
    this.hmacSecret = hmacSecret;
  }

  private resolveSafePath(key: string): string {
    const cleanKey = key.replace(/^\/+/, '');
    const target = path.resolve(this.rootDir, cleanKey);
    const relative = path.relative(this.rootDir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || relative.length === 0) {
      throw new Error('Invalid storage key path');
    }
    return target;
  }

  async putObject(key: string, body: Buffer, _contentType: string): Promise<void> {
    const target = this.resolveSafePath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }

  async getObject(key: string): Promise<Buffer> {
    const target = this.resolveSafePath(key);
    return fs.readFile(target);
  }

  async deleteObject(key: string): Promise<void> {
    const target = this.resolveSafePath(key);
    await fs.rm(target, { force: true });
  }

  getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + Math.max(10, expiresInSeconds);
    const sig = signLocalStorageKey(key, exp, this.hmacSecret);
    const params = new URLSearchParams({
      key,
      exp: String(exp),
      sig,
    });
    return Promise.resolve(`/api/v1/storage/local?${params.toString()}`);
  }
}
