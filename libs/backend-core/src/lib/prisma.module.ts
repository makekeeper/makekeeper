import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DbAccessPolicyHolder } from './db-access-policy';

@Global()
@Module({
  providers: [PrismaService, DbAccessPolicyHolder],
  exports: [PrismaService, DbAccessPolicyHolder],
})
export class PrismaModule {}
