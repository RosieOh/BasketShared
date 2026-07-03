import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ListTransfersQueryDto } from './dto/list-transfers.query.dto';
import { FileTransfer } from './entities/file-transfer.entity';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { PaginatedTransfers, TransfersService } from './transfers.service';

/**
 * Management API for operators. Guarded by the admin key (X-Admin-Token).
 *   GET  /v1/transfers          — list/filter transfers
 *   GET  /v1/transfers/:id      — inspect one
 *   POST /v1/transfers/:id/retry — re-drive a failed/stuck transfer
 */
@ApiTags('transfers')
@ApiSecurity('admin-token')
@Controller('v1/transfers')
@UseGuards(AdminAuthGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  @ApiOperation({ summary: 'List transfers (newest first), optionally filtered by status' })
  list(@Query() query: ListTransfersQueryDto): Promise<PaginatedTransfers> {
    return this.transfersService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Inspect a single transfer' })
  getOne(@Param('id', ParseUUIDPipe) id: string): Promise<FileTransfer> {
    return this.transfersService.getById(id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-drive a FAILED/stuck transfer (409 if already succeeded)' })
  retry(@Param('id', ParseUUIDPipe) id: string): Promise<FileTransfer> {
    return this.transfersService.retry(id);
  }
}
