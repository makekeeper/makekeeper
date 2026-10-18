// Operator-facing text, as i18n keys resolved by the core (§5.11: strings that
// travel through the contract carry keys; log lines are plain English).
export const en = {
  name: 'Label printer bridge',
  description:
    'Owns a Niimbot label printer over Bluetooth and prints on behalf of any device — an iPhone included.',
  printer: 'Workshop label printer',

  settingsTitle: 'Label printer bridge',
  intro:
    'This container holds the Bluetooth link to the printer, so anything that can reach MakeKeeper can print — including browsers with no Bluetooth of their own.',

  statePrinter: 'Printer',
  stateNone: 'None chosen yet',
  stateDensity: 'Density',
  stateLabelType: 'Label stock',
  stateQueue: 'Jobs waiting',

  transportLocal: 'The Bluetooth adapter of this box',
  scanSection: 'Find the printer',
  scanHint:
    'Turn the printer on, keep it close, and make sure the Niimbot phone app is not connected to it — a live app link blocks everything else.',
  scan: 'Scan for printers',
  scanning: 'Scanning…',
  scanEmpty: 'No printer answered. Check it is on and in range.',
  scanFound: 'Found {count} device(s).',
  choose: 'Use this one',
  chosen: 'Printer saved: {name}',

  settingsSection: 'Printing',
  fieldAddress: 'Printer address',
  fieldAddressHint:
    'The Bluetooth address or name the bridge connects to. Filled in by the scan above.',
  fieldDensity: 'Density',
  density1: '1',
  density2: '2',
  density3: '3',
  density4: '4',
  density5: '5',
  fieldDensityHint: '1 is the lightest, 5 the darkest.',
  fieldLabelType: 'Label stock',
  labelTypeWithGaps: 'Gap labels',
  labelTypeBlack: 'Black-mark labels',
  labelTypeTransparent: 'Transparent labels',
  save: 'Save',
  saved: 'Saved.',

  checkSection: 'Check the connection',
  check: 'Print a test label',
  checkHint:
    'Prints a small frame so you can confirm the paper, the density and the link before anyone prints a real label.',
  checkOk: 'The printer answered and printed.',

  errNoPrinter: 'No printer is configured for the bridge yet.',
  errConnect:
    'Could not reach the printer. Check it is on, in range, and not connected to the Niimbot phone app.',
  errPrint: 'The printer refused the label.',
  errBusy:
    'The printer is working through the queue; the job was not accepted.',
  errRaster: 'The page handed to the bridge was not a valid label.',
};
