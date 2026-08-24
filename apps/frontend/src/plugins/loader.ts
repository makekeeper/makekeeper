// Loads every active frontend plugin as an import side-effect. Each plugin's
// frontend entry registers its routes, navigation and i18n bundle with the
// frontend-core registry. Adding a plugin = adding one line here.
import '@makekeeper/plugin-projects/frontend';
import '@makekeeper/plugin-inventory/frontend';
import '@makekeeper/plugin-logistics/frontend';
import '@makekeeper/plugin-storages/frontend';
import '@makekeeper/plugin-settings/frontend';
import '@makekeeper/plugin-chat/frontend';
import '@makekeeper/plugin-phone-bridge/frontend';
import '@makekeeper/plugin-capture/frontend';
import '@makekeeper/plugin-multiuser/frontend';
import '@makekeeper/plugin-uxmode/frontend';
import '@makekeeper/plugin-stats/frontend';
import '@makekeeper/plugin-tags/frontend';
import '@makekeeper/plugin-exchange/frontend';
import '@makekeeper/plugin-codes/frontend';
import '@makekeeper/plugin-mobile/frontend';
import '@makekeeper/plugin-external/frontend';
