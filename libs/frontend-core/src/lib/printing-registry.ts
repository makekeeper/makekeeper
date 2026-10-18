import { computed, ref, type ComputedRef } from 'vue';
import {
  encodeRasterPayload,
  type PrintDriverDescriptor,
  type PrintHandoffLink,
  type PrintJobOptions,
  type PrintProgress,
  type PrintRaster,
  type PrintResult,
} from '@makekeeper/plugin-contract';
import { usePluginsStore } from './plugins-store';
import { apiJson } from './api';

// The browser-side half of the `printing` contract (#359).
//
// Lives here, beside the plugin registry, for the same reason navigation does:
// a consumer must not import the driver's plugin to print (§5.10). A driver
// plugin registers itself as an import side-effect; `codes` asks what can print
// and offers one button per answer.
//
// `isSupported` is a per-BROWSER question, not a per-instance one: a Web
// Bluetooth driver is real on Chrome and absent on Safari with the same plugin
// enabled. So the registry keeps the driver and the consumer asks separately
// whether this browser can use it — that gap is exactly what the handoff link
// (#361) fills.
export interface FrontendPrintDriver {
  descriptor: PrintDriverDescriptor;
  // Can this driver print from THIS browser? Pure and cheap — it is read while
  // rendering a dialog, so it must not probe the device.
  isSupported(): boolean;
  // Print one page. Resolves with a keyed failure rather than throwing: the
  // consumer shows a toast, and a driver's transport error is not an exception
  // in the consumer's code path.
  print(
    raster: PrintRaster,
    options: PrintJobOptions,
    onProgress?: (progress: PrintProgress) => void,
  ): Promise<PrintResult>;
  // Park this page for a browser that CAN print it, and return the link to open
  // there (#361). Offered only by a driver that has somewhere to park it; a
  // consumer treats its absence, and a null result, the same way — this browser
  // simply cannot print, and the system dialog is the remaining answer.
  //
  // The driver does the parking itself, through its OWN endpoint: a consumer
  // calling another plugin's API would be the coupling the registry exists to
  // avoid (§5.10).
  createHandoff?(
    raster: PrintRaster,
    options: PrintJobOptions,
  ): Promise<PrintHandoffLink | null>;
  // Optional live predicate, exactly as a slot contribution has one (#269): the
  // driver declares its own simple/pro lens, so a consumer offers whatever the
  // registry hands it without knowing another plugin's feature keys.
  visible?: () => boolean;
}

const drivers: FrontendPrintDriver[] = [];

// Bumped when the set of drivers changes, so dialogs built around a computed
// re-evaluate when an external plugin's driver appears at runtime (#150).
const registryVersion = ref(0);

export function registerPrintDriver(driver: FrontendPrintDriver): void {
  // An id names one driver, so re-registering REPLACES it — the same rule the
  // plugin registry follows, and for the same reasons (HMR, re-announcing
  // external plugins).
  const existing = drivers.findIndex(
    (d) => d.descriptor.id === driver.descriptor.id,
  );
  if (existing >= 0) drivers.splice(existing, 1, driver);
  else drivers.push(driver);
  registryVersion.value += 1;
}

export function unregisterPrintDriver(driverId: string): void {
  const index = drivers.findIndex((d) => d.descriptor.id === driverId);
  if (index >= 0) {
    drivers.splice(index, 1);
    registryVersion.value += 1;
  }
}

export function getPrintDrivers(): FrontendPrintDriver[] {
  return drivers;
}

// Drivers whose owning plugin is enabled right now. Reactive: disabling the
// driver plugin removes its button from every open print dialog, which is the
// #58 rule ("disabling a plugin removes exactly its functionality") applied to
// a surface that lives in someone else's screen.
export function usePrintDrivers(): ComputedRef<FrontendPrintDriver[]> {
  const plugins = usePluginsStore();
  return computed(() => {
    void registryVersion.value;
    return drivers.filter(
      (d) =>
        plugins.isEnabled(d.descriptor.pluginId) &&
        (d.visible === undefined || d.visible()),
    );
  });
}

// ── Server-side drivers (#362) ──────────────────────────────────────────────
//
// A driver may live in a process next to the printer rather than in this tab:
// an external plugin container with a radio of its own, which is the answer for
// an iPhone (no Web Bluetooth anywhere on iOS) and for one printer shared by
// several people. The core enumerates them; this turns each into an ordinary
// entry of the same registry, so a consumer still asks one question and gets
// one list.
//
// `isSupported` is true by construction: the hardware is the server's, so the
// browser's own capabilities have nothing to do with it. There is no handoff
// either — a link exists to reach a printer this browser cannot, and this one
// it can.
function remoteDriver(descriptor: PrintDriverDescriptor): FrontendPrintDriver {
  return {
    // A server-side driver reaches the printer from the instance, not from
    // this tab — which is the whole reason it works on an iPhone. It says so
    // unless its own plugin said something more specific.
    descriptor: {
      ...descriptor,
      // `??`, not a spread order: a descriptor that carries the key as an
      // explicit `undefined` would erase the default by spreading over it.
      routeKey: descriptor.routeKey ?? 'core.printing.route.server',
    },
    isSupported: () => true,
    print: async (raster, options, onProgress) => {
      // One report, and deliberately COUNTLESS: the relay is a single request
      // that returns when the label is out, so there are no rows to follow.
      // `rowsTotal: 0` is the contract's way of saying "printing, and I cannot
      // count" — a consumer then shows a plain "printing…" instead of a bar
      // frozen at 0 of 240, which is what a fabricated total would produce.
      // Row-level progress from a remote driver needs a push channel the
      // contract does not have (see #362's follow-up).
      onProgress?.({ stage: 'printing', rowsDone: 0, rowsTotal: 0 });
      try {
        return await apiJson<PrintResult>('/api/printing/print', {
          method: 'POST',
          body: {
            driverId: descriptor.id,
            ...encodeRasterPayload(raster, options.copies ?? 1),
          },
        });
      } catch {
        return { ok: false, errorKey: 'core.printing.errors.unknownDriver' };
      }
    },
  };
}

// Ids of the remote drivers currently in the registry, so a refresh withdraws
// the ones that have gone (a container uninstalled, its plugin disabled)
// instead of leaving a button that prints nowhere.
const remoteIds = new Set<string>();

// Asks the instance what it can print on, and registers the answers. Called
// when a print surface opens rather than at boot: a session that never prints
// should not pay a request, and a container that was plugged in five minutes
// ago should still appear without a reload.
export async function refreshRemotePrintDrivers(): Promise<void> {
  let descriptors: PrintDriverDescriptor[] = [];
  try {
    descriptors = await apiJson<PrintDriverDescriptor[]>(
      '/api/printing/drivers',
    );
  } catch {
    // No answer means no remote printers to offer; whatever this browser can
    // do itself is unaffected.
    return;
  }
  const seen = new Set<string>();
  for (const descriptor of descriptors) {
    seen.add(descriptor.id);
    registerPrintDriver(remoteDriver(descriptor));
  }
  for (const id of remoteIds) {
    if (!seen.has(id)) unregisterPrintDriver(id);
  }
  remoteIds.clear();
  for (const id of seen) remoteIds.add(id);
}
