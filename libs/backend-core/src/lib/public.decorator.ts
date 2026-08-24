import { SetMetadata } from '@nestjs/common';

// Marks a route as reachable without authentication while the multiuser
// overlay is enabled (login/registration themselves, phone capture token
// routes, upload capability URLs). A no-op when the overlay is disabled.
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
