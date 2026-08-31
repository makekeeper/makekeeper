import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MINUTES_IN_DAY } from '@makekeeper/plugin-contract';

// Quiet hours as the person sets them: minutes from local midnight, both ends
// or neither. A window that wraps past midnight is the normal case, so no
// ordering constraint is imposed between the two.
export class NotifyPreferencesDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'i18n:notify.api.quietFrom',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY - 1)
  quietFromMinutes?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'i18n:notify.api.quietTo',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MINUTES_IN_DAY - 1)
  quietToMinutes?: number | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'i18n:notify.api.timezone',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'i18n:notify.api.locale',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string | null;
}

// How long to put a notification off. Bounded at a week: beyond that the person
// is not postponing the thing, they are avoiding it, and the schedule itself is
// the honest place to change.
export class SnoozeNotificationDto {
  @ApiProperty({ description: 'i18n:notify.api.snoozeMinutes' })
  @IsInt()
  @Min(1)
  @Max(7 * 24 * 60)
  minutes!: number;
}

// One decision about the matrix: a single cell, a whole row, or everything a
// plugin declares. Bounded because the lists come from the client — long enough
// for every type an instance can hold, short enough not to be a bulk-write
// surface.
export class SetNotificationRoutesDto {
  @ApiProperty({ description: 'i18n:notify.api.routeType' })
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  types!: string[];

  @ApiProperty({ description: 'i18n:notify.api.routeChannel' })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  channelIds!: string[];

  @ApiProperty({ description: 'i18n:notify.api.routeEnabled' })
  @IsBoolean()
  enabled!: boolean;
}

// A person's master switch for one channel.
export class SetChannelEnabledDto {
  @ApiProperty({ description: 'i18n:notify.api.channelEnabled' })
  @IsBoolean()
  enabled!: boolean;
}

// A browser handing over the subscription its push service issued.
export class PushSubscribeDto {
  @ApiProperty({ description: 'i18n:notify.api.pushEndpoint' })
  @IsString()
  @MaxLength(600)
  endpoint!: string;

  @ApiProperty({ description: 'i18n:notify.api.pushP256dh' })
  @IsString()
  @MaxLength(300)
  p256dh!: string;

  @ApiProperty({ description: 'i18n:notify.api.pushAuth' })
  @IsString()
  @MaxLength(300)
  auth!: string;

  @ApiProperty({ required: false, description: 'i18n:notify.api.pushLabel' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
