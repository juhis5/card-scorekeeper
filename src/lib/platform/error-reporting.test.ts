import { afterEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'vue'

const init = vi.fn()
const breadcrumbsIntegration = vi.fn((options: unknown) => ({ name: 'Breadcrumbs', options }))
vi.mock('@sentry/vue', () => ({ init, breadcrumbsIntegration }))

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

  it('does nothing without a DSN, as in local and CI builds', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')

    await startErrorReporting(app)

    expect(init).not.toHaveBeenCalled()
  })

  it('reports with click breadcrumbs off and personal data left out', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@o1.ingest.de.sentry.io/2')

    await startErrorReporting(app)

    const options = init.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      app,
      dsn: 'https://key@o1.ingest.de.sentry.io/2',
      dataCollection: { userInfo: false, cookies: false, urlQueryParams: false, httpBodies: [] },
    })
    expect(options.integrations([{ name: 'Breadcrumbs' }, { name: 'Dedupe' }])).toEqual([
      { name: 'Dedupe' },
      { name: 'Breadcrumbs', options: { dom: false } },
    ])
    expect(breadcrumbsIntegration).toHaveBeenCalledWith({ dom: false })
    expect(options.beforeSend({ request: { url: '/room/7K4RQ' } })).toEqual({
      request: { url: '/room/:code' },
    })
  })
})
