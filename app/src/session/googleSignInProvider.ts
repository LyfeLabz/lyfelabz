// Narrow authentication UX fix. Extracted as a pure, directly-testable
// function because `index.ts` is a self-executing bootstrap entry point
// (no exported surface, runs real Firebase/DOM side effects at module
// load) and is not itself unit-testable.
//
// Without requesting Google's account-selection interstitial, Google
// silently reuses whichever Google account already has an active session
// in the browser: a signed-out LyfeLabz user who clicks "Continue with
// Google" intending to switch accounts is instead signed straight back in
// as the previous account, with no opportunity to choose. This affects
// only the base LyfeLabz sign-in flow; it does not change the one-role-
// per-Google-account model, onboarding, or any Google Classroom OAuth
// behavior.
export type ConfigurableAuthProvider = {
  readonly setCustomParameters: (customOAuthParameters: Record<string, string>) => unknown;
};

export function configureGoogleSignInProvider(
  provider: ConfigurableAuthProvider,
): void {
  provider.setCustomParameters({ prompt: "select_account" });
}
