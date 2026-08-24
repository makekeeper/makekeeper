import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOAuth2,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  DeviceAuthService,
  LoginThrottleGuard,
  PluginI18nService,
  PluginOwner,
  Public,
  RequestContextService,
  type PairedDeviceInfo,
} from '@makekeeper/backend-core';
import {
  DEVICE_PAIRING_CODE_PARAM,
  withLocaleParam,
  type DevicePairingOffer,
  type DevicePairingResult,
  type PairedDevice,
} from '@makekeeper/plugin-contract';
import { PairSelfDto, RedeemPairingCodeDto } from './devices.dto';
import { MobileOriginService } from './mobile-origin.service';
import { TUNNEL_WARMUP_SECONDS } from './mobile-settings.constants';

// Phones paired to this instance (#199). Core, not multiuser: the mobile surface
// is what gets published at a public address, and with the overlay off the
// device token is the only credential in play.
@PluginOwner('mobile')
@Controller('devices')
@ApiTags('mobile')
@ApiBearerAuth()
@ApiOAuth2([])
export class DevicesController {
  constructor(
    private readonly devices: DeviceAuthService,
    private readonly origins: MobileOriginService,
    private readonly requestContext: RequestContextService,
    private readonly i18n: PluginI18nService,
  ) {}

  private toPublic(device: PairedDeviceInfo): PairedDevice {
    return {
      id: device.id,
      name: device.name,
      createdAt: device.createdAt.toISOString(),
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
    };
  }

  // Null in single-user mode (nobody to bind to), the caller otherwise. The
  // multiuser guard has already rejected anonymous callers by the time we run.
  private callerId(): string | null {
    return this.requestContext.get()?.userId ?? null;
  }

  @Get()
  @ApiOperation({ summary: 'i18n:mobile.devices.listSummary' })
  async list(): Promise<PairedDevice[]> {
    const devices = await this.devices.list(this.callerId());
    return devices.map((d) => this.toPublic(d));
  }

  @Post('pairing-code')
  @ApiOperation({ summary: 'i18n:mobile.devices.pairingCodeSummary' })
  async createPairingCode(
    @Req() req: Request,
    // The language the DESKTOP is reading in, which `apiFetch` puts on every
    // request. It rides into the QR so the phone's first screen is already in
    // it (#211) — a phone is a different browser and knows nothing otherwise.
    @Headers('x-locale') locale?: string,
  ): Promise<DevicePairingOffer> {
    const { id, code, expiresAt } = await this.devices.issuePairingCode(
      this.callerId(),
    );
    // Where the PHONE should go — one resolver for the whole plugin, so the QR
    // and the installability verdict can never disagree. It brings a tunnel up
    // if that is the only phone-reachable address available.
    const { url: base, freshlyStarted } =
      await this.origins.resolveForPhone(req);
    if (!base) {
      throw new BadRequestException(
        this.i18n.t('mobile.errors.noPhoneAddress'),
      );
    }
    const url = withLocaleParam(
      `${base}/m/pair?${DEVICE_PAIRING_CODE_PARAM}=${encodeURIComponent(code)}`,
      locale,
    );
    return {
      id,
      url,
      expiresAt: expiresAt.toISOString(),
      // A tunnel that has just come up is not reachable yet — its name needs
      // seconds to propagate. Hold the QR for exactly as long as the bridge's
      // own QR does, or the person scans it and lands on "site not found".
      warmupSeconds: freshlyStarted ? TUNNEL_WARMUP_SECONDS : 0,
    };
  }

  // Polled by the desktop while its QR is on screen, so the dialog closes itself
  // the moment the phone pairs. Only ever says yes or no about an id the caller
  // was handed — the code itself never travels here.
  @Get('pairing-code/:id')
  @ApiOperation({ summary: 'i18n:mobile.devices.pairingStatusSummary' })
  async pairingStatus(@Param('id') id: string): Promise<{ redeemed: boolean }> {
    return { redeemed: await this.devices.isPairingCodeRedeemed(id) };
  }

  // A phone pairing ITSELF (#207). Not public: the caller's own session is the
  // authentication, which is the whole difference from `redeem` — there is
  // nobody else to hand a code to and no second screen to show it on.
  //
  // Why it exists at all: signing in with a password leaves the phone holding a
  // JWT that expires in hours, so the next launch of the installed app asks for
  // the password again — the symptom this ticket is about. The device token is
  // what survives, and it is issued here through the same code path as the QR
  // flow (issue, then redeem at once) so a device has exactly one origin story.
  @Post('self')
  @ApiOperation({ summary: 'i18n:mobile.devices.pairSelfSummary' })
  async pairSelf(
    @Body() body: PairSelfDto,
    @Headers('x-locale') locale?: string,
  ): Promise<DevicePairingResult> {
    const name =
      body.name?.trim() ||
      this.i18n.t('mobile.devices.defaultDeviceName', undefined, locale);
    const { code } = await this.devices.issuePairingCode(this.callerId());
    const result = await this.devices.redeemPairingCode(code, name);
    if (!result) {
      // The code was minted a line ago and nobody else has ever seen it, so this
      // is storage failing, not a credential being refused.
      throw new BadRequestException(
        this.i18n.t('mobile.devices.errors.selfPairFailed', undefined, locale),
      );
    }
    return { token: result.token, device: this.toPublic(result.device) };
  }

  // Public: the phone has no credential yet — that is the entire point of
  // pairing. The one-time code IS the authentication here — which also makes
  // this a credential-bearing anonymous surface, throttled per client IP like
  // the auth endpoints (#237).
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('redeem')
  @ApiOperation({ summary: 'i18n:mobile.devices.redeemSummary' })
  async redeem(
    @Body() body: RedeemPairingCodeDto,
    // The phone is unauthenticated here, so its locale can only come from the
    // header it sends — there is no user record to read a preference from
    // (§5.5).
    @Headers('x-locale') locale?: string,
  ): Promise<DevicePairingResult> {
    const name =
      body.name?.trim() ||
      this.i18n.t('mobile.devices.defaultDeviceName', undefined, locale);
    const result = await this.devices.redeemPairingCode(body.code, name);
    if (!result) {
      // Expired, already used, or never existed — one answer for all three, so
      // the endpoint cannot be used to probe which codes are real.
      throw new UnauthorizedException(
        this.i18n.t('mobile.devices.errors.pairingRejected', undefined, locale),
      );
    }
    return { token: result.token, device: this.toPublic(result.device) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'i18n:mobile.devices.revokeSummary' })
  async revoke(
    @Param('id') id: string,
    @Headers('x-locale') locale?: string,
  ): Promise<{ id: string }> {
    const revoked = await this.devices.revoke(id, this.callerId());
    if (!revoked) {
      throw new NotFoundException(
        this.i18n.t('mobile.devices.errors.notFound', undefined, locale),
      );
    }
    return { id };
  }
}
