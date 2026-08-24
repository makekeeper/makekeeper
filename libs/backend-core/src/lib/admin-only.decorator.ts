import { SetMetadata } from '@nestjs/common';

// Marks a route as instance administration (plugin toggles, provider config,
// capture settings). Enforced by the multiuser overlay's guard when that
// plugin is enabled; a no-op in single-user mode, where there is no admin.
export const ADMIN_ONLY_KEY = 'adminOnly';

export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);
