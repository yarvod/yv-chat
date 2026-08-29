import type { ClipboardPort } from '../../application/ports/clipboard'

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new TypeError('image conversion unavailable'))
    }, 'image/png')
  })
}

async function loadImage(blob: Blob): Promise<{
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }
  }

  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  }
}

async function clipboardPng(value: Blob): Promise<Blob> {
  if (value.type.toLowerCase() === 'image/png') return value
  const image = await loadImage(value)
  try {
    if (image.width < 1 || image.height < 1) throw new TypeError('invalid image dimensions')
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new TypeError('image conversion unavailable')
    context.drawImage(image.source, 0, 0)
    return await canvasPng(canvas)
  } finally {
    image.release()
  }
}

export class BrowserClipboard implements ClipboardPort {
  async writeText(value: string): Promise<void> {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(value)
  }

  async writeImage(value: Blob | Promise<Blob>): Promise<void> {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('image clipboard unavailable')
    }
    const png = Promise.resolve(value).then(clipboardPng)
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': png }),
    ])
  }
}
