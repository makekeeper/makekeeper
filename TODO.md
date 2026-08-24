# TODO

## UI / UX

- [x] **Вынести «AI Agent Capabilities (Permissions)» в отдельный раздел настроек**
  - Создать отдельную страницу/вкладку `/settings/agent` (или отдельный `AgentCapabilitiesView.vue`)
  - Группировать инструменты по плагинам — **без хардкода**: каждый плагин при регистрации
    указывает свой `pluginId` и `pluginLabel` прямо в определении `AgentTool`
  - `AgentRegistryService` группирует инструменты по `pluginId` на лету; фронтенд
    получает уже сгруппированную структуру `{ pluginId, pluginLabel, tools[] }[]`
  - Показывать заголовок плагина, его иконку (берётся из `PluginRegistry`) и счётчик инструментов
  - Добавить маршрут в навигацию Settings (`/settings/agent`)
  - Текущая реализация: плоская таблица в конце `SettingsView.vue` — перенести оттуда и удалить
