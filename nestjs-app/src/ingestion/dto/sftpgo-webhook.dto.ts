import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Schema of the SFTPGo "common actions" filesystem hook payload.
 *
 * Property names intentionally match SFTPGo's snake_case wire format so the
 * global ValidationPipe (`whitelist: true`) validates the real payload without
 * a transformation layer. Reference:
 * https://github.com/drakkan/sftpgo/blob/main/docs/custom-actions.md
 */
export class SftpgoWebhookDto {
  /** Event type. We only act on "upload". */
  @IsString()
  @IsNotEmpty()
  action!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  /** Absolute path on the SFTPGo filesystem (and the shared volume). */
  @IsString()
  @IsNotEmpty()
  path!: string;

  /** User-relative virtual path, e.g. "/inbox/report.csv". */
  @IsString()
  @IsNotEmpty()
  virtual_path!: string;

  @IsOptional()
  @IsString()
  target_path?: string;

  @IsOptional()
  @IsString()
  virtual_target_path?: string;

  @IsOptional()
  @IsString()
  ssh_cmd?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  file_size = 0;

  /** SFTPGo status: 1 = OK, 2 = generic error, 3 = quota exceeded. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;

  @IsOptional()
  @IsString()
  protocol?: string;

  @IsOptional()
  @IsString()
  ip?: string;

  @IsOptional()
  @IsString()
  session_id?: string;

  /** Event time in nanoseconds since the epoch. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  timestamp?: number;

  @IsOptional()
  @IsString()
  instance_id?: string;
}
