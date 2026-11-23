export const PREVIEW_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PREVIEW_IMAGE_EDGE = 96;
export const PREVIEW_IMAGE_PIXEL_BYTES = PREVIEW_IMAGE_EDGE ** 2 * 4;

export type PreviewImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export function previewImageType(contentType: string): PreviewImageType | null {
  const type = contentType.split(';', 1)[0]?.trim().toLowerCase();
  switch (type) {
    case 'image/png':
    case 'image/jpeg':
    case 'image/webp':
      return type;
    default:
      return null;
  }
}

export function matchesPreviewImageType(bytes: Uint8Array, type: PreviewImageType): boolean {
  const startsWith = (signature: readonly number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  switch (type) {
    case 'image/png':
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith([0xff, 0xd8, 0xff]);
    case 'image/webp':
      return startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8);
  }
}
