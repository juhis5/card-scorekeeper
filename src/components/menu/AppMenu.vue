<script setup lang="ts">
/**
 * Single job: the app menu, a side panel from the right. The header has room only for Back, the
 * room code and this button, so everything else lives here: the app's name (nothing else on
 * screen names it), the pages (Home, Stats, Rules), the language and theme settings, and installing
 * the app. Every row is one whole-width tap target (third playtest). Reka's dialog traps focus
 * while it's open and returns it to the menu button when it closes; following a link closes it.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ChevronRight, Menu, RefreshCw, X } from '@lucide/vue'
import InstallAppRow from '@/components/menu/InstallAppRow.vue'
import LocaleToggle from '@/components/menu/LocaleToggle.vue'
import { MENU_ROW_CLASS } from '@/components/menu/menu-row'
import ThemePicker from '@/components/menu/ThemePicker.vue'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useAppUpdateStore } from '@/stores/app-update'
import { useInstallStore } from '@/stores/install'

const { t } = useI18n()
const install = useInstallStore()
const appUpdate = useAppUpdateStore()
const isOpen = ref(false)

const pages = [
  { name: 'home', labelKey: 'app.menu.home' },
  { name: 'stats', labelKey: 'nav.stats' },
  { name: 'rules', labelKey: 'rules.heading' },
] as const

function close(): void {
  isOpen.value = false
}
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetTrigger as-child>
      <Button variant="ghost" size="icon" class="size-11" :aria-label="t('app.menu.open')">
        <Menu aria-hidden="true" class="size-5" />
      </Button>
    </SheetTrigger>
    <SheetContent side="right" :show-close-button="false" class="gap-0 p-0">
      <SheetHeader
        class="border-border flex-row items-center justify-between border-b py-1 pr-1 pl-4"
      >
        <SheetTitle>{{ t('app.title') }}</SheetTitle>
        <SheetClose as-child>
          <Button variant="ghost" size="icon" class="size-11" :aria-label="t('app.menu.close')">
            <X aria-hidden="true" class="size-4" />
          </Button>
        </SheetClose>
      </SheetHeader>
      <SheetDescription class="sr-only">{{ t('app.menu.description') }}</SheetDescription>

      <nav :aria-label="t('app.menu.pages')">
        <ul role="list">
          <li v-for="page in pages" :key="page.name" class="border-border border-b">
            <RouterLink :to="{ name: page.name }" :class="MENU_ROW_CLASS" @click="close">
              {{ t(page.labelKey) }}
              <ChevronRight aria-hidden="true" class="text-muted-foreground size-4" />
            </RouterLink>
          </li>
        </ul>
      </nav>

      <ul role="list" :aria-label="t('app.menu.settings')">
        <li v-if="appUpdate.needRefresh" class="border-border border-b">
          <button type="button" :class="MENU_ROW_CLASS" @click="appUpdate.reload">
            <span class="flex flex-col">
              {{ t('app.update.menuRow') }}
              <span class="text-muted-foreground text-sm">{{ t('app.update.menuHint') }}</span>
            </span>
            <RefreshCw aria-hidden="true" class="text-primary size-4" />
          </button>
        </li>
        <li class="border-border border-b"><LocaleToggle /></li>
        <li class="border-border border-b"><ThemePicker /></li>
        <li v-if="install.isAvailable" class="border-border border-b"><InstallAppRow /></li>
      </ul>
    </SheetContent>
  </Sheet>
</template>
