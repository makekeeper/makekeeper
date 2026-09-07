// The shipped demo workshop (#339): the shape the SPA reads to decide whether
// to announce that the instance it is showing is a demo, and to offer the one
// action that removes it. Declared here because both the backend controller and
// the frontend store speak it.

export interface DemoStatus {
  // True while the demo rows are present: seeded and not cleared since.
  active: boolean;
  // ISO timestamps, or null where the event has not happened.
  seededAt: string | null;
  clearedAt: string | null;
}

export interface DemoClearResult {
  // How many rows the removal deleted, across every table it touches.
  removed: number;
}
