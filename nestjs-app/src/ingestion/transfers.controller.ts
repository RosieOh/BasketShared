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
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/jwt.strategy';
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
  list(
    @Query() query: ListTransfersQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedTransfers> {
    return this.transfersService.list(query, user);
  }

  @Get(':id')
  @Roles(Role.VIEWER, Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Inspect a single transfer' })
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<FileTransfer> {
    return this.transfersService.getById(id, user);
  }

  @Get(':id/download')
  @Roles(Role.VIEWER, Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: 'Download the stored object (decrypted on the fly if encrypted)' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename, contentType } = await this.transfersService.download(id, user);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
    });
    return new StreamableFile(stream);
  }

  @Post('retry-batch')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk re-drive transfers by status/age (default FAILED)' })
  retryBatch(
    @Body() dto: RetryBatchDto,
    @CurrentUser() user: AuthUser,
  ): Promise<{ requeued: number; ids: string[] }> {
    return this.transfersService.retryBatch(dto, user);
  }

  @Post(':id/retry')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Re-drive a FAILED/stuck transfer (409 if already succeeded)' })
  retry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<FileTransfer> {
    return this.transfersService.retry(id, user);
  }
}
