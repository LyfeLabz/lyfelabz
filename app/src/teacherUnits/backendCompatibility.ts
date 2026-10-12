import { TeacherUnitsCompatibilityError } from "./compatibilityError";
import type { Auth } from "firebase/auth";
import { onIdTokenChanged } from "firebase/auth";
import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";
import { getPlaceableResources } from "./placeableResources";
import { requireTeacherUnitsAvailable } from "./releaseAvailability";
const VERSION = "teacher-units-v1";
export const REQUIRED_OPERATIONS = Object.freeze(["create", "list", "get", "update", "archive", "restore", "setResources", "reorder"]);
export { TeacherUnitsCompatibilityError } from "./compatibilityError";
const refuse = (): never => { throw new TeacherUnitsCompatibilityError(); };
export type CompatibilitySession = {
  readonly uid: string;
  readonly schoolId: string;
  readonly generation: number;
};
export type CompatibilityExpected = {
  readonly projectId: string;
  readonly environment: string;
  readonly region: string;
};
// Independent of Hosting-injected Firebase configuration. Unknown preview origins refuse.
export function trustedTeacherUnitsEnvironment(origin: string): CompatibilityExpected {
  if (origin === "https://app.lyfelabz.com")
    return { projectId: "lyfelabz-prod", environment: "production", region: "us-central1" };
  if (origin === "https://lyfelabz-staging.web.app")
    return { projectId: "lyfelabz-staging", environment: "staging", region: "us-central1" };
  let url: URL;
  try {
    url = new URL(origin);
  }
  catch {
    return refuse();
  }
  if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    return { projectId: "lyfelabz-prod", environment: "emulator", region: "us-central1" };
  return refuse();
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return refuse();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(result, k)))
    return refuse();
  return result;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== "string") || new Set(value).size !== value.length)
    return refuse();
  return value as string[];
}
export function validateTeacherUnitsCapability(raw: unknown, expected: CompatibilityExpected, nonce: string, caller: {
  uid: string;
  schoolId: string;
  districtId: string;
}, placementFingerprint: string): void {
  const r = object(raw, ["schemaVersion", "nonce", "backend", "teacherUnits", "caller"]);
  const b = object(r.backend, ["projectId", "environment", "region"]);
  const t = object(r.teacherUnits, ["apiContractVersion", "supportedOperations", "acceptedClientContractVersions", "placementFingerprint"]);
  const c = object(r.caller, ["uid", "role", "schoolId", "districtId"]);
  const operations = strings(t.supportedOperations);
  const clients = strings(t.acceptedClientContractVersions);
  if (r.schemaVersion !== 1 || r.nonce !== nonce || b.projectId !== expected.projectId || b.environment !== expected.environment || b.region !== expected.region || t.apiContractVersion !== VERSION || !clients.includes(VERSION) || operations.length !== REQUIRED_OPERATIONS.length || REQUIRED_OPERATIONS.some(op => !operations.includes(op)) || t.placementFingerprint !== placementFingerprint || c.uid !== caller.uid || c.role !== "teacher" || c.schoolId !== caller.schoolId || c.districtId !== caller.districtId)
    refuse();
}
export function assertTeacherUnitsTransport(functions: Functions, auth: Auth, expected: CompatibilityExpected): void {
  // Firebase 10 FunctionsService has emulatorOrigin. Fail closed if its shape changes.
  const emulatorOrigin = (functions as Functions & {
    emulatorOrigin?: unknown;
  }).emulatorOrigin;
  if (functions.app !== auth.app || functions.app.options.projectId !== expected.projectId || functions.region !== expected.region || functions.customDomain !== null || emulatorOrigin !== (expected.environment === "emulator" ? "http://127.0.0.1:5001" : null))
    refuse();
  if ((auth.emulatorConfig !== null) !== (expected.environment === "emulator"))
    refuse();
  if (auth.emulatorConfig && (auth.emulatorConfig.host !== "127.0.0.1" || auth.emulatorConfig.port !== 9099 || auth.emulatorConfig.protocol !== "http"))
    refuse();
}
export type TeacherUnitsMutationVerifier = () => Promise<() => void>;
export function createTeacherUnitsMutationVerifier(functions: Functions, auth: Auth, readSession: () => CompatibilitySession | null): TeacherUnitsMutationVerifier {
  // Resolve expectations only when the closed release permits construction.
  requireTeacherUnitsAvailable();
  const expected = trustedTeacherUnitsEnvironment(window.location.origin);
  const capability = httpsCallable(functions, "teacherUnitsCapabilities", { timeout: 10000 });
  return async () => {
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let handedOff = false;
    let expired = false;
    const cleanup = () => {
      unsubscribe?.();
      unsubscribe = undefined;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    try {
      requireTeacherUnitsAvailable();
      assertTeacherUnitsTransport(functions, auth, expected);
      const session = readSession();
      const user = auth.currentUser;
      if (!session || !user || user.uid !== session.uid)
        return refuse();
      let changed = false;
      let initial = true;
      unsubscribe = onIdTokenChanged(auth, observed => {
        if (initial && observed === user) {
          initial = false;
          return;
        }
        initial = false;
        changed = true;
      });
      const assertCurrent = () => {
        requireTeacherUnitsAvailable();
        assertTeacherUnitsTransport(functions, auth, expected);
        const current = readSession();
        if (expired || changed || auth.currentUser !== user || !current || current.uid !== session.uid || current.schoolId !== session.schoolId || current.generation !== session.generation)
          refuse();
      };
      const work = async () => {
        const token = await user.getIdTokenResult();
        const districtId = token.claims.districtId;
        if (token.claims.role !== "teacher" || token.claims.schoolId !== session.schoolId || typeof districtId !== "string" || !districtId.trim())
          return refuse();
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        const nonce = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(getPlaceableResources().map(r => r.id))));
        const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
        assertCurrent();
        const response = await capability({ schemaVersion: 1, nonce, clientContractVersion: VERSION });
        validateTeacherUnitsCapability(response.data, expected, nonce, { uid: user.uid, schoolId: session.schoolId, districtId }, fingerprint);
        const after = await user.getIdTokenResult();
        if (after.token !== token.token)
          refuse();
        assertCurrent();
        return assertCurrent;
      };
      const permit = await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; cleanup(); reject(new TeacherUnitsCompatibilityError()); }, 10000); })]);
      handedOff = true;
      let consumed = false;
      return () => {
        try {
          if (consumed) refuse();
          consumed = true;
          permit();
        } finally {
          cleanup();
        }
      };
    }
    catch {
      return refuse();
    }
    finally {
      if (!handedOff) {
        expired = true;
        cleanup();
      }
    }
  };
}
