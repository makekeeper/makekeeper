// An item's photographs, shared between this plugin's backend and its frontends
// (#212). At the plugin root for the same reason as `mobile-intake.ts`: nothing
// outside inventory speaks these shapes.

import type { OwnedPhoto } from '@makekeeper/plugin-contract';

// How many photographs one item — or one intake draft on its way to becoming an
// item — may hold.
//
// A constant, not a setting. It bounds two things a per-instance number would
// only make harder to reason about: what a recognition call costs (every frame
// of a draft goes to the model) and what a gallery has to lay out on a phone.
// Five angles are more than enough to identify a part; a sixth is a second part.
export const MAX_ITEM_PHOTOS = 5;

// One photograph of an item, as every API payload carries it.
//
// The SAME type the attachment store produces — re-exported under the name this
// plugin speaks rather than declared again (#212 review). Two identical
// declarations of a payload shape are two places for it to change.
export type ComponentPhoto = OwnedPhoto;

// How many of `offered` new photographs an item already holding `held` of them
// has room for.
//
// A function rather than the arithmetic inlined at the call site, because the
// arithmetic was wrong there: the phone offered its whole set to an item that
// already had pictures, built a list over the cap, and got the DTO's refusal as
// a bare save-error — with the frames attached nowhere and left on disk. The
// number is needed twice on that screen (what to send, and what to say before
// the switch is pressed), which is the second reason it is not an expression.
export function fittingPhotoCount(held: number, offered: number): number {
  return Math.max(0, Math.min(offered, MAX_ITEM_PHOTOS - held));
}

// The photo half of a component payload. `imageUrl` survives the move to a set
// (#213) as the DERIVED cover URL: every card, the chat renderer and the agent
// tools read it, and none of them had to change when the column went away.
export interface ComponentPhotoFields {
  imageUrl: string | null;
  photos: ComponentPhoto[];
}
