import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/lib/logger.js';
import {
  ClamAvVirusScanner,
  LocalDiskStorageAdapter,
  NoopVirusScanner,
  signLocalStorageKey,
  verifyLocalStorageSignature,
} from '../src/services/storage/index.js';
import { createInMemoryPrisma } from './helpers/fakePrisma.js';
import { createTestEnv } from './helpers/testEnv.js';

describe('LocalDiskStorageAdapter & signed storage endpoint', () => {
  const env = createTestEnv();
  const logger = createLogger('silent');
  let tmpDir: string;
  let storage: LocalDiskStorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathlens-storage-'));
    storage = new LocalDiskStorageAdapter(tmpDir, env.VIDEO_UNLOCK_HMAC_SECRET);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('stores, reads, signs, verifies, and deletes objects while blocking path traversal', async () => {
    await storage.putObject('attempts/a1/ans1/test.jpg', Buffer.from('hello-img'), 'image/jpeg');
    const fetched = await storage.getObject('attempts/a1/ans1/test.jpg');
    expect(fetched.toString('utf8')).toBe('hello-img');

    await expect(storage.getObject('../../etc/passwd')).rejects.toThrow('Invalid storage key path');

    const signedUrl = await storage.getSignedUrl('attempts/a1/ans1/test.jpg', 120);
    expect(signedUrl).toContain('/api/v1/storage/local?');

    const parsed = new URL(`http://localhost${signedUrl}`);
    const key = parsed.searchParams.get('key')!;
    const exp = Number(parsed.searchParams.get('exp'));
    const sig = parsed.searchParams.get('sig')!;

    expect(verifyLocalStorageSignature(key, exp, sig, env.VIDEO_UNLOCK_HMAC_SECRET)).toBe(true);
    expect(verifyLocalStorageSignature(key, exp - 99999, sig, env.VIDEO_UNLOCK_HMAC_SECRET)).toBe(
      false,
    );
    expect(
      verifyLocalStorageSignature(key, exp, '0'.repeat(64), env.VIDEO_UNLOCK_HMAC_SECRET),
    ).toBe(false);

    const app = createApp({
      env: { ...env, STORAGE_DRIVER: 'local', LOCAL_STORAGE_DIR: tmpDir },
      prisma: createInMemoryPrisma(),
      logger,
      storage,
      virusScanner: new NoopVirusScanner(),
    });

    const okRes = await request(app).get(signedUrl);
    expect(okRes.status).toBe(200);
    expect(okRes.headers['x-content-type-options']).toBe('nosniff');

    const badSigRes = await request(app).get(
      `/api/v1/storage/local?key=${encodeURIComponent(key)}&exp=${exp}&sig=${'a'.repeat(64)}`,
    );
    expect(badSigRes.status).toBe(403);

    const expiredSig = signLocalStorageKey(key, 1000, env.VIDEO_UNLOCK_HMAC_SECRET);
    const expiredRes = await request(app).get(
      `/api/v1/storage/local?key=${encodeURIComponent(key)}&exp=1000&sig=${expiredSig}`,
    );
    expect(expiredRes.status).toBe(403);

    await storage.deleteObject('attempts/a1/ans1/test.jpg');
    const missingRes = await request(app).get(signedUrl);
    expect(missingRes.status).toBe(404);
  });

  it('scans buffers with ClamAvVirusScanner over TCP stream', async () => {
    let reply = 'stream: OK\0';
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        if (chunk.includes(Buffer.from([0, 0, 0, 0]))) {
          socket.end(reply);
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as net.AddressInfo;

    try {
      const scanner = new ClamAvVirusScanner('127.0.0.1', addr.port, 1000);
      const cleanRes = await scanner.scan(Buffer.from('clean-data'));
      expect(cleanRes.clean).toBe(true);

      reply = 'stream: Eicar-Signature FOUND\0';
      const dirtyRes = await scanner.scan(Buffer.from('bad-data'));
      expect(dirtyRes.clean).toBe(false);
      expect(dirtyRes.reason).toContain('FOUND');
    } finally {
      server.close();
    }
  });
});
