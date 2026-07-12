import type { Firestore } from "firebase/firestore";
import { collection, getDocs, query, where } from "firebase/firestore";
import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";
import type { ListClasses } from "../../classes/listClasses";

import type {
  AssignmentsCallables,
  AssignmentsCreateDraftOutput,
  AssignmentsPublishOutput,
  IntegrationsCallables,
  IntegrationsClassLink,
  IntegrationsConnection,
  IntegrationsDeps,
  IntegrationsLmsClass,
  IntegrationsLmsTopic,
  IntegrationsLyfeLabzClass,
  IntegrationsProvider,
  IntegrationsPublicationOutcome,
  ListClassLinks,
  OAuthHandoff,
} from "./types";

// Client entry-point wiring for the Teacher Integrations surface. This
// module is the seam that makes the Settings > Integrations tree callable
// while keeping every downstream file free of firebase/* imports. It is
// imported only by src/index.ts, per the shell.test.ts data-and-callable
// posture invariant enforced against src/shell/**.
//
// Sprint 8C consumes only the callable surface authorized by PDR-020c and
// implemented by Sprint 8B: lmsProvidersList, lmsConnectionsBegin,
// lmsConnectionsComplete, lmsConnectionsDescribe, lmsConnectionsDisconnect,
// lmsClassesDiscover, lmsClassesImport. No direct upstream provider call
// is made from the client.

type CallableRecord = Readonly<Record<string, unknown>>;

function readArray<T>(
  value: unknown,
  mapItem: (item: Readonly<Record<string, unknown>>) => T | null,
): readonly T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const raw of value) {
    if (raw && typeof raw === "object") {
      const mapped = mapItem(raw as Readonly<Record<string, unknown>>);
      if (mapped !== null) out.push(mapped);
    }
  }
  return Object.freeze(out);
}

function readString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readOptionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function parseProvider(
  raw: Readonly<Record<string, unknown>>,
): IntegrationsProvider | null {
  const providerId = readString(raw.providerId);
  const displayName = readString(raw.displayName);
  if (!providerId || !displayName) return null;
  return Object.freeze({ providerId, displayName });
}

function parseConnection(
  raw: Readonly<Record<string, unknown>>,
): IntegrationsConnection | null {
  const connectionId = readString(raw.connectionId);
  const providerId = readString(raw.providerId);
  const rawStatus = raw.status;
  const status =
    rawStatus === "active" || rawStatus === "revoked" ? rawStatus : null;
  if (!connectionId || !providerId || !status) return null;
  const scopes: readonly string[] = Array.isArray(raw.scopes)
    ? Object.freeze(
        raw.scopes.filter((s): s is string => typeof s === "string"),
      )
    : Object.freeze([]);
  return Object.freeze({ connectionId, providerId, status, scopes });
}

function parseLmsClass(
  raw: Readonly<Record<string, unknown>>,
): IntegrationsLmsClass | null {
  const lmsClassId = readString(raw.lmsClassId);
  const name = readString(raw.name);
  if (!lmsClassId || !name) return null;
  const section = readOptionalString(raw.section);
  return Object.freeze(section ? { lmsClassId, name, section } : { lmsClassId, name });
}

function parseLmsTopic(
  raw: Readonly<Record<string, unknown>>,
): IntegrationsLmsTopic | null {
  const lmsTopicId = readString(raw.lmsTopicId);
  const name = readString(raw.name);
  if (!lmsTopicId || !name) return null;
  return Object.freeze({ lmsTopicId, name });
}

export function createLmsCallables(functions: Functions): IntegrationsCallables {
  const listProviders = httpsCallable(functions, "lmsProvidersList");
  const describe = httpsCallable(functions, "lmsConnectionsDescribe");
  const begin = httpsCallable(functions, "lmsConnectionsBegin");
  const complete = httpsCallable(functions, "lmsConnectionsComplete");
  const disconnect = httpsCallable(functions, "lmsConnectionsDisconnect");
  const discover = httpsCallable(functions, "lmsClassesDiscover");
  const importClass = httpsCallable(functions, "lmsClassesImport");
  const listTopics = httpsCallable(functions, "lmsClassesListTopics");
  const publishAssignment = httpsCallable(functions, "lmsAssignmentsPublish");
  const refreshClass = httpsCallable(functions, "lmsClassesRefresh");

  return Object.freeze({
    listProviders: async () => {
      const res = await listProviders({});
      const data = (res.data ?? {}) as CallableRecord;
      return readArray(data.providers, parseProvider);
    },
    describeConnections: async () => {
      const res = await describe({});
      const data = (res.data ?? {}) as CallableRecord;
      return readArray(data.connections, parseConnection);
    },
    beginConnection: async (input) => {
      const res = await begin(input);
      const data = (res.data ?? {}) as CallableRecord;
      const authorizationUrl = readString(data.authorizationUrl);
      const state = readString(data.state);
      if (!authorizationUrl || !state) {
        throw new Error("lmsConnectionsBegin returned an unexpected shape.");
      }
      return { authorizationUrl, state };
    },
    completeConnection: async (input) => {
      const res = await complete(input);
      const data = (res.data ?? {}) as CallableRecord;
      const connectionId = readString(data.connectionId);
      if (!connectionId) {
        throw new Error("lmsConnectionsComplete returned an unexpected shape.");
      }
      return {
        connectionId,
        alreadyConnected: data.alreadyConnected === true,
      };
    },
    disconnect: async (input) => {
      const res = await disconnect(input);
      const data = (res.data ?? {}) as CallableRecord;
      return { alreadyRevoked: data.alreadyRevoked === true };
    },
    discoverClasses: async (input) => {
      const res = await discover(input);
      const data = (res.data ?? {}) as CallableRecord;
      return readArray(data.candidates, parseLmsClass);
    },
    importClass: async (input) => {
      const res = await importClass(input);
      const data = (res.data ?? {}) as CallableRecord;
      const linkId = readString(data.linkId);
      const classId = readString(data.classId);
      const lmsClassId = readString(data.lmsClassId);
      if (!linkId || !classId || !lmsClassId) {
        throw new Error("lmsClassesImport returned an unexpected shape.");
      }
      return {
        linkId,
        classId,
        lmsClassId,
        alreadyLinked: data.alreadyLinked === true,
      };
    },
    refreshClass: async (input) => {
      const res = await refreshClass(input);
      const data = (res.data ?? {}) as CallableRecord;
      const linkId = readString(data.linkId);
      const classId = readString(data.classId);
      const lmsClassId = readString(data.lmsClassId);
      const providerId = readString(data.providerId);
      const rawStatus = data.status;
      const status =
        rawStatus === "healthy" ||
        rawStatus === "disconnected" ||
        rawStatus === "revoked" ||
        rawStatus === "ownershipDrift" ||
        rawStatus === "missingUpstream" ||
        rawStatus === "reconnectRequired" ||
        rawStatus === "providerUnavailable"
          ? rawStatus
          : null;
      if (!linkId || !classId || !lmsClassId || !providerId || !status) {
        throw new Error("lmsClassesRefresh returned an unexpected shape.");
      }
      return Object.freeze({
        linkId,
        classId,
        lmsClassId,
        providerId,
        status,
        changed: data.changed === true,
      });
    },
    listClassTopics: async (input) => {
      const res = await listTopics(input);
      const data = (res.data ?? {}) as CallableRecord;
      return readArray(data.topics, parseLmsTopic);
    },
    publishAssignment: async (input) => {
      const res = await publishAssignment(input);
      const data = (res.data ?? {}) as CallableRecord;
      const publicationId = readString(data.publicationId);
      const rawStatus = data.status;
      const status =
        rawStatus === "succeeded" || rawStatus === "failed" ? rawStatus : null;
      if (!publicationId || !status) {
        throw new Error(
          "lmsAssignmentsPublish returned an unexpected shape.",
        );
      }
      const outcome: IntegrationsPublicationOutcome = {
        publicationId,
        status,
        ...(readOptionalString(data.lmsAssignmentId) !== undefined
          ? { lmsAssignmentId: readOptionalString(data.lmsAssignmentId)! }
          : {}),
        ...(readOptionalString(data.lmsAssignmentUrl) !== undefined
          ? { lmsAssignmentUrl: readOptionalString(data.lmsAssignmentUrl)! }
          : {}),
        ...(readOptionalString(data.errorCode) !== undefined
          ? { errorCode: readOptionalString(data.errorCode)! }
          : {}),
        ...(readOptionalString(data.errorMessage) !== undefined
          ? { errorMessage: readOptionalString(data.errorMessage)! }
          : {}),
      };
      return Object.freeze(outcome);
    },
  });
}

// Sprint 8D.1 authoritative assignment lifecycle callables. Consumed by
// the Assign Experience so the persistent LyfeLabz assignment is created
// and published before any LMS-side publication is attempted.
export function createAssignmentsCallables(
  functions: Functions,
): AssignmentsCallables {
  const createDraft = httpsCallable(functions, "assignmentsCreateDraft");
  const publish = httpsCallable(functions, "assignmentsPublish");
  return Object.freeze({
    createDraft: async (input) => {
      const res = await createDraft(input);
      const data = (res.data ?? {}) as CallableRecord;
      const assignmentId = readString(data.assignmentId);
      if (!assignmentId || data.status !== "draft") {
        throw new Error("assignmentsCreateDraft returned an unexpected shape.");
      }
      const out: AssignmentsCreateDraftOutput = {
        assignmentId,
        status: "draft",
        alreadyCreated: data.alreadyCreated === true,
      };
      return Object.freeze(out);
    },
    publish: async (input) => {
      const res = await publish(input);
      const data = (res.data ?? {}) as CallableRecord;
      const assignmentId = readString(data.assignmentId);
      if (!assignmentId || data.status !== "published") {
        throw new Error("assignmentsPublish returned an unexpected shape.");
      }
      const out: AssignmentsPublishOutput = {
        assignmentId,
        status: "published",
        alreadyPublished: data.alreadyPublished === true,
      };
      return Object.freeze(out);
    },
  });
}

// Firestore reader for the teacher's active `lmsClassLinks`. Scoped to
// the caller's uid through the certified `ownerUid` list rule (Sprint 8B
// Firestore Rules). Only the fields the Assignment Dialog consumes are
// projected out; every other server-managed field is intentionally
// ignored.
export function createListClassLinks(
  db: Firestore,
  uid: string,
): ListClassLinks {
  return async () => {
    const q = query(
      collection(db, "lmsClassLinks"),
      where("ownerUid", "==", uid),
      where("status", "==", "linked"),
    );
    const snap = await getDocs(q);
    const rows: IntegrationsClassLink[] = [];
    snap.forEach((doc) => {
      const data = doc.data() as Readonly<Record<string, unknown>>;
      const classId = readString(data.classId);
      const providerId = readString(data.providerId);
      const lmsClassId = readString(data.lmsClassId);
      if (!classId || !providerId || !lmsClassId) return;
      rows.push(
        Object.freeze({
          linkId: doc.id,
          classId,
          providerId,
          lmsClassId,
        }),
      );
    });
    return Object.freeze(rows);
  };
}

// Browser-scoped OAuth handoff. Opens the authorization URL in a popup,
// listens for the postMessage delivered by the same-origin callback
// page (public/lms-callback.html), verifies the state, and resolves
// with { code, state }. Rejects on popup block, cancellation, state
// mismatch, or upstream error.
export function createBrowserOAuthHandoff(win: Window): OAuthHandoff {
  return ({ authorizationUrl, expectedState }) =>
    new Promise((resolve, reject) => {
      const popup = win.open(
        authorizationUrl,
        "lyfelabz-lms-oauth",
        "width=520,height=640,noopener=no",
      );
      if (!popup) {
        const err = new Error("popup blocked");
        (err as { code?: string }).code = "popup-blocked";
        reject(err);
        return;
      }

      let settled = false;
      const cleanup = (): void => {
        settled = true;
        win.removeEventListener("message", onMessage);
        win.clearInterval(pollId);
        try {
          if (!popup.closed) popup.close();
        } catch {
          // ignored
        }
      };

      const onMessage = (ev: MessageEvent): void => {
        if (settled) return;
        if (ev.origin !== win.location.origin) return;
        const data = ev.data;
        if (!data || typeof data !== "object") return;
        if ((data as { type?: unknown }).type !== "lyfelabz-lms-oauth") return;
        const payload = data as {
          type: string;
          code?: unknown;
          state?: unknown;
          error?: unknown;
        };
        if (typeof payload.error === "string") {
          const err = new Error(payload.error);
          (err as { code?: string }).code = payload.error;
          cleanup();
          reject(err);
          return;
        }
        const code = payload.code;
        const state = payload.state;
        if (typeof code !== "string" || typeof state !== "string") return;
        if (state !== expectedState) {
          const err = new Error("state mismatch");
          (err as { code?: string }).code = "state-mismatch";
          cleanup();
          reject(err);
          return;
        }
        cleanup();
        resolve({ code, state });
      };

      const pollId = win.setInterval(() => {
        if (settled) return;
        try {
          if (popup.closed) {
            const err = new Error("cancelled");
            (err as { code?: string }).code = "cancelled";
            cleanup();
            reject(err);
          }
        } catch {
          // Cross-origin popup access is expected; the postMessage path
          // is authoritative for success.
        }
      }, 500);

      win.addEventListener("message", onMessage);
    });
}

// Class reader adapter. The Integrations surface consumes a
// three-field projection; the existing ClassSummary reader already
// scopes reads to the caller's uid under the certified list rule.
export function createListTeacherClasses(
  listClasses: ListClasses,
  uid: string,
): () => Promise<readonly IntegrationsLyfeLabzClass[]> {
  return async () => {
    const rows = await listClasses(uid);
    return Object.freeze(
      rows
        .filter((c) => c.status === "active")
        .map((c) =>
          Object.freeze({ id: c.id, title: c.title, grade: c.grade }),
        ),
    );
  };
}

export function createIntegrationsDeps(input: {
  readonly functions: Functions;
  readonly listClasses: ListClasses;
  readonly teacherUid: string;
  readonly win: Window;
  readonly db?: Firestore;
}): IntegrationsDeps {
  const redirectUri = `${input.win.location.origin}/lms-callback.html`;
  return Object.freeze({
    callables: createLmsCallables(input.functions),
    openOAuth: createBrowserOAuthHandoff(input.win),
    listTeacherClasses: createListTeacherClasses(
      input.listClasses,
      input.teacherUid,
    ),
    redirectUri,
    ...(input.db !== undefined
      ? { listClassLinks: createListClassLinks(input.db, input.teacherUid) }
      : {}),
  });
}
