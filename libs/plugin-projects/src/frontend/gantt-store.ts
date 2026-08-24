import { defineStore } from 'pinia';
import { ref } from 'vue';
import { isGanttScale, type GanttScale } from './gantt';

// The timeline's remembered zoom level (#294).
//
// Only the LENGTH of the window is kept, never its position: an absolute window
// stored in July greets the viewer with empty canvas in October, whereas a
// length re-centred on today always frames something. Deliberately the plugin's
// own store rather than `frontend-core`'s `preferences-store` — that one is the
// app shell's (theme, sidebar, chat width), and a projects-only preference in it
// would be a plugin leaking into the core (§5.10).
const SCALE_KEY = 'projects.gantt.scale';

function readStoredScale(): GanttScale {
  try {
    const stored = localStorage.getItem(SCALE_KEY);
    // A value written by an older build (or by hand) is not a crash — fall back
    // to fitting the data, which is always a valid answer.
    return stored !== null && isGanttScale(stored) ? stored : 'all';
  } catch {
    // Private-mode browsers throw on localStorage access; the timeline still works.
    return 'all';
  }
}

export const useGanttStore = defineStore('projects-gantt', () => {
  // Read at store setup, not in `onMounted`: the first paint must already use
  // the stored scale, or the canvas visibly re-zooms in front of the viewer.
  const scale = ref<GanttScale>(readStoredScale());

  const setScale = (next: GanttScale): void => {
    scale.value = next;
    try {
      localStorage.setItem(SCALE_KEY, next);
    } catch {
      // Nothing to recover: the scale still holds for this session.
    }
  };

  return { scale, setScale };
});
