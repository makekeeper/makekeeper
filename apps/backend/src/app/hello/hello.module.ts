import { Module } from '@nestjs/common';
import { HelloController } from './hello.controller';
import { HelloService } from './hello.service';

// Imports nothing: PrismaModule and the guards' modules are global in the root.
@Module({
  controllers: [HelloController],
  providers: [HelloService],
})
export class HelloModule {}
