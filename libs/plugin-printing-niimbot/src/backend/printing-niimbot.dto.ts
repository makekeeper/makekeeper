import {
  IsBase64,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_ORIGIN_LENGTH,
  type PrintHandoffRequest,
} from '@makekeeper/plugin-contract';
import {
  DENSITY_MAX,
  DENSITY_MIN,
  NIIMBOT_LABEL_TYPES,
  type NiimbotLabelType,
} from '../label-stock';
import {
  NIIMBOT_HA_TARGET_KINDS,
  type NiimbotHaTargetKind,
} from '../ha-contract';

// The page to park for a handoff link (#361). A raster and nothing else: the
// endpoint stores what will be printed, never what it depicts.
//
// `implements` rather than a lookalike: the contract owns the wire shape of a
// page (`PrintHandoffRequest`), and the validators below only say what this
// endpoint will accept of it. A field renamed in the contract has to fail here.
export class CreateHandoffDto implements PrintHandoffRequest {
  @ApiProperty({ description: 'i18n:printingNiimbot.api.handoff.widthDots' })
  @IsInt()
  @Min(1)
  // A printhead this wide does not exist; the bound is here so a typo cannot
  // ask the server to remember a megabyte.
  @Max(4096)
  widthDots!: number;

  @ApiProperty({ description: 'i18n:printingNiimbot.api.handoff.heightDots' })
  @IsInt()
  @Min(1)
  @Max(4096)
  heightDots!: number;

  @ApiProperty({ description: 'i18n:printingNiimbot.api.handoff.rows' })
  @IsBase64()
  // 64 KB of base64 ≈ 48 KB of dots — six times the 384 × 240 page the B1
  // prints, so a tall label still fits and a mistake still cannot be big.
  @MaxLength(65536)
  rows!: string;

  // Optional on the wire, defaulted by the pipe: a caller that wants one copy
  // should not have to say so.
  @ApiPropertyOptional({
    description: 'i18n:printingNiimbot.api.handoff.copies',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  copies = 1;

  // The posting browser's `window.location.origin` (#372) — the address the
  // link must open. Validated as an origin by AppConfigService, so it is only
  // length-bounded here.
  @ApiPropertyOptional({ maxLength: MAX_ORIGIN_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ORIGIN_LENGTH)
  origin?: string;
}

// How the printer prints (#366) — the same two values for every route.
export class UpdateNiimbotPrintSettingsDto {
  @ApiPropertyOptional({
    description: 'i18n:printingNiimbot.api.print.density',
  })
  @IsOptional()
  @IsInt()
  @Min(DENSITY_MIN)
  @Max(DENSITY_MAX)
  density?: number;

  @ApiPropertyOptional({
    description: 'i18n:printingNiimbot.api.print.labelType',
  })
  @IsOptional()
  @IsIn(NIIMBOT_LABEL_TYPES)
  labelType?: NiimbotLabelType;
}

// Which Home Assistant printer this instance prints on (#364). Every field is
// optional: the screen saves one group at a time, and `undefined` means "leave
// it alone" — none of these is a secret, so an empty string plainly clears it.
export class UpdateNiimbotHaSettingsDto {
  @ApiPropertyOptional({ description: 'i18n:printingNiimbot.api.ha.targetId' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  targetId?: string;

  @ApiPropertyOptional({
    description: 'i18n:printingNiimbot.api.ha.targetKind',
  })
  @IsOptional()
  @IsIn(NIIMBOT_HA_TARGET_KINDS)
  targetKind?: NiimbotHaTargetKind;

  @ApiPropertyOptional({
    description: 'i18n:printingNiimbot.api.ha.printerName',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  printerName?: string;

  @ApiPropertyOptional({
    description: 'i18n:printingNiimbot.api.ha.soleTarget',
  })
  @IsOptional()
  @IsBoolean()
  soleTarget?: boolean;

  @ApiPropertyOptional({ description: 'i18n:printingNiimbot.api.ha.sendSize' })
  @IsOptional()
  @IsBoolean()
  sendSize?: boolean;
}
