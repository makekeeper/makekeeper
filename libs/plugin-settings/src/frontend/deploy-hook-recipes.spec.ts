import { describe, it, expect } from 'vitest';
import en from '../i18n/en.json';
import ru from '../i18n/ru.json';
import {
  DEPLOY_HOOK_RECIPES,
  DEPLOY_HOOK_SOURCES,
  deployHookSourceFor,
  type DeployHookSource,
} from './deploy-hook-recipes';

function lookup(bundle: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      bundle,
    );
}

describe('deployHookSourceFor', () => {
  it('opens on the manager the instance was detected as', () => {
    expect(deployHookSourceFor('coolify')).toBe('coolify');
    expect(deployHookSourceFor('dokploy')).toBe('dokploy');
    expect(deployHookSourceFor('portainer')).toBe('portainer');
  });

  it('falls back to the generic recipe for anything without a manager', () => {
    expect(deployHookSourceFor(null)).toBe('other');
    expect(deployHookSourceFor('compose')).toBe('other');
    expect(deployHookSourceFor('install-sh')).toBe('other');
    expect(deployHookSourceFor('kubernetes')).toBe('other');
    expect(deployHookSourceFor('unknown')).toBe('other');
  });
});

describe('DEPLOY_HOOK_RECIPES', () => {
  it('covers every selectable source', () => {
    for (const source of DEPLOY_HOOK_SOURCES) {
      expect(DEPLOY_HOOK_RECIPES[source].steps.length).toBeGreaterThan(0);
    }
  });

  // The steps are i18n keys (§5.5): a missing one renders as the raw key in the
  // UI, which is exactly the "no instructions" gap this feature exists to close.
  it.each(['en', 'ru'])('resolves every step key in %s', (locale) => {
    const bundle = locale === 'en' ? en : ru;
    const missing: string[] = [];
    for (const source of DEPLOY_HOOK_SOURCES) {
      for (const key of DEPLOY_HOOK_RECIPES[source].steps) {
        if (typeof lookup(bundle, key) !== 'string') missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });

  it.each(['en', 'ru'])('resolves the surrounding prose in %s', (locale) => {
    const bundle = locale === 'en' ? en : ru;
    for (const key of [
      'settings.updates.hook.source.title',
      'settings.updates.hook.source.hint',
      'settings.updates.hook.source.manager',
      'settings.updates.hook.source.otherLabel',
      'settings.updates.hook.source.expects',
      'settings.updates.hook.source.withToken',
      'settings.updates.hook.source.withoutToken',
      'settings.updates.hook.source.urlTemplate',
    ]) {
      expect(typeof lookup(bundle, key)).toBe('string');
    }
  });

  // Coolify is the one manager whose hook the admin assembles rather than
  // copies, so its template must stay a fillable URL with both placeholders.
  it('keeps the Coolify URL template fillable', () => {
    const template = DEPLOY_HOOK_RECIPES.coolify.urlTemplate;
    expect(template).toContain('<coolify-host>');
    expect(template).toContain('<uuid>');
    expect(DEPLOY_HOOK_RECIPES.coolify.method).toBe('GET');
    expect(DEPLOY_HOOK_RECIPES.coolify.needsToken).toBe(true);
  });

  it('marks the managers whose URL carries its own token', () => {
    const carriesToken: DeployHookSource[] = ['dokploy', 'portainer'];
    for (const source of carriesToken) {
      expect(DEPLOY_HOOK_RECIPES[source].needsToken).toBe(false);
      expect(DEPLOY_HOOK_RECIPES[source].method).toBe('POST');
      expect(DEPLOY_HOOK_RECIPES[source].urlTemplate).toBeNull();
    }
  });
});
