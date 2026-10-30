// The frame of Lite's small dialogs (hand to a teammate, message another
// agent): a raised card near the top of the window over a dim backdrop, a
// title and the thing it is about, then the dialog's own parts. Radix gives
// it the focus trap, Escape and the outside click; aria-modal tells the
// shortcut dispatcher a modal is open, so global keys stay quiet under it.
// Mounted only while open: a closed dialog runs none of its hooks.
import "./collab.css";
import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

export function LiteDialog({ title, subject, label, onClose, onCloseAutoFocus, children }: {
  title: string;
  /** What the dialog is about (a session's title), under the title. */
  subject?: string | null;
  /** The dialog's accessible name when it differs from the title. */
  label?: string;
  onClose: () => void;
  /** Where focus goes when it closes: preventDefault keeps it off the
   *  trigger, for a dialog that hands the keyboard to the composer. */
  onCloseAutoFocus?: (e: Event) => void;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-lite="" className="lt-dialog-backdrop" />
        <DialogPrimitive.Content
          data-lite=""
          aria-modal="true"
          aria-label={label}
          aria-describedby={undefined}
          className="lt-dialog"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="lt-dialog-head">
            <DialogPrimitive.Title asChild>
              <h2>{title}</h2>
            </DialogPrimitive.Title>
            {subject ? <span title={subject}>{subject}</span> : null}
          </header>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
