/** BullMQ queue + job identifiers and the job payload contract. */
export const TRANSFER_QUEUE = 'file-transfers';
export const TRANSFER_JOB = 'process-transfer';

/** Payload carried by each transfer job — just the DB row id to process. */
export interface TransferJobData {
  transferId: string;
}
