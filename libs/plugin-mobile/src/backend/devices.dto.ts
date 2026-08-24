import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// The credential a phone presents at pairing. Length-bounded like every other
// string that reaches us: the code is a fixed-size random string, so anything
// materially longer is not a code.
export class RedeemPairingCodeDto {
  @ApiProperty({ description: 'i18n:core.devices.codeDescription' })
  @IsString()
  @MaxLength(128)
  code!: string;

  @ApiProperty({
    required: false,
    description: 'i18n:core.devices.nameDescription',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}

// A phone naming ITSELF (#207): it already holds a session, so there is no code
// to present — only what the device should be called in the list.
export class PairSelfDto {
  @ApiProperty({
    required: false,
    description: 'i18n:core.devices.nameDescription',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;
}
