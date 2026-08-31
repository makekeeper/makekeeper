import {
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
import { ApiProperty } from '@nestjs/swagger';

export const SCHEDULE_TITLE_MAX = 200;
// An RRULE with a DTSTART line and a handful of BY* parts; generous enough for
// anything a person builds in the UI, bounded so the column cannot be abused.
export const SCHEDULE_RRULE_MAX = 1000;

export class CreateScheduleDto {
  @ApiProperty({ description: 'i18n:schedule.api.hookId' })
  @IsString()
  @MaxLength(120)
  hookId!: string;

  @ApiProperty({ description: 'i18n:schedule.api.title' })
  @IsString()
  @MaxLength(SCHEDULE_TITLE_MAX)
  title!: string;

  @ApiProperty({ description: 'i18n:schedule.api.triggerKind' })
  @IsIn(['absolute', 'relative'])
  triggerKind!: 'absolute' | 'relative';

  @ApiProperty({ required: false, description: 'i18n:schedule.api.rrule' })
  @IsOptional()
  @IsString()
  @MaxLength(SCHEDULE_RRULE_MAX)
  rrule?: string;

  @ApiProperty({ required: false, description: 'i18n:schedule.api.timezone' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiProperty({ required: false, description: 'i18n:schedule.api.ref' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  ref?: string;

  @ApiProperty({ required: false, description: 'i18n:schedule.api.refField' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  refField?: string;

  @ApiProperty({
    required: false,
    description: 'i18n:schedule.api.offsetMinutes',
  })
  @IsOptional()
  @IsInt()
  // A week either side: enough for "a day before" and "an hour after", and
  // short of anything that would silently outlive the object it follows.
  @Min(-7 * 24 * 60)
  @Max(7 * 24 * 60)
  offsetMinutes?: number;

  @ApiProperty({ required: false, description: 'i18n:schedule.api.params' })
  @IsOptional()
  @IsObject()
  params?: Record<string, string | number | boolean>;

  @ApiProperty({ required: false, description: 'i18n:schedule.api.personal' })
  @IsOptional()
  @IsBoolean()
  personal?: boolean;
}

export class SnoozeScheduleDto {
  @ApiProperty({ description: 'i18n:schedule.api.snoozeMinutes' })
  @IsInt()
  @Min(1)
  @Max(7 * 24 * 60)
  minutes!: number;
}

export class SetScheduleEnabledDto {
  @ApiProperty({ description: 'i18n:schedule.api.enabled' })
  @IsBoolean()
  enabled!: boolean;
}
