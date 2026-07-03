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
 * Protects the management API with a shared admin key presented as the
 * `X-Admin-Token` header. Constant-time comparison avoids leaking the key.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  private readonly logger = new Logger(AdminAuthGuard.name);
  private readonly key: string;

  constructor(config: ConfigService<AppConfig, true>) {
    this.key = config.get('app.adminApiKey', { infer: true });
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.header('x-admin-token');
    if (!provided || !this.matches(provided)) {
      this.logger.warn(`Rejected admin request from ${req.ip}: invalid or missing token`);
      throw new UnauthorizedException('Invalid admin token');
    }
    return true;
  }

  private matches(provided: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(this.key);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
