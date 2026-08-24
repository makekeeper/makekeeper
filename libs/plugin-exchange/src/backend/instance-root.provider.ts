import type { ExchangeSectionProvider } from '@makekeeper/backend-core';

// The instance root's core marker section. Carries no plugin data — it exists
// because every root needs exactly one `isRoot` section; the fresh-instance
// precondition and account handling land here with the instance-restore phase.
export function createInstanceRootProvider(): ExchangeSectionProvider {
  return {
    sectionKey: 'exchange.instance',
    exportSection: () => Promise.resolve({ records: [] }),
    inspectSection: (records) => Promise.resolve({ count: records.length }),
    importSection: () => Promise.resolve({ created: 0 }),
  };
}

// The scope root's core marker section — same empty payload. A scope export is
// export-only (there is no scope-restore import path), so this just satisfies
// the "exactly one isRoot section per root" rule.
export function createScopeRootProvider(): ExchangeSectionProvider {
  return {
    sectionKey: 'exchange.scope',
    exportSection: () => Promise.resolve({ records: [] }),
    inspectSection: (records) => Promise.resolve({ count: records.length }),
    importSection: () => Promise.resolve({ created: 0 }),
  };
}
