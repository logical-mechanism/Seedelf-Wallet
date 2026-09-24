// A sheet that rises from the bottom over the page, after Lace's bottom sheets:
// a modal <dialog>, so focus stays inside, Escape closes it, and so does a
// click on the dimmed page around it.

import { useEffect, useRef, type ReactNode } from "react";

import { CloseIcon } from "./Icons";

export function Sheet({
  title,
  titleId,
  onClose,
  children,
}: {
  title: ReactNode;
  titleId: string;
  onClose: () => void;
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
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet__panel">
        <header className="sheet__head">
          <h2 id={titleId} className="sheet__title">
            {title}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close">
            <CloseIcon />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
