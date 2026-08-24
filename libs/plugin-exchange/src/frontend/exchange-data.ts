import {
  apiFetch,
  apiJson,
  apiDownload,
  ApiError,
} from '@makekeeper/frontend-core';
import type { ExchangeOptionValues } from '@makekeeper/plugin-contract';
import type {
  ExchangeCatalog,
  ExchangeImportPreview,
  ExchangeImportResult,
} from '../exchange-types';

export function getCatalog(): Promise<ExchangeCatalog> {
  return apiJson<ExchangeCatalog>('/api/exchange/catalog');
}

// Session-cached catalog for the always-mounted surfaces (the slot actions on
// detail pages) — the set of exportable roots only changes when an admin
// toggles plugins, which reloads the app anyway. A failed fetch is not cached.
let catalogCache: Promise<ExchangeCatalog> | null = null;

export function getCachedCatalog(): Promise<ExchangeCatalog> {
  catalogCache ??= getCatalog().catch((err: unknown) => {
    catalogCache = null;
    throw err;
  });
  return catalogCache;
}

// Non-JSON endpoints (blob download, multipart upload) build their ApiError
// the same way apiJson does: backend message when present, else the status.
function toApiError(status: number, payload: unknown): ApiError {
  const message =
    typeof payload === 'object' &&
    payload !== null &&
    'message' in payload &&
    typeof payload.message === 'string'
      ? payload.message
      : String(status);
  return new ApiError(status, payload, message);
}

// Run an export and hand the archive to the browser as a download. The
// blob→download plumbing lives in frontend-core's apiDownload so every export
// surface shares one implementation.
export function downloadExport(body: {
  rootType: string;
  rootId?: string;
  sections?: string[];
  includeSecrets?: boolean;
}): Promise<void> {
  return apiDownload(
    '/api/exchange/export',
    { method: 'POST', body },
    'export.mkx',
  );
}

export async function inspectArchive(
  file: File,
): Promise<ExchangeImportPreview> {
  const form = new FormData();
  form.append('file', file);
  const response = await apiFetch('/api/exchange/import/inspect', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    throw toApiError(response.status, payload);
  }
  const preview: ExchangeImportPreview = await response.json();
  return preview;
}

export function executeImport(
  token: string,
  sections: string[],
  options: Record<string, ExchangeOptionValues>,
): Promise<ExchangeImportResult> {
  return apiJson<ExchangeImportResult>(
    `/api/exchange/import/${token}/execute`,
    {
      method: 'POST',
      body: { sections, options },
    },
  );
}

export function discardImport(token: string): Promise<{ ok: true }> {
  return apiJson<{ ok: true }>(`/api/exchange/import/${token}`, {
    method: 'DELETE',
  });
}
