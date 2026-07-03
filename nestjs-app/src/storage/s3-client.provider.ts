import { S3Client } from '@aws-sdk/client-s3';
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { S3_CLIENT } from './storage.constants';

/**
 * Factory provider for a single, shared S3 client.
 *
 * The only difference between "MinIO locally" and "AWS S3 in production" is
 * configuration:
 *   - MinIO: set S3_ENDPOINT + S3_FORCE_PATH_STYLE=true
 *   - AWS:   leave S3_ENDPOINT empty (SDK derives the regional endpoint) and
 *            set S3_FORCE_PATH_STYLE=false
 * No code changes required — that's the whole point of this provider.
 */
export const s3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppConfig, true>): S3Client => {
    const s3 = config.get('s3', { infer: true });
    return new S3Client({
      region: s3.region,
      endpoint: s3.endpoint, // undefined => real AWS endpoint
      forcePathStyle: s3.forcePathStyle,
      credentials: {
        accessKeyId: s3.accessKeyId,
        secretAccessKey: s3.secretAccessKey,
      },
    });
  },
};
