// Shapes the mobile intake surface shares between its backend and its frontend
// (#200). They live at the plugin root — not in plugin-contract — because
// nothing outside inventory speaks them: the SDK describes what plugins declare
// to the core, and this is inventory talking to itself.

// How long a description may be, on the draft and on the item it becomes. One
// constant because the phone's field and the server's validator have to agree:
// a textarea that accepts more than the save does is a rejection nobody saw
// coming.
export const DESCRIPTION_MAX = 5000;

// A component the recognition result might already be, offered for the human to
// pick instead of creating a second card for the same part.
export interface IntakeCandidate {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
}

// What the model made of the photo, ready to prefill the create form. Every
// field is a suggestion: nothing here is written until a human presses save.
export interface RecognizedItemDraft {
  name: string;
  sku: string | null;
  // A category the model CHOSE from the existing tree, or null (#206). It is
  // never a name it made up: the prompt carries the tree and anything outside
  // it is discarded, because minting a vocabulary entry is a human's job.
  categoryId: string | null;
  // Detailed enough to answer questions about the part without the photo — it
  // is what the second, text-only call reads.
  description: string | null;
  // Values the second call guessed for the category's properties, keyed by
  // property id. Two layers of guessing (the photo, then the description), so
  // these are shown as ordinary editable fields before anything is saved.
  propertyValues: Record<string, string>;
  unit: string | null;
  // Where the frames were stored, in the order they were sent, so the form can
  // attach them to the item it creates without uploading the bytes twice. The
  // first is the item's cover — the phone never asks about covers (#215).
  imageUrls: string[];
  // Existing components this might be. An exact SKU hit is resolved before the
  // model is ever called, so anything here is a NAME similarity — a suggestion
  // for a human, never an automatic merge.
  candidates: IntakeCandidate[];
}

// ── The conveyor (#201) ──────────────────────────────────────────────────
// Shooting is instant; recognition happens afterwards on the server; a human
// confirms a batch later. A draft is that middle state, made durable.

// `recognizing` — the model has not answered yet. `ready` — there are fields to
// review (from the model or typed by hand). `failed` — recognition produced
// nothing usable, which is an ordinary outcome the human fixes by typing.
export type IntakeDraftStatus = 'recognizing' | 'ready' | 'failed';

export interface IntakeDraft {
  id: string;
  // Every frame of this item, in upload order (#216). Several angles of ONE
  // part — the marking on one face, the footprint on another — all of which go
  // to the model together and all of which become the item's photographs.
  imageUrls: string[];
  status: IntakeDraftStatus;
  name: string | null;
  sku: string | null;
  categoryId: string | null;
  description: string | null;
  // Editable before commit like every other field: the values reached here
  // through two guesses, so they are fields on the card, not a hidden payload.
  propertyValues: Record<string, string>;
  unit: string | null;
  quantity: number;
  storageId: string | null;
  storageRow: number | null;
  storageCol: number | null;
  // i18n KEY of why recognition failed, resolved by the client (§5.5).
  errorKey: string | null;
  createdAt: string;
}

// What committing a draft produced — enough for the conveyor to offer an undo.
export interface IntakeCommitResult {
  componentId: string;
  // True when a new component was created, false when this was a receipt into
  // one that already existed. Undo differs: delete versus subtract.
  created: boolean;
  quantity: number;
}
