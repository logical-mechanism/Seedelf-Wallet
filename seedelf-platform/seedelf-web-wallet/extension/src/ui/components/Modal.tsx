// A modal, centred over the dimmed page: a <dialog>, so focus stays inside,
// Escape closes it, and so does a click around it. It's never taller than the
// window; its body scrolls instead, so nothing is cut off in the popup.

import { useEffect, useRef, type ReactNode } from "react";

import { CloseIcon } from "./Icons";

export function Modal({
  title,
  titleId,
  onClose,
  foot,
  children,
}: {
  title: ReactNode;
  titleId: string;
  onClose: () => void;
  /** Stays in view under the body, which scrolls. */
  foot?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header className="modal__head">
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close">
          <CloseIcon />
        </button>
      </header>
      <div className="modal__body">{children}</div>
      {foot && <div className="modal__foot">{foot}</div>}
    </dialog>
  );
}
