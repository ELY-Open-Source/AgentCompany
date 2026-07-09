import { useState } from "react";
import { Avatar, AVATAR_COLORS, Field } from "./ui";
import { t } from "../i18n/i18n";

/**
 * Form-embedded avatar editor: an emoji (or empty for initials) plus a
 * background swatch. Submits through the surrounding form as `avatarEmoji`
 * and `avatarColor`; the "auto" swatch clears the color back to the
 * name-hashed palette.
 */
export function AvatarField({
  previewName,
  defaultEmoji,
  defaultColor,
}: {
  previewName: string;
  defaultEmoji: string | null;
  defaultColor: string | null;
}) {
  const [emoji, setEmoji] = useState(defaultEmoji ?? "");
  const [color, setColor] = useState(defaultColor ?? "");
  return (
    <Field label={t("Avatar")}>
      <div className="avatar-editor">
        <Avatar name={previewName || "?"} size="lg" look={{ emoji: emoji.trim() || null, color: color || null }} />
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
      </div>
    </Field>
  );
}
