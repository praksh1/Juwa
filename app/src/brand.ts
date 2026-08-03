/**
 * The product's name, in one place.
 *
 * Every screen, the PWA manifest, and the page title have to agree, and a name
 * that appears as a literal in fifteen files is a name that ends up spelled
 * three different ways. `app.json` and `public/manifest.json` cannot import
 * from here — they are static JSON read by the bundler and the browser — so
 * those two carry their own copy and are checked by a test.
 */
export const APP_NAME = 'Juwa 3.0';

/** The wordmark is drawn as letterforms; the version rides beside it. */
export const APP_VERSION_LABEL = '3.0';

/** The name without the version, for prose where a version reads oddly. */
export const APP_SHORT_NAME = 'Juwa';
