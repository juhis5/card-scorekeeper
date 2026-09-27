// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateContentMock = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI() {
    return { models: { generateContent: generateContentMock } }
  }),
  Type: { OBJECT: 'OBJECT', ARRAY: 'ARRAY', STRING: 'STRING', NUMBER: 'NUMBER' },
  ThinkingLevel: { LOW: 'LOW' },
}))

const { createGeminiClient } = await import('./gemini')
const { MAX_DETECTED_CARDS } = await import('./extraction')

beforeEach(() => {
  vi.clearAllMocks()
  generateContentMock.mockResolvedValue({ text: '{"cards":[]}' })
})

function sentRequest() {
  return generateContentMock.mock.calls[0]?.[0] as {
    model: string
    config: Record<string, unknown> & {
      responseSchema: { properties: { cards: { maxItems: string } } }
    }
  }
}

describe('createGeminiClient', () => {
  it('uses the model it was configured with', async () => {
    await createGeminiClient('key', 'gemini-3.8-flash').extractCards('aGVsbG8=', 'image/jpeg')

    expect(sentRequest().model).toBe('gemini-3.8-flash')
  })

  it('bounds the call: a deadline, an output cap and low thinking', async () => {
    await createGeminiClient('key', 'gemini-3.8-flash').extractCards('aGVsbG8=', 'image/jpeg')

    const { config } = sentRequest()
    expect(config.abortSignal).toBeInstanceOf(AbortSignal)
    expect(config.maxOutputTokens).toBeGreaterThan(0)
    expect(config.thinkingConfig).toEqual({ thinkingLevel: 'LOW' })
    expect(config.responseSchema.properties.cards.maxItems).toBe(String(MAX_DETECTED_CARDS))
  })

  it('leaves temperature at the model default, as Google advises for 3.x models', async () => {
    await createGeminiClient('key', 'gemini-3.8-flash').extractCards('aGVsbG8=', 'image/jpeg')

    expect(sentRequest().config).not.toHaveProperty('temperature')
  })
})
