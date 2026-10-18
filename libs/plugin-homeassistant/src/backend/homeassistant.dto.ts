import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Both fields are optional and both have an "absent" meaning that differs from
// an empty one — that is the whole shape of a write-only secret form (#220).
export class UpdateHomeAssistantSettingsDto {
  @ApiPropertyOptional({
    description: 'i18n:homeassistant.api.settings.baseUrl',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  baseUrl?: string;

  // Omitted keeps the stored token; an empty string clears it.
  @ApiPropertyOptional({ description: 'i18n:homeassistant.api.settings.token' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  token?: string;
}
