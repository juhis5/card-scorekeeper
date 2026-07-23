import type { MessageSchema } from './schema'

// Makes `t()`/`$t()` calls type-checked and autocompleted against `en.json`
// everywhere, without repeating the schema generic at every `useI18n()` call.
declare module 'vue-i18n' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- vue-i18n's documented typed-messages pattern needs declaration merging, which requires an interface body
  export interface DefineLocaleMessage extends MessageSchema {}
}
