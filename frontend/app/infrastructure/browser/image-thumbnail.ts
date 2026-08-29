import type {
  ImageThumbnail,
  ImageThumbnailPort,
} from '../../application/ports/image-thumbnail'

interface LoadedImage {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new TypeError('image thumbnail unavailable'))
    }, 'image/png')
  })
}

async function loadImage(source: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(source)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }
  }

  const url = URL.createObjectURL(source)
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

export class BrowserImageThumbnail implements ImageThumbnailPort {
  async create(source: Blob, maximumEdge: number): Promise<ImageThumbnail> {
    if (!Number.isInteger(maximumEdge) || maximumEdge < 32 || maximumEdge > 512) {
      throw new TypeError('invalid thumbnail size')
    }
    const image = await loadImage(source)
    try {
      if (image.width < 1 || image.height < 1) throw new TypeError('invalid image dimensions')
      const scale = Math.min(1, maximumEdge / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new TypeError('image thumbnail unavailable')
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height)
      return {
        body: await canvasPng(canvas),
        pixelWidth: image.width,
        pixelHeight: image.height,
      }
    } finally {
      image.release()
    }
  }
}
