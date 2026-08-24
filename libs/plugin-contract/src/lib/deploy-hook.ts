// Shared contract for the admin-configured deploy hook (#101) — the "update now"
// button in the Updates view.
//
// Key constraint from the #97 research: the app cannot learn its manager's
// webhook URL/token from inside the container, so the admin PASTES them. The
// configured hook is the only trigger; install-method detection (#100) is a
// setup hint ("looks like Coolify — paste your hook here"), never a trigger.
//
// The call goes to the admin's own manager, so this is not a phone-home.

// Managers differ in how the hook is called: Coolify's deploy endpoint is a GET
// with a bearer token, Dokploy's is a POST whose path carries a refresh token.
// Both shapes are expressible with a method + optional token.
export const DEPLOY_HOOK_METHODS = ['POST', 'GET'] as const;
export type DeployHookMethod = (typeof DEPLOY_HOOK_METHODS)[number];

// Outcome of the last trigger attempt. `failed` covers both a transport error
// and a non-2xx response — the distinction lives in `lastStatusCode`.
export type DeployHookOutcome = 'never' | 'ok' | 'failed';

// What the admin UI may see. Neither the full URL nor the token is ever
// returned: the URL PATH can itself be the secret (Dokploy embeds a refresh
// token in it), so only a host-level preview leaves the backend.
export interface DeployHookState {
  hasUrl: boolean;
  // `https://deploy.example.com/…` — scheme + host, path and query redacted.
  urlPreview: string | null;
  method: DeployHookMethod;
  hasToken: boolean;
  lastTriggeredAt: string | null;
  lastOutcome: DeployHookOutcome;
  // HTTP status of the last attempt, or null if the request never completed.
  // The response BODY is deliberately never stored or returned — a manager may
  // echo secrets in it.
  lastStatusCode: number | null;
}

// Admin-editable fields. `url`/`token`: undefined keeps the stored value, an
// empty string clears it.
export interface DeployHookSettingsPatch {
  url?: string;
  token?: string;
  method?: DeployHookMethod;
}

export interface DeployHookTriggerResult {
  ok: boolean;
  state: DeployHookState;
}

export const MAX_DEPLOY_HOOK_URL_LENGTH = 2000;
export const MAX_DEPLOY_HOOK_TOKEN_LENGTH = 500;

export function isDeployHookMethod(value: unknown): value is DeployHookMethod {
  return (
    typeof value === 'string' &&
    (DEPLOY_HOOK_METHODS as readonly string[]).includes(value)
  );
}
