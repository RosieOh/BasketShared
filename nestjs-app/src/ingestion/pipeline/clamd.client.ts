import { createReadStream } from 'node:fs';
import { connect } from 'node:net';

export interface ScanResult {
  clean: boolean;
  signature?: string;
}

/**
 * Minimal clamd INSTREAM client (no external dependency).
 *
 * Protocol: send `zINSTREAM\0`, then a sequence of [uint32 length][bytes]
 * chunks, terminated by a zero-length chunk. clamd replies with
 * `stream: OK` or `stream: <signature> FOUND`.
 */
export function scanFileWithClamd(
  host: string,
  port: number,
  filePath: string,
  timeoutMs = 30_000,
): Promise<ScanResult> {
  return new Promise<ScanResult>((resolve, reject) => {
    const socket = connect({ host, port });
    socket.setTimeout(timeoutMs);

    let response = '';
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };

    socket.on('error', fail);
    socket.on('timeout', () => fail(new Error('clamd scan timed out')));
    socket.on('data', (d) => (response += d.toString('utf8')));
    socket.on('end', () => {
      if (settled) return;
      settled = true;
      const text = response.trim();
      if (text.includes('FOUND')) {
        // "stream: Eicar-Test-Signature FOUND"
        const sig = text.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '');
        resolve({ clean: false, signature: sig });
      } else if (text.includes('OK')) {
        resolve({ clean: true });
      } else {
        reject(new Error(`Unexpected clamd response: ${text}`));
      }
    });

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const file = createReadStream(filePath);
      file.on('error', fail);
      file.on('data', (data: string | Buffer) => {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      });
      file.on('end', () => {
        const terminator = Buffer.alloc(4); // zero-length chunk = end of stream
        socket.write(terminator);
      });
    });
  });
}
