import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { TransferStatus } from '../entities/file-transfer.entity';

/** Body for POST /v1/transfers/retry-batch — bulk re-drive of matching transfers. */
export class RetryBatchDto {
  /** Which status to re-drive (default FAILED). SUCCESS is not allowed. */
  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  /** Only transfers last updated before this ISO timestamp. */
  @IsOptional()
  @IsDateString()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit = 100;
}
