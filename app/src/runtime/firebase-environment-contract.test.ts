/**
 * @jest-environment node
 */
import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

import {
  EMULATOR_CONFIG,
  getFirebaseClientConfig,
} from "../firebase-config";

const FIREBASE_CONFIG_PATH = path.resolve(
  __dirname,
  "../../../assets/lyfelabz-firebase-config.js",
);
const SHIM_PATH = path.resolve(
  __dirname,
  "../../../assets/lyfelabz-assessment-runtime.js",
);
const ACTIVE_ENTRY_PATH = path.resolve(__dirname, "./entry.ts");
const REAL_LESSON_PATH = path.resolve(
  __dirname,
  "../../../app/lessons/lesson_what-is-life.html",
);

const firebaseConfigSource = fs.readFileSync(FIREBASE_CONFIG_PATH, "utf8");
const shimSource = fs.readFileSync(SHIM_PATH, "utf8");

type ScriptNode = {
  src: string;
  async?: boolean;
  defer?: boolean;
  onload?: () => void;
  setAttribute(name: string, value: string): void;
  attributes: Record<string, string>;
};

type TestWindow = {
  location: { hostname: string; search: string; hash: string };
  document: {
    head: { appendChild(node: ScriptNode): void };
    createElement(tag: string): ScriptNode;
  };
  __lyfelabzFirebaseConfig?: Record<string, string>;
  lyfelabz?: unknown;
};

function makeWindow(hostname: string, assignment = true): {
  win: TestWindow;
  appended: ScriptNode[];
  context: vm.Context;
} {
  const appended: ScriptNode[] = [];
  const win = {
    location: {
      hostname,
      search: assignment ? "?assignment=asg-1" : "",
      hash: "",
    },
    document: {
      head: {
        appendChild(node: ScriptNode) {
          appended.push(node);
        },
      },
      createElement(tag: string) {
        if (tag !== "script") throw new Error(`unexpected element: ${tag}`);
        const attributes: Record<string, string> = {};
        return {
          src: "",
          attributes,
          setAttribute(name: string, value: string) {
            attributes[name] = value;
          },
        };
      },
    },
  } as TestWindow;
  const context = vm.createContext({ window: win, Promise, setTimeout });
  return { win, appended, context };
}

function runConfig(hostname: string): TestWindow {
  const { win, context } = makeWindow(hostname);
  vm.runInContext(firebaseConfigSource, context);
  return win;
}

describe("host-aware Firebase configuration asset", () => {
  it.each([
    "lyfelabz-staging.web.app",
    "lyfelabz-staging.firebaseapp.com",
  ])("selects staging for %s", (hostname) => {
    expect(runConfig(hostname).__lyfelabzFirebaseConfig).toMatchObject({
      authDomain: "lyfelabz-staging.firebaseapp.com",
      projectId: "lyfelabz-staging",
    });
  });

  it("selects production for the production hostname", () => {
    expect(runConfig("lyfelabz.com").__lyfelabzFirebaseConfig).toMatchObject({
      authDomain: "lyfelabz-prod.firebaseapp.com",
      projectId: "lyfelabz-prod",
    });
  });

  it("keeps localhost on the shared emulator config and endpoints", () => {
    const injected = runConfig("localhost").__lyfelabzFirebaseConfig;
    const config = getFirebaseClientConfig({
      location: { hostname: "localhost" },
      __lyfelabzFirebaseConfig: injected,
    } as unknown as Window);

    expect(config).toEqual(EMULATOR_CONFIG);

    const activeEntry = fs.readFileSync(ACTIVE_ENTRY_PATH, "utf8");
    expect(activeEntry).toContain(
      'connectAuthEmulator(auth, "http://127.0.0.1:9099"',
    );
    expect(activeEntry).toContain(
      'connectFunctionsEmulator(functions, "127.0.0.1", 5001)',
    );
  });
});

describe("authenticated lesson Firebase initialization contract", () => {
  it("loads the host-aware config before the active runtime on a real lesson entry", () => {
    const lesson = fs.readFileSync(REAL_LESSON_PATH, "utf8");
    expect(lesson).toContain(
      '<script defer src="/assets/lyfelabz-assessment-runtime.js"></script>',
    );

    const { win, appended, context } = makeWindow(
      "lyfelabz-staging.web.app",
    );
    vm.runInContext(shimSource, context);

    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
    ]);
    expect(win.__lyfelabzFirebaseConfig).toBeUndefined();

    vm.runInContext(firebaseConfigSource, context);
    appended[0]!.onload!();

    expect(win.__lyfelabzFirebaseConfig).toMatchObject({
      projectId: "lyfelabz-staging",
    });
    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
      "/assets/lyfelabz-assessment-runtime-active.js",
    ]);
  });

  it("fails closed when config load fires without installing the global", () => {
    const { win, appended, context } = makeWindow(
      "lyfelabz-staging.web.app",
    );
    vm.runInContext(shimSource, context);

    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
    ]);

    appended[0]!.onload!();

    expect(win.__lyfelabzFirebaseConfig).toBeUndefined();
    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
    ]);
  });

  it("fails closed when config execution throws before installing the global", () => {
    const { win, appended, context } = makeWindow(
      "lyfelabz-staging.web.app",
    );
    vm.runInContext(shimSource, context);

    expect(() => {
      vm.runInContext(
        'throw new Error("simulated Firebase config execution failure")',
        context,
      );
    }).toThrow("simulated Firebase config execution failure");
    appended[0]!.onload!();

    expect(win.__lyfelabzFirebaseConfig).toBeUndefined();
    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
    ]);
  });

  it("fails closed when an installed configuration is incomplete", () => {
    const { win, appended, context } = makeWindow(
      "lyfelabz-staging.web.app",
    );
    win.__lyfelabzFirebaseConfig = { projectId: "lyfelabz-staging" };

    vm.runInContext(shimSource, context);
    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
    ]);

    appended[0]!.onload!();
    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
    ]);
  });

  it("does not replace an already-correct staging configuration", () => {
    const { win, appended, context } = makeWindow(
      "lyfelabz-staging.firebaseapp.com",
    );
    const stagingConfig = {
      apiKey: "staging-key",
      authDomain: "lyfelabz-staging.firebaseapp.com",
      projectId: "lyfelabz-staging",
    };
    win.__lyfelabzFirebaseConfig = stagingConfig;

    vm.runInContext(shimSource, context);

    expect(win.__lyfelabzFirebaseConfig).toBe(stagingConfig);
    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-assessment-runtime-active.js",
    ]);
  });

  it("loads the active runtime after production config is installed", () => {
    const { win, appended, context } = makeWindow("lyfelabz.com");
    vm.runInContext(shimSource, context);

    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
    ]);

    vm.runInContext(firebaseConfigSource, context);
    appended[0]!.onload!();

    expect(win.__lyfelabzFirebaseConfig).toMatchObject({
      authDomain: "lyfelabz-prod.firebaseapp.com",
      projectId: "lyfelabz-prod",
    });
    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
      "/assets/lyfelabz-assessment-runtime-active.js",
    ]);
  });

  it("loads the active runtime while localhost keeps emulator selection", () => {
    const { win, appended, context } = makeWindow("localhost");
    vm.runInContext(shimSource, context);

    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
    ]);

    vm.runInContext(firebaseConfigSource, context);
    appended[0]!.onload!();

    expect(
      getFirebaseClientConfig(win as unknown as Window),
    ).toEqual(EMULATOR_CONFIG);
    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
      "/assets/lyfelabz-assessment-runtime-active.js",
    ]);
  });

  it("does not load the active runtime when the config resource fails", () => {
    const { appended, context } = makeWindow("lyfelabz-staging.web.app");
    vm.runInContext(shimSource, context);

    expect(appended[0]!.onload).toBeDefined();
    expect(appended.map((script) => script.src)).toEqual([
      "/assets/lyfelabz-firebase-config.js",
    ]);
  });

  it("keeps a standalone lesson inert", () => {
    const { win, appended, context } = makeWindow("lyfelabz.com", false);
    vm.runInContext(shimSource, context);

    expect(win.__lyfelabzFirebaseConfig).toBeUndefined();
    expect(appended).toEqual([]);
  });
});
