import { UnauthorizedException } from '@nestjs/common';
import {
  PluginI18nService,
  RequestContextService,
} from '@makekeeper/backend-core';

// The caller's authenticated user id, or a localized 401. Shared by the
// owner-facing multiuser controllers (grants, my-plugins) whose routes act on
// the caller rather than on scope data — one definition of the "who am I"
// contract instead of a copy per controller.
//
// A NestJS param decorator can't reach the AsyncLocalStorage-backed request
// context (decorators don't participate in DI), so this stays a plain helper
// the controllers call with their injected RequestContextService + i18n.
export function requireUserId(
  requestContext: RequestContextService,
  i18n: PluginI18nService,
  locale?: string,
): string {
  const userId = requestContext.get()?.userId;
  if (!userId) {
    throw new UnauthorizedException(
      i18n.t('multiuser.errors.unauthorized', undefined, locale),
    );
  }
  return userId;
}
