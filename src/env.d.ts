/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/vue" />

interface ImportMetaEnv {
  /** Sentry's DSN; set only in the Vercel builds, so local and CI builds report nothing. */
  readonly VITE_SENTRY_DSN?: string
  /** production (main), test (develop), preview (other branches) or local; set in vite.config.ts. */
  readonly VITE_DEPLOY_ENV: string
  /** The commit being deployed, which Sentry matches with the uploaded source maps. */
  readonly VITE_RELEASE: string
  /** App Check's reCAPTCHA Enterprise site key (public); set per Firebase project in Vercel. */
  readonly VITE_APP_CHECK_SITE_KEY?: string
  /** Local only: a debug token registered in the console, for a dev build against staging. */
  readonly VITE_APP_CHECK_DEBUG_TOKEN?: string
}
