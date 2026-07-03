import {
  Body,
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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../auth/role.enum';
import { ListTransfersQueryDto } from './dto/list-transfers.query.dto';
import { RetryBatchDto } from './dto/retry-batch.dto';
import { FileTransfer } from './entities/file-transfer.entity';
import { PaginatedTransfers, TransfersService } from './transfers.service';

/**
 * Management API for operators. Requires a Bearer JWT (POST /v1/auth/login) and
 * enforces RBAC: viewers read, operators/admins can re-drive transfers.
 */
@ApiTags('transfers')
@ApiBearerAuth()
@Controller('v1/transfers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Get()
  @Roles(Role.VIEWER, Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'List transfers (newest first), optionally filtered by status' })
  list(@Query() query: ListTransfersQueryDto): Promise<PaginatedTransfers> {
    return this.transfersService.list(query);
  }

  @Get(':id')
  @Roles(Role.VIEWER, Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Inspect a single transfer' })
  getOne(@Param('id', ParseUUIDPipe) id: string): Promise<FileTransfer> {
    return this.transfersService.getById(id);
  }

  @Post('retry-batch')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk re-drive transfers by status/age (default FAILED)' })
  retryBatch(@Body() dto: RetryBatchDto): Promise<{ requeued: number; ids: string[] }> {
    return this.transfersService.retryBatch(dto);
  }

  @Post(':id/retry')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-drive a FAILED/stuck transfer (409 if already succeeded)' })
  retry(@Param('id', ParseUUIDPipe) id: string): Promise<FileTransfer> {
    return this.transfersService.retry(id);
  }
}
