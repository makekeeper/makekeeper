import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  EXTERNAL_TOKEN_CEILINGS,
  type ExternalTokenCeiling,
} from '../external-types';

// Registration body (plugin → core). The manifest object is validated by the
// contract validator, not class-validator — this DTO only bounds the envelope.
export class ExternalRegisterDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  installToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pluginSecret?: string;

  @IsString()
  @MaxLength(500)
  baseUrl!: string;

  @IsObject()
  manifest!: Record<string, unknown>;
}

// Render/action bodies from the SPA. `params`/`form` are opaque maps relayed
// to the plugin — bounded in size by the global body limit, and never
// interpreted by the core.
export class ExternalRenderBodyDto {
  @IsString()
  @MaxLength(64)
  screen!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, string>;

  // Which budget/degradation class this render belongs to (own screen vs a
  // guest surface). Defaults to the strictest-waiting one.
  @IsOptional()
  @IsIn(['screen', 'widget', 'slot'])
  surface?: 'screen' | 'widget' | 'slot';

  // In-progress form values, when a `reloadOnChange` field asked for this
  // render (contract 1.2).
  @IsOptional()
  @IsObject()
  form?: Record<string, string | number | boolean>;
}

export class ExternalActionBodyDto {
  @IsString()
  @MaxLength(64)
  screen!: string;

  @IsString()
  @MaxLength(64)
  action!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, string | number | boolean>;

  @IsOptional()
  @IsObject()
  form?: Record<string, string | number | boolean>;
}

export class ExternalUninstallDto {
  @IsOptional()
  @IsBoolean()
  purge?: boolean;
}

export class ExternalSetEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

// Scoped-surface invocation: an operation name from the capability layer plus
// its arguments (opaque to this DTO — the tool's own schema governs them).
export class ExternalInvokeDto {
  @IsString()
  @MaxLength(120)
  operation!: string;

  @IsOptional()
  @IsObject()
  args?: Record<string, unknown>;
}

// Instance-surface query. `days` is bounded so one call cannot ask the
// instance to scan an unbounded history.
export class ExternalMetricsQueryDto {
  @IsString()
  @MaxLength(64)
  pluginId!: string;

  @IsString()
  @MaxLength(120)
  metricKey!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(730)
  days?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  byScope?: boolean;
}

// Realtime invalidation from a plugin. `scopeId` is honoured only for an
// instance-class token; a scoped token's scope always comes from the token.
export class ExternalNotifyChangedDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  screen?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  scopeId?: string;
}

// Capability invocation from an external plugin. `args` is opaque JSON relayed
// to the owner — the core validates the contract of neither side (#138).
export class ExternalInvokeCapabilityDto {
  @IsString()
  @MaxLength(120)
  capability!: string;

  @IsString()
  @MaxLength(120)
  method!: string;

  @IsOptional()
  @IsArray()
  args?: unknown[];
}

// Token bootstrap: the plugin identifies itself with its registration secret
// and receives its current background tokens (#140).
export class ExternalTokensDto {
  @IsString()
  @MaxLength(64)
  pluginId!: string;

  @IsString()
  @MaxLength(200)
  pluginSecret!: string;
}

// Connection-token management (#249). The ceiling is immutable after
// issuance — only the label may change later.
export class ExternalConnectionTokenCreateDto {
  @IsString()
  @MaxLength(64)
  label!: string;

  @IsIn(EXTERNAL_TOKEN_CEILINGS)
  ceiling!: ExternalTokenCeiling;
}

export class ExternalConnectionTokenLabelDto {
  @IsString()
  @MaxLength(64)
  label!: string;
}

// Anonymous announce from a running container during a pairing window (#144).
export class ExternalAnnounceDto {
  @IsObject()
  manifest!: Record<string, unknown>;

  @IsString()
  @MaxLength(500)
  baseUrl!: string;

  @IsString()
  @MaxLength(200)
  announceKey!: string;

  @IsString()
  @MaxLength(32)
  pairingCode!: string;
}

export class ExternalClaimDto {
  @IsString()
  @MaxLength(64)
  pluginId!: string;

  @IsString()
  @MaxLength(200)
  announceKey!: string;
}

export class ExternalPairDto {
  @IsString()
  @MaxLength(32)
  code!: string;
}

// Admin-tunable per-surface time budgets (decision #8). Partial on purpose:
// only the surfaces present in the body change.
export class ExternalBudgetsDto {
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(600000)
  screen?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(600000)
  widget?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(600000)
  slot?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(600000)
  ref?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(600000)
  tool?: number;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(600000)
  hook?: number;
}
