import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/** Generic bottom sheet wrapper, styled with the shared .sheet classes. Locks body scroll while open. */
export default function AdjustSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet__backdrop" onClick={onClose} />
      <div className="sheet__panel stack">
        <div className="sheet__handle" />
        <div className="topbar" style={{ marginBottom: 0 }}>
          <h2>{title}</h2>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            <X className="ic" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
