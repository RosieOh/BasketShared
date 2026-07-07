import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuotaService } from './quota.service';
import { TenantUsage } from './tenant-usage.entity';
import { UsageController } from './usage.controller';

/** Global so the pipeline step and worker can enforce/record without re-import. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([TenantUsage])],
  controllers: [UsageController],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
