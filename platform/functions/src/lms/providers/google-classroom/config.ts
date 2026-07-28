// Google Classroom OAuth client configuration seam.
//
// Sprint 23A adopts the "getter/setter, source deferred" pattern
// approved in SPRINT_23_ARCHITECTURE_REVIEW.md §7 (Option B). The seam
// mirrors the existing `LmsTokenStore` pattern in
// `providers/../tokens/token-store.ts` so the repository does not
// accrue a second, divergent configuration convention.
//
// Invariants:
//
// - This module is package-local to `providers/google-classroom`. The
//   vendor-neutral LMS core never imports it (PDR-020f).
//
// - Sprint 23A ships no default binding. The default `getGoogleClassroomConfig`
//   throws `lms.googleClassroomConfigUnbound` if any production code
//   path resolves it. Production adapter methods still short-circuit at
//   `lms.providerNotYetOperational` in 23A, so this throw is defense
//   in depth: it proves at test time that no seam has been accidentally
//   activated.
//
// - Sprint 23B replaces the default binding with a Firebase-native
//   secret source (Secret Manager for `clientSecret`, typed parameters
//   for the non-secret values). No secret value ever appears in a
//   Firestore document, in a client bundle, in a fixture file, or in a
//   log message (PDR-019e; `LMS_INTEGRATION_ARCHITECTURE.md` §5.5,
//   §10.3.3).

import { PlatformError } from "../../../shared";

export type GoogleClassroomConfig = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
};

class UnboundGoogleClassroomConfig {
  resolve(): never {
    throw new PlatformError(
      "lms.googleClassroomConfigUnbound",
      "Google Classroom OAuth client configuration is not bound. Sprint 23A ships no default binding; the production binding is a Sprint 23B obligation. Tests must install a fixture via setGoogleClassroomConfig() or withGoogleClassroomConfig().",
    );
  }
}

type ConfigResolver = { resolve(): GoogleClassroomConfig };

const UNBOUND_CONFIG: ConfigResolver = new UnboundGoogleClassroomConfig();

let ACTIVE_CONFIG: ConfigResolver = UNBOUND_CONFIG;

export function getGoogleClassroomConfig(): GoogleClassroomConfig {
  return ACTIVE_CONFIG.resolve();
}

export function setGoogleClassroomConfig(
  config: GoogleClassroomConfig,
): void {
  ACTIVE_CONFIG = { resolve: () => config };
}

// Scoped installation helper. Restores the prior binding after `fn`
// resolves or rejects. Tests use this to guarantee cleanup even when
// an assertion throws.
export async function withGoogleClassroomConfig<T>(
  config: GoogleClassroomConfig,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = ACTIVE_CONFIG;
  ACTIVE_CONFIG = { resolve: () => config };
  try {
    return await fn();
  } finally {
    ACTIVE_CONFIG = previous;
  }
}

export function resetGoogleClassroomConfigForTests(): void {
  ACTIVE_CONFIG = UNBOUND_CONFIG;
}
