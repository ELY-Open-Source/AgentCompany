import { useRef, useState, type ChangeEvent } from "react";
import { Avatar, AVATAR_COLORS, Button, Field } from "./ui";
import { t } from "../i18n/i18n";

/** Longest edge of a stored portrait; keeps data URLs at a few kilobytes. */
const PORTRAIT_SIZE = 96;

/**
 * Form-embedded avatar editor: an uploaded portrait (downscaled to a small
 * data URL), or an emoji (or empty for initials) on a background swatch.
 * Submits through the surrounding form as `avatarImage`, `avatarEmoji`, and
 * `avatarColor`; the "auto" swatch clears the color back to the name-hashed
 * palette and "Remove photo" falls back to emoji/initials.
 */
export function AvatarField({
  previewName,
  defaultEmoji,
  defaultColor,
  defaultImage,
}: {
  previewName: string;
  defaultEmoji: string | null;
  defaultColor: string | null;
  defaultImage?: string | null;
}) {
  const [emoji, setEmoji] = useState(defaultEmoji ?? "");
  const [color, setColor] = useState(defaultColor ?? "");
  const [image, setImage] = useState(defaultImage ?? "");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onFileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setUploadError(null);
    void portraitDataUrl(file)
      .then(setImage)
      .catch((error) => setUploadError(error instanceof Error ? error.message : String(error)));
  };

  return (
    <Field label={t("Avatar")}>
      <div className="avatar-editor">
        <Avatar name={previewName || "?"} size="lg" look={{ emoji: emoji.trim() || null, color: color || null, image: image || null }} />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          aria-label={t("Avatar image file")}
          onChange={onFileChosen}
        />
        <Button size="small" onClick={() => fileInputRef.current?.click()}>{t("Upload photo")}</Button>
        {image && <Button size="small" onClick={() => setImage("")}>{t("Remove photo")}</Button>}
        <input
          className="input avatar-emoji-input"
          name="avatarEmoji"
          value={emoji}
          maxLength={8}
          placeholder="🙂"
          aria-label={t("Avatar emoji")}
          onChange={(event) => setEmoji(event.currentTarget.value)}
        />
        <div className="avatar-swatches" aria-label={t("Avatar color")}>
          <button
            type="button"
            className={`avatar-swatch auto ${color === "" ? "selected" : ""}`.trim()}
            title={t("Auto")}
            aria-label={t("Auto color")}
            onClick={() => setColor("")}
          />
          {AVATAR_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`avatar-swatch ${color === swatch ? "selected" : ""}`.trim()}
              style={{ background: swatch }}
              title={swatch}
              aria-label={t("Color {color}", { color: swatch })}
              onClick={() => setColor(swatch)}
            />
          ))}
        </div>
        <input type="hidden" name="avatarColor" value={color} />
        <input type="hidden" name="avatarImage" value={image} />
        {uploadError && <div className="form-error" role="alert">{uploadError}</div>}
      </div>
    </Field>
  );
}

/**
 * Downscales the chosen picture to a small square cover crop and returns a
 * compact data URL. PNG keeps transparency; everything else compresses to
 * JPEG.
 */
async function portraitDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error(t("That file could not be read as an image."));
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = PORTRAIT_SIZE;
    canvas.height = PORTRAIT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t("That file could not be read as an image."));
    const scale = Math.max(PORTRAIT_SIZE / bitmap.width, PORTRAIT_SIZE / bitmap.height);
    const drawW = bitmap.width * scale;
    const drawH = bitmap.height * scale;
    ctx.drawImage(bitmap, (PORTRAIT_SIZE - drawW) / 2, (PORTRAIT_SIZE - drawH) / 2, drawW, drawH);
    return file.type === "image/png" ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}
