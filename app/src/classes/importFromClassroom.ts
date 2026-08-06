import { generateClassId } from "./classId";
import type { LmsCreateClass } from "./lmsCreateClass";
import type {
  IntegrationsCallables,
  IntegrationsClassLink,
  IntegrationsConnection,
  IntegrationsLmsClass,
  IntegrationsLyfeLabzClass,
  IntegrationsProvider,
  ListClassLinks,
  ListTeacherClasses,
  OAuthHandoff,
} from "../settings/integrations/types";

// Sprint 24B Phase 2B.4: client orchestration for the primary Import
// Class from Google Classroom flow.
//
// Phase 2B.4 replaces the Phase 2 hard-coded `{grade: "7", block: "A"}`
// creation path with the ratified two-step LMS lifecycle:
//
//   1. classesLmsCreate({classId, title}) writes a `needsSetup` class
//      (no grade, no block, no join code).
//   2. lmsClassesImport({connectionId, classId, lmsClassId}) writes the
//      authoritative LMS link and additive provider metadata.
//   3. Teacher confirms grade and block through the workspace setup
//      form; classesActivate atomically writes {status: "active",
//      grade, block, joinCode}.
//
// This module owns steps 1 and 2. Step 3 belongs to the Classes
// surface workspace and is not launched from here; the module hands
// off to `linked` state, and the Classes surface routes the teacher to
// the setup form for the linked class.
//
// This module opens no Firestore listener and imports no firebase/*
// module; every side effect arrives through injected dependencies.
//
// Provider abstraction (Blueprint §5): this module never branches on a
// hard-coded providerId. The target provider is resolved from the
// certified provider list at flow start, so the same orchestration
// serves any provider whose adapter the server certifies later.

export type ImportFromClassroomDeps = {
  readonly callables: Pick<
    IntegrationsCallables,
    | "listProviders"
    | "describeConnections"
    | "beginConnection"
    | "completeConnection"
    | "discoverClasses"
    | "importClass"
  >;
  readonly openOAuth: OAuthHandoff;
  readonly redirectUri: string;
  // Phase 2B.4: the LMS-specific creation seam. This is the sole
  // `needsSetup` writer available to the client. The Manual Create seam
  // (`classesCreate`) is intentionally not accepted here; a mistaken
  // wiring would re-introduce the hard-coded grade/block bug the phase
  // is fixing.
  readonly lmsCreateClass: LmsCreateClass;
  readonly listTeacherClasses: ListTeacherClasses;
  readonly listClassLinks?: ListClassLinks | null;
};

export type ImportStage =
  | "connecting"
  | "discovering"
  | "creating"
  | "linking";

export type ImportErrorState = {
  readonly kind: "error";
  readonly stage: ImportStage;
  readonly message: string;
  readonly recoveryHint: string | null;
  // Phase 2B.4: on a link failure after a successful creation, the
  // orchestrator preserves the created classId so a retry re-runs only
  // the link step against the same `needsSetup` class instead of
  // creating a second one. Absent on any other error stage.
  readonly retry?: LinkRetryContext;
};

// Phase 2B.4: retry context for the "creation succeeded, link failed"
// branch. All fields are frozen. The controller uses this to reproduce
// the original selectCourse invocation without re-creating the class.
export type LinkRetryContext = {
  readonly classId: string;
  readonly connectionId: string;
  readonly course: IntegrationsLmsClass;
};

export type ImportState =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting" }
  | {
      readonly kind: "discovering";
      readonly providerDisplayName: string;
      readonly stagesComplete: readonly ImportStage[];
    }
  | {
      readonly kind: "courses";
      readonly providerId: string;
      readonly providerDisplayName: string;
      readonly connectionId: string;
      readonly courses: readonly IntegrationsLmsClass[];
      readonly stagesComplete: readonly ImportStage[];
    }
  | {
      readonly kind: "duplicate";
      readonly providerDisplayName: string;
      readonly course: IntegrationsLmsClass;
      readonly existingClassId: string;
      readonly existingClassTitle: string;
    }
  | {
      readonly kind: "creating";
      readonly providerDisplayName: string;
      readonly course: IntegrationsLmsClass;
      readonly stagesComplete: readonly ImportStage[];
    }
  | {
      readonly kind: "linking";
      readonly providerDisplayName: string;
      readonly course: IntegrationsLmsClass;
      readonly classId: string;
      readonly stagesComplete: readonly ImportStage[];
    }
  | {
      readonly kind: "linked";
      readonly providerDisplayName: string;
      readonly course: IntegrationsLmsClass;
      readonly classId: string;
    }
  | (ImportErrorState & { readonly providerDisplayName: string | null });

// Target provider identifier for the Import Class from Google Classroom
// entry point. Preserved verbatim from Phase 2 (Blueprint §5). Provider
// resolution matches by stable id, never by array order.
const GOOGLE_CLASSROOM_PROVIDER_ID = "googleClassroom";

export type ImportController = {
  readonly getState: () => ImportState;
  readonly start: () => Promise<void>;
  readonly selectCourse: (course: IntegrationsLmsClass) => Promise<void>;
  readonly retry: () => Promise<void>;
  readonly cancel: () => void;
};

export function createImportFromClassroom(
  deps: ImportFromClassroomDeps,
  onChange: (state: ImportState) => void,
): ImportController {
  let state: ImportState = { kind: "idle" };
  let providerCache: {
    readonly providerId: string;
    readonly providerDisplayName: string;
  } | null = null;
  let connectionCache: string | null = null;
  // Reentrancy guards. Preserved verbatim from Phase 2. A rapid
  // double-click on the primary Import button or on a course tile can
  // dispatch two async invocations before the first has advanced the
  // state machine past the guarding `state.kind` check. These booleans
  // reject the second invocation synchronously so at most one class is
  // ever created per teacher action.
  let startInFlight = false;
  let selectInFlight = false;
  let retryInFlight = false;

  const set = (next: ImportState): void => {
    state = next;
    onChange(state);
  };

  const resolveProvider = async (): Promise<{
    readonly providerId: string;
    readonly providerDisplayName: string;
  }> => {
    if (providerCache !== null) return providerCache;
    const providers = await deps.callables.listProviders();
    const target: IntegrationsProvider | undefined = providers.find(
      (p) => p.providerId === GOOGLE_CLASSROOM_PROVIDER_ID,
    );
    if (!target) {
      throw makeStageError(
        "connecting",
        "Google Classroom is not available on your account yet. Ask your school administrator to enable it.",
      );
    }
    providerCache = Object.freeze({
      providerId: target.providerId,
      providerDisplayName: target.displayName,
    });
    return providerCache;
  };

  const findActiveConnection = async (
    providerId: string,
  ): Promise<string | null> => {
    const connections = await deps.callables.describeConnections();
    const match: IntegrationsConnection | undefined = connections.find(
      (c) => c.providerId === providerId && c.status === "active",
    );
    return match ? match.connectionId : null;
  };

  const runOAuth = async (providerId: string): Promise<string> => {
    const begin = await deps.callables.beginConnection({
      providerId,
      redirectUri: deps.redirectUri,
    });
    const handoff = await deps.openOAuth({
      authorizationUrl: begin.authorizationUrl,
      redirectUri: deps.redirectUri,
      expectedState: begin.state,
    });
    const complete = await deps.callables.completeConnection({
      providerId,
      code: handoff.code,
      state: handoff.state,
      redirectUri: deps.redirectUri,
    });
    return complete.connectionId;
  };

  const loadCourses = async (
    provider: { providerId: string; providerDisplayName: string },
    connectionId: string,
    stagesComplete: readonly ImportStage[],
  ): Promise<void> => {
    set({
      kind: "discovering",
      providerDisplayName: provider.providerDisplayName,
      stagesComplete,
    });
    const courses = await deps.callables.discoverClasses({ connectionId });
    set({
      kind: "courses",
      providerId: provider.providerId,
      providerDisplayName: provider.providerDisplayName,
      connectionId,
      courses,
      stagesComplete: freeze([...stagesComplete, "discovering"]),
    });
  };

  const start = async (): Promise<void> => {
    if (
      state.kind !== "idle" &&
      state.kind !== "error"
    ) {
      return;
    }
    if (startInFlight) return;
    startInFlight = true;
    try {
      const provider = await resolveProvider();
      const existingConnection = await findActiveConnection(provider.providerId);
      if (existingConnection === null) {
        set({ kind: "connecting" });
        try {
          connectionCache = await runOAuth(provider.providerId);
        } catch (err) {
          throw wrapStageError(err, "connecting", provider.providerDisplayName);
        }
        await loadCourses(
          provider,
          connectionCache,
          freeze<ImportStage>(["connecting"]),
        );
        return;
      }
      connectionCache = existingConnection;
      await loadCourses(provider, connectionCache, freeze<ImportStage>([]));
    } catch (err) {
      const provider = providerCache;
      handleStageError(err, provider?.providerDisplayName ?? null);
    } finally {
      startInFlight = false;
    }
  };

  const runLink = async (
    provider: { providerId: string; providerDisplayName: string },
    connectionId: string,
    course: IntegrationsLmsClass,
    classId: string,
    linkingStages: readonly ImportStage[],
  ): Promise<void> => {
    set({
      kind: "linking",
      providerDisplayName: provider.providerDisplayName,
      course,
      classId,
      stagesComplete: linkingStages,
    });
    try {
      await deps.callables.importClass({
        connectionId,
        classId,
        lmsClassId: course.lmsClassId,
      });
    } catch (err) {
      if (isAlreadyLinkedError(err)) {
        // The Google Classroom course is already linked to another
        // LyfeLabz class (possibly the teacher's own from an earlier
        // session, or a colleague's). The `needsSetup` class we just
        // created is a valid orphan; the teacher can archive it from
        // the Classes list.
        set({
          kind: "error",
          stage: "linking",
          providerDisplayName: provider.providerDisplayName,
          message: `"${course.name}" is already connected to another LyfeLabz class. Open Classes to finish setting up or archive the unfinished class we just started.`,
          recoveryHint:
            "Choose another course, or open the linked class from your Classes list.",
        });
        return;
      }
      // Preserve the created classId in the error state so a retry
      // reuses the same `needsSetup` class instead of creating another.
      set({
        kind: "error",
        stage: "linking",
        providerDisplayName: provider.providerDisplayName,
        message: `We started your class for "${course.name}" but could not finish connecting it to Google Classroom. Try again in a moment.`,
        recoveryHint: describeStageErrorHint(err),
        retry: Object.freeze({
          classId,
          connectionId,
          course,
        }),
      });
      return;
    }

    set({
      kind: "linked",
      providerDisplayName: provider.providerDisplayName,
      course,
      classId,
    });
  };

  const selectCourse = async (
    course: IntegrationsLmsClass,
  ): Promise<void> => {
    if (state.kind !== "courses") return;
    if (selectInFlight) return;
    selectInFlight = true;
    const provider = {
      providerId: state.providerId,
      providerDisplayName: state.providerDisplayName,
    };
    const connectionId = state.connectionId;
    const priorStages = state.stagesComplete;
    try {
      const duplicate = await findDuplicate(course);
      if (duplicate !== null) {
        set({
          kind: "duplicate",
          providerDisplayName: provider.providerDisplayName,
          course,
          existingClassId: duplicate.existingClassId,
          existingClassTitle: duplicate.existingClassTitle,
        });
        return;
      }

      set({
        kind: "creating",
        providerDisplayName: provider.providerDisplayName,
        course,
        stagesComplete: priorStages,
      });

      // Generate the classId in the client, matching the Manual Create
      // pattern. Both `classesCreate` and `classesLmsCreate` validate
      // against the identical server-side CLASS_ID_PATTERN.
      const classId = generateClassId();

      let created;
      try {
        created = await deps.lmsCreateClass({
          classId,
          title: course.name,
        });
      } catch (err) {
        throw wrapStageError(err, "creating", provider.providerDisplayName);
      }

      const linkingStages = freeze<ImportStage>([...priorStages, "creating"]);
      await runLink(
        provider,
        connectionId,
        course,
        created.classId,
        linkingStages,
      );
    } catch (err) {
      handleStageError(err, provider.providerDisplayName);
    } finally {
      selectInFlight = false;
    }
  };

  const findDuplicate = async (
    course: IntegrationsLmsClass,
  ): Promise<{
    readonly existingClassId: string;
    readonly existingClassTitle: string;
  } | null> => {
    if (!deps.listClassLinks) return null;
    let links: readonly IntegrationsClassLink[];
    let classes: readonly IntegrationsLyfeLabzClass[];
    try {
      [links, classes] = await Promise.all([
        deps.listClassLinks(),
        deps.listTeacherClasses(),
      ]);
    } catch {
      return null;
    }
    const link = links.find((l) => l.lmsClassId === course.lmsClassId);
    if (!link) return null;
    const cls = classes.find((c) => c.id === link.classId);
    return {
      existingClassId: link.classId,
      existingClassTitle: cls ? cls.title : "your linked class",
    };
  };

  const retry = async (): Promise<void> => {
    if (state.kind !== "error") return;
    if (retryInFlight) return;
    retryInFlight = true;
    try {
      // Phase 2B.4: recover from a link failure by rerunning only the
      // link step against the preserved classId. Any earlier-stage
      // error falls back to a full restart via `start()` (identical to
      // Phase 2 behavior).
      const errorState = state;
      if (
        errorState.kind === "error" &&
        errorState.stage === "linking" &&
        errorState.retry !== undefined
      ) {
        const provider = providerCache;
        if (provider === null) {
          await start();
          return;
        }
        const linkingStages = freeze<ImportStage>([
          "discovering",
          "creating",
        ]);
        await runLink(
          provider,
          errorState.retry.connectionId,
          errorState.retry.course,
          errorState.retry.classId,
          linkingStages,
        );
        return;
      }
      await start();
    } finally {
      retryInFlight = false;
    }
  };

  const cancel = (): void => {
    set({ kind: "idle" });
  };

  const handleStageError = (
    err: unknown,
    providerDisplayName: string | null,
  ): void => {
    if (isStageError(err)) {
      set({
        kind: "error",
        stage: err.stage,
        providerDisplayName,
        message: err.message,
        recoveryHint: err.recoveryHint,
      });
      return;
    }
    set({
      kind: "error",
      stage: "discovering",
      providerDisplayName,
      message: "Something did not work. Try again in a moment.",
      recoveryHint: null,
    });
  };

  return Object.freeze({
    getState: () => state,
    start,
    selectCourse,
    retry,
    cancel,
  });
}

// -----------------------------------------------------------------------------
// Error helpers - staged, teacher-facing messages only.
// Raw callable names, upstream API errors, provider account identifiers,
// Firestore ids, and Firebase UIDs are never surfaced.
// -----------------------------------------------------------------------------

type StageError = Error & {
  readonly stage: ImportStage;
  readonly recoveryHint: string | null;
};

function makeStageError(
  stage: ImportStage,
  message: string,
  recoveryHint: string | null = null,
): StageError {
  const err = new Error(message) as StageError;
  Object.assign(err, { stage, recoveryHint });
  return err;
}

function isStageError(err: unknown): err is StageError {
  return (
    err instanceof Error &&
    typeof (err as { stage?: unknown }).stage === "string"
  );
}

function extractCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" ? code : "";
  }
  return "";
}

function isAlreadyLinkedError(err: unknown): boolean {
  const code = extractCode(err).toLowerCase();
  return code.includes("alreadylinked") || code.includes("already-linked");
}

function wrapStageError(
  err: unknown,
  stage: ImportStage,
  providerDisplayName: string,
): StageError {
  if (isStageError(err)) return err;
  const code = extractCode(err);
  if (stage === "connecting") {
    if (code.includes("popup") || code.includes("popup-blocked")) {
      return makeStageError(
        stage,
        `Your browser blocked the ${providerDisplayName} sign-in window. Allow pop-ups for LyfeLabz and try again.`,
        "Enable pop-ups for this site, then try Import Class from Google Classroom again.",
      );
    }
    if (code.includes("cancel")) {
      return makeStageError(
        stage,
        `${providerDisplayName} sign-in was cancelled. Try again whenever you are ready.`,
      );
    }
    if (code.includes("state") || code.includes("csrf")) {
      return makeStageError(
        stage,
        `The ${providerDisplayName} sign-in did not match the request LyfeLabz opened. Try again.`,
      );
    }
    if (code.includes("network") || code.includes("unavailable")) {
      return makeStageError(
        stage,
        `We could not reach ${providerDisplayName}. Check your connection and try again.`,
      );
    }
    return makeStageError(
      stage,
      `We could not connect ${providerDisplayName} just now. Try again in a moment.`,
    );
  }
  if (stage === "discovering") {
    return makeStageError(
      stage,
      `We could not load your ${providerDisplayName} courses. Try again in a moment.`,
    );
  }
  if (stage === "creating") {
    if (code.includes("permission") || code.includes("forbidden")) {
      return makeStageError(
        stage,
        "Your account is not permitted to create classes yet.",
      );
    }
    if (code.includes("network") || code.includes("unavailable")) {
      return makeStageError(
        stage,
        "We could not reach LyfeLabz. Check your connection and try again.",
      );
    }
    return makeStageError(
      stage,
      "We could not start the class. Try again in a moment.",
    );
  }
  return makeStageError(
    stage,
    "We could not finish importing your class. Try again in a moment.",
  );
}

function describeStageErrorHint(err: unknown): string | null {
  const code = extractCode(err);
  if (code.includes("network") || code.includes("unavailable")) {
    return "Check your connection and try again.";
  }
  return null;
}

function freeze<T>(value: readonly T[]): readonly T[] {
  return Object.freeze(value.slice());
}
