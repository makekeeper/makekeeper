import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ minLength: 3, maxLength: 190 })
  @IsString()
  @MinLength(3)
  @MaxLength(190)
  username!: string;

  @ApiProperty({ minLength: 8, maxLength: 190 })
  @IsString()
  @MinLength(8)
  @MaxLength(190)
  password!: string;

  @ApiPropertyOptional({ maxLength: 190 })
  @IsOptional()
  @IsString()
  @MaxLength(190)
  displayName?: string;
}

export class LoginDto {
  @ApiProperty({ maxLength: 190 })
  @IsString()
  @MaxLength(190)
  username!: string;

  @ApiProperty({ maxLength: 190 })
  @IsString()
  @MaxLength(190)
  password!: string;
}

// OAuth2 "password" grant body (form-urlencoded) sent by Swagger UI's Authorize
// dialog. Only username/password are consumed; the pipe's `whitelist` strips the
// grant's other fields (grant_type/scope/client_id). It wraps the same login.
export class OAuth2TokenDto {
  @ApiProperty({ maxLength: 190 })
  @IsString()
  @MaxLength(190)
  username!: string;

  @ApiProperty({ maxLength: 190 })
  @IsString()
  @MaxLength(190)
  password!: string;
}

export class CreateGrantDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @MaxLength(64)
  granteeUserId!: string;

  @ApiProperty({ maxLength: 10 })
  @IsString()
  @MaxLength(10)
  @IsIn(['READ', 'WRITE'])
  accessLevel!: string;

  @ApiProperty({ type: String, isArray: true, maxLength: 64 })
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  allowedPluginIds!: string[];

  // { [pluginId]: { [resourceKey]: string[] } } — shape-validated in the
  // service (class-validator cannot express nested record types).
  @ApiProperty()
  @IsObject()
  resourceRestrictions!: Record<string, unknown>;
}

export class UpdateGrantDto {
  @ApiPropertyOptional({ maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @IsIn(['READ', 'WRITE'])
  accessLevel?: string;

  @ApiPropertyOptional({ type: String, isArray: true, maxLength: 64 })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  allowedPluginIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  resourceRestrictions?: Record<string, unknown>;
}

export class UpdateMyPluginDto {
  @ApiProperty()
  @IsBoolean()
  isEnabled!: boolean;
}

export class UpdateMultiuserSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allowRegistration?: boolean;
}
