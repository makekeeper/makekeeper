# A Home Assistant that is not one

A dependency-free `node:http` stub of the slice of Home Assistant's REST API the
`homeassistant` plugin speaks (#364), plus the `niimbot.print` and
`niimbot.refresh_info` actions of
[hass-niimbot](https://github.com/eigger/hass-niimbot).

It exists because the alternative is testing a print path against somebody's
house. Every rendered label is written to disk, so the page that went through
can be compared with the dialog's own preview by eye — the one check no unit
test performs.

```bash
node tools/ha-stub/ha-stub.mjs                 # http://localhost:8123, token "devtoken"
node tools/ha-stub/ha-stub.mjs --fail 401      # a token the instance rejects
node tools/ha-stub/ha-stub.mjs --fail 400      # Home Assistant without hass-niimbot
node tools/ha-stub/ha-stub.mjs --fail nodevices # an instance whose device registry cannot be read
node tools/ha-stub/ha-stub.mjs --fail hang     # never answers, for the timeout branch
```

Then point **Settings → Home Assistant** at `http://localhost:8123` with the
token `devtoken`, and **Settings → Niimbot printer → Through Home Assistant**
at the printer it offers.

The failure flags are the point: a stub that answers 200 to everything proves
only that a request was made. This one refuses what Home Assistant refuses, so
every branch of the error taxonomy is reachable from the real screen.

## The same checks by hand

```bash
HA=http://localhost:8123; T=devtoken
curl -s -H "Authorization: Bearer $T" "$HA/api/"            # {"message":"API running."}
curl -s -H "Authorization: Bearer $T" "$HA/api/config" | jq '.version, (.components|index("niimbot"))'
curl -s -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"template":"{{ integration_entities(\"niimbot\") | list | tojson }}"}' "$HA/api/template"
# the printers themselves, which is what the picker lists:
curl -s -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"template":"{% set ns = namespace(rows=[]) %}{% for e in integration_entities(\"niimbot\") %}{% set d = device_id(e) %}{% if d and d not in (ns.rows | map(attribute=\"id\") | list) %}{% set ns.rows = ns.rows + [{\"id\": d, \"name\": device_attr(d, \"name_by_user\") or device_attr(d, \"name\")}] %}{% endif %}{% endfor %}{{ ns.rows | tojson }}"}' "$HA/api/template"
# a page, rendered and not printed (the answer carries the PNG):
curl -s -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"device_id":"dev-b1","preview":true,"width":320,"height":240,"density":3,"label_type":1,
       "payload":[{"type":"dlimg","x":0,"y":0,"xsize":320,"ysize":240,"mode":"stretch",
                   "url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}]}' \
  "$HA/api/services/niimbot/print?return_response"
```

Against a real Home Assistant the same commands work with its address and a
long-lived access token (profile → Security → Long-lived access tokens).
