/**
 * Error reports to Sentry, only in builds that set a DSN (the Vercel ones). Loaded after the app
 * starts, so neither the first paint nor an offline host waits for it. Room codes are cut from
 * every report, click breadcrumbs (whose labels carry player names) are off, and there's no
 * session replay or performance tracing.
 */
import type { App } from 'vue'

const ROOM_PATH = /\b(room|join)\/[2-9A-HJ-NP-Z]{5}\b/g

export function scrubRoomCodes(text: string): string {
  return text.replace(ROOM_PATH, '$1/:code')
}

/** A report is plain JSON, so its text is scrubbed in one pass wherever a code appears. */
export function scrubReport<T>(report: T): T {
  return JSON.parse(scrubRoomCodes(JSON.stringify(report))) as T
}

export async function startErrorReporting(app: App): Promise<void> {
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
    ],
    beforeSend: (event) => scrubReport(event),
    beforeBreadcrumb: (breadcrumb) => scrubReport(breadcrumb),
  })
}
