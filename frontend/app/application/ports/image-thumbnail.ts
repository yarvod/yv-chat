export interface ImageThumbnail {
  body: Blob
  pixelWidth: number
  pixelHeight: number
}

export interface ImageThumbnailPort {
  create(source: Blob, maximumEdge: number): Promise<ImageThumbnail>
}
