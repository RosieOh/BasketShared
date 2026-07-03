import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'node:path';
import type { AppConfig, RoutingRule } from '../config/configuration';
import { FileTransfer } from './entities/file-transfer.entity';

export interface RouteTarget {
  bucket: string;
  key: string;
}

/**
 * Resolves each transfer to a destination bucket + object key from configurable
 * rules (first match wins). Lets different file types / users land in different
 * buckets or prefixes without changing the worker — a rules engine, not code.
 */
@Injectable()
export class RoutingService {
  private readonly defaultBucket: string;
  private readonly rules: RoutingRule[];

  constructor(config: ConfigService<AppConfig, true>) {
    this.defaultBucket = config.get('s3.bucket', { infer: true });
    this.rules = config.get('routing.rules', { infer: true });
  }

  resolve(transfer: FileTransfer): RouteTarget {
    const rule = this.rules.find((r) => this.matches(r, transfer));
    const bucket = rule?.bucket || this.defaultBucket;
    const prefix = rule?.prefix ?? '';
    const relative = transfer.virtualPath.replace(/^\/+/, '');
    return { bucket, key: `${prefix}${transfer.username}/${relative}` };
  }

  private matches(rule: RoutingRule, transfer: FileTransfer): boolean {
    const m = rule.match ?? {};
    if (m.username && m.username !== transfer.username) return false;
    if (m.extension && extname(transfer.filename).toLowerCase() !== `.${m.extension.toLowerCase().replace(/^\./, '')}`) {
      return false;
    }
    if (m.pathPrefix && !transfer.virtualPath.startsWith(m.pathPrefix)) return false;
    return true;
  }
}
