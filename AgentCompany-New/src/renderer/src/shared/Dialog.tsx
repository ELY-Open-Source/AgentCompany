import type { FormEvent, ReactNode } from "react";
import { Button } from "./ui";

export function Dialog({
  title,
  open,
  children,
  submitLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  open: boolean;
  children: ReactNode;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={onSubmit}>
        <h2 className="modal-title">{title}</h2>
        <div style={{ display: "grid", gap: 12 }}>{children}</div>
        <div className="modal-actions">
          <Button tone="ghost" onClick={onClose}>Cancel</Button>
          <Button tone="primary" type="submit">{submitLabel}</Button>
        </div>
      </form>
    </div>
  );
}
