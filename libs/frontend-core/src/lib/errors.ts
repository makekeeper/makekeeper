// The frontend twin of backend-core's `getErrorMessage`. A caught `unknown` on
// its way to a toast is the single most repeated shape in the app; without one
// home for it, every view re-derives the same ternary (and some of them drop
// the non-Error case).
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
