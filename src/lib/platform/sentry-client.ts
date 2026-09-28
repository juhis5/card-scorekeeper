/** Only what error-reporting.ts uses: importing the whole SDK namespace would ship all of it. */
export {
  breadcrumbsIntegration,
  browserTracingIntegration,
  init,
  replayIntegration,
} from '@sentry/vue'
