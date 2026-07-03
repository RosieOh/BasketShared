import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';

export interface FailureAlert {
  transferId: string;
  filename: string;
  reason: string;
}

/**
 * Sends failure alerts to a Slack-compatible incoming webhook. No-ops (logs
 * only) when disabled or unconfigured, so it's always safe to call.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly enabled: boolean;
  private readonly webhookUrl?: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const alerts = config.get('alerts', { infer: true });
    this.enabled = alerts.enabled;
    this.webhookUrl = alerts.webhookUrl;
  }

  async notifyFailure(alert: FailureAlert): Promise<void> {
    const text = `🚨 S3-SyncBridge transfer FAILED\n• file: ${alert.filename}\n• id: ${alert.transferId}\n• reason: ${alert.reason}`;
    if (!this.enabled || !this.webhookUrl) {
      this.logger.warn(`[alert suppressed] ${text.replace(/\n/g, ' ')}`);
      return;
    }
    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        this.logger.error(`Alert webhook returned ${res.status}`);
      }
    } catch (err) {
      this.logger.error(`Alert webhook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
