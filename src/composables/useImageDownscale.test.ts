import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeDownscaledDimensions,
  useImageDownscale,
  type DrawableCanvas,
} from './useImageDownscale'

describe('computeDownscaledDimensions', () => {
  it('scales a wide landscape photo down to a 1600px long edge', () => {
    expect(computeDownscaledDimensions(4000, 3000)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales a tall portrait photo down to a 1600px long edge', () => {
    expect(computeDownscaledDimensions(3000, 4000)).toEqual({ width: 1200, height: 1600 })
  })

  it('scales a square photo down to a 1600x1600 square', () => {
    expect(computeDownscaledDimensions(2000, 2000)).toEqual({ width: 1600, height: 1600 })
  })

  it('never upscales a photo already under the cap', () => {
    expect(computeDownscaledDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('leaves a photo exactly at the cap unchanged', () => {
    expect(computeDownscaledDimensions(1600, 900)).toEqual({ width: 1600, height: 900 })
  })

  it('honors a custom max long edge', () => {
    expect(computeDownscaledDimensions(800, 400, 400)).toEqual({ width: 400, height: 200 })
  })
})

/** A fake `ImageBitmap`: just `width`, `height` and `close()`. */
function makeFakeBitmap(width: number, height: number) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap
}

function makeFakeCanvas(blob: Blob | null): {
  canvas: DrawableCanvas
  drawImage: ReturnType<typeof vi.fn>
  context: { imageSmoothingQuality?: ImageSmoothingQuality }
} {
  const drawImage = vi.fn()
  const context: { drawImage: typeof drawImage; imageSmoothingQuality?: ImageSmoothingQuality } = {
    drawImage,
  }
  const canvas: DrawableCanvas = {
    getContext: () => context as unknown as CanvasRenderingContext2D,
    toBlob: (callback) => callback(blob),
  }
  return { canvas, drawImage, context }
}

describe('useImageDownscale().downscale', () => {
  it('draws the bitmap at the computed dimensions and returns the encoded base64 + mime type', async () => {
    const bitmap = makeFakeBitmap(4000, 3000)
    const fakeBlob = { size: 3 } as Blob
    const { canvas, drawImage } = makeFakeCanvas(fakeBlob)
    const createCanvas = vi.fn().mockReturnValue(canvas)
    const blobToBase64 = vi.fn().mockResolvedValue('ZmFrZQ==')

    const { downscale } = useImageDownscale({
      loadBitmap: async () => bitmap,
      createCanvas,
      blobToBase64,
    })

    const result = await downscale(new Blob())

    expect(createCanvas).toHaveBeenCalledWith(1600, 1200)
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 1200)
    expect(blobToBase64).toHaveBeenCalledWith(fakeBlob)
    expect(result).toEqual({ base64: 'ZmFrZQ==', mimeType: 'image/jpeg' })
  })

  it('draws with high-quality smoothing so small corner indices stay legible', async () => {
    const { canvas, drawImage, context } = makeFakeCanvas({ size: 3 } as Blob)
    let qualityWhenDrawn: ImageSmoothingQuality | undefined
    drawImage.mockImplementation(() => {
      qualityWhenDrawn = context.imageSmoothingQuality
    })

    const { downscale } = useImageDownscale({
      loadBitmap: async () => makeFakeBitmap(4000, 3000),
      createCanvas: () => canvas,
      blobToBase64: async () => 'ZmFrZQ==',
    })
    await downscale(new Blob())

    expect(qualityWhenDrawn).toBe('high')
  })

  it('never upscales a photo already under the cap', async () => {
    const bitmap = makeFakeBitmap(800, 600)
    const { canvas } = makeFakeCanvas({} as Blob)
    const createCanvas = vi.fn().mockReturnValue(canvas)

    const { downscale } = useImageDownscale({
      loadBitmap: async () => bitmap,
      createCanvas,
      blobToBase64: async () => 'base64',
    })

    await downscale(new Blob())

    expect(createCanvas).toHaveBeenCalledWith(800, 600)
  })

  it('closes the bitmap even when canvas encoding fails', async () => {
    const bitmap = makeFakeBitmap(100, 100)
    const { canvas } = makeFakeCanvas(null) // toBlob calls back with null -> encoding rejects

    const { downscale } = useImageDownscale({
      loadBitmap: async () => bitmap,
      createCanvas: () => canvas,
      blobToBase64: async () => 'unused',
    })

    await expect(downscale(new Blob())).rejects.toThrow('canvas encoding failed')
    expect(bitmap.close).toHaveBeenCalledOnce()
  })

  it('closes the bitmap even when the 2d context is unavailable', async () => {
    const bitmap = makeFakeBitmap(100, 100)
    const canvas: DrawableCanvas = {
      getContext: () => null,
      toBlob: vi.fn(),
    }

    const { downscale } = useImageDownscale({
      loadBitmap: async () => bitmap,
      createCanvas: () => canvas,
    })

    await expect(downscale(new Blob())).rejects.toThrow('2d canvas context unavailable')
    expect(bitmap.close).toHaveBeenCalledOnce()
  })
})

describe('useImageDownscale().downscale, in the browser (its defaults)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('decodes the photo with its EXIF orientation applied, so iOS photos come out upright', async () => {
    const loadBitmap = vi.fn().mockResolvedValue(makeFakeBitmap(100, 100))
    vi.stubGlobal('createImageBitmap', loadBitmap)
    const { canvas } = makeFakeCanvas(new Blob(['fake']))
    const file = new Blob()

    await useImageDownscale({ createCanvas: () => canvas }).downscale(file)

    expect(loadBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' })
  })

  it('draws on a page canvas sized to the downscaled dimensions', async () => {
    const { canvas } = makeFakeCanvas(new Blob(['fake']))
    const drawnSizes: Array<{ width: number; height: number }> = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      drawnSizes.push({ width: this.width, height: this.height })
      return canvas.getContext('2d')
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
      callback(new Blob(['fake'])),
    )

    await useImageDownscale({
      loadBitmap: async () => makeFakeBitmap(4000, 3000),
      blobToBase64: async () => 'ZmFrZQ==',
    }).downscale(new Blob())

    expect(drawnSizes).toEqual([{ width: 1600, height: 1200 }])
  })

  it('returns the JPEG as bare base64, without the data URL prefix', async () => {
    const { canvas } = makeFakeCanvas(new Blob(['fake']))

    const result = await useImageDownscale({
      loadBitmap: async () => makeFakeBitmap(100, 100),
      createCanvas: () => canvas,
    }).downscale(new Blob())

    expect(result.base64).toBe('ZmFrZQ==')
  })

  it('rejects with the read error, and still closes the bitmap, when the JPEG cannot be read', async () => {
    const readError = new Error('NotReadableError')
    vi.stubGlobal(
      'FileReader',
      class {
        error = readError
        onerror: (() => void) | null = null
        readAsDataURL(): void {
          this.onerror?.()
        }
      },
    )
    const bitmap = makeFakeBitmap(100, 100)
    const { canvas } = makeFakeCanvas(new Blob(['fake']))

    const outcome = useImageDownscale({
      loadBitmap: async () => bitmap,
      createCanvas: () => canvas,
    }).downscale(new Blob())

    await expect(outcome).rejects.toBe(readError)
    expect(bitmap.close).toHaveBeenCalledOnce()
  })
})
