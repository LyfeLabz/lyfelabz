import type { LaunchExecuteDeps } from "./launchRouting";
import {
  browserDeliveryPreparationDeps,
  prepareDeliveryNavigation,
} from "./deliveryNavigation";
import { enterAssignmentDelivery } from "./deliveryContext";

// F5.2 §7.3 (Slice 5): the browser wiring for the launch executor. The routing
// DECISION is server-authoritative and lives in launchRouting.ts; this only
// supplies the browser side effects it needs. `navigate` is the certified
// full-page assignment launch. `probe` is a same-origin HEAD load-check used
// only for a differentiated artifact before the navigation commits, so an
// unloadable variant (structurally exceptional under §6.8) can fall back
// visually to the standard lesson rather than land the student on a broken page;
// any failure resolves false (fail safe toward canonical). `onVariantLoadFailure`
// emits a NEUTRAL, non-sensitive anomaly (no variantKey, presentationRevisionId,
// launchRef, path, or accommodation detail) - the durable delivery outcome is
// derived server-side (Slice 6), never asserted by the client.
//
// `prepareNavigation` is the Policy E cache transition (deliveryNavigation.ts):
// the executor awaits it before every navigation, so every product launch (My
// Science canonical, differentiated, canonicalFallback, revision-bound, and the
// `/app/a/{id}` assignment and practice handoffs) replaces a pre-policy cached
// copy of its exact target before navigating to it.
export function createBrowserLaunchExecuteDeps(win: Window): LaunchExecuteDeps {
  return {
    navigate: (url: string) => {
      // Every student launch puts this tab in assignment delivery
      // (deliveryContext.ts): the lesson header offers Back to My Science.
      enterAssignmentDelivery(win);
      win.location.assign(url);
    },
    probe: async (url: string) => {
      try {
        const res = await win.fetch(url, { method: "HEAD", cache: "no-store" });
        return res.ok;
      } catch {
        return false;
      }
    },
    onVariantLoadFailure: () => {
      try {
        // eslint-disable-next-line no-console
        console.warn(
          "[lyfelabz] lesson presentation unavailable; opening the standard lesson",
        );
      } catch {
        // Observability only.
      }
    },
    prepareNavigation: (url: string) =>
      prepareDeliveryNavigation(url, browserDeliveryPreparationDeps(win)),
  };
}
