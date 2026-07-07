import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/jwt.strategy';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { EventSubscription } from './entities/event-subscription.entity';

/** Manages a tenant's outbound-webhook subscriptions (app-level tenant scoping). */
@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(EventSubscription) private readonly repo: Repository<EventSubscription>,
  ) {}

  async create(user: AuthUser, dto: CreateSubscriptionDto): Promise<EventSubscription> {
    return this.repo.save(
      this.repo.create({
        tenantId: user.tenantId,
        url: dto.url,
        events: dto.events,
        secret: dto.secret ?? randomBytes(24).toString('hex'),
        active: true,
      }),
    );
  }

  list(user: AuthUser): Promise<EventSubscription[]> {
    return this.repo.find({ where: { tenantId: user.tenantId }, order: { createdAt: 'DESC' } });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    const sub = await this.repo.findOne({ where: { id, tenantId: user.tenantId } });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    await this.repo.delete(id);
  }
}
