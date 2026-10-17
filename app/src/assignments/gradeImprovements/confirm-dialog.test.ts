/**
 * @jest-environment jsdom
 *
 * Grade Improvements V1: modal focus containment for the shared confirmation
 * dialog (Assignment Detail "Update Grade" and Student Detail "Undo").
 */
import { openGradeConfirmDialog, type GradeConfirmOutcome } from "./confirm-dialog";
import { dismissOpenModals } from "../../shell/openModals";

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid=${id}]`);
const dialog = () => byTestId("gi-dialog");
const cancel = () => byTestId("gi-dialog-cancel") as HTMLButtonElement;
const confirm = () => byTestId("gi-dialog-confirm") as HTMLButtonElement;

function press(key: string, shiftKey = false): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(ev);
  return ev;
}

function setup(onConfirm: () => Promise<GradeConfirmOutcome> = async () => ({ ok: true })) {
  const trigger = document.createElement("button");
  trigger.textContent = "Update Grade";
  const background = document.createElement("button");
  background.textContent = "Sign out";
  document.body.append(background, trigger);
  trigger.focus();
  const onClose = jest.fn();
  openGradeConfirmDialog(document, {
    testid: "gi-dialog",
    title: "Mark Grade as Updated?",
    body: "Have you updated Ada's grade from 60% to 90%?",
    confirmLabel: "Yes, Updated",
    onConfirm,
    onClose,
    returnFocusTo: trigger,
  });
  return { trigger, background, onClose };
}

afterEach(() => {
  dismissOpenModals();
  document.body.innerHTML = "";
});

describe("openGradeConfirmDialog focus containment", () => {
  test("keeps modal semantics and starts on Cancel", () => {
    setup();
    const d = dialog()!;
    expect(d.getAttribute("role")).toBe("dialog");
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-labelledby")).toBe("gi-dialog-title");
    expect(d.getAttribute("aria-describedby")).toBe("gi-dialog-description");
    expect(document.activeElement).toBe(cancel());
  });

  test("Tab cycles forward and wraps inside the dialog", () => {
    setup();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm());
    press("Tab");
    expect(document.activeElement).toBe(cancel());
  });

  test("Shift+Tab cycles backward and wraps inside the dialog", () => {
    setup();
    press("Tab", true);
    expect(document.activeElement).toBe(confirm());
    press("Tab", true);
    expect(document.activeElement).toBe(cancel());
  });

  test("focus moved to a background control is pulled back into the dialog", () => {
    const { background } = setup();
    background.focus();
    expect(dialog()!.contains(document.activeElement)).toBe(true);
  });

  test("Escape closes, returns focus to the trigger, and removes containment", () => {
    const { trigger, background, onClose } = setup();
    press("Escape");
    expect(dialog()).toBeNull();
    expect(onClose).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(trigger);
    // No leaked listeners: background focus and Tab behave normally again.
    background.focus();
    expect(document.activeElement).toBe(background);
    expect(press("Tab").defaultPrevented).toBe(false);
  });

  test("Cancel returns focus to the trigger", () => {
    const { trigger } = setup();
    cancel().click();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("browser Back (shell modal dismissal) closes like Cancel and removes containment", () => {
    const { trigger, background, onClose } = setup();
    dismissOpenModals();
    expect(dialog()).toBeNull();
    expect(onClose).toHaveBeenCalledWith(false);
    expect(document.activeElement).toBe(trigger);
    background.focus();
    expect(document.activeElement).toBe(background);
  });

  test("while saving, focus stays on the busy dialog and Tab cannot escape", async () => {
    let release: (o: GradeConfirmOutcome) => void = () => undefined;
    const { background } = setup(() => new Promise<GradeConfirmOutcome>((r) => (release = r)));
    confirm().focus();
    confirm().click();
    const d = dialog()!;
    expect(confirm().disabled).toBe(true);
    expect(confirm().textContent).toBe("Saving...");
    expect(d.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(d);
    press("Tab");
    expect(document.activeElement).toBe(d);
    background.focus();
    expect(document.activeElement).toBe(d);
    press("Escape");
    expect(dialog()).not.toBeNull();
    release({ ok: false, message: "We couldn't save this. Please try again.", allowRetry: true });
    await flush();
    expect(d.hasAttribute("aria-busy")).toBe(false);
    expect(document.activeElement).toBe(confirm());
  });

  test("a non-retryable failure focuses Cancel, and Tab skips the disabled confirm", async () => {
    setup(async () => ({ ok: false, message: "This student's score changed.", allowRetry: false }));
    confirm().click();
    await flush();
    expect(confirm().disabled).toBe(true);
    expect(document.activeElement).toBe(cancel());
    press("Tab");
    expect(document.activeElement).toBe(cancel());
    press("Tab", true);
    expect(document.activeElement).toBe(cancel());
  });
});
