import { v7 as uuidv7 } from 'uuid';

/**
 * Generates a chronologically sortable UUIDv7 identifier.
 */
export function generateUuid(): string {
  return uuidv7();
}
