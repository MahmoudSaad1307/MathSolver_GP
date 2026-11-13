import net from 'node:net';
import type { VirusScanResult, VirusScanner } from './types.js';

export class NoopVirusScanner implements VirusScanner {
  scan(_buffer: Buffer): Promise<VirusScanResult> {
    return Promise.resolve({ clean: true });
  }
}

export class ClamAvVirusScanner implements VirusScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 5000,
  ) {}

  scan(buffer: Buffer): Promise<VirusScanResult> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let response = '';
      let settled = false;

      const finish = (err: Error | null, res?: VirusScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) {
          reject(err);
        } else if (res) {
          resolve(res);
        }
      };

      socket.setTimeout(this.timeoutMs, () => {
        finish(new Error('ClamAV scan timeout'));
      });

      socket.on('error', (err) => {
        finish(err);
      });

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const chunkLen = Buffer.alloc(4);
        chunkLen.writeUInt32BE(buffer.length, 0);
        socket.write(chunkLen);
        socket.write(buffer);
        const endChunk = Buffer.alloc(4);
        endChunk.writeUInt32BE(0, 0);
        socket.write(endChunk);
      });

      socket.on('data', (chunk) => {
        response += chunk.toString('utf8');
      });

      socket.on('end', () => {
        const cleaned = response.replace(/\0/g, '').trim();
        if (cleaned.endsWith('OK')) {
          finish(null, { clean: true });
        } else {
          finish(null, { clean: false, reason: cleaned || 'Infected or rejected payload' });
        }
      });
    });
  }
}
