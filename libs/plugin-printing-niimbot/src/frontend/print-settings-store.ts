import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { apiFetch } from '@makekeeper/frontend-core';
import { isRecord, readLocal, writeLocal } from './browser-storage';
import {
  clampDensity,
  DENSITY_DEFAULT,
  isNiimbotLabelType,
  type NiimbotLabelType,
} from '../label-stock';
import {
  carryOverPatch,
  type NiimbotPrintSettings,
  type NiimbotPrintSettingsPatch,
} from '../print-contract';

// How the printer prints, as this browser knows it (#366).
//
// The values themselves are the INSTANCE's — the burn density and the roll in
// the machine describe the printer, not whoever sent the job — so this store
// is a reader, not an owner. It keeps the last answer in `localStorage` for one
// reason: a print must not fail because the settings request did. A browser
// that has never reached the API prints at the printer's own defaults, which is
// what it did before these were settings at all.
//
// The cache is also what the one-time carry-over reads: an instance that never
// saved print settings takes the values this browser remembered from when they
// lived here.

const DENSITY_KEY = 'printingNiimbot.density';
const LABEL_TYPE_KEY = 'printingNiimbot.labelType';

function cachedDensity(): number {
  const raw = Number(readLocal(DENSITY_KEY));
  return Number.isFinite(raw) && raw > 0 ? clampDensity(raw) : DENSITY_DEFAULT;
}

function cachedLabelType(): NiimbotLabelType {
  const raw = readLocal(LABEL_TYPE_KEY);
  return isNiimbotLabelType(raw) ? raw : 'withGaps';
}

export const useNiimbotPrintSettingsStore = defineStore(
  'printingNiimbotPrint',
  () => {
    const density = ref<number>(cachedDensity());
    const labelType = ref<NiimbotLabelType>(cachedLabelType());
    // Whether the instance has ever saved any. Null until asked.
    const configured = ref<boolean | null>(null);
    const loading = ref(false);

    // Reads the instance's settings and caches them. Never throws: a driver
    // calls this on its way to the printer, and an unreachable API is a reason
    // to print with what we have, not a reason not to print.
    async function refresh(): Promise<void> {
      loading.value = true;
      try {
        // `public: true` because the handoff page (#361) reads this with no
        // session at all; an authenticated caller is unaffected.
        const res = await apiFetch('/api/printing-niimbot/print-settings', {
          public: true,
        });
        if (!res.ok) return;
        const body: unknown = await res.json();
        if (!isRecord(body)) return;
        // An unconfigured instance answers with the printer's own defaults,
        // which are not an answer worth caching — and caching them would
        // overwrite the very values the carry-over exists to rescue.
        const saved = body['configured'] === true;
        configured.value = saved;
        if (typeof body['density'] === 'number') {
          density.value = clampDensity(body['density']);
          if (saved) writeLocal(DENSITY_KEY, String(density.value));
        }
        if (isNiimbotLabelType(body['labelType'])) {
          labelType.value = body['labelType'];
          if (saved) writeLocal(LABEL_TYPE_KEY, labelType.value);
        }
      } catch {
        // Keep the cached values; the caller is on its way to a printer.
      } finally {
        loading.value = false;
      }
    }

    // Saves them — admin only on the server, and the screen only offers it to
    // an admin.
    async function save(patch: NiimbotPrintSettingsPatch): Promise<boolean> {
      try {
        const res = await apiFetch('/api/printing-niimbot/print-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) return false;
        const body: unknown = await res.json();
        if (isRecord(body)) {
          if (typeof body['density'] === 'number') {
            density.value = clampDensity(body['density']);
            writeLocal(DENSITY_KEY, String(density.value));
          }
          if (isNiimbotLabelType(body['labelType'])) {
            labelType.value = body['labelType'];
            writeLocal(LABEL_TYPE_KEY, labelType.value);
          }
          configured.value = true;
        }
        return true;
      } catch {
        return false;
      }
    }

    // What this browser remembered from before these were instance settings.
    // Absent means it never had any of its own.
    const remembered = computed<NiimbotPrintSettingsPatch | null>(() => {
      const storedDensity = readLocal(DENSITY_KEY);
      const storedType = readLocal(LABEL_TYPE_KEY);
      if (storedDensity === null && storedType === null) return null;
      return { density: cachedDensity(), labelType: cachedLabelType() };
    });

    // The one-time carry-over, here rather than in a screen's `onMounted`: it
    // is a data migration, and its ordering constraint is the whole of it —
    // what this browser remembers has to be READ BEFORE the refresh, because a
    // refresh is what overwrites the cache it is read from. A comment in a
    // component cannot hold that; a method can.
    //
    // Returns true when something was carried over, so the caller can say so.
    async function carryOverIfUnconfigured(): Promise<boolean> {
      const mine = remembered.value;
      await refresh();
      const patch = carryOverPatch(mine, configured.value);
      return patch === null ? false : save(patch);
    }

    return {
      density,
      labelType,
      configured,
      loading,
      remembered,
      refresh,
      carryOverIfUnconfigured,
      save,
    };
  },
);
