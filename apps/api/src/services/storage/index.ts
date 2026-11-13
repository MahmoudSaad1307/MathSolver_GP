import type { AppEnv } from '../../config/env.js';
import { LocalDiskStorageAdapter } from './localStorage.js';
import { S3StorageAdapter } from './s3Storage.js';
import type { StorageAdapter, VirusScanner } from './types.js';
import { ClamAvVirusScanner, NoopVirusScanner } from './virusScan.js';

export type { StorageAdapter, VirusScanner, VirusScanResult } from './types.js';
export {
  LocalDiskStorageAdapter,
  signLocalStorageKey,
  verifyLocalStorageSignature,
} from './localStorage.js';
export { S3StorageAdapter } from './s3Storage.js';
export { ClamAvVirusScanner, NoopVirusScanner } from './virusScan.js';

export function createStorageAdapter(env: AppEnv): StorageAdapter {
  if (env.STORAGE_DRIVER === 'local') {
    return new LocalDiskStorageAdapter(env.LOCAL_STORAGE_DIR, env.VIDEO_UNLOCK_HMAC_SECRET);
  }
  return new S3StorageAdapter(env);
}

export function createVirusScanner(env: AppEnv): VirusScanner {
  if (env.VIRUS_SCAN_DRIVER === 'clamav') {
    return new ClamAvVirusScanner(env.CLAMAV_HOST, env.CLAMAV_PORT);
  }
  return new NoopVirusScanner();
}
