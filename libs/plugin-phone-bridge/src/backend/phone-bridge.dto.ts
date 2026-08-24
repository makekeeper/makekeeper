import {
  Allow,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PhoneBridgeContext, TunnelMode } from '@makekeeper/plugin-contract';

const TUNNEL_MODES: readonly TunnelMode[] = ['off', 'on', 'auto'];

// What the desktop is connecting the phone for. Nested in CreateSessionDto and
// validated by the global ValidationPipe (transform + whitelist), so unknown
// fields are stripped and every string is bounded. `kind` is an open string —
// each consumer plugin declares its own — so it is length-bounded, not enumed.
export class PhoneBridgeContextDto implements PhoneBridgeContext {
  @ApiProperty({ maxLength: 60 })
  @IsString()
  @MaxLength(60)
  kind!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  projectId?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contextLabel?: string;

  // Opaque surface bootstrap data — the bridge never inspects it; the consumer
  // narrows it. Whitelisted through as-is; its size is bounded once serialized,
  // by PhoneBridgeService (MAX_CONTEXT_CHARS), since its shape is unknown here.
  @ApiPropertyOptional()
  @IsOptional()
  @Allow()
  data?: unknown;
}

// Re-point a live session (#79): the label the phone shows and the surface's
// bootstrap data. `kind` is not patchable — see PhoneBridgeService.retarget.
// Both fields are optional and patch semantics apply: an omitted field leaves
// the stored value untouched.
export class RetargetSessionDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  contextLabel?: string;

  // Bounded with the rest of the context by PhoneBridgeService — see above.
  @ApiPropertyOptional()
  @IsOptional()
  @Allow()
  data?: unknown;
}

export class CreateSessionDto {
  @ApiProperty({ type: () => PhoneBridgeContextDto })
  @ValidateNested()
  @Type(() => PhoneBridgeContextDto)
  context!: PhoneBridgeContextDto;

  // The desktop browser's own origin (`window.location.origin`) — the ground
  // truth for how the app was actually reached (scheme + host), which the
  // backend trusts over any forwarded-header guess. Used to skip the tunnel
  // when the app is already served over HTTPS (#93). Validated as an origin by
  // AppConfigService, so it is only length-bounded here.
  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  origin?: string;
}

// One payload relayed by the phone (a photo data URL, a scanned string, an
// object, …) — surface-defined and opaque to the bridge, forwarded verbatim to
// the kind handler. Bounded by the global request body-size cap.
export class RelayMessageDto {
  @ApiProperty()
  @Allow()
  payload!: unknown;
}

export class UpdatePhoneBridgeSettingsDto {
  @ApiPropertyOptional({ enum: TUNNEL_MODES })
  @IsOptional()
  @IsIn(TUNNEL_MODES)
  tunnelMode?: TunnelMode;

  // Empty string clears the override (falls back to managed/PATH lookup).
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cloudflaredPath?: string;

  // Minutes to keep an auto tunnel up after its last use (1..1440).
  @ApiPropertyOptional({ minimum: 1, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  tunnelIdleTtlMinutes?: number;
}
