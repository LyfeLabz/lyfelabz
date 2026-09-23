/**
 * @jest-environment node
 */
import { dismissOpenModals, registerOpenModal } from "./openModals";

describe("openModals", () => {
  test("dismissOpenModals invokes every open dialog's own dismissal exactly once", () => {
    const a = jest.fn();
    const b = jest.fn();
    registerOpenModal(a);
    registerOpenModal(b);
    dismissOpenModals();
    dismissOpenModals();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  test("a dialog closed through its own path unregisters and is not dismissed again", () => {
    const dismiss = jest.fn();
    const unregister = registerOpenModal(dismiss);
    unregister();
    dismissOpenModals();
    expect(dismiss).not.toHaveBeenCalled();
  });

  test("a dialog whose dismissal throws never blocks the others", () => {
    const broken = jest.fn(() => {
      throw new Error("boom");
    });
    const ok = jest.fn();
    registerOpenModal(broken);
    registerOpenModal(ok);
    expect(() => dismissOpenModals()).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
