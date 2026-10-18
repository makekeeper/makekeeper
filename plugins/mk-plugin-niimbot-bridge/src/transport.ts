import type { NiimbotAbstractClient } from '@mmote/niimbluelib';

// How the bridge reaches a printer — the seam #362 asks for: "local adapter
// first; an ESPHome BLE proxy as a second adapter once #363 says how — the
// bridge must not assume a local adapter."
//
// So everything above this file (the queue, the print sequence, the screens)
// talks to a transport, and only a transport knows there is a radio in this
// box. A second one — a BLE proxy reached over the network, a USB/serial
// cable — is a second implementation of these three methods and nothing else.

export interface ScannedPrinter {
  address: string;
  name: string;
}

export interface PrinterTransport {
  // Named in the operator's own terms when the settings screen has to say
  // where it is looking. An i18n key into this plugin's bundles.
  labelKey: string;
  // Printers this transport can see right now. Empty is a legitimate answer
  // ("nothing replied"), never an error: a printer that is switched off is the
  // commonest case there is.
  scan(): Promise<ScannedPrinter[]>;
  // A connected client for `address`, or null when it could not be reached.
  // The CALLER owns the client's lifetime (and its disconnect), because the
  // print sequence is what knows when the paper has left the machine.
  connect(address: string): Promise<NiimbotAbstractClient | null>;
}
