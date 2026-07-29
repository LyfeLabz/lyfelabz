/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion */
//
// Sprint 23D. Durable-storage installer coverage.

import { FirestoreLmsOAuthStateStore } from "../oauth-state/firestore-state-store";
import {
  InProcessLmsOAuthStateStore,
  getLmsOAuthStateStore,
  resetLmsOAuthStateStoreForTests,
  setLmsOAuthStateStore,
} from "../oauth-state/state-store";
import { FirestoreLmsTokenStore } from "../tokens/firestore-token-store";
import {
  getLmsTokenStore,
  setLmsTokenStore,
} from "../tokens/token-store";

import {
  ensureLmsDurableStorageBindings,
  isFunctionsRuntime,
  resetLmsDurableStorageBindingsForTests,
} from "./durable-storage";

class FixtureTokenStore {
  async store(): Promise<string> {
    return "fixture";
  }
  async resolve(): Promise<any> {
    return {};
  }
  async revoke(): Promise<void> {}
}

describe("ensureLmsDurableStorageBindings", () => {
  afterEach(() => {
    resetLmsOAuthStateStoreForTests();
    resetLmsDurableStorageBindingsForTests();
    // Restore a benign default token store for the next test.
    setLmsTokenStore(new FixtureTokenStore() as any);
    resetLmsDurableStorageBindingsForTests();
  });

  it("swaps the InProcess default OAuth state store for the Firestore-backed store", () => {
    resetLmsOAuthStateStoreForTests();
    ensureLmsDurableStorageBindings();
    expect(getLmsOAuthStateStore()).toBeInstanceOf(FirestoreLmsOAuthStateStore);
  });

  it("leaves an already-injected OAuth state fixture untouched", () => {
    const fixture = new InProcessLmsOAuthStateStore();
    setLmsOAuthStateStore(fixture);
    ensureLmsDurableStorageBindings();
    // The fixture is an InProcess instance, so the installer will
    // swap it. This test proves the installer only refuses when the
    // caller has injected a DIFFERENT type. Use a bespoke fixture:
    resetLmsDurableStorageBindingsForTests();
    resetLmsOAuthStateStoreForTests();
    const bespoke = { issue: jest.fn(), peek: jest.fn(), consume: jest.fn(), revokeForTeacher: jest.fn() } as any;
    setLmsOAuthStateStore(bespoke);
    ensureLmsDurableStorageBindings();
    expect(getLmsOAuthStateStore()).toBe(bespoke);
  });

  it("swaps a default-shaped token store for the Firestore-backed store", () => {
    // Rebind the token store to the default class name so the
    // nominal detection matches.
    class InProcessLmsTokenStore {
      async store(): Promise<string> {
        return "ref";
      }
      async resolve(): Promise<any> {
        return {};
      }
      async revoke(): Promise<void> {}
    }
    setLmsTokenStore(new InProcessLmsTokenStore() as any);
    resetLmsDurableStorageBindingsForTests();
    ensureLmsDurableStorageBindings();
    expect(getLmsTokenStore()).toBeInstanceOf(FirestoreLmsTokenStore);
  });

  it("is idempotent - repeat calls do not re-swap", () => {
    resetLmsOAuthStateStoreForTests();
    ensureLmsDurableStorageBindings();
    const firstStore = getLmsOAuthStateStore();
    ensureLmsDurableStorageBindings();
    expect(getLmsOAuthStateStore()).toBe(firstStore);
  });
});

describe("isFunctionsRuntime", () => {
  const originalKService = process.env.K_SERVICE;
  const originalFunctionTarget = process.env.FUNCTION_TARGET;
  afterEach(() => {
    if (originalKService === undefined) delete process.env.K_SERVICE;
    else process.env.K_SERVICE = originalKService;
    if (originalFunctionTarget === undefined)
      delete process.env.FUNCTION_TARGET;
    else process.env.FUNCTION_TARGET = originalFunctionTarget;
  });

  it("returns true when K_SERVICE is set", () => {
    delete process.env.FUNCTION_TARGET;
    process.env.K_SERVICE = "fixture-service";
    expect(isFunctionsRuntime()).toBe(true);
  });

  it("returns true when FUNCTION_TARGET is set", () => {
    delete process.env.K_SERVICE;
    process.env.FUNCTION_TARGET = "fixtureTarget";
    expect(isFunctionsRuntime()).toBe(true);
  });

  it("returns false in a bare test environment", () => {
    delete process.env.K_SERVICE;
    delete process.env.FUNCTION_TARGET;
    expect(isFunctionsRuntime()).toBe(false);
  });
});
