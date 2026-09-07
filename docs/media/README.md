# Media for the README

The pictures a stranger meets first. Kept here, in the repository, so the README
renders the same everywhere it is mirrored — never under `uploads/`, which is
user data.

| File | What it shows |
|---|---|
| `phone-capture.gif` | The phone flow, end to end: pair the phone, photograph a part, name it, and it is in the inventory on the desktop. |
| `dashboard-*.png` | The dashboard: what can be built right now, what is blocking, the task queue, the assistant answering with a tool call. |
| `inventory-*.png` | The inventory list — categories, storage location, quantities, low stock. |
| `storage-*.png` | A storage cell opened: what is in it, where it sits in the grid. |
| `shopping-list-*.png` | The shopping list derived from what the running projects are short of, beside the parcels already on their way. |
| `calendar-*.png` | The calendar: deliveries due, task dates and reminders, drawn from what the plugins already hold. |
| `project-detail-*.png` | One project: tasks, reserved parts, budget, activity. |

Every screen ships in both themes (`-light` / `-dark`); the README pairs them in
a `<picture>` so the shot follows the reader's system theme.

## Rules

- **Only the demo workshop may appear in them.** These pictures are public: shoot
  them on an instance that holds the seeded demo dataset (#339) and nothing else.
- **Downscaled for a README** (1280 px wide, palette PNG ≈ 90 KB each). The repo
  is mirrored on every release, so weight is a real cost — keep the whole
  directory around 1 MB.
- **Re-shoot after a screen changes.** A picture that shows a UI the product no
  longer has is worse than no picture.

## How they were made

Screenshots: a real browser against a real instance, 2× and downscaled. The
shopping-list and calendar shots were taken on an instance holding nothing but
the seeded demo workshop (#339); the rest come from the landing-page shoot,
which is why their sidebars carry a plugin or two more.

The GIF: two browser contexts side by side — a desktop viewport and a phone one,
photographed at the same moments — with Chromium's fake camera device filming a
photograph of a real part, so the phone genuinely goes through the app's own
camera path. Frames composed and encoded with `sharp` (no ffmpeg in the image).
