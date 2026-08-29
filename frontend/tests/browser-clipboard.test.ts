import { afterEach, describe, expect, it, vi } from 'vitest'

import { BrowserClipboard } from '../app/infrastructure/browser/clipboard'

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem')
const createImageBitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')

interface RecordedClipboardItem {
  readonly data: ClipboardItemData
}

class FakeClipboardItem implements RecordedClipboardItem {
  constructor(readonly data: ClipboardItemData) {}
}

function installClipboard(write: (items: readonly ClipboardItem[]) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write, writeText: vi.fn() },
  })
  Object.defineProperty(globalThis, 'ClipboardItem', {
    configurable: true,
    value: FakeClipboardItem,
  })
}

afterEach(() => {
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  if (clipboardItemDescriptor) {
    Object.defineProperty(globalThis, 'ClipboardItem', clipboardItemDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'ClipboardItem')
  }
  if (createImageBitmapDescriptor) {
    Object.defineProperty(globalThis, 'createImageBitmap', createImageBitmapDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'createImageBitmap')
  }
  vi.restoreAllMocks()
})

describe('browser clipboard', () => {
  it('starts clipboard write before a pending PNG attachment finishes loading', async () => {
    let resolveImage: ((blob: Blob) => void) | undefined
    const pendingImage = new Promise<Blob>(resolve => { resolveImage = resolve })
    const write = vi.fn(async () => undefined)
    installClipboard(write)

    const request = new BrowserClipboard().writeImage(pendingImage)

    expect(write).toHaveBeenCalledOnce()
    const item = write.mock.calls[0]?.[0][0] as unknown as RecordedClipboardItem
    const png = new Blob(['png'], { type: 'image/png' })
    resolveImage?.(png)
    await request
    await expect(item.data['image/png']).resolves.toBe(png)
  })

  it('converts a non-PNG image to the portable PNG clipboard type', async () => {
    const close = vi.fn()
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      value: vi.fn(async () => ({ width: 4, height: 3, close })),
    })
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(callback => callback(new Blob(['converted'], { type: 'image/png' })))
    let copied: Blob | null = null
    const write = vi.fn(async items => {
      const item = items[0] as unknown as RecordedClipboardItem
      copied = await item.data['image/png']
    })
    installClipboard(write)

    await new BrowserClipboard().writeImage(new Blob(['jpeg'], { type: 'image/jpeg' }))

    expect(drawImage).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(copied).toBeInstanceOf(Blob)
    expect(copied?.type).toBe('image/png')
  })
})
