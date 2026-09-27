<script setup lang="ts">
/**
 * Single job: the app menu, a side panel from the right. The header has room only for Back, the
 * room code and this button, so everything else lives here: the app's name (nothing else on
 * screen names it), the pages (Home, Stats, Rules), and the language and theme settings. Reka's dialog traps focus
 * while it's open and returns it to the menu button when it closes; following a link closes it.
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { ChevronRight, Menu, X } from '@lucide/vue'
import LocaleToggle from '@/components/LocaleToggle.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
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

const { t } = useI18n()
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
            <RouterLink
              :to="{ name: page.name }"
              class="text-foreground hover:bg-muted focus-visible:ring-ring flex h-12 items-center justify-between px-4 text-base focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
              @click="close"
            >
              {{ t(page.labelKey) }}
              <ChevronRight aria-hidden="true" class="text-muted-foreground size-4" />
            </RouterLink>
          </li>
        </ul>
      </nav>

      <div class="border-border flex items-center justify-between border-b py-1 pr-1 pl-4">
        <span class="text-base">{{ t('app.menu.language') }}</span>
        <LocaleToggle />
      </div>
      <div class="border-border flex items-center justify-between border-b py-1 pr-1 pl-4">
        <span class="text-base" aria-hidden="true">{{ t('app.theme.label') }}</span>
        <ThemeToggle />
      </div>
    </SheetContent>
  </Sheet>
</template>
