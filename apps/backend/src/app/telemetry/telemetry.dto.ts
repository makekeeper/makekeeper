import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

// The whole write surface of liveness telemetry (#343): one boolean, chosen by
// a human. There is deliberately nothing here to configure — no endpoint, no
// interval, no extra fields — because every one of those would be a way to
// change what leaves the instance from inside the app.
export class SetTelemetryConsentDto {
  @ApiProperty({
    description: 'Whether this instance may send the documented liveness ping',
  })
  @IsBoolean()
  granted!: boolean;
}
