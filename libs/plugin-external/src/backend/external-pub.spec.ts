import { ExternalPubService } from './external-pub.service';
import type { ExternalRegistryService } from './external-registry.service';
import type { PluginConfigService } from '@makekeeper/backend-core';

// The routing decisions of the public-path proxy (#250): what is reachable,
// and whether nginx streams directly or pipes through the core.

const build = (opts: {
  baseUrl?: string;
  publicPaths?: string[];
  active?: boolean;
  hostEnabled?: boolean;
}): ExternalPubService => {
  const registry = {
    getActive: jest.fn().mockResolvedValue(
      opts.active === false
        ? null
        : {
            pluginId: 'demo',
            baseUrl: opts.baseUrl ?? 'http://mk-plugin-demo:4400',
            manifest: { publicPaths: opts.publicPaths },
            grants: [],
          },
    ),
  } as unknown as ExternalRegistryService;
  const pluginConfig = {
    isEnabled: () => opts.hostEnabled !== false,
  } as unknown as PluginConfigService;
  return new ExternalPubService(registry, pluginConfig);
};

describe('ExternalPubService.resolveUri', () => {
  it('resolves a declared path on both faces to a direct target', async () => {
    const pub = build({ publicPaths: ['webhook'] });
    for (const uri of [
      '/plugins/demo/webhook/incoming?x=1',
      '/api/external/pub/demo/webhook/incoming?x=1',
    ]) {
      await expect(pub.resolveUri(uri)).resolves.toEqual({
        ok: true,
        mode: 'direct',
        target: 'http://mk-plugin-demo:4400/webhook/incoming?x=1',
      });
    }
  });

  it("covers the plugin root when '' is declared", async () => {
    const pub = build({ publicPaths: [''] });
    await expect(pub.resolveUri('/plugins/demo/')).resolves.toEqual({
      ok: true,
      mode: 'direct',
      target: 'http://mk-plugin-demo:4400/',
    });
  });

  it('refuses undeclared paths, unknown plugins and junk URIs', async () => {
    await expect(
      build({ publicPaths: ['webhook'] }).resolveUri('/plugins/demo/other'),
    ).resolves.toEqual({ ok: false });
    await expect(
      build({ publicPaths: undefined }).resolveUri('/plugins/demo/webhook'),
    ).resolves.toEqual({ ok: false });
    await expect(
      build({ active: false }).resolveUri('/plugins/demo/webhook'),
    ).resolves.toEqual({ ok: false });
    await expect(build({}).resolveUri('/elsewhere/x')).resolves.toEqual({
      ok: false,
    });
  });

  it("never exposes the signed /mk surface, even under ''", async () => {
    const pub = build({ publicPaths: [''] });
    await expect(pub.resolveUri('/plugins/demo/mk/tool')).resolves.toEqual({
      ok: false,
    });
    await expect(pub.resolveUri('/plugins/demo/mk')).resolves.toEqual({
      ok: false,
    });
  });

  it('pipes plugins registered on a loopback base URL', async () => {
    const pub = build({
      baseUrl: 'http://localhost:4405',
      publicPaths: [''],
    });
    const res = await pub.resolveUri('/plugins/demo/ingest?token=t');
    expect(res).toEqual({
      ok: true,
      mode: 'pipe',
      target: 'http://localhost:4405/ingest?token=t',
    });
  });

  it('answers nothing while the external host plugin is disabled', async () => {
    const pub = build({ publicPaths: [''], hostEnabled: false });
    await expect(pub.resolveUri('/plugins/demo/')).resolves.toEqual({
      ok: false,
    });
  });
});
