import { describe, expect, it } from 'vitest';
import {
  normalizeRedisUrl,
  parseRedisConnectionOptions,
} from '../src/services/gradingDispatcher.js';

describe('parseRedisConnectionOptions', () => {
  it('parses standard redis:// URLs without TLS', () => {
    const opts = parseRedisConnectionOptions('redis://localhost:6379/2');
    expect(opts).toEqual({
      host: 'localhost',
      port: 6379,
      username: undefined,
      password: undefined,
      db: 2,
      maxRetriesPerRequest: null,
    });
    expect('tls' in opts).toBe(false);
  });

  it('enables TLS and preserves username/password for Upstash rediss:// URLs', () => {
    const opts = parseRedisConnectionOptions(
      'rediss://default:secret_token%401@eternal-chow-202248.upstash.io:6379',
    );
    expect(opts).toEqual({
      host: 'eternal-chow-202248.upstash.io',
      port: 6379,
      username: 'default',
      password: 'secret_token@1',
      db: 0,
      maxRetriesPerRequest: null,
      tls: {},
    });
  });

  it('auto-upgrades redis:// to TLS when pointing at an Upstash host', () => {
    const url = 'redis://default:token123@eternal-chow-202248.upstash.io:6379';
    expect(normalizeRedisUrl(url)).toBe(
      'rediss://default:token123@eternal-chow-202248.upstash.io:6379',
    );
    expect(parseRedisConnectionOptions(url)).toMatchObject({
      host: 'eternal-chow-202248.upstash.io',
      tls: {},
    });
  });
});
