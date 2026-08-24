import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CUSTOM_ORIGIN_MAX_LENGTH } from './mobile-settings.constants';

// An absolute http(s) origin and nothing else — no path, no query. What goes in
// here ends up in a QR a phone will open and, when a separate host is in play,
// in a CORS allowlist; both deserve a shape check before storage.
// The empty alternative is how the field is CLEARED — the same convention the
// phone-bridge binary path uses.
const ORIGIN_PATTERN = /^$|^https?:\/\/[a-z0-9.-]+(:\d+)?\/?$/i;

export class UpdateMobileSettingsDto {
  @ApiPropertyOptional({
    maxLength: CUSTOM_ORIGIN_MAX_LENGTH,
    description: 'i18n:mobile.api.settings.customOriginDescription',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CUSTOM_ORIGIN_MAX_LENGTH)
  @Matches(ORIGIN_PATTERN, { message: 'mobile.errors.invalidOrigin' })
  customOrigin?: string;
}
