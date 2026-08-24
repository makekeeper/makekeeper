import { Global, Module } from '@nestjs/common';
import { DeviceAuthService } from './device-auth.service';

// Global: the core's device controller mints and revokes, and the multiuser
// guard resolves presented tokens — without either importing the other's module
// and without the credential model belonging to an optional plugin (#199).
@Global()
@Module({
  providers: [DeviceAuthService],
  exports: [DeviceAuthService],
})
export class DeviceAuthModule {}
