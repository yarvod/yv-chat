import { afterEach, describe, expect, it, vi } from 'vitest'

import { BrowserImageThumbnail } from '../app/infrastructure/browser/image-thumbnail'

const createImageBitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')

afterEach(() => {
  if (createImageBitmapDescriptor) {
    Object.defineProperty(globalThis, 'createImageBitmap', createImageBitmapDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'createImageBitmap')
  }
  vi.restoreAllMocks()
})

describe('browser image thumbnail', () => {
  it('releases the full bitmap after creating a bounded PNG preview', async () => {
    const close = vi.fn()
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn(async () => ({ width: 4_032, height: 3_024, close })),
    })
    const drawImage = vi.fn()
    let renderedWidth = 0
    let renderedHeight = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (this: HTMLCanvasElement) {
        renderedWidth = this.width
        renderedHeight = this.height
        return {
          drawImage,
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'low',
        } as unknown as CanvasRenderingContext2D
      })
    const thumbnailBody = new Blob(['small'], { type: 'image/png' })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(callback => callback(thumbnailBody))

    const result = await new BrowserImageThumbnail().create(
      new Blob(['full'], { type: 'image/jpeg' }),
      160,
    )

    expect(renderedWidth).toBe(160)
    expect(renderedHeight).toBe(120)
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 160, 120)
    expect(result).toEqual({
      body: thumbnailBody,
      pixelWidth: 4_032,
      pixelHeight: 3_024,
    })
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects unbounded thumbnail dimensions before decoding', async () => {
    const decode = vi.fn()
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: decode,
    })

    await expect(new BrowserImageThumbnail().create(new Blob(['x']), 2_048))
      .rejects.toThrow('invalid thumbnail size')
    expect(decode).not.toHaveBeenCalled()
  })
})
