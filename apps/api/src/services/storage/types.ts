export interface StorageAdapter {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

export interface VirusScanResult {
  clean: boolean;
  reason?: string;
}

export interface VirusScanner {
  scan(buffer: Buffer): Promise<VirusScanResult>;
}
