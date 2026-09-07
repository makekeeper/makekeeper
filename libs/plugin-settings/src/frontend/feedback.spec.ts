import { describe, expect, it } from 'vitest';
import {
  buildBugReportUrl,
  formatEnvironment,
  type FeedbackEnvironment,
  type FeedbackEnvironmentLabels,
} from './feedback';

const LABELS: FeedbackEnvironmentLabels = {
  version: 'Version',
  installMethod: 'Install method',
  plugins: 'Plugins',
  locale: 'Locale',
};

const FULL: FeedbackEnvironment = {
  version: '0.17.0',
  installMethod: 'docker-compose',
  plugins: ['projects', 'inventory'],
  locale: 'ru',
};

describe('formatEnvironment', () => {
  it('lists every known fact on its own line', () => {
    expect(formatEnvironment(FULL, LABELS)).toBe(
      [
        'Version: 0.17.0',
        'Install method: docker-compose',
        'Plugins: projects, inventory',
        'Locale: ru',
      ].join('\n'),
    );
  });

  // A non-admin has no install diagnostics and a version probe can fail: the
  // block must then be short, never carry an empty or invented value.
  it('omits what is unknown instead of reporting a blank', () => {
    expect(
      formatEnvironment(
        { version: null, installMethod: null, plugins: [], locale: 'en' },
        LABELS,
      ),
    ).toBe('Locale: en');
  });
});

describe('buildBugReportUrl', () => {
  it('names the template and prefills the environment field', () => {
    const url = new URL(buildBugReportUrl(FULL, LABELS));
    expect(url.origin + url.pathname).toBe(
      'https://github.com/makekeeper/makekeeper/issues/new',
    );
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('environment')).toContain('0.17.0');
  });

  // The newlines and commas of the block survive the trip: hand-built query
  // strings are exactly where they stop doing so.
  it('encodes the block so it arrives intact', () => {
    const url = new URL(buildBugReportUrl(FULL, LABELS));
    expect(url.searchParams.get('environment')).toBe(
      formatEnvironment(FULL, LABELS),
    );
  });
});
