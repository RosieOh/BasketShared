import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { CryptoService } from './crypto.service';

function serviceWithKek(): CryptoService {
  const kek = randomBytes(32).toString('base64');
  const config = { get: () => ({ enabled: true, kek }) } as never;
  return new CryptoService(config);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('CryptoService (envelope encryption)', () => {
  it('round-trips: encrypt stream then decrypt yields the original bytes', async () => {
    const svc = serviceWithKek();
    const plaintext = Buffer.from('sensitive,financial,data\n1,2,3\n'.repeat(1000));

    const { stream, wrappedDek } = svc.createEncryptStream();
    const encrypted = await streamToBuffer(Readable.from(plaintext).pipe(stream));

    // Ciphertext differs and carries the IV+tag overhead.
    expect(encrypted.equals(plaintext)).toBe(false);
    expect(encrypted.length).toBe(plaintext.length + svc.overheadBytes);

    const decrypted = svc.decrypt(encrypted, wrappedDek);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('round-trips via the streaming decrypt Transform', async () => {
    const svc = serviceWithKek();
    const plaintext = Buffer.from('streamed,decrypt\n'.repeat(5000));
    const { stream, wrappedDek } = svc.createEncryptStream();
    const encrypted = await streamToBuffer(Readable.from(plaintext).pipe(stream));

    const decrypted = await streamToBuffer(
      Readable.from(encrypted).pipe(svc.createDecryptStream(wrappedDek)),
    );
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('fails to decrypt tampered ciphertext (GCM auth tag)', async () => {
    const svc = serviceWithKek();
    const { stream, wrappedDek } = svc.createEncryptStream();
    const encrypted = await streamToBuffer(Readable.from(Buffer.from('hello')).pipe(stream));
    encrypted[encrypted.length - 20] ^= 0xff; // flip a ciphertext byte
    expect(() => svc.decrypt(encrypted, wrappedDek)).toThrow();
  });

  it('is disabled when ENCRYPTION_ENABLED is false', () => {
    const svc = new CryptoService({ get: () => ({ enabled: false }) } as never);
    expect(svc.isEnabled).toBe(false);
  });
});
