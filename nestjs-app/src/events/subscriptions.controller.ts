import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/jwt.strategy';
import { Role } from '../auth/role.enum';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { EventSubscription } from './entities/event-subscription.entity';
import { SubscriptionsService } from './subscriptions.service';

/** Manage outbound-webhook subscriptions for the caller's tenant. */
@ApiTags('subscriptions')
@ApiBearerAuth()
@Controller('v1/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @Roles(Role.OPERATOR, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a signed-webhook subscription for the tenant' })
  create(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: AuthUser): Promise<EventSubscription> {
    return this.subscriptions.create(user, dto);
  }

  @Get()
  @Roles(Role.VIEWER, Role.OPERATOR, Role.ADMIN)
  @ApiOperation({ summary: "List the tenant's subscriptions" })
  list(@CurrentUser() user: AuthUser): Promise<EventSubscription[]> {
    return this.subscriptions.list(user);
  }

  @Delete(':id')
  @Roles(Role.OPERATOR, Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a subscription' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.subscriptions.remove(user, id);
  }
}
