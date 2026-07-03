import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';

/** Global so the dead-letter processor (and others) can alert without re-import. */
@Global()
@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
