import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SftpgoWebhookDto } from './dto/sftpgo-webhook.dto';
import { WebhookAuthGuard } from './guards/webhook-auth.guard';
import { AcceptOutcome, IngestionService } from './ingestion.service';

@ApiTags('ingestion')
@ApiSecurity('webhook-token')
@Controller('v1/sftp')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  /**
   * SFTPGo on_upload hook target: POST /v1/sftp/on-upload
   *
   * Responds 200 as soon as the event is validated and durably queued (a
   * PENDING row). The actual SFTPGo -> S3 transfer happens asynchronously in
   * the worker, so the SFTP session never blocks on object-storage latency.
   */
  @Post('on-upload')
  @UseGuards(WebhookAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SFTPGo on_upload webhook; validates + queues, returns 200 immediately' })
  async handleWebhook(@Body() payload: SftpgoWebhookDto): Promise<{ outcome: AcceptOutcome }> {
    const outcome = await this.ingestionService.accept(payload);
    return { outcome };
  }
}
