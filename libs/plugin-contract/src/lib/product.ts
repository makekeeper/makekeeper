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

// The public repository: where the source, the releases and every route back to
// us live (#342, #367). One constant, because the shell and the settings plugin
// both link to it and a plugin must not import another plugin's code (§5.10).
export const PRODUCT_REPO_URL = 'https://github.com/makekeeper/makekeeper';

// The releases feed GitHub publishes for every repository. The way to follow
// releases without a GitHub account (#367).
export const PRODUCT_RELEASES_FEED_URL = `${PRODUCT_REPO_URL}/releases.atom`;
