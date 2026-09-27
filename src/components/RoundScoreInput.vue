<script setup lang="ts">
/**
 * Single job: a labelled numeric field for one leftover-card score. Wraps the shadcn
 * Input/Label primitives; exposes its value as `number | null` via `defineModel` (Input's own
 * v-model is string-only, so the string<->number conversion lives here, once).
 */
import { computed } from 'vue'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const {
  id,
  label,
  describedBy,
  isInvalid = false,
} = defineProps<{
  id: string
  label: string
  describedBy?: string
  isInvalid?: boolean
}>()

/** `commit` fires on Enter. `blur` passes the focus event so the parent decides whether leaving
 * the field should save (see ScoreCard). */
const emit = defineEmits<{ commit: []; blur: [event: FocusEvent] }>()

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
    <Label :for="id">{{ label }}</Label>
    <Input
      :id="id"
      v-model="rawValue"
      type="number"
      inputmode="numeric"
      enterkeyhint="done"
      min="0"
      class="h-11 text-base"
      :aria-invalid="isInvalid"
      :aria-describedby="describedBy"
      @blur="emit('blur', $event)"
      @keyup.enter="emit('commit')"
    />
  </div>
</template>
