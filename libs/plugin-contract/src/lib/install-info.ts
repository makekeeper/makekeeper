// Shared contract for install-method detection (#100). The research spike (#97)
// established that sniffing the surrounding manager (Coolify/Dokploy) is blind
// from inside the app container: their magic variables are consumed by Compose
// interpolation or live proxy-side, never reaching this process. So the method
// is primarily SELF-DECLARED by the deploy artifact via `MK_INSTALL_METHOD`;
// only Kubernetes and container-vs-dev are inferable in-process.
//
// This is a diagnostic hint — never the sole trigger of an action.

// How the instance was deployed. `portainer` extends the enumeration #100
// listed: it ships no artifact of ours to stamp, so it exists purely as an
// accepted hand-set marker value (INSTALL.md documents it) — without it a
// Portainer install could only ever report `unknown`.
export const INSTALL_METHODS = [
  'install-sh',
  'compose',
  'coolify',
  'dokploy',
  'portainer',
  'kubernetes',
  'dev',
  'unknown',
] as const;

export type InstallMethod = (typeof INSTALL_METHODS)[number];

// How much the reported method can be trusted:
// - `declared`: the deploy artifact stamped `MK_INSTALL_METHOD`.
// - `inferred`: a reliable in-process signal (Kubernetes service env, no
//   `/.dockerenv`).
// - `guessed`: containerized but unmarked — the method is `unknown`.
export type InstallConfidence = 'declared' | 'inferred' | 'guessed';

export interface InstallInfo {
  method: InstallMethod;
  confidence: InstallConfidence;
  // Whether the process runs inside a container. Reported independently of the
  // method, so an unmarked container install is still distinguishable from a
  // bare-metal/dev run.
  container: boolean;
}

export function isInstallMethod(value: unknown): value is InstallMethod {
  return (
    typeof value === 'string' &&
    (INSTALL_METHODS as readonly string[]).includes(value)
  );
}
