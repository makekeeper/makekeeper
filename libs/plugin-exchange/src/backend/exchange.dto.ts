import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { ExchangeOptionValues } from '@makekeeper/plugin-contract';

export class ExportRequestDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  rootType!: string;

  // Raw Prisma id or a canonical ORef — the root section's provider resolves
  // either form (§5.9). Absent for dataset roots.
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rootId?: string;

  // Section keys to include; omitted = all available (isRoot always included).
  @ApiPropertyOptional({ type: String, isArray: true, maxLength: 200 })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  sections?: string[];

  // Instance root only: include `sensitive` sections (credentials). Ignored —
  // forced off — for entity roots.
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  includeSecrets?: boolean;
}

export class ExportScopeDto {
  // The scope (== owning user id) to export. Admin-only; secrets forced off.
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  scopeId!: string;
}

export class ExecuteImportDto {
  @ApiProperty({ type: String, isArray: true, maxLength: 200 })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  sections!: string[];

  // Per-section values for declared `importOptions`. Deliberately loose here —
  // the service filters against each section's declaration and coerces types
  // (only declared keys survive, strings are length-capped).
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  options?: Record<string, ExchangeOptionValues>;
}
