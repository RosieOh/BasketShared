import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/jwt.strategy';
import { Role } from '../auth/role.enum';
import { QuotaService } from './quota.service';

@ApiTags('usage')
@ApiBearerAuth()
@Controller('v1/usage')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsageController {
  constructor(private readonly quota: QuotaService) {}

  @Get()
  @ApiOperation({ summary: 'Usage + quota for the caller tenant (admins may pass ?tenant=)' })
  usage(@CurrentUser() user: AuthUser, @Query('tenant') tenant?: string) {
    // Only admins may inspect another tenant's usage.
    const target = tenant && user.roles.includes(Role.ADMIN) ? tenant : user.tenantId;
    return this.quota.summary(target);
  }
}
