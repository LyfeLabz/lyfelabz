// Return-affordance logic. Certified by PRESENT_MODE_ARCHITECTURE.md
// §14.4 through §14.6.
//
// This TypeScript module is the reference implementation for the
// lightweight return script that ships as a plain .js artifact on the
// canonical instructional experience. The behavior encoded here and the
// behavior of `assets/present-mode-return.js` must remain identical;
// tests in this package exercise the reference implementation and the
// plain-JS artifact under jsdom.
//
// The script does not import Firebase Authentication, Firestore, or
// Functions. It reads only the certified sessionStorage marker and, if
// the marker validates, renders a single semantic button whose only
// capability is same-tab navigation back to the Teacher Workspace.
//
// Privacy posture: no teacher, class, or student identifier is loaded or
// rendered. Absent or invalid markers no-op. See PRESENT_MODE_ARCHITECTURE
// §5, §6, §7, and PLATFORM_CONTRACTS §8, §9.

import {
  PRESENT_MODE_RETURN_CONTEXT_KEY,
  clearReturnContext,
  parseReturnContext,
  type ReturnContext,
  type ReturnContextStorage,
  type CertifiedReturnSurface,
} from "./launchContext";

// Certified accessible copy. PRESENT_MODE_ARCHITECTURE §14.4.
export const RETURN_CONTROL_LABEL = "Return to Teacher Workspace";

export const RETURN_CONTROL_TESTID = "present-mode-return";

// Product-concept → Teacher Workspace entry URL. `returnSurface` is a
// workspace-surface identifier, not a URL. The canonical instructional
// experience opts a returning teacher back into the authenticated shell,
// which resolves Curriculum as its default landing surface.
const WORKSPACE_ENTRY_URL: Readonly<Record<CertifiedReturnSurface, string>> =
  Object.freeze({
    curriculum: "/app/teacher",
  });

export function returnUrlFor(surface: CertifiedReturnSurface): string {
  return WORKSPACE_ENTRY_URL[surface];
}

export interface ReturnControlNavigator {
  assign(url: string): void;
}

export type ReturnControlDeps = {
  readonly storage: ReturnContextStorage;
  readonly navigator: ReturnControlNavigator;
};

// Render the certified return control. Returns the injected element, or
// `null` when no valid marker is present (safe failure).
export function renderReturnControl(
  doc: Document,
  deps: ReturnControlDeps,
): HTMLButtonElement | null {
  const raw = deps.storage.getItem(PRESENT_MODE_RETURN_CONTEXT_KEY);
  const ctx = parseReturnContext(raw);
  if (ctx === null) return null;
  return injectReturnControl(doc, ctx, deps);
}

function injectReturnControl(
  doc: Document,
  ctx: ReturnContext,
  deps: ReturnControlDeps,
): HTMLButtonElement {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.textContent = RETURN_CONTROL_LABEL;
  btn.setAttribute("data-testid", RETURN_CONTROL_TESTID);
  btn.setAttribute("aria-label", RETURN_CONTROL_LABEL);
  btn.className = "present-mode-return";
  const style = btn.style;
  style.position = "fixed";
  style.top = "12px";
  style.right = "12px";
  style.zIndex = "99999";
  style.padding = "10px 16px";
  style.borderRadius = "6px";
  style.border = "2px solid #222";
  style.background = "#fff";
  style.color = "#111";
  style.font =
    "600 14px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  style.cursor = "pointer";
  style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
  btn.addEventListener("click", () => {
    const target = returnUrlFor(ctx.returnSurface);
    clearReturnContext(deps.storage);
    deps.navigator.assign(target);
  });
  doc.body.appendChild(btn);
  return btn;
}
