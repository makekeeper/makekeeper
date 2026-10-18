import {
  NiimbotNodeBleClient,
  type NiimbotAbstractClient,
} from '@mmote/niimbluelib';
import type { PrinterTransport, ScannedPrinter } from './transport.ts';

// The local-radio transport: this box's own Bluetooth adapter, through
// niimbluelib's `-node` client (noble underneath).
//
// The one implementation that exists today, and deliberately the only file that
// knows a radio is in the same machine — a proxy transport (#363) plugs in
// beside it without the print sequence noticing.

// How long to listen for printers when the operator presses "scan". Long
// enough for a B1 that was asleep, short enough that the screen is not frozen.
const SCAN_MS = 6000;

export function localBleTransport(): PrinterTransport {
  return {
    labelKey: 'transportLocal',

    async scan(): Promise<ScannedPrinter[]> {
      try {
        const found = await NiimbotNodeBleClient.scan(SCAN_MS);
        return found.map((device) => ({
          address: device.address,
          name: device.name || device.address,
        }));
      } catch (err) {
        // No adapter, no permission, BlueZ not running: all of them mean "no
        // printers found here", and the operator gets the same empty list with
        // the hint beside it. The reason goes to the log, where an operator
        // reading `docker logs` can act on it.
        console.error('BLE scan failed:', err);
        return [];
      }
    },

    async connect(address: string): Promise<NiimbotAbstractClient | null> {
      const client = new NiimbotNodeBleClient();
      client.setAddress(address);
      try {
        await client.connect();
        return client;
      } catch (err) {
        console.error('printer connect failed:', err);
        return null;
      }
    },
  };
}
