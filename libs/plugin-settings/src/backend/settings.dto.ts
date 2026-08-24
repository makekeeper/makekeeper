import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  DEPLOY_HOOK_METHODS,
  DeployHookMethod,
  MAX_CHECK_HOUR_UTC,
  MAX_ORIGIN_LENGTH,
  MAX_DEPLOY_HOOK_TOKEN_LENGTH,
  MAX_DEPLOY_HOOK_URL_LENGTH,
  MIN_CHECK_HOUR_UTC,
} from '@makekeeper/plugin-contract';

export class UpdateAgentToolDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ApiPropertyOptional({ enum: ['AUTO', 'CONFIRM'], maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @IsIn(['AUTO', 'CONFIRM'])
  confirmationPolicy?: string;
}

// Deploy hook (#101). `url`/`token` are write-only: they are never echoed back,
// and an empty string clears the stored value.
export class DeployHookSettingsDto {
  @ApiPropertyOptional({
    description: 'i18n:settings.updates.hook.url',
    maxLength: MAX_DEPLOY_HOOK_URL_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEPLOY_HOOK_URL_LENGTH)
  url?: string;

  @ApiPropertyOptional({
    description: 'i18n:settings.updates.hook.token',
    maxLength: MAX_DEPLOY_HOOK_TOKEN_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_DEPLOY_HOOK_TOKEN_LENGTH)
  token?: string;

  @ApiPropertyOptional({ enum: DEPLOY_HOOK_METHODS })
  @IsOptional()
  @IsIn(DEPLOY_HOOK_METHODS)
  method?: DeployHookMethod;
}

export class UpdateCheckSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoCheckEnabled?: boolean;

  @ApiPropertyOptional({
    minimum: MIN_CHECK_HOUR_UTC,
    maximum: MAX_CHECK_HOUR_UTC,
  })
  @IsOptional()
  @IsInt()
  @Min(MIN_CHECK_HOUR_UTC)
  @Max(MAX_CHECK_HOUR_UTC)
  checkHourUtc?: number;
}

// The caller's own `window.location.origin` (#282). Only length-bounded here:
// AppConfigService validates it as an absolute http(s) origin and ignores
// anything else, so a junk value degrades to the header-derived address rather
// than being echoed back.
export class ApiInfoQueryDto {
  @ApiPropertyOptional({ maxLength: MAX_ORIGIN_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ORIGIN_LENGTH)
  origin?: string;
}
