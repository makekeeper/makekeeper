import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_ORIGIN_LENGTH } from '@makekeeper/plugin-contract';

export class EnsureLabelDto {
  @ApiProperty({ description: 'i18n:codes.agentTools.create_label.params.ref' })
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  ref!: string;

  // The print dialog's own `window.location.origin` (#372): the address the
  // printed QR has to open. Header-derived guesses lose pieces of it behind
  // chained proxies (`https://host:80`). Validated as an origin by
  // AppConfigService, so it is only length-bounded here — same as the phone
  // bridge and the API section.
  @ApiPropertyOptional({ maxLength: MAX_ORIGIN_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ORIGIN_LENGTH)
  origin?: string;
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
