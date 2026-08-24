import { apiJson } from '@makekeeper/frontend-core';
import type {
  ExternalActionPayload,
  ExternalRenderPayload,
  ExternalShellPlugin,
} from '../external-types';

// HTTP seam of the external-plugin frontend (#134). The browser NEVER talks to
// a plugin container: every call goes to the core, which mints the delegated
// token, signs the outbound request, applies the budget/breaker and sanitizes
// the returned tree.

export const fetchExternalShell = (): Promise<ExternalShellPlugin[]> =>
  apiJson<ExternalShellPlugin[]>('/api/external/shell');

export const renderExternalScreen = (
  pluginId: string,
  screen: string,
  params: Record<string, string> = {},
  surface: 'screen' | 'widget' | 'slot' = 'screen',
  // Sent when a `reloadOnChange` field triggered the render, so the plugin can
  // draw the form that belongs to what the user has picked so far.
  form?: Record<string, string | number | boolean>,
): Promise<ExternalRenderPayload> =>
  apiJson<ExternalRenderPayload>(`/api/external/render/${pluginId}`, {
    method: 'POST',
    body: { screen, params, surface, form },
  });

export const runExternalAction = (
  pluginId: string,
  screen: string,
  action: string,
  params: Record<string, string | number | boolean> = {},
  form?: Record<string, string | number | boolean>,
): Promise<ExternalActionPayload> =>
  apiJson<ExternalActionPayload>(`/api/external/action/${pluginId}`, {
    method: 'POST',
    body: { screen, action, params, form },
  });
