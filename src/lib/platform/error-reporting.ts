/**
 * Errors, tracing and replays of sessions with an error to Sentry, only in builds that set a DSN
 * (the Vercel ones). Loaded after the app starts, so neither the first paint nor an offline host
 * waits for it. Room codes are cut from every payload: events, streamed spans, replay recordings
 * and replay events. Component props (player names, uids) and click breadcrumbs (whose labels
 * carry names) are off, and replays mask all text.
 */
import type { App } from 'vue'
import type { Router } from 'vue-router'

const ROOM_PATH = /\b(room|join)\/[2-9A-HJ-NP-Z]{5}\b/g

type SentryModule = typeof import('@sentry/vue')
/** Set once Sentry has started; handled errors from before that aren't sent. */
let sentry: SentryModule | null = null

/** An error the app recovers from (a fallback, a skipped extra), so it still leaves a trace. A
 * no-op in builds without a DSN, and scrubbed like every other report. */
export function reportHandledError(error: unknown, context: string): void {
  sentry?.captureException(error, { level: 'warning', tags: { handled: 'true', context } })
}

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
  const Sentry = await import('@sentry/vue')
  Sentry.init({
    app,
    dsn,
    // Vue's error handler would attach the failing component's props: players' names and uids.
    attachProps: false,
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
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
        beforeAddRecordingEvent: (event) => scrubReport(event),
      }),
    ],
    tracesSampleRate: 1,
    // Replays only of sessions that hit an error: the last minute is kept in memory and sent then.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
    beforeSend: (event) => scrubReport(event),
    // Sentry 11 streams spans, so beforeSendTransaction never sees them: spans carry the route.
    beforeSendSpan: (span) => scrubReport(span),
    beforeBreadcrumb: (breadcrumb) => scrubReport(breadcrumb),
  })
  // Replay events skip beforeSend; a global processor also sees them and their URL list.
  Sentry.addEventProcessor((event) => scrubReport(event))
  sentry = Sentry
}
