// The product's name, canonically. A brand noun, not translatable text (§5.5
// exempts brand nouns), and it cannot live in the root manifest: npm forbids
// uppercase in package names, and `MakeKeeper`'s inner capital is not
// derivable from the lowercase workspace id. So code owns the cased form, and
// every consumer — backend, frontend, plugins, SDK authors — imports it from
// here instead of restating it.
export const PRODUCT_NAME = 'MakeKeeper';

// The lowercase derivative for machine identifiers (cache keys, database
// names, outbound User-Agent tokens, repo slugs). Matches the npm workspace id
// by construction.
export const PRODUCT_SLUG = 'makekeeper';
