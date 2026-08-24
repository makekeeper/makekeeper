import { formatObjectRef, resolveEntityId } from '@makekeeper/plugin-contract';

// The one place the chat plugin names an attachment to the model (#112).
//
// A stored attachment is addressed as `mk://projects/file/<id>`: the row lives
// in backend-core, but the surface a user can open it on is the projects Files
// tab, so that is whose namespace owns it (§5.9). Chat only speaks the name —
// it imports no projects code, the same way the exchange providers already
// address a project root.
//
// Kept in one module because the pair is used three times in two files (the
// context note, and both ends of `read_attachment`), and an entity type that
// drifts in one of them produces a ref the frontend silently fails to route.
const ATTACHMENT_REF = {
  pluginId: 'projects',
  entityType: 'file',
} as const;

// The canonical ref for a stored attachment, degrading to the bare id if the
// ORef cannot be formed — a note that names the file is worth more than none.
export function attachmentRef(id: string): string {
  return formatObjectRef({ ...ATTACHMENT_REF, entityId: id }) ?? id;
}

// The attachment id behind whatever the model passed — an ORef or a raw id.
// Null when it is neither, or names something that is not an attachment.
export function attachmentIdFromRef(value: string): string | null {
  return resolveEntityId(value, ATTACHMENT_REF)?.id ?? null;
}
