// Where the product's feedback goes (#342).
//
// The routes are split by what the sender wants, not by what we would rather
// receive: a defect goes to the issue tracker, everything else to Discussions.
// Development is private and GitHub is a snapshot mirror (#297), so these are
// the only addresses a user can actually reach us at.
//
// One module, because an address assembled in a component is an address that
// drifts: the issue form's field id below has to match the template
// `publish-github.yml` writes, and that agreement is only checkable while both
// halves are named in one place.
const REPO_URL = 'https://github.com/makekeeper/makekeeper';

/** The bug template's `id:` in `.github/ISSUE_TEMPLATE/bug_report.yml`. */
const BUG_TEMPLATE = 'bug_report.yml';

/**
 * The template field the environment block fills. GitHub prefills an issue
 * form from query parameters named after the field ids — rename the field and
 * the prefill silently stops arriving, which is why the name lives here.
 */
const ENVIRONMENT_FIELD = 'environment';

/**
 * Where each action lands, as the trail of GitHub's own surface names.
 *
 * Segments, not one string: the separators between them are framing the UI
 * owns, and framing in a locale value is a decoration every language has to
 * remember (§5.4). These names are also NOT translated — "Issues",
 * "Discussions", "Q&A" are what GitHub calls those pages in every locale, so
 * they are brand nouns rather than text, and both bundles carried identical
 * copies of them until this moved here.
 */
export const FEEDBACK_TRAILS = {
  bug: ['GitHub', 'Issues'],
  idea: ['GitHub', 'Discussions', 'Ideas'],
  question: ['GitHub', 'Discussions', 'Q&A'],
} as const satisfies Record<string, readonly string[]>;

export const FEEDBACK_LINKS = {
  discussions: `${REPO_URL}/discussions`,
  ideas: `${REPO_URL}/discussions/new?category=ideas`,
  questions: `${REPO_URL}/discussions/new?category=q-a`,
  source: REPO_URL,
  install: `${REPO_URL}/blob/main/INSTALL.md`,
  releases: `${REPO_URL}/releases`,
  license: `${REPO_URL}/blob/main/LICENSE.md`,
} as const;

/**
 * What the reporter should not have to look up. Anything unknown is left out
 * rather than guessed: `installMethod` is admin-only diagnostics (#100) and a
 * non-admin genuinely does not have it.
 */
export interface FeedbackEnvironment {
  version: string | null;
  installMethod: string | null;
  plugins: readonly string[];
  locale: string;
}

/** Field labels, resolved by the caller — the reporter reads them (§5.5). */
export interface FeedbackEnvironmentLabels {
  version: string;
  installMethod: string;
  plugins: string;
  locale: string;
}

/**
 * The environment block, as it appears in the report.
 *
 * Plain `label: value` lines, not a table or a fenced block: GitHub renders
 * this inside a textarea field, where any markup the reporter did not type
 * reads as noise they are expected to clean up.
 */
export function formatEnvironment(
  environment: FeedbackEnvironment,
  labels: FeedbackEnvironmentLabels,
): string {
  const lines: string[] = [];
  if (environment.version)
    lines.push(`${labels.version}: ${environment.version}`);
  if (environment.installMethod) {
    lines.push(`${labels.installMethod}: ${environment.installMethod}`);
  }
  if (environment.plugins.length > 0) {
    lines.push(`${labels.plugins}: ${environment.plugins.join(', ')}`);
  }
  lines.push(`${labels.locale}: ${environment.locale}`);
  return lines.join('\n');
}

/**
 * The bug-report URL with the environment already filled in.
 *
 * A report that carries the version is worth several that do not — and the one
 * moment a user is willing to spend on us is the moment they press the button,
 * not the exchange that follows it.
 */
export function buildBugReportUrl(
  environment: FeedbackEnvironment,
  labels: FeedbackEnvironmentLabels,
): string {
  const params = new URLSearchParams({
    template: BUG_TEMPLATE,
    [ENVIRONMENT_FIELD]: formatEnvironment(environment, labels),
  });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}
