import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import {
  AppConfigService,
  LoginThrottleGuard,
  PluginI18nService,
  PluginOwner,
  Public,
  RequestContextService,
  type RequestHeadersLike,
} from '@makekeeper/backend-core';
import { AuthResult, AuthStatus } from '@makekeeper/plugin-contract';
import { AuthService } from './auth.service';
import { LoginDto, OAuth2TokenDto, RegisterDto } from './multiuser.dto';
import { requireUserId } from './require-user';
import { extractBearerToken } from './multiuser.guard';
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  type ResponseLike,
} from './session-cookie';

// The @PluginOwner tag makes the whole auth surface disappear (404) while the
// multiuser plugin is disabled — the SPA probes GET /auth/status to detect
// whether multi-user mode is on at all.
@PluginOwner('multiuser')
@Controller('auth')
@ApiTags('multiuser')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly requestContext: RequestContextService,
    private readonly config: AppConfigService,
    private readonly i18n: PluginI18nService,
  ) {}

  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('register')
  async register(
    @Res({ passthrough: true }) res: ResponseLike,
    @Headers() headers: RequestHeadersLike['headers'],
    @Body() dto: RegisterDto,
    @Headers('x-locale') locale?: string,
  ): Promise<AuthResult> {
    const result = await this.auth.register(dto, locale);
    this.issueSessionCookie(res, headers, result.token);
    return result;
  }

  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('login')
  async login(
    @Res({ passthrough: true }) res: ResponseLike,
    @Headers() headers: RequestHeadersLike['headers'],
    @Body() dto: LoginDto,
    @Headers('x-locale') locale?: string,
  ): Promise<AuthResult> {
    const result = await this.auth.login(dto, locale);
    this.issueSessionCookie(res, headers, result.token);
    return result;
  }

  // OAuth2 "password" grant, used only by Swagger UI's Authorize dialog to trade
  // username/password for a Bearer token it then attaches automatically. A thin
  // wrapper over the same login (identical credential/blocked-account checks and
  // DEK arming) — it just returns the JWT as `access_token` and does not hand the
  // client the #63 sessionKey, so a docs session can't re-arm the DEK across a
  // server restart. Hidden from the docs list; it is the token URL, not a
  // browsable endpoint.
  @Public()
  @UseGuards(LoginThrottleGuard)
  @Post('token')
  @ApiExcludeEndpoint()
  async token(
    @Body() dto: OAuth2TokenDto,
    @Headers('x-locale') locale?: string,
  ): Promise<{ access_token: string; token_type: string }> {
    const result = await this.auth.login(dto, locale);
    return { access_token: result.token, token_type: 'bearer' };
  }

  // The SPA reads the authenticated user + scopes from GET /auth/status (which
  // returns them for a valid token), so no separate /auth/me is needed.
  //
  // It doubles as the refresh point for the media cookie (#123). The SPA calls
  // it on every boot with the token it kept in storage, so two sessions that
  // would otherwise have no cookie get one here without a re-login: a session
  // created before this change shipped, and one whose cookie outlived its
  // Max-Age while the token itself was still valid.
  @Public()
  @Get('status')
  async status(
    @Res({ passthrough: true }) res: ResponseLike,
    @Headers() headers: RequestHeadersLike['headers'],
    @Headers('authorization') authorization?: string,
  ): Promise<AuthStatus> {
    const status = await this.auth.getStatus(authorization);
    const token = extractBearerToken(authorization);
    if (status.user && token) this.issueSessionCookie(res, headers, token);
    return status;
  }

  // Authenticated: revoke this session's DEK re-arm token (#63). Not @Public —
  // it acts on the caller resolved from their Bearer token by the guard.
  @Post('logout')
  async logout(
    @Res({ passthrough: true }) res: ResponseLike,
    @Headers() headers: RequestHeadersLike['headers'],
    @Headers('x-session-key') sessionKey?: string,
    @Headers('x-locale') locale?: string,
  ): Promise<{ ok: true }> {
    await this.auth.logout(
      requireUserId(this.requestContext, this.i18n, locale),
      sessionKey,
    );
    // The SPA drops its token; the cookie is ours to drop, since script cannot
    // touch an HttpOnly one.
    res.setHeader(
      'Set-Cookie',
      buildClearedSessionCookie(
        this.config.isRequestSecure(headers),
        this.config.getSessionCookieDomain(),
      ),
    );
    return { ok: true };
  }

  // Mirrors the token's own lifetime, so the picture stops loading exactly when
  // the session it belongs to expires rather than at some unrelated moment.
  private issueSessionCookie(
    res: ResponseLike,
    headers: RequestHeadersLike['headers'],
    token: string,
  ): void {
    res.setHeader(
      'Set-Cookie',
      buildSessionCookie(token, {
        secure: this.config.isRequestSecure(headers),
        maxAgeSeconds: this.config.getJwtTtlSeconds(),
        domain: this.config.getSessionCookieDomain(),
      }),
    );
  }
}
