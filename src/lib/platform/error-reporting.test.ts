import { afterEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'vue'
import type { Router } from 'vue-router'

const init = vi.fn()
const captureException = vi.fn()
const breadcrumbsIntegration = vi.fn((options: unknown) => ({ name: 'Breadcrumbs', options }))
const browserTracingIntegration = vi.fn((options: unknown) => ({ name: 'BrowserTracing', options }))
const replayIntegration = vi.fn((options: unknown) => ({ name: 'Replay', options }))
vi.mock('@sentry/vue', () => ({
  init,
  captureException,
  breadcrumbsIntegration,
  browserTracingIntegration,
  replayIntegration,
}))

const { scrubRoomCodes, scrubReport, startErrorReporting } = await import('./error-reporting')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('scrubRoomCodes', () => {
  it('cuts the room code out of room and join addresses', () => {
    expect(scrubRoomCodes('https://rommi.vercel.app/room/7K4RQ?x=1')).toBe(
      'https://rommi.vercel.app/room/:code?x=1',
    )
    expect(scrubRoomCodes('/join/FGHJK and room/ABCDE/players/uid')).toBe(
      '/join/:code and room/:code/players/uid',
    )
  })

  it('leaves everything else as it is', () => {
    expect(scrubRoomCodes('/room/local')).toBe('/room/local')
    expect(scrubRoomCodes('/stats')).toBe('/stats')
  })
})

describe('scrubReport', () => {
  it('scrubs room codes anywhere in a report, however deep', () => {
    const report = {
      request: { url: 'https://rommi.vercel.app/room/7K4RQ' },
      exception: { values: [{ value: 'Missing doc room/7K4RQ/players/abc' }] },
      breadcrumbs: [{ data: { from: '/join/7K4RQ', to: '/room/7K4RQ' } }],
    }

    expect(JSON.stringify(scrubReport(report))).not.toContain('7K4RQ')
  })
})

describe('startErrorReporting', () => {
  const app = {} as App
  const router = {} as Router

  it('does nothing without a DSN, as in local and CI builds', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')

    await startErrorReporting(app, router)

    expect(init).not.toHaveBeenCalled()
  })

  it('reports errors, traces routes and replays only sessions with an error, all text masked', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.de.sentry.io/2')

    await startErrorReporting(app, router)

    const options = init.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      tracesSampleRate: 1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1,
    })
    options.integrations([])
    expect(browserTracingIntegration).toHaveBeenCalledWith({ router })
    expect(replayIntegration).toHaveBeenCalledWith({ maskAllText: true, blockAllMedia: true })
  })

  it('reports with click breadcrumbs off and personal data left out', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.de.sentry.io/2')

    await startErrorReporting(app, router)

    const options = init.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      app,
      dsn: 'https://key@o1.ingest.de.sentry.io/2',
      dataCollection: { userInfo: false, cookies: false, urlQueryParams: false, httpBodies: [] },
    })
    expect(options.integrations([{ name: 'Breadcrumbs' }, { name: 'Dedupe' }])).toEqual([
      { name: 'Dedupe' },
      { name: 'Breadcrumbs', options: { dom: false } },
      { name: 'BrowserTracing', options: { router } },
      { name: 'Replay', options: { maskAllText: true, blockAllMedia: true } },
    ])
    expect(breadcrumbsIntegration).toHaveBeenCalledWith({ dom: false })
    expect(options.beforeSend({ request: { url: '/room/7K4RQ' } })).toEqual({
      request: { url: '/room/:code' },
    })
  })
})

describe('reportHandledError', () => {
  /** A fresh module each time: whether Sentry has started is module state. */
  async function freshModule() {
    vi.resetModules()
    return import('./error-reporting')
  }

  it('sends nothing without a DSN, as in local and CI builds', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const reporting = await freshModule()
    await reporting.startErrorReporting({} as App, {} as Router)

    reporting.reportHandledError(new Error('refused'), 'publish-highscores')

    expect(captureException).not.toHaveBeenCalled()
  })

  it('sends a recovered error as a warning tagged with where it happened', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.de.sentry.io/2')
    const reporting = await freshModule()
    await reporting.startErrorReporting({} as App, {} as Router)
    const error = new Error('refused')

    reporting.reportHandledError(error, 'publish-highscores')

    expect(captureException).toHaveBeenCalledWith(error, {
      level: 'warning',
      tags: { handled: 'true', context: 'publish-highscores' },
    })
  })
})
