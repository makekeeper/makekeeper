import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnsureLabelDto {
  @ApiProperty({ description: 'i18n:codes.agentTools.create_label.params.ref' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  ref!: string;
}

export class ResolveScanDto {
  @ApiProperty({
    description: 'i18n:codes.agentTools.resolve_code.params.value',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  value!: string;
}

export class PreviewScanDto extends ResolveScanDto {
  // The caller's live phone-bridge session token: the preview route is public
  // (the phone has no app session), so it is gated on this token instead of an
  // authenticated session. See PHONE_BRIDGE_SESSION_CAPABILITY.
  @ApiProperty({
    description: 'Live phone-bridge session token gating the public preview',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  token!: string;
}
