import type { TeacherUnitsCapabilityState } from "./capabilityState";
import { TeacherUnitsCompatibilityError } from "./compatibilityError";
import type { Auth } from "firebase/auth";
import { onIdTokenChanged } from "firebase/auth";
import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";
import { getPlaceableResources } from "./placeableResources";
import { requireTeacherUnitsAvailable } from "./releaseAvailability";
import { type MutationCompatibilityV2, validateCapabilityResponse, validateMutationCompatibility } from "./availabilityProtocol";
const CONTRACT = "teacher-units-v3";
export { TeacherUnitsCompatibilityError } from "./compatibilityError";
const refuse = (): never => { throw new TeacherUnitsCompatibilityError(); };
export type CompatibilitySession = {
  readonly uid: string;
  readonly schoolId: string;
  readonly generation: number;
};
export type CompatibilityExpected = {
  readonly projectId: "lyfelabz-prod" | "lyfelabz-staging";
  readonly environment: "production" | "staging";
  readonly region: "us-central1";
};
// Independent of Hosting-injected Firebase configuration. Unknown preview
// origins refuse. Local origins also refuse (A3-4 S3): A3-3 accepts only
// `demo-` emulator identities, while the shared client emulator configuration
// uses `lyfelabz-prod`, so no local browser can form a valid binding.
export function trustedTeacherUnitsEnvironment(origin: string): CompatibilityExpected {
  if (origin === "https://app.lyfelabz.com")
    return { projectId: "lyfelabz-prod", environment: "production", region: "us-central1" };
  if (origin === "https://lyfelabz-staging.web.app")
    return { projectId: "lyfelabz-staging", environment: "staging", region: "us-central1" };
  return refuse();
}
// Schema 3 discovery (U2_6_A3_CONTRACTS.md, Protocol). Only an `enabled`,
// policy-eligible declaration that accepts `teacher-units-v3` and matches
// this session's trusted environment, caller and placement yields a mutation
// envelope. Closed and unverified declarations are valid responses that
// authorize nothing, so the mutation is refused locally before dispatch.
export function evaluateTeacherUnitsCapability(raw: unknown, expected: CompatibilityExpected, nonce: string, caller: {
  uid: string;
  schoolId: string;
  districtId: string;
}, placementFingerprint: string): MutationCompatibilityV2 {
  // No emulator project is supplied, so an emulator declaration refuses.
  const checked = validateCapabilityResponse(raw);
  if (!checked.ok)
    return refuse();
  const { backend: b, teacherUnits: t, caller: c } = checked.value;
  const a = t.availability;
  if (checked.value.nonce !== nonce || b.projectId !== expected.projectId || b.environment !== expected.environment || b.region !== expected.region || c.uid !== caller.uid || c.role !== "teacher" || c.schoolId !== caller.schoolId || c.districtId !== caller.districtId || t.placementFingerprint !== placementFingerprint || a.state !== "enabled" || a.deploymentEligible !== true || t.acceptedClientContractVersions.length !== 1 || !(t.acceptedClientContractVersions as readonly string[]).includes(CONTRACT) || a.policyInstanceId === null || a.policyGeneration === null || a.backendReleaseId === null)
    return refuse();
  const envelope = validateMutationCompatibility({ schemaVersion: 2, clientContractVersion: CONTRACT, policyInstanceId: a.policyInstanceId, policyGeneration: a.policyGeneration, backendReleaseId: a.backendReleaseId, placementFingerprint });
  if (!envelope.ok)
    return refuse();
  return Object.freeze({ ...envelope.value });
}
export function assertTeacherUnitsTransport(functions: Functions, auth: Auth, expected: CompatibilityExpected): void {
  // Firebase 10 FunctionsService has emulatorOrigin. Fail closed if its shape changes.
  const emulatorOrigin = (functions as Functions & {
    emulatorOrigin?: unknown;
  }).emulatorOrigin;
  if (functions.app !== auth.app || functions.app.options.projectId !== expected.projectId || functions.region !== expected.region || functions.customDomain !== null || emulatorOrigin !== null || auth.emulatorConfig !== null)
    refuse();
}
// A fresh single-use permit that rechecks the verified context and returns
// the Option B mutation `compatibility` envelope obtained by the same fresh
// discovery. The envelope is attached immediately before dispatch and never
// persisted. backendReleaseId denotes the approved backend build identity.
export type TeacherUnitsMutationVerifier = () => Promise<() => MutationCompatibilityV2>;
export type CapabilityLifecycleBridge = TeacherUnitsCapabilityState;
export function createTeacherUnitsMutationVerifier(functions: Functions, auth: Auth, readSession: () => CompatibilitySession | null, lifecycle?: CapabilityLifecycleBridge): TeacherUnitsMutationVerifier {
  // Resolve expectations only when the closed release permits construction.
  requireTeacherUnitsAvailable();
  const expected = trustedTeacherUnitsEnvironment(window.location.origin);
  const capability = httpsCallable(functions, "teacherUnitsCapabilities", { timeout: 10000 });
  if (lifecycle) {
    const initialUser = auth.currentUser;
    let initial = true;
    const stop = onIdTokenChanged(auth, observed => {
      if (initial && observed === initialUser) { initial = false; return; }
      initial = false;
      lifecycle.invalidate("stale");
    });
    lifecycle.addCleanup(stop);
  }
  const discover = async (kind: "display" | "mutation") => {
    const ticket = lifecycle?.begin(kind);
    if (lifecycle && !ticket) return refuse();
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
        if ((ticket && !lifecycle?.current(ticket)) || expired || changed || auth.currentUser !== user || !current || current.uid !== session.uid || current.schoolId !== session.schoolId || current.generation !== session.generation)
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
        const response = await capability({ schemaVersion: 3, nonce, clientContractVersion: CONTRACT });
        const parsed = validateCapabilityResponse(response.data);
        if (!parsed.ok) {
          if (ticket) lifecycle?.publish(ticket, { status: "incompatible" });
          return refuse();
        }
        // Closed declarations still require every transport/caller/nonce binding.
        const r = parsed.value;
        if (r.nonce !== nonce || r.backend.projectId !== expected.projectId || r.backend.environment !== expected.environment || r.backend.region !== expected.region || r.caller.uid !== user.uid || r.caller.schoolId !== session.schoolId || r.caller.districtId !== districtId || r.teacherUnits.placementFingerprint !== fingerprint) {
          if (ticket) lifecycle?.publish(ticket, { status: "incompatible" });
          return refuse();
        }
        const availability = r.teacherUnits.availability;
        const envelope = availability.state === "enabled"
          ? evaluateTeacherUnitsCapability(response.data, expected, nonce, { uid: user.uid, schoolId: session.schoolId, districtId }, fingerprint)
          : null;
        const after = await user.getIdTokenResult();
        if (after.token !== token.token)
          refuse();
        assertCurrent();
        if (ticket && !lifecycle?.publish(ticket, {
          status: availability.state === "enabled" ? "enabled" : availability.state === "closed" ? "closed" : "unavailable",
          ...(availability.policyInstanceId !== null ? { policyInstanceId: availability.policyInstanceId, policyGeneration: availability.policyGeneration! } : {}),
        })) return refuse();
        if (!envelope && kind === "mutation") return refuse();
        return envelope;
      };
      const envelope = await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; cleanup(); reject(new TeacherUnitsCompatibilityError()); }, 10000); })]);
      if (kind === "display") return undefined;
      if (!envelope) return refuse();
      handedOff = true;
      let consumed = false;
      return () => {
        try {
          if (consumed) refuse();
          consumed = true;
          assertCurrent();
          return envelope;
        } finally {
          cleanup();
        }
      };
    }
    catch {
      if (ticket && lifecycle?.current(ticket)) lifecycle.publish(ticket, { status: "unavailable" });
      return refuse();
    }
    finally {
      if (!handedOff) {
        expired = true;
        cleanup();
      }
    }
  };
  lifecycle?.setDiscover(async () => { await discover("display"); });
  return async () => {
    const permit = await discover("mutation");
    if (!permit) return refuse();
    return permit;
  };
}
