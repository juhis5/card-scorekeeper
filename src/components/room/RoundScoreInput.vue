<script setup lang="ts">
/**
 * Single job: a labelled numeric field for one leftover-card score. Wraps the shadcn
 * Input/Label primitives; exposes its value as `number | null` via `defineModel` (Input's own
 * v-model is string-only, so the string<->number conversion lives here, once). The default slot
 * sits beside the field, under the label, for an action such as ScoreCard's Save.
 */
import { computed } from 'vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const {
  id,
  label,
  describedBy,
  isInvalid = false,
  isLabelHidden = false,
  placeholder,
} = defineProps<{
  id: string
  label: string
  describedBy?: string
  isInvalid?: boolean
  /** Keeps the label for screen readers only, for rows where something visible already says
   * what the field is (the photo-count card list). */
  isLabelHidden?: boolean
  placeholder?: string
}>()

/** `commit` fires on Enter. */
const emit = defineEmits<{ commit: [] }>()

const model = defineModel<number | null>({ default: null })

const rawValue = computed<string | number>({
  get: () => model.value ?? '',
  set: (value) => {
    const text = String(value).trim()
    model.value = text === '' ? null : Number(text)
  },
})
</script>

<template>
  <div class="flex flex-col gap-1">
    <Label :for="id" :class="{ 'sr-only': isLabelHidden }">{{ label }}</Label>
    <div class="flex gap-2">
      <Input
        :id="id"
        v-model="rawValue"
        type="number"
        inputmode="numeric"
        enterkeyhint="done"
        min="0"
        class="h-11 min-w-0 flex-1 text-base"
        :placeholder="placeholder"
        :aria-invalid="isInvalid"
        :aria-describedby="describedBy"
        @keyup.enter="emit('commit')"
      />
      <slot />
    </div>
  </div>
</template>
