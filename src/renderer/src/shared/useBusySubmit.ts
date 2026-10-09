import { useRef, useState, type FormEvent } from "react";

/** Wraps a form's submit: while the returned promise is pending the form is busy and further submits are ignored. */
export function useBusySubmit(onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<unknown>): { busy: boolean; submit: (event: FormEvent<HTMLFormElement>) => void } {
  // The ref guards submits in the same tick, before the busy state has rendered.
  const pendingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    if (pendingRef.current) {
      event.preventDefault();
      return;
    }
    const pending = onSubmit(event);
    if (!(pending instanceof Promise)) return;
    pendingRef.current = true;
    setBusy(true);
    // A failure the caller did not handle still surfaces once, as an unhandled rejection the failure toasts show.
    void pending.finally(() => {
      pendingRef.current = false;
      setBusy(false);
    });
  };
  return { busy, submit };
}
