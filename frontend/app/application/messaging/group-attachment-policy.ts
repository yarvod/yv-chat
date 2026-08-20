import type { MessageAttachmentKind } from '../../domain/messaging/models'

export const GROUP_ATTACHMENT_LIMIT = 10
export const IMAGE_MAX_BYTES = 12 * 1024 * 1024
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024
export const FILE_MAX_BYTES = 25 * 1024 * 1024
export const AES_GCM_TAG_BYTES = 16

export const PREVIEWABLE_IMAGE_TYPES = new Set([
  'image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp',
])

export const PREVIEWABLE_VIDEO_TYPES = new Set([
  'video/mp4', 'video/ogg', 'video/quicktime', 'video/webm', 'video/x-m4v',
])

export const STICKER_IMAGE_TYPES = new Set(['image/gif', 'image/webp'])

export function supportsStickerPresentation(contentType: string): boolean {
  return STICKER_IMAGE_TYPES.has(normalizeAttachmentContentType(contentType))
}

export function normalizeAttachmentContentType(value: string): string {
  const normalized = value.trim().toLowerCase()
  return normalized || 'application/octet-stream'
}

export function attachmentKindFor(contentType: string): MessageAttachmentKind {
  const normalized = normalizeAttachmentContentType(contentType)
  if (PREVIEWABLE_IMAGE_TYPES.has(normalized)) return 'image'
  if (PREVIEWABLE_VIDEO_TYPES.has(normalized)) return 'video'
  return 'file'
}

export function maximumAttachmentBytes(kind: MessageAttachmentKind): number {
  if (kind === 'image') return IMAGE_MAX_BYTES
  if (kind === 'video') return VIDEO_MAX_BYTES
  return FILE_MAX_BYTES
}

export function maximumDirectAttachmentBytes(kind: MessageAttachmentKind): number {
  return Math.min(maximumAttachmentBytes(kind), FILE_MAX_BYTES - AES_GCM_TAG_BYTES)
}
