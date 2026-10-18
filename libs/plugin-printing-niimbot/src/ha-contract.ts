// The wire between this plugin's Home Assistant routes and its settings
// screen (#364).
//
// Here rather than in `backend/`, because both halves touch these shapes and a
// Vue file importing a Nest module would drag the server into the browser.
// Hand-copying them into the component is what the repo's quality bar forbids
// for exactly the reason it already happened once here: the screen's own copy
// of the test result quietly dropped a field, and the `'device' | 'entity'`
// union was written out a third time instead of being the one type below.

export const NIIMBOT_HA_TARGET_KINDS = ['device', 'entity'] as const;

// What a print job is aimed at. A DEVICE is the printer itself, which is what
// a person means by "my printer"; an entity is one of its parts, which
// hass-niimbot also accepts and which is all this plugin can offer on an
// instance whose device registry it could not read.
export type NiimbotHaTargetKind = (typeof NIIMBOT_HA_TARGET_KINDS)[number];

export const isNiimbotHaTargetKind = (
  value: unknown,
): value is NiimbotHaTargetKind =>
  NIIMBOT_HA_TARGET_KINDS.some((kind) => kind === value);

export interface NiimbotHaSettings {
  targetId: string | null;
  targetKind: NiimbotHaTargetKind;
  // The target's name as Home Assistant gave it when it was chosen: naming the
  // printer in a print dialog must not cost a request to the household server.
  printerName: string | null;
  // Send no target at all, for an instance whose Home Assistant has exactly one
  // printer. A real choice between two working configurations, not an absence.
  soleTarget: boolean;
  // Send the page size with the job. Off hands the decision to hass-niimbot's
  // own online label lookup, which knows the roll by its RFID tag.
  sendSize: boolean;
}

// One printer, as the settings screen lists them.
export interface NiimbotHaPrinter {
  id: string;
  name: string;
}

export interface NiimbotHaPrinters {
  // Whether there is a Home Assistant to ask at all: its plugin may be absent
  // or disabled (`absent`), present but without an address and token
  // (`unconfigured`), or ready (`ok`).
  bridge: 'ok' | 'absent' | 'unconfigured';
  // What the rows ARE — see `NiimbotHaTargetKind`.
  kind: NiimbotHaTargetKind;
  printers: NiimbotHaPrinter[];
  // Only meaningful for an entity list: false means it could not even be
  // narrowed to the integration.
  filtered?: boolean;
  errorKey?: string;
}

// What a dry run answers with: the page Home Assistant actually drew, when it
// hands one back. A picture is the only answer to "did this work" that cannot
// be misread — a line of text saying "rendered" looks the same whether the
// label came out whole, blank or upside down.
export type NiimbotHaPreviewResult =
  | { ok: true; image?: string }
  | {
      ok: false;
      // Which half failed, because they fail for different reasons and send a
      // person to different places: `device` means Home Assistant could not
      // reach the printer at all (off, out of range, held by the phone app),
      // `render` means it did but could not draw the page.
      stage: 'device' | 'render';
      errorKey: string;
      params?: Record<string, string | number>;
    };
