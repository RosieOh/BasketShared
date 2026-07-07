import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

/**
 * Maps an SFTP username to its tenant. Webhooks carry no user identity, so the
 * tenant is derived from the uploader via `TENANT_MAP` (username -> tenant),
 * falling back to `DEFAULT_TENANT`.
 */
@Injectable()
export class TenantService {
  private readonly map: Record<string, string>;
  private readonly defaultTenant: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const t = config.get('tenancy', { infer: true });
    this.map = t.map;
    this.defaultTenant = t.defaultTenant;
  }

  resolve(username: string): string {
    return this.map[username] ?? this.defaultTenant;
  }
}
