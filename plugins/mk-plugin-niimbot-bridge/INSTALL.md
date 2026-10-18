# Installing mk-plugin-niimbot-bridge

Published image: **`ghcr.io/makekeeper/mk-plugin-niimbot-bridge`** (built by the
release CI, its own version line). Container facts: listens on `4420`, state in
`/data`, env `MK_CORE_URL` / `MK_PLUGIN_URL` / optional `MK_INSTALL_TOKEN`.

**Where it runs is the whole point.** Unlike every other plugin, this one needs
the host's **Bluetooth adapter**, so it belongs on the box standing next to the
printer — a Raspberry Pi, a mini-PC, the Home Assistant host. That may or may
not be the box MakeKeeper runs on. It is also why it asks for more than the
others: `network_mode: host`, `NET_ADMIN`/`NET_RAW`, and the host D-Bus socket.

1. **Compose fragment** (the usual path, because the bridge normally lives on
   its own box): paste [`compose.fragment.yml`](./compose.fragment.yml) into a
   stack on that machine and set the two addresses:

   ```yaml
   MK_CORE_URL: https://makekeeper.example # the instance, as this box sees it
   MK_PLUGIN_URL: http://192.168.1.50:4420 # this box, as the instance sees it
   ```

2. **Same box as MakeKeeper** (an all-in-one home server): keep
   `network_mode: host` and point both addresses at `localhost` — the bridge
   cannot join the app's bridge network and still see the radio.

3. **install.sh**, on the docker host next to the printer — the extras this
   plugin needs are passed through explicitly, because the script never chooses
   host networking for you:

   ```bash
   ./plugins/install.sh niimbot-bridge --network host \
     -- --cap-add NET_ADMIN --cap-add NET_RAW -v /var/run/dbus:/var/run/dbus
   ```

4. **Plain docker run**:

   ```bash
   docker run -d --name niimbot-bridge \
     --network host --cap-add NET_ADMIN --cap-add NET_RAW \
     -v /var/run/dbus:/var/run/dbus \
     -v niimbot-bridge-data:/data \
     -e MK_CORE_URL=http://localhost:3000 \
     -e MK_PLUGIN_URL=http://localhost:4420 \
     --restart unless-stopped \
     ghcr.io/makekeeper/mk-plugin-niimbot-bridge:latest
   ```

5. **From source** (development):
   `./examples/run-plugin.sh plugins/mk-plugin-niimbot-bridge`, or
   `docker build -f plugins/mk-plugin-niimbot-bridge/Dockerfile -t mk-plugin-niimbot-bridge .`
   (repo-root context).

Then pair it in **Settings → External plugins** (the code is in
`docker logs niimbot-bridge` unless an install token was provided) and approve
its empty permission set — it needs none of the instance's data to print a page
somebody else rendered.

Finally open its settings screen: scan, pick the printer, set density and label
stock, print the test label. From then on every print dialog in the app offers
**“Print on Workshop label printer”**, from any browser on any device.

Troubleshooting:

- **The scan finds nothing.** The printer is off, out of range, or the Niimbot
  phone app is connected to it — a live app link blocks everything else.
- **`No adapter found` in the log.** The container is not on the host network,
  or `/var/run/dbus` is not mounted; both are required for Bluetooth.
- **The core says the printer is unreachable.** `MK_PLUGIN_URL` must be the
  address the _instance_ can call back on, not `localhost`, when the two are on
  different machines.
