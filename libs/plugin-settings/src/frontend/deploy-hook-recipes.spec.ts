import { describe, it, expect } from 'vitest';
import { DEPLOY_HOOK_OUTCOMES } from '@makekeeper/plugin-contract';
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
      'settings.updates.hook.outcomeHints.unconfirmed',
      'settings.updates.hook.outcomeHints.methodNotAllowed',
      'settings.updates.hook.toast.triggerUnconfirmed',
      ...DEPLOY_HOOK_OUTCOMES.map(
        (outcome) => `settings.updates.hook.outcomes.${outcome}`,
      ),
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
    expect(DEPLOY_HOOK_RECIPES.coolify.needsToken).toBe(true);
  });

  // #373: Coolify's GET /api/v1/deploy answers 405 since v4.2.0, and its POST
  // starts a compose service without pulling. The recipe targets the service
  // restart endpoint with an explicit pull instead.
  it('sends Coolify a POST to the service restart endpoint with a pull', () => {
    const recipe = DEPLOY_HOOK_RECIPES.coolify;
    expect(recipe.method).toBe('POST');
    expect(recipe.urlTemplate).toBe(
      'https://<coolify-host>/api/v1/services/<uuid>/restart?latest=true',
    );
    expect(recipe.urlTemplate).not.toContain('/api/v1/deploy');
  });

  // A pinned TAG turns a successful restart into a no-op, so the recipe has
  // to say so somewhere in its steps.
  it.each(['en', 'ru'])('mentions TAG in the Coolify steps in %s', (locale) => {
    const bundle = locale === 'en' ? en : ru;
    const prose = DEPLOY_HOOK_RECIPES.coolify.steps
      .map((step) => lookup(bundle, step))
      .join(' ');
    expect(prose).toContain('TAG');
    expect(prose).toContain('POST');
    expect(prose).not.toMatch(/\bGET\b/);
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
