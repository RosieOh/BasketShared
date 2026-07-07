export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const WEBHOOK_DELIVERY_JOB = 'deliver';

/** Domain event types a subscription can register for. */
export const EVENT_TYPES = ['transfer.completed', 'transfer.failed'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface WebhookDeliveryJob {
  subscriptionId: string;
  url: string;
  secret: string;
  event: {
    type: EventType;
    transferId: string;
    tenantId: string;
    data: Record<string, unknown>;
  };
}
