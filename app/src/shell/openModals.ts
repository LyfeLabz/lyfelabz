// Teacher-workspace modal dialogs (the Curriculum Assign / Update dialog and
// the class Settings dialog) are appended to `document.body`, outside the
// shell outlet, so they are NOT removed when the outlet changes surface.
// Browser Back/Forward restores a different page underneath; without this, a
// dialog opened on one page would stay on screen over another.
//
// Dialogs are ephemeral UI, not history pages (no history entry is created
// for them). Each open dialog registers the SAME dismissal its own Escape
// key performs, and the shell's popstate handler dismisses any open dialog
// before restoring the requested page. Unsaved dialog input is discarded
// exactly as Escape / Cancel already discards it.

const openDismissals = new Set<() => void>();

// Registers an open dialog's dismissal. Returns the unregister function the
// dialog calls from its own close path.
export function registerOpenModal(dismiss: () => void): () => void {
  openDismissals.add(dismiss);
  return () => {
    openDismissals.delete(dismiss);
  };
}

export function dismissOpenModals(): void {
  for (const dismiss of Array.from(openDismissals)) {
    openDismissals.delete(dismiss);
    try {
      dismiss();
    } catch {
      // A dialog that fails to close must not block navigation.
    }
  }
}
