// The wire between this plugin's routes and its settings screen (#364).
//
// Here rather than in `backend/`, because both halves touch these shapes and a
// Vue file importing a Nest module would drag the server into the browser.
// Hand-copying them into the component is what the repo's quality bar forbids
// — and the copy had already lost a field (`status`) before this module
// existed.

export interface HomeAssistantSettingsPublic {
  baseUrl: string | null;
  // Never the token itself. Whether one is stored is all a screen may know,
  // and all it needs: a stored secret renders as shielded rather than as an
  // empty box somebody reads as lost settings (#270).
  hasToken: boolean;
}

export type HomeAssistantTestResult =
  | {
      ok: true;
      // What answered, and how much of it the token may read. A working
      // connection that can see nothing is a token without permissions, and an
      // admin has to be able to tell those two apart.
      version: string;
      entityCount: number;
    }
  | {
      ok: false;
      // The same vocabulary a consumer gets from the capability, so an admin
      // and a print dialog never disagree about the cause.
      errorKey: string;
      status?: number;
    };
