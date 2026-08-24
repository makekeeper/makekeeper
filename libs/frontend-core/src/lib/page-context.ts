import { readonly, ref, type Ref } from 'vue';

// A human-readable description of the active view's *precise* selection (e.g.
// "склад «Office / Working Table», ячейка B1, storageId: …") that the route's
// opaque ids can't express. The current view sets it; the app shell reads it into
// PageContext.summary when a chat message is sent, so the AI agent receives named,
// actionable context instead of a bare UUID. Views MUST clear it (set null) on
// unmount so it never leaks to another screen.
const pageContextSummary = ref<string | null>(null);

export const setPageContextSummary = (summary: string | null): void => {
  pageContextSummary.value = summary;
};

export const usePageContextSummary = (): Readonly<Ref<string | null>> =>
  readonly(pageContextSummary);

// Machine-parseable counterpart to the summary: the active view's precise selection
// as canonical Object References (ORef). Set alongside the summary by the current
// view and read into PageContext.refs when a chat message is sent, so the agent gets
// an exact, ownership-tagged handle instead of parsing ids out of prose (issue #16).
// Views MUST clear it (null) on unmount so it never leaks to another screen.
const pageContextRefs = ref<string[] | null>(null);

export const setPageContextRefs = (refs: string[] | null): void => {
  pageContextRefs.value = refs && refs.length ? refs : null;
};

export const usePageContextRefs = (): Readonly<Ref<string[] | null>> =>
  readonly(pageContextRefs);
