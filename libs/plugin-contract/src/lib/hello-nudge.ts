// "Let us know you're here" (#367-#369): a card that, once the instance is a
// week old, asks each signed-in person for any response — a GitHub star, a
// release subscription, a wish or a complaint, and (for whoever may act for
// the instance) the daily ping — until they close it. Nothing here is a
// measurement; it is the state of one question.

// How old an instance must be before it is asked. Not a day earlier: a request
// for a star five minutes after install reads as needy, and the product has
// not yet earned anything to be told about.
export const HELLO_NUDGE_AFTER_DAYS = 7;

export interface HelloNudgeState {
  // True when the card should be on screen for the person asking: the
  // instance is old enough and they have not closed it.
  show: boolean;
  // When this instance first met the feature. Minted on the first read, so an
  // instance that predates the feature counts its week from the update that
  // brought it, not from a date nobody recorded.
  firstSeenAt: string;
  // When the person asking closed the card; null while they have not. Each
  // person closes it for themselves (#368): a star or a release subscription is
  // a personal act, so one user's "no" says nothing about anyone else's.
  dismissedAt: string | null;
}
