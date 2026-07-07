import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { EVENT_TYPES } from '../webhook-queue';

export class CreateSubscriptionDto {
  @IsUrl({ require_tld: false }) // allow internal hostnames in dev
  url!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(EVENT_TYPES as unknown as string[], { each: true })
  events!: string[];

  /** Optional HMAC secret; generated if omitted. */
  @IsOptional()
  @IsString()
  secret?: string;
}
