import { log } from "../../shared";
import {
  InProcessLmsOAuthStateStore,
  getLmsOAuthStateStore,
  setLmsOAuthStateStore,
} from "../oauth-state/state-store";
import { FirestoreLmsOAuthStateStore } from "../oauth-state/firestore-state-store";
import {
  getLmsTokenStore,
  setLmsTokenStore,
} from "../tokens/token-store";
import { FirestoreLmsTokenStore } from "../tokens/firestore-token-store";

// Sprint 23D. Idempotent installer that swaps the in-process OAuth
// state and token stores for durable, multi-instance-safe Firestore
// implementations.
//
// The default in-process bindings ship with the modules for parity
// with unit tests. This installer is the sole production-side seam
// that upgrades those bindings to the Firestore-backed
// implementations. It is:
//
// * Idempotent: repeat calls after the first are no-ops.
// * Test-safe: if a test has already installed a fixture through
//   `setLmsOAuthStateStore` or `setLmsTokenStore`, the installer
//   leaves the fixture in place. Only the sentinel default
//   (InProcess*) is upgraded.
//
// Autorun in the Cloud Functions runtime is delegated to
// `platform/functions/src/lms/index.ts`, which imports this module
// for its side effect and invokes `ensureLmsDurableStorageBindings`
// when the process env indicates a functions runtime (K_SERVICE or
// FUNCTION_TARGET). Unit tests neither set those env vars nor import
// through `lms/index.ts`, so the in-process defaults remain active
// under jest.

let INSTALLED = false;

export function ensureLmsDurableStorageBindings(): void {
  if (INSTALLED) return;
  INSTALLED = true;

  const currentStateStore = getLmsOAuthStateStore();
  if (currentStateStore instanceof InProcessLmsOAuthStateStore) {
    setLmsOAuthStateStore(new FirestoreLmsOAuthStateStore());
    try {
      log.info("lms.durableOAuthStateStoreInstalled", {});
    } catch {
      // Logging is observability, not lifecycle.
    }
  }

  // The default token store does not export a type sentinel; the
  // safe check is nominal (constructor name matches the in-process
  // default). This keeps the installer robust when the caller has
  // already injected a fixture through `setLmsTokenStore`.
  const currentTokenStore = getLmsTokenStore();
  const isInProcessTokenStore =
    currentTokenStore.constructor?.name === "InProcessLmsTokenStore";
  if (isInProcessTokenStore) {
    setLmsTokenStore(new FirestoreLmsTokenStore());
    try {
      log.info("lms.durableTokenStoreInstalled", {});
    } catch {
      // Logging is observability, not lifecycle.
    }
  }
}

// Test-only reset so unit tests that DO exercise this installer can
// re-run the swap in a fresh state.
export function resetLmsDurableStorageBindingsForTests(): void {
  INSTALLED = false;
}

// Detection helper for the Cloud Functions runtime. Gen2 sets
// K_SERVICE (Cloud Run) and FUNCTION_TARGET (Functions framework);
// the Firebase Emulator Suite also sets FUNCTION_TARGET when running
// functions. Unit tests set neither.
export function isFunctionsRuntime(): boolean {
  return (
    typeof process.env.K_SERVICE === "string" ||
    typeof process.env.FUNCTION_TARGET === "string"
  );
}
