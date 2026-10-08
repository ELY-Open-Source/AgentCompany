/** Avatar colors persist as #rrggbb; anything else is a caller bug. */
export function normalizeAvatarColor(value: string): string | null {
  const color = value.trim();
  if (!color) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("Avatar color must be a #rrggbb hex value.");
  return color.toLowerCase();
}

/** Portraits are small base64 data URLs; the cap keeps the snapshot from ballooning. */
const MAX_AVATAR_IMAGE_CHARS = 300_000;

export function normalizeAvatarImage(value: string): string | null {
  const image = value.trim();
  if (!image) return null;
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
    throw new Error("Avatar image must be a base64 data URL (png, jpeg, or webp).");
  }
  if (image.length > MAX_AVATAR_IMAGE_CHARS) {
    throw new Error("Avatar image is too large - upload a smaller picture.");
  }
  return image;
}
