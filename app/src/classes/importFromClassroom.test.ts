/**
 * @jest-environment jsdom
 */
import {
  createImportFromClassroom,
  type ImportFromClassroomDeps,
  type ImportState,
} from "./importFromClassroom";
import type {
  IntegrationsClassLink,
  IntegrationsConnection,
  IntegrationsLmsClass,
  IntegrationsLyfeLabzClass,
  IntegrationsProvider,
} from "../settings/integrations/types";

// Sprint 24B Phase 2: orchestration tests for the primary Import Class
// from Google Classroom flow. Every dependency is an injected callable;
// no firebase/* import is exercised.

const googleProvider: IntegrationsProvider = Object.freeze({
  providerId: "googleClassroom",
  displayName: "Google Classroom",
});

const activeConnection: IntegrationsConnection = Object.freeze({
  connectionId: "conn-1",
  providerId: "googleClassroom",
  status: "active",
  scopes: Object.freeze([]),
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

type Overrides = {
  providers?: readonly IntegrationsProvider[];
  connections?: readonly IntegrationsConnection[];
  courses?: readonly IntegrationsLmsClass[];
  links?: readonly IntegrationsClassLink[];
  teacherClasses?: readonly IntegrationsLyfeLabzClass[];
  beginConnection?: ImportFromClassroomDeps["callables"]["beginConnection"];
  completeConnection?: ImportFromClassroomDeps["callables"]["completeConnection"];
  openOAuth?: ImportFromClassroomDeps["openOAuth"];
  lmsCreateClass?: ImportFromClassroomDeps["lmsCreateClass"];
  importClass?: ImportFromClassroomDeps["callables"]["importClass"];
  refreshRoster?: ImportFromClassroomDeps["callables"]["refreshRoster"];
  discoverClasses?: ImportFromClassroomDeps["callables"]["discoverClasses"];
  listClassLinks?: ImportFromClassroomDeps["listClassLinks"] | null;
};

function makeDeps(overrides: Overrides = {}): {
  deps: ImportFromClassroomDeps;
  calls: string[];
} {
  const calls: string[] = [];
  const providers = overrides.providers ?? [googleProvider];
  const connections = overrides.connections ?? [activeConnection];
  const courses =
    overrides.courses ??
    ([
      Object.freeze({ lmsClassId: "gc-1", name: "Period 3 Science" }),
      Object.freeze({ lmsClassId: "gc-2", name: "Period 5 Science" }),
    ] as readonly IntegrationsLmsClass[]);
  const links = overrides.links ?? [];
  const teacherClasses = overrides.teacherClasses ?? [];
  const deps: ImportFromClassroomDeps = {
    callables: {
      listProviders: async () => {
        calls.push("listProviders");
        return providers;
      },
      describeConnections: async () => {
        calls.push("describeConnections");
        return connections;
      },
      beginConnection:
        overrides.beginConnection ??
        (async () => {
          calls.push("beginConnection");
          return { authorizationUrl: "https://auth.example/authorize", state: "s" };
        }),
      completeConnection:
        overrides.completeConnection ??
        (async () => {
          calls.push("completeConnection");
          return { connectionId: "conn-new", alreadyConnected: false };
        }),
      discoverClasses:
        overrides.discoverClasses ??
        (async () => {
          calls.push("discoverClasses");
          return courses;
        }),
      importClass:
        overrides.importClass ??
        (async ({ classId, lmsClassId }) => {
          calls.push(`importClass:${classId}:${lmsClassId}`);
          return { linkId: "link-1", classId, lmsClassId, alreadyLinked: false };
        }),
      refreshRoster:
        overrides.refreshRoster ??
        (async ({ classId }) => {
          calls.push(`refreshRoster:${classId}`);
          return {
            classId,
            membersSeen: 3,
            added: 3,
            reaffirmed: 0,
            removed: 0,
            withdrawnEnrollments: 0,
            upstreamRosterEmpty: false,
          };
        }),
    },
    openOAuth:
      overrides.openOAuth ??
      (async () => {
        calls.push("openOAuth");
        return { code: "c", state: "s" };
      }),
    redirectUri: "https://example.test/app/lms-callback.html",
    lmsCreateClass:
      overrides.lmsCreateClass ??
      (async ({ classId, title }: { classId: string; title: string }) => {
        calls.push(`lmsCreateClass:${title}`);
        return {
          classId,
          alreadyCreated: false,
        };
      }),
    listTeacherClasses: async () => teacherClasses,
    listClassLinks:
      overrides.listClassLinks === undefined
        ? links.length === 0
          ? async () => []
          : async () => links
        : overrides.listClassLinks,
  };
  return { deps, calls };
}

describe("createImportFromClassroom", () => {
  test("connected teacher proceeds directly to course discovery", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps();
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();

    expect(calls).toEqual([
      "listProviders",
      "describeConnections",
      "discoverClasses",
    ]);
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("courses");
    if (final.kind === "courses") {
      expect(final.courses.length).toBe(2);
      expect(final.connectionId).toBe("conn-1");
      expect(final.providerId).toBe("googleClassroom");
    }
  });

  test("disconnected teacher runs OAuth inline and returns to discovery", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps({ connections: [] });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();

    expect(calls).toEqual([
      "listProviders",
      "describeConnections",
      "beginConnection",
      "openOAuth",
      "completeConnection",
      "discoverClasses",
    ]);
    const seenConnecting = states.some((s) => s.kind === "connecting");
    expect(seenConnecting).toBe(true);
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("courses");
    if (final.kind === "courses") {
      // Connecting stage marked complete before discovery.
      expect(final.stagesComplete).toEqual(["connecting", "discovering"]);
    }
  });

  test("course selection creates class and links it, ending in linked state", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps();
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    await controller.selectCourse(current.courses[0]!);
    await flush();

    expect(calls).toContain("lmsCreateClass:Period 3 Science");
    // Phase 2B.4: classId is generated by the client (matches Manual
    // Create). Only the presence of an importClass call ending in the
    // expected lmsClassId is asserted; the generated classId is opaque.
    expect(
      calls.some((c) => c.startsWith("importClass:") && c.endsWith(":gc-1")),
    ).toBe(true);
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("linked");
    if (final.kind === "linked") {
      expect(final.classId).toMatch(/^[a-z0-9]{20}$/);
      expect(final.course.lmsClassId).toBe("gc-1");
    }
  });

  test("Sprint 29G.5K-2: Import captures the class roster as part of the one workflow before reaching linked", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps();
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    await controller.selectCourse(current.courses[0]!);
    await flush();

    // The roster capture ran server-side against the created class, ordered
    // after the link - one Import workflow, no separate teacher action.
    const createdClassId = (() => {
      const c = calls.find((x) => x.startsWith("importClass:"));
      return c ? c.split(":")[1] : "";
    })();
    expect(createdClassId).toMatch(/^[a-z0-9]{20}$/);
    expect(calls).toContain(`refreshRoster:${createdClassId}`);
    expect(calls.indexOf(`refreshRoster:${createdClassId}`)).toBeGreaterThan(
      calls.findIndex((x) => x.startsWith("importClass:")),
    );
    expect(controller.getState().kind).toBe("linked");
  });

  test("Sprint 29G.5K-2: a roster-capture failure does NOT present the import as ready; it is a recoverable capturing error", async () => {
    const states: ImportState[] = [];
    const { deps } = makeDeps({
      refreshRoster: async () => {
        throw Object.assign(new Error("upstream"), { code: "unavailable" });
      },
    });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    await controller.selectCourse(current.courses[0]!);
    await flush();

    const final = controller.getState();
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.stage).toBe("capturing");
      // The teacher is never told to "sync" or manage a "roster".
      expect(final.message.toLowerCase()).not.toContain("sync");
      // A retry is offered against the same class.
      expect(final.retry).toBeDefined();
    }
    // Never reached the ready `linked` state.
    expect(states.some((s) => s.kind === "linked")).toBe(false);
  });

  test("Sprint 29G.5K-2: retry after a capture failure re-runs link + capture and reaches linked", async () => {
    let attempts = 0;
    const { deps, calls } = makeDeps({
      refreshRoster: async ({ classId }) => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("upstream"), { code: "unavailable" });
        }
        calls.push(`refreshRoster:${classId}`);
        return {
          classId,
          membersSeen: 1,
          added: 1,
          reaffirmed: 0,
          removed: 0,
          withdrawnEnrollments: 0,
          upstreamRosterEmpty: false,
        };
      },
    });
    const controller = createImportFromClassroom(deps, () => {});
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    await controller.selectCourse(current.courses[0]!);
    await flush();
    expect(controller.getState().kind).toBe("error");

    await controller.retry();
    await flush();
    expect(controller.getState().kind).toBe("linked");
    expect(attempts).toBe(2);
  });

  test("duplicate course detected client-side surfaces the Open class / Cancel panel", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps({
      links: [
        Object.freeze({
          linkId: "link-existing",
          classId: "existing-class",
          providerId: "googleClassroom",
          lmsClassId: "gc-1",
        }),
      ],
      teacherClasses: [
        Object.freeze({
          id: "existing-class",
          title: "Existing Science",
          grade: "7",
        }),
      ],
    });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    await controller.selectCourse(current.courses[0]!);
    await flush();

    // No importClass call should happen when duplicate is detected up
    // front. No "Import anyway" path exists.
    expect(calls.some((c) => c.startsWith("importClass"))).toBe(false);
    expect(calls.some((c) => c.startsWith("lmsCreateClass"))).toBe(false);

    const final = states[states.length - 1]!;
    expect(final.kind).toBe("duplicate");
    if (final.kind === "duplicate") {
      expect(final.existingClassId).toBe("existing-class");
      expect(final.existingClassTitle).toBe("Existing Science");
    }
  });

  test("popup blocked during OAuth surfaces teacher-facing message, not a raw code", async () => {
    const states: ImportState[] = [];
    const { deps } = makeDeps({
      connections: [],
      openOAuth: async () => {
        const err = new Error("popup blocked");
        (err as { code?: string }).code = "popup-blocked";
        throw err;
      },
    });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.stage).toBe("connecting");
      expect(final.message).toMatch(/pop-?ups/i);
      // Raw code must not leak.
      expect(final.message).not.toMatch(/popup-blocked/);
    }
  });

  test("createClass failure stops at the creating stage with a teacher-facing message", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps({
      lmsCreateClass: async () => {
        const err = new Error("network");
        (err as { code?: string }).code = "unavailable";
        throw err;
      },
    });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    await controller.selectCourse(current.courses[0]!);
    await flush();

    expect(calls.some((c) => c.startsWith("importClass"))).toBe(false);
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.stage).toBe("creating");
      // Teacher-facing message, no engineering vocabulary.
      expect(final.message.length).toBeGreaterThan(0);
      expect(final.message).not.toMatch(/classesCreate/);
      expect(final.message).not.toMatch(/unavailable/);
      expect(final.message).not.toMatch(/network\b/);
    }
  });

  test("importClass failure after successful create preserves the created class and shows recovery guidance", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps({
      importClass: async () => {
        const err = new Error("boom");
        (err as { code?: string }).code = "unavailable";
        throw err;
      },
    });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    await controller.selectCourse(current.courses[0]!);
    await flush();

    expect(calls).toContain("lmsCreateClass:Period 3 Science");
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.stage).toBe("linking");
      // Phase 2B.4: message acknowledges the started class and offers
      // a safe retry through the preserved retry context.
      expect(final.message).toMatch(/Period 3 Science/);
      expect(final.message).toMatch(/try again/i);
      expect(final.retry).toBeDefined();
      if (final.retry) {
        expect(final.retry.course.lmsClassId).toBe("gc-1");
        expect(typeof final.retry.classId).toBe("string");
        expect(typeof final.retry.connectionId).toBe("string");
      }
    }
  });

  test("retry after linking failure reuses the same class and does not re-create it", async () => {
    // Sprint 24B Phase 2B.4 §4B: creation succeeded, linking failed.
    // On retry, orchestrator must re-run only the link step against
    // the same needsSetup class.
    const states: ImportState[] = [];
    let importAttempts = 0;
    const { deps, calls } = makeDeps({
      importClass: async ({ classId, lmsClassId }: { classId: string; lmsClassId: string }) => {
        importAttempts += 1;
        calls.push(`importClass:${classId}:${lmsClassId}`);
        if (importAttempts === 1) {
          const err = new Error("boom");
          (err as { code?: string }).code = "unavailable";
          throw err;
        }
        return { linkId: "link-1", classId, lmsClassId, alreadyLinked: false };
      },
    });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    await controller.selectCourse(current.courses[0]!);
    await flush();

    const errState = states[states.length - 1]!;
    if (errState.kind !== "error") throw new Error("expected error state");
    if (!errState.retry) throw new Error("expected retry context");
    const preservedClassId = errState.retry.classId;

    await controller.retry();
    await flush();

    const creates = calls.filter((c) => c.startsWith("lmsCreateClass"));
    const imports = calls.filter((c) => c.startsWith("importClass"));
    expect(creates.length).toBe(1);
    expect(imports.length).toBe(2);
    expect(imports[1]).toBe(`importClass:${preservedClassId}:gc-1`);
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("linked");
    if (final.kind === "linked") {
      expect(final.classId).toBe(preservedClassId);
    }
  });

  test("importClass fails with alreadyLinked: no retry context, teacher-facing guidance", async () => {
    const states: ImportState[] = [];
    const { deps } = makeDeps({
      importClass: async () => {
        const err = new Error("already linked");
        (err as { code?: string }).code = "lms.lmsClassAlreadyLinked";
        throw err;
      },
    });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    await controller.selectCourse(current.courses[0]!);
    await flush();

    const final = states[states.length - 1]!;
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.stage).toBe("linking");
      // No retry context on alreadyLinked (creating another class
      // would just orphan another needsSetup document).
      expect(final.retry).toBeUndefined();
      expect(final.message).toMatch(/already connected/i);
    }
  });

  test("empty course list surfaces a teacher-facing empty state, not a spinner", async () => {
    const states: ImportState[] = [];
    const { deps } = makeDeps({ courses: [] });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("courses");
    if (final.kind === "courses") {
      expect(final.courses.length).toBe(0);
    }
  });

  test("cancel returns to idle without invoking further callables", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps();
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const before = calls.length;
    controller.cancel();
    expect(controller.getState().kind).toBe("idle");
    expect(calls.length).toBe(before);
  });

  test("provider selection: Google Classroom is selected when it is not the first provider returned", async () => {
    const states: ImportState[] = [];
    const canvas: IntegrationsProvider = Object.freeze({
      providerId: "canvasLMS",
      displayName: "Canvas",
    });
    // Google Classroom is deliberately last. Selection must not depend
    // on array order; matching is by stable providerId from the
    // certified provider registry.
    const { deps, calls } = makeDeps({
      providers: [canvas, googleProvider],
    });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();

    expect(calls).toContain("discoverClasses");
    const final = states[states.length - 1]!;
    if (final.kind !== "courses") throw new Error(`expected courses, got ${final.kind}`);
    expect(final.providerId).toBe("googleClassroom");
    expect(final.providerDisplayName).toBe("Google Classroom");
  });

  test("provider selection: Google Classroom unavailable surfaces a plain-language error", async () => {
    const states: ImportState[] = [];
    const canvas: IntegrationsProvider = Object.freeze({
      providerId: "canvasLMS",
      displayName: "Canvas",
    });
    const { deps, calls } = makeDeps({ providers: [canvas] });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();

    // Discovery must not run; the provider was not available.
    expect(calls).not.toContain("discoverClasses");
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.stage).toBe("connecting");
      expect(final.message).toMatch(/Google Classroom is not available/i);
    }
  });

  test("reentrancy: a double-click on a course tile does not create two LyfeLabz classes", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps();
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const current = controller.getState();
    if (current.kind !== "courses") throw new Error("expected courses");
    // Fire two selectCourse calls back-to-back before the first resolves.
    const p1 = controller.selectCourse(current.courses[0]!);
    const p2 = controller.selectCourse(current.courses[0]!);
    await Promise.all([p1, p2]);
    await flush();

    const creates = calls.filter((c) => c.startsWith("lmsCreateClass"));
    const imports = calls.filter((c) => c.startsWith("importClass"));
    expect(creates.length).toBe(1);
    expect(imports.length).toBe(1);
  });

  test("reentrancy: a double-click on Import does not initiate two OAuth flows", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps({ connections: [] });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    const p1 = controller.start();
    const p2 = controller.start();
    await Promise.all([p1, p2]);
    await flush();

    const oauth = calls.filter((c) => c === "openOAuth");
    const beginC = calls.filter((c) => c === "beginConnection");
    expect(oauth.length).toBe(1);
    expect(beginC.length).toBe(1);
  });

  test("OAuth cancelled by the teacher surfaces a friendly connecting-stage message and no class is created", async () => {
    const states: ImportState[] = [];
    const { deps, calls } = makeDeps({
      connections: [],
      openOAuth: async () => {
        const err = new Error("cancelled");
        (err as { code?: string }).code = "cancelled";
        throw err;
      },
    });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();

    expect(calls.some((c) => c.startsWith("lmsCreateClass"))).toBe(false);
    expect(calls.some((c) => c.startsWith("importClass"))).toBe(false);
    const final = states[states.length - 1]!;
    expect(final.kind).toBe("error");
    if (final.kind === "error") {
      expect(final.stage).toBe("connecting");
      expect(final.message).toMatch(/cancelled/i);
    }
  });

  test("provider abstraction: provider metadata is read from listProviders, not hard-coded strings", async () => {
    // The display name in the teacher-facing prose comes from the
    // certified provider record, not a client-side literal. If the
    // server changes the display name, every teacher-facing message
    // updates without a client change.
    const states: ImportState[] = [];
    const relabelled: IntegrationsProvider = Object.freeze({
      providerId: "googleClassroom",
      displayName: "Google Classroom (Beta)",
    });
    const { deps } = makeDeps({ providers: [relabelled], courses: [] });
    const controller = createImportFromClassroom(deps, (s) => states.push(s));
    await controller.start();
    await flush();
    const final = states[states.length - 1]!;
    if (final.kind !== "courses") throw new Error(`expected courses, got ${final.kind}`);
    expect(final.providerDisplayName).toBe("Google Classroom (Beta)");
  });
});
