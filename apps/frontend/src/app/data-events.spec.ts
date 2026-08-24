import { describe, it, expect } from 'vitest';
import {
  notifyAgentDataChanged,
  useAgentDataChanged,
} from '@makekeeper/frontend-core';

// The agent-data signal is how the chat store tells plugin views (e.g. storages)
// to refetch after an agent turn may have mutated backend data.
describe('agent-data-changed signal', () => {
  it('bumps the shared tick on notify', () => {
    const tick = useAgentDataChanged();
    const before = tick.value;
    notifyAgentDataChanged();
    expect(tick.value).toBe(before + 1);
  });

  it('is a single shared signal across subscribers', () => {
    const a = useAgentDataChanged();
    const b = useAgentDataChanged();
    notifyAgentDataChanged();
    expect(b.value).toBe(a.value);
  });
});
