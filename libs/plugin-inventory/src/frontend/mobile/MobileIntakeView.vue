<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import {
  BusyOverlay,
  Button,
  Select,
  Switch,
  apiJson,
  apiErrorMessage,
  fieldNumber,
  useCameraScanner,
  useConfirm,
  useOfflineQueue,
  usePluginsStore,
  useToastStore,
  useMobileScreenChrome,
  usePinchZoom,
  previewUrl,
} from '@makekeeper/frontend-core';
import { useI18n } from 'vue-i18n';
import {
  Camera,
  Sparkles,
  PencilLine,
  PackagePlus,
  Layers,
  ZoomIn,
  Check,
  X,
} from '@lucide/vue';
import { parseObjectRef, resolveEntityId } from '@makekeeper/plugin-contract';
import {
  DESCRIPTION_MAX,
  type IntakeCandidate,
  type RecognizedItemDraft,
} from '../../mobile-intake';
import { MAX_ITEM_PHOTOS, fittingPhotoCount } from '../../photos';
import { useDraftCategories } from './draft-categories';
import { useRecognitionAvailability } from './recognition-availability';
import { isBackNavigation, readHistoryPosition } from './phase-history';
import PropertyFields from './PropertyFields.vue';

// Stocking the inventory from a phone (#200).
//
// The order of attempts is the whole design. The camera reads a barcode locally
// — free, instant and exact — and an SKU hit answers "which part is this"
// outright: the item already exists, so this is a receipt, not a second card
// for the same resistor. Only a part with no readable code reaches the model,
// and even then the model fills a FORM: a human presses save, so the write is an
// ordinary POST with no autonomous tool call anywhere in the path.

interface StorageOption {
  id: string;
  name: string;
}

interface ExistingComponent {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
}

type Phase = 'camera' | 'form' | 'receive';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const toast = useToastStore();
const confirm = useConfirm();
const plugins = usePluginsStore();
const queue = useOfflineQueue();

// The phase lives in the URL, not in a ref (§5.3).
//
// It looks like component state and behaves like navigation: pressing Recognize
// puts a different screen in front of the person, and the phone's back gesture
// is what they reach for to leave it. As a ref there was no history entry to
// pop, so the gesture left the intake screen ALTOGETHER and landed wherever they
// had been before the tab — Stock, most often, which is how this was reported.
//
// The query, not a child route: these faces share the collected frames, the
// uploaded urls and the candidate list, and a route change remounts the
// component that holds them. A query change keeps the same component and still
// writes history.
const PHASE_PARAM = 'phase';
const phase = computed<Phase>(() => {
  const value = route.query[PHASE_PARAM];
  if (value === 'form') return 'form';
  if (value === 'receive') return 'receive';
  return 'camera';
});

// Whether the entry currently on screen is one WE pushed, and where it sits in
// the stack. Both are bookkeeping for leaving the face correctly — the part that
// has now been got wrong twice.
let pushedPhase = false;
let phasePosition: number | null = null;

const currentPosition = (): number | null =>
  readHistoryPosition(router.options.history.state);

const goToPhase = async (next: Exclude<Phase, 'camera'>): Promise<void> => {
  await router.push({ query: { ...route.query, [PHASE_PARAM]: next } });
  pushedPhase = true;
  phasePosition = currentPosition();
};

// A form face may only be left backwards to its OWN camera.
//
// The back gesture pops, and it has twice been observed popping past the camera
// entirely — landing on whatever preceded the intake tab (Stock once, Home the
// next time). Rather than keep guessing at the stack, the screen states the rule
// it actually wants: going back from a form means going back to the camera, and
// nothing further. A deliberate departure — tapping another tab — is left alone,
// because that is a person choosing to be elsewhere, not a gesture overshooting.
onBeforeRouteLeave((to) => {
  if (phase.value === 'camera') return true;
  const toCamera =
    to.path === route.path && to.query[PHASE_PARAM] === undefined;
  if (toCamera) return true;
  if (!isBackNavigation(phasePosition, currentPosition())) return true;
  // `replace`, not push: the entry being landed on is the overshoot itself, so
  // the camera takes its place rather than piling on top of it.
  return { path: route.path, replace: true };
});

// Leaving POPS the entry the face pushed. It used to replace it with the camera
// — and the camera was already the entry right behind it, so the stack ended up
// holding two identical adjacent entries. The first back press then moved
// through history without changing anything visible, so it read as dead, and the
// second one carried the person two screens away: "I swiped out of the form and
// landed in Stock".
//
// Popping also makes the arrow and the gesture the same act, which is the only
// way they can be relied on to agree.
//
// Nothing of ours to pop — a reloaded or shared `?phase=` — falls back to a
// replace, because there the entry belongs to the browser, not to us.
const leavePhase = async (): Promise<void> => {
  if (pushedPhase) {
    pushedPhase = false;
    phasePosition = null;
    router.back();
    return;
  }
  const query = { ...route.query };
  delete query[PHASE_PARAM];
  await router.replace({ query });
};

// WHAT is in flight, not merely whether something is (§5.1 — a named state
// beats a boolean). One shared `busy` was one spinner too many: five operations
// raised it, and three of the buttons watching it sit on the camera screen at
// once, so pressing Shoot spun the Recognize button beside it as if the model
// were already looking at something.
//
// A button now spins for its OWN work and is merely disabled while somebody
// else's is running — which is the protection the single flag was really there
// for.
type PendingAction = 'scan' | 'shoot' | 'frame' | 'save' | 'receive';
const pending = ref<PendingAction | null>(null);
const busy = computed<boolean>(() => pending.value !== null);
const spinning = (action: PendingAction): boolean => pending.value === action;
const blocked = (action: PendingAction): boolean =>
  pending.value !== null && pending.value !== action;
const recognizing = ref(false);
// Asked once per session, not once per mount: the answer used to land after the
// interface and shove the button row sideways on every entry to the tab.
const { available: recognitionAvailable, ensure: ensureRecognition } =
  useRecognitionAvailability();

// Form state. `storageId` deliberately survives a save: a person works through
// one shelf at a time, and re-picking the same box for every part is the kind of
// friction that makes people stop using the app by item ten.
const name = ref('');
const sku = ref('');
// The category is a relation (#205), and the model now CHOOSES one from the
// tree rather than naming a group (#206) — the phone is not where a new
// vocabulary entry gets minted.
const categoryId = ref('');
const categories = useDraftCategories();
// What the model made of the photo, and the values it read back out of that
// description (#206). Both are editable here: they are guesses, and the person
// holding the part is the one who knows.
const description = ref('');
const propertyValues = ref<Record<string, string>>({});
const properties = computed(() => categories.of(categoryId.value || null));

// Picking a different category drops values keyed to the old one's properties.
const onCategoryChange = async (next: string): Promise<void> => {
  categoryId.value = next;
  propertyValues.value = {};
  await categories.ensure(next || null);
};

const quantity = ref(1);
const unit = ref('');
const storageId = ref('');
const storageRow = ref<number | null>(null);
const storageCol = ref<number | null>(null);
// Every frame that will become a photograph of the item being saved (#217),
// stored "/api/uploads/:id" URLs in order; the first is the cover.
const photos = ref<string[]>([]);
const candidates = ref<IntakeCandidate[]>([]);
// The frame handed to the model, held only while it is being looked at: it
// stands in for the preview once the camera is switched off.
const pendingFrame = ref<string | null>(null);

// Receipt state: an existing component the scan or a candidate resolved to.
const existing = ref<ExistingComponent | null>(null);
const receiveQty = ref(1);

const storages = ref<StorageOption[]>([]);
const storagesEnabled = computed(() => plugins.isEnabled('storages'));
// Deciding whether a scanned string is OURS belongs to the codes plugin, which
// owns that grammar. Gated, never imported (§5.10): with codes disabled we fall
// back to the one question inventory can answer by itself — do we know this SKU.
const codesEnabled = computed(() => plugins.isEnabled('codes'));

// A code we scanned and do not recognize. Held, not acted on: a factory QR on a
// packet is usually a marketing URL, and opening a half-filled form for it — the
// old behaviour — put junk on the shelf. The person can still say "this is the
// article number" deliberately.
const unknownCode = ref<string | null>(null);
const unknownCodeIsForeign = computed<boolean>(
  () =>
    unknownCode.value !== null &&
    parseObjectRef(unknownCode.value) === null &&
    !unknownCode.value.includes('/c/'),
);
const storageOptions = computed(() => [
  { value: '', label: t('inventory.mobile.noStorage'), empty: true },
  ...storages.value.map((s) => ({ value: s.id, label: s.name })),
]);

// Every code this camera session has already decided about. Cleared when the
// screen goes back to the camera for a fresh part.
const judgedCodes = new Set<string>();

const {
  videoRef,
  active: cameraActive,
  failed: cameraFailed,
  start: startCamera,
  stop: stopCamera,
  capture: captureFrame,
  zoomRange,
  zoom,
  setZoom,
  videoStyle,
} = useCameraScanner((value) => {
  // The camera fires for as long as a code stays in view. A code we have already
  // judged is never judged twice — the packet is still in front of the lens, and
  // re-asking the server about it several times a second is what made the screen
  // loop.
  // Also while recognition runs: the overlay stops fingers, but a decoded
  // barcode arrives on its own and would move the screen out from under it.
  if (phase.value !== 'camera' || busy.value || recognizing.value) return;
  if (judgedCodes.has(value)) return;
  void onScanned(value);
});

const resetForm = (): void => {
  name.value = '';
  sku.value = '';
  categoryId.value = '';
  description.value = '';
  propertyValues.value = {};
  quantity.value = 1;
  unit.value = '';
  storageRow.value = null;
  storageCol.value = null;
  photos.value = [];
  candidates.value = [];
};

// Back to the camera. ASK for it — the cleanup below hangs off the phase
// actually changing, not off this call, because the other way out of a form is
// the swipe gesture, which goes through no handler of ours at all. Hanging the
// cleanup on a click handler is why every gesture out of the form used to leave
// its uploaded frames on disk as orphans.
const backToCamera = (): Promise<void> => leavePhase();

// What returning to the camera means, however it was asked for.
const onLeftForm = async (): Promise<void> => {
  unknownCode.value = null;
  // A fresh part deserves a fresh judgement, including of a code we ignored.
  judgedCodes.clear();
  existing.value = null;
  // Anything still parentless is litter: the person reached the form or the
  // receive screen and backed out, so no record ever adopted these frames.
  // `discardFrames` deletes only what belongs to nothing, so a frame the save
  // just claimed is refused by the server and survives — which is why this can
  // run unconditionally rather than trying to guess how the screen was left.
  const orphans = [...collected.value, ...photos.value];
  if (orphans.length > 0) void discardFrames(orphans);
  clearCollected();
  resetForm();
  await startCamera();
};

watch(phase, (next, previous) => {
  if (next === 'camera' && previous !== 'camera') {
    // However the face was left — the arrow, the back gesture, a tab tap — the
    // entry it pushed is behind us now.
    pushedPhase = false;
    phasePosition = null;
    void onLeftForm();
  }
});

onMounted(async () => {
  // A reloaded (or shared) `?phase=form` names state that died with the last
  // page: nothing collected, nothing typed, no photographs. Drop the phase and
  // open on the camera rather than on an empty form claiming to be a part.
  // The watcher above brings the camera up on that path, so it is not started
  // twice.
  if (phase.value === 'camera') await startCamera();
  else await leavePhase();
  await ensureRecognition();
  if (storagesEnabled.value) {
    try {
      storages.value = await apiJson<StorageOption[]>('/api/storages');
    } catch {
      // The placement picker just stays empty.
    }
  }
  // Same as above: a failure leaves the picker offering only "no category".
  await categories.load();
});

// A decoded barcode.
//
// Only a code we KNOW opens anything. Ours (a printed label, an ORef) resolves
// through the codes plugin; a foreign barcode counts as known exactly when it is
// already somebody's SKU, in which case this is a receipt. Anything else — the
// manufacturer's QR pointing at their website, which is most factory packaging —
// is shown and left alone, because auto-opening a form with a URL in the SKU
// field is how a shelf fills with junk.
const onScanned = async (value: string): Promise<void> => {
  pending.value = 'scan';
  judgedCodes.add(value);
  try {
    const componentId = await resolveKnownComponent(value);
    if (!componentId) {
      // Not ours. Say so and CHANGE NOTHING ELSE: the camera keeps running, the
      // screen stays where it is, and the person carries on — most factory
      // packaging carries a marketing QR, and reacting to it would interrupt
      // exactly the work they are doing.
      unknownCode.value = value;
      return;
    }
    // A code we know is worth acting on, and only then does the camera stop.
    stopCamera();
    const found = await apiJson<ExistingComponent>(
      `/api/components/${componentId}`,
    );
    existing.value = found;
    receiveQty.value = quantity.value > 0 ? quantity.value : 1;
    await prepareReceivePhotos(componentId);
    await goToPhase('receive');
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.lookupError')));
  } finally {
    pending.value = null;
  }
};

// The component this code names, or null when we do not know the code at all.
const resolveKnownComponent = async (value: string): Promise<string | null> => {
  if (codesEnabled.value) {
    try {
      const { ref } = await apiJson<{ ref: string | null }>(
        '/api/codes/scan/resolve',
        { method: 'POST', body: { value } },
      );
      // Another plugin's object (a storage cell label, say) is not something
      // this screen acts on — it is not an item to receive, so it counts as a
      // code we cannot use here.
      const component = ref
        ? resolveEntityId(ref, {
            pluginId: 'inventory',
            entityType: 'component',
          })
        : null;
      if (component) return component.id;
      if (ref) return null;
    } catch {
      // Fall through to the SKU question we can answer ourselves.
    }
  }
  const matches = await apiJson<ExistingComponent[]>(
    `/api/components/by-sku?sku=${encodeURIComponent(value)}`,
  );
  return matches[0]?.id ?? null;
};

// The deliberate half: the person decides this foreign code IS the article
// number, and gets the create form with it filled in.
const useUnknownCodeAsSku = (): void => {
  const code = unknownCode.value;
  if (!code) return;
  unknownCode.value = null;
  resetForm();
  sku.value = code;
  stopCamera();
  void goToPhase('form');
};

// Pinch the preview to zoom the CAMERA. The shell took pinch away from the page
// on purpose, and this is the one place where the gesture means something — a
// shelf label two metres from the lens. It drives the same `setZoom` the slider
// does, so hardware zoom is used where the phone has it and the digital crop
// stands in where it does not.
const pinch = usePinchZoom({
  bounds: () => zoomRange.value,
  current: () => zoom.value,
  apply: setZoom,
});

// The conveyor (#201, #216): shoot, keep the camera live, move to the next
// shelf position. Recognition is asked for later, per draft, on the batch
// screen — a run is dozens of photographs and most of those parts a person names
// faster than a model does.
//
// A shot is no longer an item. Frames pile up into the CURRENT item, glued by a
// key this phone mints: the server appends to the draft holding it, or creates
// it. That is what makes several angles work offline — a queued frame cannot
// learn a server id, and a client-side key needs no answer.
const shot = ref(0);
const currentDraftId = ref<string | null>(null);
// The current item's frames, from the data URLs THIS phone captured. Reading
// them back from the server would leave the strip empty exactly when it matters
// — offline, mid-shelf, with three frames still in the queue.
//
// Each one remembers the OPERATION that carried it out, which is the only
// handle the phone has on a photograph it may never have sent: dropping a frame
// names that key, and the server deletes the attachment stamped with it. A url
// would not do — a frame still sitting in the queue has none.
interface ShotFrame {
  preview: string;
  opId: string;
}
const currentFrames = ref<ShotFrame[]>([]);
const framesFull = computed(
  () => currentFrames.value.length >= MAX_ITEM_PHOTOS,
);

// "Done — next item": purely local, nothing is sent. Walking away, reloading the
// PWA or closing the tab leaves a perfectly valid draft with the frames it got.
const startNextItem = (): void => {
  currentDraftId.value = null;
  currentFrames.value = [];
};

// Drop one shot of the item being built.
//
// Through the QUEUE, like the shot itself: the person dropping a blurred angle
// is standing exactly where the signal was too poor to send it, and a drop that
// needed the network would be the one action on this screen that did. Ordered
// behind its own shot, so offline the pair settles on the server in that order.
//
// The frame is named by the OPERATION that uploaded it, and the draft by the key
// this phone minted — neither needs an answer from the server, which is the
// whole point when there is no server to answer.
//
// The draft SURVIVES its last frame, here as in the batch: one rule for both
// screens, and the next shot simply refills it. Deleting a draft is its own
// deliberate act, not a side effect of regretting a photograph.
const dropShot = async (index: number): Promise<void> => {
  const draftKey = currentDraftId.value;
  const frame = currentFrames.value[index];
  if (!draftKey || !frame) return;
  currentFrames.value.splice(index, 1);
  try {
    await queue.submit({
      label: t('inventory.mobile.queuedDrop'),
      path: `/api/components/intake/drafts/${draftKey}/photos/discard`,
      method: 'POST',
      body: { clientOpIds: [frame.opId] },
    });
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  }
};

const shoot = async (): Promise<void> => {
  if (recognizing.value || framesFull.value) return;
  const frame = captureFrame();
  if (!frame) {
    toast.error(t('inventory.mobile.noFrame'));
    return;
  }

  const draftKey = currentDraftId.value ?? crypto.randomUUID();
  pending.value = 'shoot';
  try {
    // One entry point for a write that must survive a bad connection: it sends
    // now when it can, queues when it cannot, and carries the same idempotency
    // key either way (#202).
    const { id: opId } = await queue.submit({
      label: t('inventory.mobile.queuedShot', { n: shot.value + 1 }),
      path: '/api/components/intake/drafts',
      method: 'POST',
      body: {
        imageDataUrl: frame,
        clientDraftId: draftKey,
        quantity: quantity.value > 0 ? quantity.value : 1,
        ...(storageId.value ? { storageId: storageId.value } : {}),
        ...(storageRow.value !== null ? { storageRow: storageRow.value } : {}),
        ...(storageCol.value !== null ? { storageCol: storageCol.value } : {}),
      },
    });
    // Only after the frame is safely queued or sent: a failed submit must not
    // leave the strip claiming a frame that does not exist.
    currentDraftId.value = draftKey;
    currentFrames.value.push({ preview: frame, opId });
    shot.value += 1;
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  } finally {
    pending.value = null;
  }
};

// ── The single-item scenario (#217) ─────────────────────────────────────────
//
// Deliberately NOT the conveyor. Batch entry and "add this one part now" are
// different jobs with different rhythms, and merging them was considered and
// rejected. So Recognize no longer fires the model: the first press FIXES a
// frame and puts the screen into a collecting mode where more angles can be
// added, and recognition is a second, explicit press.
//
// Each fixed frame is uploaded IMMEDIATELY. A failed recognition — no provider,
// timeout, rate limit, by far the most common failure here — then costs zero
// frames and the button can simply be pressed again.
//
// The mode lives on the camera screen (variant 1 of #217). If it proves cramped
// in real use, the prepared retreat is a dedicated `/m/inventory/recognize`
// route reusing the camera composable — a switch, not a redesign.
const collecting = ref(false);
// Stored "/api/uploads/:id" URLs of the frames fixed so far, in order.
const collected = ref<string[]>([]);
// The local bytes of the same frames, for the filmstrip: a stored URL would
// need a round trip to paint, and these are already in hand.
const collectedPreviews = ref<string[]>([]);
const collectedFull = computed(() => collected.value.length >= MAX_ITEM_PHOTOS);

// What the filmstrip paints: the frames being collected for one item (#217), or
// — outside that mode — the conveyor's shots of the current item (#216). The two
// scenarios never run at once, which is why one strip serves both.
//
// Each entry carries a STABLE key, not its list index: dropping a frame splices
// the array, and an index key would make Vue reuse the wrong <img> for every
// frame after the gap. The key is the stored URL for a collecting frame and the
// carrying operation's id for a shot — both outlive their position.
interface StripFrame {
  key: string;
  src: string;
}

const strip = computed<StripFrame[]>(() =>
  collecting.value
    ? collectedPreviews.value.map((src, index) => ({
        key: collected.value[index] ?? `pending_${index}`,
        src,
      }))
    : currentFrames.value.map((frame) => ({
        key: frame.opId,
        src: frame.preview,
      })),
);

// Dropping a frame off the strip, whichever scenario filled it. Both mean the
// same thing to the person holding the phone — "not that one" — so the button
// is the same button; only the paperwork behind it differs.
const dropStripFrame = (index: number): void => {
  if (collecting.value) void dropFrame(index);
  else void dropShot(index);
};

// Fix one frame: freeze it, upload it, add it to the strip.
const fixFrame = async (): Promise<void> => {
  if (recognizing.value || busy.value || collectedFull.value) return;
  const frame = captureFrame();
  if (!frame) {
    toast.error(t('inventory.mobile.noFrame'));
    return;
  }
  pending.value = 'frame';
  try {
    const { imageUrl: stored } = await apiJson<{ imageUrl: string }>(
      '/api/components/intake/photos',
      { method: 'POST', body: { imageDataUrl: frame } },
    );
    collected.value.push(stored);
    collectedPreviews.value.push(frame);
    collecting.value = true;
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  } finally {
    pending.value = null;
  }
};

// A frame means nothing yet, so dropping one asks nothing.
const dropFrame = async (index: number): Promise<void> => {
  const [url] = collected.value.splice(index, 1);
  collectedPreviews.value.splice(index, 1);
  if (url) void discardFrames([url]);
  if (collected.value.length === 0) collecting.value = false;
};

// Best-effort: the frames are already off the screen, and a failed cleanup must
// not stand between the person and the next part. The disk report (#120) is
// where anything that survives shows up.
const discardFrames = async (imageUrls: string[]): Promise<void> => {
  if (imageUrls.length === 0) return;
  try {
    await apiJson('/api/components/intake/photos/discard', {
      method: 'POST',
      body: { imageUrls },
    });
  } catch {
    // Nothing to say to the user about a picture they just discarded.
  }
};

// Leaving the mode DELETES the collected frames. Silently keeping them is how a
// store of abandoned frames grows.
const leaveCollecting = async (): Promise<void> => {
  if (collected.value.length > 0) {
    const ok = await confirm({
      message: t('inventory.mobile.dropFramesConfirm', {
        count: collected.value.length,
      }),
      tone: 'danger',
    });
    if (!ok) return;
    void discardFrames([...collected.value]);
  }
  clearCollected();
};

const clearCollected = (): void => {
  collecting.value = false;
  collected.value = [];
  collectedPreviews.value = [];
};

const recognize = async (): Promise<void> => {
  if (recognizing.value || busy.value) return;
  // The first press only fixes a frame — the model is not called until the
  // person says the angles are enough.
  if (!collecting.value) {
    await fixFrame();
    return;
  }
  if (collected.value.length === 0) return;

  recognizing.value = true;
  // The camera goes OFF, not just unreachable, and the last fixed frame stays on
  // screen in its place. A live preview under a lock invites the exact mistake
  // the lock is for — pointing the phone at the next part. Freeing the stream
  // also stops the torch and the drain of a sensor nobody is reading.
  pendingFrame.value = collectedPreviews.value.at(-1) ?? null;
  stopCamera();
  try {
    const draft = await apiJson<RecognizedItemDraft>(
      '/api/components/intake/recognize',
      { method: 'POST', body: { imageUrls: collected.value } },
    );
    resetForm();
    name.value = draft.name;
    sku.value = draft.sku ?? '';
    // Already an id from the existing tree — the model chose from a list rather
    // than naming a group, so there is nothing left to match here.
    categoryId.value = draft.categoryId ?? '';
    await categories.ensure(draft.categoryId);
    description.value = draft.description ?? '';
    propertyValues.value = { ...draft.propertyValues };
    unit.value = draft.unit ?? '';
    // Every frame becomes a photograph of the item this saves; the first is the
    // cover, and the phone does NOT ask about covers — a person about to press
    // Save should not be picking stars.
    photos.value = [...collected.value];
    candidates.value = draft.candidates;
    await goToPhase('form');
    pendingFrame.value = null;
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.recognizeError')));
    // Failure puts the person back where they were standing: same shelf, live
    // camera, the part still in their hand — and EVERY frame still collected,
    // which is what makes retrying free.
    pendingFrame.value = null;
    await startCamera();
  } finally {
    recognizing.value = false;
  }
};

// The two form faces of this ONE route title themselves, because route meta
// cannot tell them apart. The camera face declares nothing and falls back to the
// route's own title.
//
// Back points at `/m/inventory` — the tab's own path — so the shell reads the
// arrow's word off the tab, which is what makes it say "Intake" rather than the
// "Camera" I had invented for a place that already had a name.
useMobileScreenChrome(() =>
  phase.value === 'camera'
    ? null
    : {
        backTo: '/m/inventory',
        back: () => void leavePhase(),
        title:
          phase.value === 'form'
            ? t('inventory.mobile.newItem')
            : t('inventory.mobile.knownItem'),
      },
);

const enterManually = (): void => {
  resetForm();
  stopCamera();
  void goToPhase('form');
};

// Add the collected frames to an item that already exists, keeping whatever it
// already had. The server drops any that already belong to something else.
//
// Only as many as still FIT. The set is capped at `MAX_ITEM_PHOTOS`, and the
// item's own pictures are already part of it — sending everything would build a
// list over the cap, which the DTO refuses outright (#212 review): the person
// got a bare save-error, the frames attached nowhere, and the ones left over
// stayed on disk as orphans. The overflow is named and deleted instead.
const attachPhotosToTarget = async (componentId: string): Promise<void> => {
  const fitting = photos.value.slice(0, attachableCount.value);
  const overflow = photos.value.slice(attachableCount.value);
  if (overflow.length > 0) {
    void discardFrames(overflow);
    toast.error(
      t('inventory.mobile.attachOverflow', {
        count: overflow.length,
        max: MAX_ITEM_PHOTOS,
      }),
    );
  }
  if (fitting.length === 0) return;
  try {
    await apiJson(`/api/components/${componentId}`, {
      method: 'PATCH',
      body: { photos: [...targetPhotoUrls.value, ...fitting] },
    });
  } catch (err) {
    // The receipt itself is the point; a photograph that did not attach is
    // worth a word but must not stop it.
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  }
};

// A suggested candidate the human accepted: the same receipt path a scan takes.
const useCandidate = async (candidate: IntakeCandidate): Promise<void> => {
  existing.value = {
    id: candidate.id,
    name: candidate.name,
    sku: candidate.sku,
    quantity: candidate.quantity,
  };
  receiveQty.value = quantity.value > 0 ? quantity.value : 1;
  await prepareReceivePhotos(candidate.id);
  await goToPhase('receive');
};

// Whether the collected frames should go onto the item being received into.
const attachPhotos = ref(false);
// What that item already has, read ONCE while opening the receive screen: the
// switch's default and the list the attach would extend are the same fact, and
// asking for it twice was two round trips for one answer.
const targetPhotoUrls = ref<string[]>([]);

// How many of the frames in hand the target still has room for. Said on the
// screen BEFORE the switch is pressed rather than discovered as a save error:
// an item holds `MAX_ITEM_PHOTOS` pictures in total, and the ones it already
// has count towards that.
const attachableCount = computed<number>(() =>
  fittingPhotoCount(targetPhotoUrls.value.length, photos.value.length),
);

// The same rule as the conveyor's commit path, said out loud (#217): default ON
// when the target has no photograph, OFF when it has one. Asked of the server
// rather than guessed — the candidate list carries no picture.
const prepareReceivePhotos = async (componentId: string): Promise<void> => {
  targetPhotoUrls.value = [];
  attachPhotos.value = false;
  if (photos.value.length === 0) return;
  try {
    const item = await apiJson<{ photos?: { url: string }[] }>(
      `/api/components/${componentId}`,
    );
    targetPhotoUrls.value = (item.photos ?? []).map((photo) => photo.url);
    attachPhotos.value = targetPhotoUrls.value.length === 0;
  } catch {
    // Unknown means "do not add": a picture that turns out to be redundant is
    // easier to regret than one that was never taken.
  }
};

const save = async (): Promise<void> => {
  if (name.value.trim() === '' || busy.value) return;
  pending.value = 'save';
  try {
    const created = await apiJson<{ name: string }>('/api/components', {
      method: 'POST',
      body: {
        name: name.value.trim(),
        ...(sku.value.trim() ? { sku: sku.value.trim() } : {}),
        ...(categoryId.value ? { categoryId: categoryId.value } : {}),
        ...(description.value.trim()
          ? { description: description.value.trim() }
          : {}),
        // Only alongside a category: without one there are no properties these
        // ids could belong to, and the server would drop them anyway.
        ...(categoryId.value && Object.keys(propertyValues.value).length > 0
          ? { propertyValues: propertyValues.value }
          : {}),
        ...(unit.value.trim() ? { unit: unit.value.trim() } : {}),
        ...(quantity.value > 0 ? { quantity: quantity.value } : {}),
        ...(storageId.value ? { storageId: storageId.value } : {}),
        ...(storageRow.value !== null ? { storageRow: storageRow.value } : {}),
        ...(storageCol.value !== null ? { storageCol: storageCol.value } : {}),
        ...(photos.value.length > 0 ? { photos: photos.value } : {}),
      },
    });
    toast.success(t('inventory.mobile.created', { name: created.name }));
    await backToCamera();
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  } finally {
    pending.value = null;
  }
};

const receive = async (): Promise<void> => {
  const target = existing.value;
  if (!target || busy.value) return;
  pending.value = 'receive';
  try {
    // The frames go on (or go away) BEFORE the stock delta is queued: the delta
    // may sit in the offline queue for an hour, and the photographs are a
    // separate decision that must not wait on it.
    if (photos.value.length > 0) {
      if (attachPhotos.value) await attachPhotosToTarget(target.id);
      else void discardFrames([...photos.value]);
    }
    await queue.submit({
      label: target.name,
      path: `/api/components/${target.id}/adjust`,
      method: 'PATCH',
      // A DELTA, never an absolute quantity: a phone that spent an hour offline
      // adds what it counted instead of rolling back what the desktop did.
      body: { amount: receiveQty.value, type: 'PURCHASE' },
    });
    toast.success(
      t('inventory.mobile.received', {
        name: target.name,
        qty: receiveQty.value,
      }),
    );
    await backToCamera();
  } catch (err) {
    toast.error(apiErrorMessage(err, t('inventory.mobile.saveError')));
  } finally {
    pending.value = null;
  }
};
</script>

<template>
  <!-- Only the CAMERA phase is pinned to the viewport. A form is longer than any
       phone and must be free to scroll — forcing it into one screen is what cut
       the fields off at Row/Column and left the tab bar stranded mid-page. -->
  <div
    class="p-4 flex flex-col gap-4"
    :class="phase === 'camera' ? 'h-full' : ''"
  >
    <!-- Recognition locks the screen, not just its button. It is looking at the
         frame the camera is showing RIGHT NOW: a person who shoots the next
         part while the model is still on the previous one has two shots in
         flight and no way to tell which answer belongs to which. -->
    <BusyOverlay
      :show="recognizing"
      :label="$t('inventory.mobile.recognizing')"
      :preview="pendingFrame ?? undefined"
    />
    <!-- Camera: the resting state of the screen.

         Laid out as a column that FITS, not one that scrolls. A person doing
         this holds the phone in one hand and a part in the other: every control
         has to be reachable without a scroll, so the preview takes whatever
         height is left over (`flex-1 min-h-0`) instead of dictating it, the hint
         rides on the picture rather than costing a row, and the secondary
         actions share one row as icons. -->
    <section
      v-show="phase === 'camera'"
      class="flex flex-col gap-3 flex-1 min-h-0"
    >
      <!-- `touch-none`: without it the browser spends the first pixels of a
           pinch deciding whether it was a scroll, and the gesture starts with a
           stutter. Scoped to the preview — the page's own lock is untouched. -->
      <div
        class="relative flex-1 min-h-36 overflow-hidden rounded-2xl bg-slate-900 touch-none"
        @touchstart="pinch.onTouchStart"
        @touchmove="pinch.onTouchMove"
        @touchend="pinch.onTouchEnd"
        @touchcancel="pinch.onTouchEnd"
      >
        <video
          ref="videoRef"
          class="w-full h-full object-cover"
          :style="videoStyle"
          :aria-label="$t('inventory.mobile.cameraPreview')"
          muted
          playsinline
        ></video>
        <!-- The still that stands in for the stopped camera while the model
             looks at it. The <video> element stays MOUNTED underneath — the
             scanner composable owns that ref and would lose it to a v-if — and
             is simply covered. -->
        <img
          v-if="pendingFrame"
          :src="pendingFrame"
          :alt="$t('inventory.mobile.photoAlt')"
          class="absolute inset-0 w-full h-full object-cover"
        />
        <p
          v-if="cameraFailed"
          class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white"
        >
          {{ $t('inventory.mobile.cameraError') }}
        </p>

        <!-- Hint and zoom belong to a LIVE camera: with the frame frozen there
             is nothing to aim and nothing to zoom. -->
        <template v-else-if="!pendingFrame">
          <!-- Zoom rides ON the preview: a shelf label two metres away is
               unreadable at 1x, and the controls below had no row to spare. It
               is always offered — the camera's own zoom where the phone has it,
               a digital crop where it does not, exactly as the capture surface
               behaves. -->
          <p
            class="absolute inset-x-0 top-0 bg-black/50 px-3 py-2 text-xxs text-white"
          >
            {{ $t('inventory.mobile.scanHint') }}
          </p>
          <div
            class="absolute inset-x-0 bottom-0 flex items-center gap-2 px-3 py-2"
          >
            <ZoomIn class="w-4 h-4 shrink-0 text-white/80" />
            <input
              :value="zoom"
              type="range"
              :min="zoomRange.min"
              :max="zoomRange.max"
              :step="zoomRange.step"
              :aria-label="$t('inventory.mobile.zoom')"
              class="w-full accent-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 rounded-xl"
              @input="setZoom(fieldNumber($event))"
            />
          </div>
        </template>

        <!-- The frames of the item being worked on right now, drawn from the
             data URLs this phone captured — reading them back from the server
             would leave the strip empty exactly when it matters, offline with
             three frames still in the queue. Over the preview, so it costs no
             row on a screen that must fit without scrolling.

             Two sources, one strip: the conveyor's queued shots (#216) and the
             single-item scenario's fixed frames (#217). The latter can be
             tapped to enlarge and dropped, because they are not on their way
             anywhere yet.

             OUTSIDE the cameraFailed / live-camera chain above on purpose: an
             element between a `v-if` and its `v-else-if` breaks the pair, and
             the casualty was the zoom slider — the control that exists to read
             a shelf label two metres away.

             `top-12`, not `top-8`: the hint bar above is exactly 32px tall
             (`text-xxs` on `py-2`), so a strip starting at 32 sits flush
             against it — and the drop badge, which hangs 8px ABOVE its
             thumbnail, then landed on the words. -->
        <ul
          v-if="strip.length > 0 && !pendingFrame"
          class="absolute inset-x-0 top-12 flex gap-1.5 overflow-x-auto px-3 py-1"
        >
          <li
            v-for="(frame, index) in strip"
            :key="frame.key"
            class="relative shrink-0"
          >
            <!-- Not a viewer. Enlarging a frame is a REVIEWING act and belongs
                 to the batch screen, where the decision is actually made; here
                 the strip is a tally of what has been shot, and the only thing
                 worth doing to one is dropping it. -->
            <img
              :src="frame.src"
              :alt="
                $t('inventory.mobile.frameAlt', {
                  index: index + 1,
                  total: strip.length,
                })
              "
              class="h-12 w-12 rounded-lg border border-white/40 object-cover"
            />
            <!-- On EVERY frame, not just a collected one: a shot of the wrong
                 part is noticed the moment it lands, and the conveyor used to
                 offer nothing to do about it. No confirmation — a frame means
                 nothing yet. `overlayScrim` is the primitive for a control
                 sitting ON a picture (§5.4). -->
            <Button
              variant="overlayScrim"
              size="icon-sm"
              pill
              class="absolute -right-2 -top-2"
              :icon-left="X"
              :aria-label="$t('inventory.mobile.dropFrame')"
              @click="dropStripFrame(index)"
            />
          </li>
        </ul>
      </div>

      <!-- A code we do not know. Shown, never acted on. -->
      <div
        v-if="unknownCode"
        class="shrink-0 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 space-y-2"
      >
        <p class="text-xxs text-amber-900 dark:text-amber-200 break-all">
          {{ $t('inventory.mobile.unknownCode', { code: unknownCode }) }}
        </p>
        <div class="flex gap-2">
          <!-- Filling the SKU is offered, never done: the person may simply want
               to photograph this part and describe it themselves, and the notice
               must not stand in the way of that. -->
          <Button
            v-if="unknownCodeIsForeign"
            variant="secondary"
            size="sm"
            @click="useUnknownCodeAsSku"
          >
            {{ $t('inventory.mobile.useAsSku') }}
          </Button>
          <Button variant="ghost" size="sm" @click="unknownCode = null">
            {{ $t('inventory.mobile.dismissCode') }}
          </Button>
        </div>
      </div>

      <!-- What the next shot will be filed as. Sticky between shots, so a shelf
           is set up once. -->
      <div class="flex items-end gap-2 shrink-0">
        <div class="w-24 space-y-1">
          <label for="mi-shot-qty" class="block text-xxs font-medium">
            {{ $t('inventory.mobile.quantity') }}
          </label>
          <input
            id="mi-shot-qty"
            v-model.number="quantity"
            type="number"
            min="1"
            inputmode="numeric"
            class="w-full glass-input rounded-xl px-3 py-2 text-base"
          />
        </div>
        <div v-if="storagesEnabled" class="flex-1 min-w-0 space-y-1">
          <label for="mi-shot-storage" class="block text-xxs font-medium">
            {{ $t('inventory.mobile.storage') }}
          </label>
          <Select
            id="mi-shot-storage"
            v-model="storageId"
            :options="storageOptions"
          />
        </div>
      </div>

      <!-- Collecting mode (#217): the conveyor's controls are hidden, because
           mixing conveyor frames into a single item has no meaning. The camera
           button stays physically where "Shoot" was — the thumb does not have
           to relearn the screen — and now reads "one more angle". -->
      <template v-if="collecting">
        <div class="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            block
            :icon-left="Camera"
            :loading="spinning('frame')"
            :disabled="!cameraActive || collectedFull || blocked('frame')"
            @click="fixFrame"
          >
            {{
              collectedFull
                ? $t('inventory.mobile.framesFull', { max: MAX_ITEM_PHOTOS })
                : $t('inventory.mobile.oneMoreAngle', {
                    count: collected.length,
                  })
            }}
          </Button>
          <!-- Leaving deletes the frames, behind a confirmation while there is
               anything to lose. -->
          <Button
            variant="secondary"
            size="icon"
            :icon-left="X"
            :aria-label="$t('inventory.mobile.leaveCollecting')"
            @click="leaveCollecting"
          />
        </div>
        <Button
          variant="ai"
          block
          :icon-left="Sparkles"
          :loading="recognizing"
          :disabled="collected.length === 0"
          class="shrink-0"
          @click="recognize"
        >
          {{
            $t('inventory.mobile.recognizeFrames', { count: collected.length })
          }}
        </Button>
      </template>

      <div v-else class="flex items-center gap-2 shrink-0">
        <Button
          variant="primary"
          block
          :icon-left="Camera"
          :loading="spinning('shoot')"
          :disabled="!cameraActive || framesFull || blocked('shoot')"
          @click="shoot"
        >
          {{
            currentFrames.length === 0
              ? $t('inventory.mobile.shoot')
              : framesFull
                ? $t('inventory.mobile.framesFull', { max: MAX_ITEM_PHOTOS })
                : $t('inventory.mobile.oneMoreAngle', {
                    count: currentFrames.length,
                  })
          }}
        </Button>
        <!-- "Done — next item": nothing is sent, the local key is simply
             dropped. Only offered once the current item HAS a frame, because
             before that there is no item to be done with. -->
        <Button
          v-if="currentFrames.length > 0"
          variant="secondary"
          size="icon"
          :icon-left="Check"
          :aria-label="$t('inventory.mobile.nextItem')"
          @click="startNextItem"
        />
        <!-- The single-item scenario's entry point. The first press does not
             call the model — it fixes a frame and opens the collecting mode. -->
        <Button
          v-if="recognitionAvailable"
          variant="ai"
          size="icon"
          :icon-left="Sparkles"
          :loading="spinning('frame')"
          :disabled="!cameraActive || blocked('frame')"
          :aria-label="$t('inventory.mobile.recognize')"
          @click="recognize"
        />
        <Button
          variant="secondary"
          size="icon"
          :icon-left="PencilLine"
          :aria-label="$t('inventory.mobile.manual')"
          @click="enterManually"
        />
        <Button
          variant="secondary"
          size="icon"
          to="/m/inventory/drafts"
          :icon-left="Layers"
          :aria-label="
            shot > 0
              ? $t('inventory.mobile.reviewShot', { count: shot })
              : $t('inventory.mobile.review')
          "
        />
      </div>
    </section>

    <!-- Form: everything recognized or typed, before anything is written.
         Its title and its way out live in the shell's screen header now (see
         `chrome` above) — the heading used to be here and the only Cancel was
         at the very bottom, below a form longer than the phone. -->
    <section v-if="phase === 'form'" class="space-y-4">
      <!-- Every frame that will become a photograph of this item (#217). The
           first is the cover and the phone does NOT ask about covers: a person
           about to press Save should not be picking stars. -->
      <ul v-if="photos.length > 0" class="flex gap-2 overflow-x-auto">
        <li v-for="(photo, index) in photos" :key="photo" class="shrink-0">
          <img
            :src="previewUrl(photo, 'sm')"
            :alt="
              $t('inventory.mobile.frameAlt', {
                index: index + 1,
                total: photos.length,
              })
            "
            class="h-32 w-32 rounded-2xl object-cover"
          />
        </li>
      </ul>

      <div v-if="candidates.length > 0" class="space-y-2">
        <p class="text-sm font-semibold">
          {{ $t('inventory.mobile.maybeExisting') }}
        </p>
        <Button
          v-for="candidate in candidates"
          :key="candidate.id"
          variant="secondary"
          block
          @click="useCandidate(candidate)"
        >
          <span class="font-medium">{{ candidate.name }}</span>
          <span class="text-slate-500 dark:text-slate-400">
            · {{ $t('inventory.mobile.inStock', { qty: candidate.quantity }) }}
          </span>
        </Button>
      </div>

      <div class="space-y-1">
        <label for="mi-name" class="block text-sm font-medium">
          {{ $t('inventory.mobile.name') }}
        </label>
        <input
          id="mi-name"
          v-model="name"
          type="text"
          maxlength="200"
          class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <label for="mi-qty" class="block text-sm font-medium">
            {{ $t('inventory.mobile.quantity') }}
          </label>
          <input
            id="mi-qty"
            v-model.number="quantity"
            type="number"
            min="0"
            inputmode="numeric"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
          />
        </div>
        <div class="space-y-1">
          <label for="mi-unit" class="block text-sm font-medium">
            {{ $t('inventory.mobile.unit') }}
          </label>
          <input
            id="mi-unit"
            v-model="unit"
            type="text"
            maxlength="20"
            class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
          />
        </div>
      </div>

      <div class="space-y-1">
        <label for="mi-sku" class="block text-sm font-medium">
          {{ $t('inventory.mobile.sku') }}
        </label>
        <input
          id="mi-sku"
          v-model="sku"
          type="text"
          maxlength="120"
          class="w-full glass-input rounded-xl px-4 py-2.5 text-base font-mono"
        />
      </div>

      <div class="space-y-1">
        <label for="mi-category" class="block text-sm font-medium">
          {{ $t('inventory.mobile.category') }}
        </label>
        <Select
          id="mi-category"
          :model-value="categoryId"
          :options="categories.options.value"
          @update:model-value="onCategoryChange(String($event))"
        />
      </div>

      <div class="space-y-1">
        <label for="mi-description" class="block text-sm font-medium">
          {{ $t('inventory.mobile.description') }}
        </label>
        <textarea
          id="mi-description"
          v-model="description"
          rows="3"
          :maxlength="DESCRIPTION_MAX"
          class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
        ></textarea>
      </div>

      <PropertyFields
        :properties="properties"
        :values="propertyValues"
        id-prefix="mi-prop"
        @change="(propertyId, value) => (propertyValues[propertyId] = value)"
      />

      <div v-if="storagesEnabled" class="space-y-3">
        <div class="space-y-1">
          <label for="mi-storage" class="block text-sm font-medium">
            {{ $t('inventory.mobile.storage') }}
          </label>
          <Select
            id="mi-storage"
            v-model="storageId"
            :options="storageOptions"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="mi-row" class="block text-sm font-medium">
              {{ $t('inventory.mobile.row') }}
            </label>
            <input
              id="mi-row"
              v-model.number="storageRow"
              type="number"
              min="1"
              inputmode="numeric"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
            />
          </div>
          <div class="space-y-1">
            <label for="mi-col" class="block text-sm font-medium">
              {{ $t('inventory.mobile.col') }}
            </label>
            <input
              id="mi-col"
              v-model.number="storageCol"
              type="number"
              min="1"
              inputmode="numeric"
              class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
            />
          </div>
        </div>
      </div>

      <div class="flex gap-2">
        <Button variant="secondary" block @click="backToCamera">
          {{ $t('inventory.mobile.cancel') }}
        </Button>
        <Button
          variant="primary"
          block
          :loading="spinning('save')"
          :disabled="name.trim() === '' || blocked('save')"
          :icon-left="PackagePlus"
          @click="save"
        >
          {{ $t('inventory.mobile.save') }}
        </Button>
      </div>
    </section>

    <!-- Receipt: this part is already on the shelf, so add to it. Titled by the
         shell header, same as the form. -->
    <section v-if="phase === 'receive' && existing" class="space-y-4">
      <div
        class="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-800 p-4"
      >
        <p class="font-semibold">{{ existing.name }}</p>
        <p class="text-sm text-slate-500 dark:text-slate-400">
          {{ $t('inventory.mobile.inStock', { qty: existing.quantity }) }}
        </p>
      </div>

      <!-- The frames in hand, and what will happen to them. The default is the
           same rule the conveyor's commit path applies silently (#216) — on
           when this item has no photograph, off when it has — said out loud
           here, because there IS a screen to say it on. -->
      <div v-if="photos.length > 0" class="space-y-2">
        <ul class="flex gap-2 overflow-x-auto">
          <li v-for="(photo, index) in photos" :key="photo" class="shrink-0">
            <img
              :src="previewUrl(photo, 'xs')"
              :alt="
                $t('inventory.mobile.frameAlt', {
                  index: index + 1,
                  total: photos.length,
                })
              "
              class="h-16 w-16 rounded-xl object-cover"
            />
          </li>
        </ul>
        <div class="flex items-center gap-3">
          <Switch
            id="mi-attach-photos"
            v-model="attachPhotos"
            :disabled="attachableCount === 0"
          />
          <label for="mi-attach-photos" class="text-sm font-medium">
            {{ $t('inventory.mobile.attachPhotos') }}
          </label>
        </div>
        <!-- The room left, said before the switch is pressed. Learning that an
             item is full from a failed save is how the frames used to be lost
             without a word. -->
        <p
          v-if="attachableCount < photos.length"
          class="text-xs text-amber-600 dark:text-amber-400"
        >
          {{
            attachableCount === 0
              ? $t('inventory.mobile.attachNoRoom', { max: MAX_ITEM_PHOTOS })
              : $t('inventory.mobile.attachSomeRoom', {
                  count: attachableCount,
                  max: MAX_ITEM_PHOTOS,
                })
          }}
        </p>
      </div>

      <div class="space-y-1">
        <label for="mi-receive" class="block text-sm font-medium">
          {{ $t('inventory.mobile.receiveQty') }}
        </label>
        <input
          id="mi-receive"
          v-model.number="receiveQty"
          type="number"
          min="1"
          inputmode="numeric"
          class="w-full glass-input rounded-xl px-4 py-2.5 text-base"
        />
      </div>

      <div class="flex gap-2">
        <Button variant="secondary" block @click="backToCamera">
          {{ $t('inventory.mobile.cancel') }}
        </Button>
        <Button
          variant="primary"
          block
          :loading="spinning('receive')"
          :disabled="blocked('receive')"
          :icon-left="Camera"
          @click="receive"
        >
          {{ $t('inventory.mobile.receive') }}
        </Button>
      </div>
    </section>
  </div>
</template>
