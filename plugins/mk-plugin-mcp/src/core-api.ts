// The pass-through client to the core's external data surface (#251).
//
// This plugin holds NO credentials of its own for these calls: the MCP
// client's `Authorization: Bearer mkt_…` header is forwarded verbatim, and
// the core decides everything — identity, ceiling, per-user plugin set. What
// the caller may not do simply is not in `operations`, and `invoke` answers
// 401/403 with the core's own message.

export interface CoreOperation {
  name: string;
  pluginId: string;
  permission: 'READ' | 'WRITE' | 'DESTRUCTIVE';
  description: string;
  resolvedParameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export class CoreApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const coreUrl = (): string =>
  (process.env['MK_CORE_URL'] ?? 'http://localhost:3000').replace(/\/+$/, '');

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const messageOf = async (res: Response): Promise<string> => {
  try {
    const payload: unknown = await res.json();
    if (isRecord(payload)) {
      const message = payload['message'];
      if (typeof message === 'string') return message;
      if (Array.isArray(message) && message.every((m) => typeof m === 'string'))
        return message.join('; ');
      const error = payload['error'];
      if (typeof error === 'string') return error;
    }
  } catch {
    // Non-JSON error body — the status is all we know.
  }
  return `core answered ${res.status}`;
};

// Narrow one operations-list entry. The core is trusted, but its answer is
// still network JSON — a shape mismatch should surface as a clean protocol
// error here, not as a crash deep inside a tools/list response.
const isCoreOperation = (v: unknown): v is CoreOperation => {
  if (!isRecord(v)) return false;
  if (typeof v['name'] !== 'string' || typeof v['pluginId'] !== 'string')
    return false;
  if (!['READ', 'WRITE', 'DESTRUCTIVE'].includes(String(v['permission'])))
    return false;
  if (typeof v['description'] !== 'string') return false;
  const params = v['resolvedParameters'];
  return (
    isRecord(params) &&
    params['type'] === 'object' &&
    isRecord(params['properties'])
  );
};

export async function listOperations(
  authorization: string,
): Promise<CoreOperation[]> {
  const res = await fetch(`${coreUrl()}/api/external/data/operations`, {
    headers: { authorization },
  });
  if (!res.ok) throw new CoreApiError(res.status, await messageOf(res));
  const payload: unknown = await res.json();
  if (!Array.isArray(payload) || !payload.every(isCoreOperation)) {
    throw new CoreApiError(502, 'core answered an unexpected operations shape');
  }
  return payload;
}

export async function invokeOperation(
  authorization: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${coreUrl()}/api/external/data/invoke`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ operation, args }),
  });
  if (!res.ok) throw new CoreApiError(res.status, await messageOf(res));
  const payload: unknown = await res.json();
  return isRecord(payload) ? payload['result'] : undefined;
}
