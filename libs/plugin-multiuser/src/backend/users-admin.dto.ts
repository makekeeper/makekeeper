import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Admin user-management payloads. The target user is addressed by route param;
// these carry only the change being applied.

export class SetUserRoleDto {
  @ApiProperty()
  @IsBoolean()
  isAdmin!: boolean;
}

export class SetUserBlockedDto {
  @ApiProperty()
  @IsBoolean()
  blocked!: boolean;
}

export class DeleteUserQueryDto {
  // Query strings carry booleans as text; only the literal "true" opts into the
  // destructive cascade.
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  force?: boolean;
}

export class ResetUserPasswordDto {
  @ApiProperty({ minLength: 8, maxLength: 190 })
  @IsString()
  @MinLength(8)
  @MaxLength(190)
  password!: string;
}
