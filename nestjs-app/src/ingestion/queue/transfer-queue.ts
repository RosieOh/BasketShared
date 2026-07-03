/** BullMQ queue + job identifiers and the job payload contract. */
export const TRANSFER_QUEUE = 'file-transfers';
export const TRANSFER_JOB = 'process-transfer';

/** Payload carried by each transfer job — the DB row id + trace carrier. */
export interface TransferJobData {
  transferId: string;
  /** W3C trace-context carrier so the worker span links to the webhook trace. */
  carrier?: Record<string, string>;
}

/** Dead-letter queue: transfers that permanently failed, for alert + review. */
export const DEAD_LETTER_QUEUE = 'file-transfers-dlq';
export const DEAD_LETTER_JOB = 'dead-letter';

export interface DeadLetterJobData {
  transferId: string;
  reason: string;
}
