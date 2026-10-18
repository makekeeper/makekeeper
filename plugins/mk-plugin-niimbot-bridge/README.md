# mk-plugin-niimbot-bridge — BLE print bridge

Owns a **Niimbot label printer** over Bluetooth and prints on behalf of any
device that can reach MakeKeeper — an iPhone included.

Why it exists: the in-browser driver (`printing-niimbot`, #359) talks to the
printer through Web Bluetooth, which only Chromium has. Safari has none, and on
iOS _every_ browser is WebKit, so no iPhone can ever print directly. A process
standing next to the printer can, and then the browser only submits a page.

It also turns one printer into a shared one: several people print through the
same link, in order, instead of fighting over a Bluetooth pairing.

## How it fits together

```
label dialog (any browser) → core → printing.driver.niimbot-bridge → this container → printer
```

The container declares `printDriver` in its manifest; the core registers it as
a print driver and `plugin-codes` offers **“Print on Workshop label printer”**
beside whatever the browser itself can do. Nothing in `codes` knows this
plugin exists.

What travels is a **raster** — a page size in dots and packed 1-bpp rows, per
the `printing` contract — so the bridge never learns what the label depicts.

## Where to run it

On the box **next to the printer**: a Raspberry Pi, a mini-PC, the Home
Assistant host. It needs that box's Bluetooth adapter (`network_mode: host` and
the host D-Bus socket — see `compose.fragment.yml`), which is exactly why this
is a separate container and not part of the core: the app image stays free of
native Bluetooth stacks.

MakeKeeper and the bridge must be able to reach each other both ways
(`MK_CORE_URL` ← the instance, `MK_PLUGIN_URL` → this host as the core sees it).

## Setting it up

1. Start the container with an install token (Settings → External plugins →
   _Generate install token_), or pair with the code it prints to its log.
2. Open its settings screen, press **Scan for printers**, pick the one that
   answers. Turn the printer on first, keep it close, and make sure the Niimbot
   phone app is **not** connected — a live app link blocks GATT entirely.
3. Set the density and the label stock loaded in the machine, then press
   **Print a test label**: it prints a frame with a diagonal, which proves the
   paper, the density and the link in one go.

## Hardware notes

Verified on a **Niimbot B1** (#359): 384-dot printhead at 203 dpi, density
1–5, gap / black-mark / transparent stock. The protocol is
[niimbluelib](https://github.com/MultiMote/niimblue) (MIT, (c) 2024 MultiMote)
— the `-node` build, which reaches the radio through noble. Other Niimbot
models use the same client and a different print task; adding one means
verifying it on paper, because the device acknowledges sequences it then fails
to print.

## Development

```bash
./examples/run-plugin.sh plugins/mk-plugin-niimbot-bridge   # build & run from source
npm test                                                    # payload parsing + queue order
```

The tests cover the parts that have branches and no radio: what counts as a
printable page, and that two clients printing at once get two labels in order.
The Bluetooth half is verified on hardware, not mocked — an acknowledgement
from a thermal printer proves nothing; only paper does.
