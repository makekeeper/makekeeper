import {
  EXTERNAL_CONTRACT_VERSION,
  type ExternalPluginManifest,
} from '@makekeeper/plugin-contract';

// The MCP server plugin (#251) is a pure protocol face: no screens, no tools
// of its own, no permissions — the rights of every call live in the caller's
// `mkt_` connection token, which this plugin forwards untouched. What it DOES
// declare is its whole surface as public (`publicPaths: ['']`): the streamable
// HTTP endpoint must be reachable by MCP clients at
// `https://<instance>/plugins/mcp` without a MakeKeeper session.
// The authoring version; a released image overrides it with the version its
// tag was cut at (MK_PLUGIN_VERSION baked in by release-plugin.yml), so what
// the core displays always names the actual release.
const SOURCE_VERSION = '0.1.1';

export const manifest: ExternalPluginManifest = {
  contract: EXTERNAL_CONTRACT_VERSION,
  pluginId: 'mcp',
  version: process.env['MK_PLUGIN_VERSION']?.trim() || SOURCE_VERSION,
  nameKey: 'mcp.name',
  descriptionKey: 'mcp.description',
  icon: 'Plug',
  scopeModel: 'instance',
  permissions: [],
  i18n: {
    en: {
      mcp: {
        name: 'MCP server',
        description:
          'Exposes this instance’s agent tools to MCP clients (Claude Desktop, Claude Code, …) over streamable HTTP.',
        setup:
          'Add this address to your MCP client as a streamable-HTTP server and send a connection token with it: Authorization: Bearer mkt_… — issue one below, under “Connection tokens”. The token’s access ceiling decides which tools the client sees.',
      },
    },
    ru: {
      mcp: {
        name: 'MCP-сервер',
        description:
          'Открывает агентные инструменты этого инстанса MCP-клиентам (Claude Desktop, Claude Code, …) по streamable HTTP.',
        setup:
          'Добавьте этот адрес в MCP-клиент как streamable-HTTP сервер и передавайте вместе с ним токен подключения: Authorization: Bearer mkt_… — выпустите его ниже, в разделе «Токены подключения». Потолок доступа токена определяет, какие инструменты увидит клиент.',
      },
    },
  },
  screens: [],
  publicPaths: [''],
  publicHintKey: 'mcp.setup',
};
