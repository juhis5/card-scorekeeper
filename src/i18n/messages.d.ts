import type { MessageSchema } from './schema'

// Types every `t()`/`$t()` call against `en.json`, with no generic at each `useI18n()`.
declare module 'vue-i18n' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- vue-i18n's documented typed-messages pattern needs declaration merging, which requires an interface body
  export interface DefineLocaleMessage extends MessageSchema {}
}
