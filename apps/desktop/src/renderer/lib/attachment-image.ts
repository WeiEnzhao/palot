/**
 * Shared raster preview rules for message attachments.
 *
 * The read-image preview and the native attachment byte limit both allow a small
 * raster set; keeping the list here means every path that turns a prompt
 * attachment into a `PalotFileAttachment` produces the same preview.
 */
const ATTACHMENT_IMAGE_MIMES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Turn inline base64 attachment bytes into a data URL usable as an <img> source.
 * Returns undefined for non-raster types, oversized payloads or malformed base64.
 */
export function attachmentImageDataUrl(
  mime: string | undefined,
  data: unknown,
): string | undefined {
  if (!mime || typeof data !== "string") return undefined;
  const normalized = mime.toLowerCase();
  if (!ATTACHMENT_IMAGE_MIMES.has(normalized)) return undefined;
  if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return undefined;
  if (data.length % 4 !== 0) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return undefined;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  if ((data.length / 4) * 3 - padding > MAX_IMAGE_BYTES) return undefined;
  return `data:${normalized};base64,${data}`;
}
