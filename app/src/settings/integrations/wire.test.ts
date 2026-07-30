/**
 * @jest-environment jsdom
 */
jest.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: undefined }),
}));
jest.mock("firebase/firestore", () => ({
  collection: () => ({}),
  getDocs: async () => ({ forEach: () => undefined }),
  query: () => ({}),
  where: () => ({}),
}));

import type { Functions } from "firebase/functions";
import type { ListClasses } from "../../classes/listClasses";
import { createIntegrationsDeps } from "./wire";

function makeWin(origin: string): Window {
  const win = {
    location: { origin },
    open: () => null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
  } as unknown as Window;
  return win;
}

const listClassesStub: ListClasses = async () => Object.freeze([]);

describe("createIntegrationsDeps redirectUri", () => {
  it("targets the served /app/lms-callback.html path at the production origin", () => {
    const deps = createIntegrationsDeps({
      functions: {} as Functions,
      listClasses: listClassesStub,
      teacherUid: "teacher-1",
      win: makeWin("https://lyfelabz.com"),
    });
    expect(deps.redirectUri).toBe("https://lyfelabz.com/app/lms-callback.html");
  });

  it("preserves the /app/ segment across arbitrary same-origin hosts", () => {
    const deps = createIntegrationsDeps({
      functions: {} as Functions,
      listClasses: listClassesStub,
      teacherUid: "teacher-1",
      win: makeWin("https://staging.example.test"),
    });
    expect(deps.redirectUri).toBe(
      "https://staging.example.test/app/lms-callback.html",
    );
  });

  it("never emits an origin-root /lms-callback.html redirect URI", () => {
    const deps = createIntegrationsDeps({
      functions: {} as Functions,
      listClasses: listClassesStub,
      teacherUid: "teacher-1",
      win: makeWin("https://lyfelabz.com"),
    });
    expect(deps.redirectUri).not.toMatch(/\/\/[^/]+\/lms-callback\.html$/);
    expect(deps.redirectUri).toMatch(/\/app\/lms-callback\.html$/);
  });
});
