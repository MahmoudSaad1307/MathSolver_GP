import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET } from '@mathlens/shared';
import {
  generateUnambiguousCode,
  hashIp,
  hashPassword,
  signStudentSessionToken,
  signTeacherAccessToken,
  signVideoUnlock,
  verifyPassword,
  verifyStudentSessionToken,
  verifyTeacherAccessToken,
} from '../src/lib/security.js';
import { createTestEnv } from './helpers/testEnv.js';

describe('security utilities', () => {
  const env = createTestEnv();

  it('hashes and verifies passwords using argon2id', async () => {
    const hash = await hashPassword('SuperSecret123!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'SuperSecret123!')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('signs and verifies teacher and student JWTs with audience separation', () => {
    const tToken = signTeacherAccessToken(
      { id: '11111111-1111-1111-1111-111111111111', email: 't@example.com', role: 'TEACHER' },
      env,
    );
    const sToken = signStudentSessionToken(
      {
        id: '22222222-2222-2222-2222-222222222222',
        cohortId: '33333333-3333-3333-3333-333333333333',
      },
      env,
    );

    expect(verifyTeacherAccessToken(tToken, env)?.email).toBe('t@example.com');
    expect(verifyTeacherAccessToken(sToken, env)).toBeNull();

    expect(verifyStudentSessionToken(sToken, env)?.sub).toBe(
      '22222222-2222-2222-2222-222222222222',
    );
    expect(verifyStudentSessionToken(tToken, env)).toBeNull();
  });

  it('generates 6-char codes strictly from CODE_ALPHABET', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateUnambiguousCode(6);
      expect(code).toHaveLength(6);
      for (const ch of code) {
        expect(CODE_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });

  it('produces salted IP hashes and deterministic HMAC unlock signatures', () => {
    const h1 = hashIp('10.0.0.1', env.IP_HASH_SALT);
    const h2 = hashIp('10.0.0.2', env.IP_HASH_SALT);
    expect(h1).toHaveLength(64);
    expect(h1).not.toBe(h2);

    const sig1 = signVideoUnlock('s1', 't1', '2026-01-01T00:00:00Z', env.VIDEO_UNLOCK_HMAC_SECRET);
    const sig2 = signVideoUnlock('s1', 't1', '2026-01-01T00:00:00Z', env.VIDEO_UNLOCK_HMAC_SECRET);
    expect(sig1).toBe(sig2);
  });
});
