/**
 * Errors, tracing and session replay to Sentry, only in builds that set a DSN (the Vercel ones).
 * Loaded after the app starts, so neither the first paint nor an offline host waits for it. Room
 * codes are cut from every report, click breadcrumbs (whose labels carry player names) are off,
 * and replays mask all text.
 */
import type { App } from 'vue'
import type { Router } from 'vue-router'

const ROOM_PATH = /\b(room|join)\/[2-9A-HJ-NP-Z]{5}\b/g

export function scrubRoomCodes(text: string): string {
  return text.replace(ROOM_PATH, '$1/:code')
}

/** A report is plain JSON, so its text is scrubbed in one pass wherever a code appears. */
export function scrubReport<T>(report: T): T {
  return JSON.parse(scrubRoomCodes(JSON.stringify(report))) as T
}

export async function startErrorReporting(app: App, router: Router): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  const Sentry = await import('./sentry-client')
  Sentry.init({
    app,
    dsn,
    environment: import.meta.env.VITE_DEPLOY_ENV,
    release: import.meta.env.VITE_RELEASE || undefined,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    integrations: (defaults) => [
      ...defaults.filter((integration) => integration.name !== 'Breadcrumbs'),
      Sentry.breadcrumbsIntegration({ dom: false }),
      Sentry.browserTracingIntegration({ router }),
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: 1,
    // Sentry's usual rates: a tenth of sessions, and every session that hits an error.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,
    beforeSend: (event) => scrubReport(event),
    beforeSendTransaction: (event) => scrubReport(event),
    beforeBreadcrumb: (breadcrumb) => scrubReport(breadcrumb),
  })
}
