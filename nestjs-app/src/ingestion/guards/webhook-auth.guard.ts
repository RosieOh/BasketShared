import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { AppConfig } from '../../config/configuration';

/**
 * Authenticates the SFTPGo hook via a shared secret presented either as the
 * `X-SyncBridge-Token` header (Event Manager flow) or a `token` query param
 * (legacy actions hook, which cannot set headers). Comparison is constant-time.
 */
@Injectable()
export class WebhookAuthGuard implements CanActivate {
  private readonly logger = new Logger(WebhookAuthGuard.name);
  private readonly secret: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.secret = config.get('app.webhookSecret', { infer: true });
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const headerToken = req.header('x-syncbridge-token');
    const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined;
    const provided = headerToken ?? queryToken;

    if (!provided || !this.matches(provided)) {
      this.logger.warn(`Rejected webhook from ${req.ip}: invalid or missing token`);
      throw new UnauthorizedException('Invalid webhook token');
    }
    return true;
  }

  /** Length-safe, constant-time comparison to avoid leaking the secret. */
  private matches(provided: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(this.secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
