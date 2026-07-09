import type { BootstrapAuthInput, BootstrapFirestoreInput, Session } from "./types";
import { bootstrapSession } from "./bootstrap";

// Thin re-run helper. Route surfaces call this to force a fresh Session
// object without patching the current one in place. Session objects are
// immutable; every state transition is realized by re-running the
// bootstrap and letting the router re-dispatch (Step 4 §3.6).
export function makeRefreshSession(
  auth: BootstrapAuthInput,
  db: BootstrapFirestoreInput,
  render: (session: Session) => void,
): () => Promise<void> {
  return async () => {
    const session = await bootstrapSession(auth, db);
    render(session);
  };
}
