// My Units three-dot menus (the unit management menu in each unit's header
// and the quiet per-row menu holding "Remove from Unit"). A menu button
// pattern: the trigger is a real button with aria-haspopup/aria-expanded and
// an accessible name; items are buttons with role="menuitem".
//
// Keyboard: Enter, Space, or ArrowDown opens on the first item, ArrowUp on
// the last; ArrowUp/ArrowDown/Home/End move between items; Escape closes and
// returns focus to the trigger; Tab closes and moves on. A click or tap
// outside closes it. Choosing an item closes the menu (focus on the trigger)
// before the item's action runs, so the action can move focus on.
//
// Items stay in the DOM while the menu is closed (hidden), keeping their
// test ids and the panel's busy gating (`data-busy-gate`) in place.

export type UnitsMenuItem = {
  readonly label: string;
  readonly testid: string;
  readonly ariaLabel?: string;
  readonly action?: string;
  readonly danger?: boolean;
  readonly busyGate?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
};

export type UnitsMenu = {
  readonly root: HTMLElement;
  readonly trigger: HTMLButtonElement;
  readonly menu: HTMLElement;
  readonly items: ReadonlyArray<HTMLButtonElement>;
  readonly close: (focusTrigger: boolean) => void;
};

let menuSeq = 0;
// Only one menu is open at a time across the page.
let closeOpenMenu: (() => void) | null = null;

const inert = (b: HTMLButtonElement): boolean =>
  b.disabled || b.getAttribute("aria-disabled") === "true";

export function buildUnitsMenu(
  doc: Document,
  input: {
    readonly triggerLabel: string;
    readonly triggerTestId: string;
    readonly triggerAction?: string;
    readonly variant: "unit" | "row";
    readonly items: ReadonlyArray<UnitsMenuItem>;
  },
): UnitsMenu {
  const root = doc.createElement("div");
  root.className = `shell-units-menu shell-units-menu--${input.variant}`;

  const trigger = doc.createElement("button");
  trigger.type = "button";
  trigger.className = "shell-units-menu-trigger";
  trigger.setAttribute("data-testid", input.triggerTestId);
  if (input.triggerAction !== undefined) trigger.setAttribute("data-action", input.triggerAction);
  trigger.setAttribute("aria-label", input.triggerLabel);
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  const dots = doc.createElement("span");
  dots.className = "shell-units-menu-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.textContent = "⋯";
  trigger.appendChild(dots);
  root.appendChild(trigger);

  const menu = doc.createElement("div");
  menu.className = "shell-units-menu-list";
  menu.id = `units-menu-${++menuSeq}`;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", input.triggerLabel);
  menu.setAttribute("data-testid", `${input.triggerTestId}-list`);
  menu.hidden = true;
  trigger.setAttribute("aria-controls", menu.id);
  root.appendChild(menu);

  const items = input.items.map((item) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = `shell-units-menu-item${item.danger === true ? " shell-units-menu-item--danger" : ""}`;
    b.setAttribute("role", "menuitem");
    b.tabIndex = -1;
    b.textContent = item.label;
    b.setAttribute("data-testid", item.testid);
    if (item.ariaLabel !== undefined) b.setAttribute("aria-label", item.ariaLabel);
    if (item.action !== undefined) b.setAttribute("data-action", item.action);
    if (item.busyGate === true) b.setAttribute("data-busy-gate", "");
    if (item.disabled === true) b.disabled = true;
    b.addEventListener("click", () => {
      if (inert(b)) return;
      close(true);
      item.onSelect();
    });
    menu.appendChild(b);
    return b;
  });

  const enabled = (): HTMLButtonElement[] => items.filter((b) => !b.disabled);
  const focusItem = (b: HTMLButtonElement | undefined): void => {
    try {
      b?.focus({ preventScroll: true });
    } catch {
      // ignored
    }
  };

  const onDocPointer = (ev: Event): void => {
    if (ev.target instanceof Node && root.contains(ev.target)) return;
    close(false);
  };
  // Choosing an item always lands focus on the trigger, even when the item
  // was activated without the menu having been opened (assistive
  // technology can invoke a menu item directly).
  const close = (focusTrigger: boolean): void => {
    if (!menu.hidden) {
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      doc.removeEventListener("pointerdown", onDocPointer, true);
      if (closeOpenMenu === closeThis) closeOpenMenu = null;
    }
    if (focusTrigger) focusItem(trigger);
  };
  const closeThis = (): void => close(false);
  const open = (at: "first" | "last"): void => {
    if (menu.hidden) {
      closeOpenMenu?.();
      closeOpenMenu = closeThis;
      menu.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      doc.addEventListener("pointerdown", onDocPointer, true);
    }
    const list = enabled();
    focusItem(at === "first" ? list[0] : list[list.length - 1]);
  };

  trigger.addEventListener("click", () => {
    if (menu.hidden) open("first");
    else close(true);
  });
  trigger.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      open("first");
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      open("last");
    }
  });
  menu.addEventListener("keydown", (ev) => {
    const list = enabled();
    const index = list.indexOf(doc.activeElement as HTMLButtonElement);
    switch (ev.key) {
      case "ArrowDown":
        ev.preventDefault();
        focusItem(list[(index + 1) % list.length]);
        break;
      case "ArrowUp":
        ev.preventDefault();
        focusItem(list[(index - 1 + list.length) % list.length]);
        break;
      case "Home":
        ev.preventDefault();
        focusItem(list[0]);
        break;
      case "End":
        ev.preventDefault();
        focusItem(list[list.length - 1]);
        break;
      case "Escape":
        ev.preventDefault();
        ev.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  });

  return { root, trigger, menu, items, close };
}
