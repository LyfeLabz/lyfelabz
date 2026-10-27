// Bootstrap-scoped advisory display state. This never grants backend authority
// and never stores or shares a mutation permit.
export type CapabilityStatus = "unknown" | "checking" | "enabled" | "closed" | "unavailable" | "incompatible" | "stale";
export type CapabilitySnapshot = Readonly<{ status: CapabilityStatus; epoch: number; sequence: number }>;
export type CapabilityTicket = Readonly<{ epoch: number; sequence: number; context: readonly unknown[]; startedAt: number }>;
export type CapabilityObservation = Readonly<{
  status: "enabled" | "closed" | "unavailable" | "incompatible";
  policyInstanceId?: string;
  policyGeneration?: number;
}>;
export type TeacherUnitsCapabilityState = {
  getSnapshot(): CapabilitySnapshot;
  subscribe(listener: (state: CapabilitySnapshot) => void): () => void;
  begin(kind: "display" | "mutation"): CapabilityTicket | null;
  current(ticket: CapabilityTicket): boolean;
  publish(ticket: CapabilityTicket, observation: CapabilityObservation): boolean;
  invalidate(status?: "stale" | "closed" | "unavailable" | "incompatible"): void;
  setDiscover(discover: () => Promise<void>): void;
  refresh(): Promise<void>;
  revalidate(): Promise<void>;
  enter(surface: string): Promise<void>;
  addCleanup(cleanup: () => void): void;
  dispose(): void;
};

export function createTeacherUnitsCapabilityState(options: {
  // Include canonical identity/bootstrap and actual Auth/transport object
  // identities. The adapter additionally watches actual token changes.
  readContext?: () => readonly unknown[] | null;
  now?: () => number;
  visibility?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
} = {}): TeacherUnitsCapabilityState {
  const clock = options.now ?? (() => performance.now());
  const readContext = options.readContext ?? (() => []);
  const same = (a: readonly unknown[] | null, b: readonly unknown[] | null) =>
    a === b || (a !== null && b !== null && a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
  let context = readContext()?.slice() ?? null;
  let snapshot: CapabilitySnapshot = Object.freeze({ status: "unknown", epoch: 0, sequence: 0 });
  let disposed = false;
  let expiresAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let discovery: (() => Promise<void>) | undefined;
  let inflight: Promise<void> | undefined;
  let surface: string | null = null;
  const generations = new Map<string, number>();
  const listeners = new Set<(state: CapabilitySnapshot) => void>();
  const cleanups = new Set<() => void>();
  const clearExpiry = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; expiresAt = 0; };
  const emit = (status: CapabilityStatus, epoch = snapshot.epoch, sequence = snapshot.sequence) => {
    snapshot = Object.freeze({ status, epoch, sequence });
    for (const listener of listeners) listener(snapshot);
  };
  const invalidate: TeacherUnitsCapabilityState["invalidate"] = (status = "stale") => {
    if (disposed) return;
    clearExpiry();
    inflight = undefined;
    emit(status, snapshot.epoch + 1);
  };
  const synchronize = () => {
    const current = readContext();
    if (!same(context, current)) {
      context = current?.slice() ?? null;
      invalidate();
    }
    if (snapshot.status === "enabled" && clock() >= expiresAt) invalidate();
    return !disposed && context !== null;
  };
  const current = (ticket: CapabilityTicket) => synchronize() &&
    ticket.epoch === snapshot.epoch && ticket.sequence === snapshot.sequence &&
    same(ticket.context, context) && clock() >= ticket.startedAt && clock() - ticket.startedAt < 10000;
  const refresh = (): Promise<void> => {
    if (!synchronize()) return Promise.resolve();
    if (options.visibility?.visibilityState === "hidden") { invalidate(); return Promise.resolve(); }
    if (inflight) return inflight;
    const epoch = snapshot.epoch;
    // Defer invocation so inflight is installed before a synchronous adapter
    // failure or a coalesced caller can observe it.
    const work = Promise.resolve().then(async () => {
      if (disposed || snapshot.epoch !== epoch) return;
      if (!discovery) { invalidate("unavailable"); return; }
      let sequence = snapshot.sequence;
      try {
        const pending = discovery();
        sequence = snapshot.sequence;
        await pending;
      }
      catch { if (!disposed && snapshot.epoch === epoch && snapshot.sequence === sequence) invalidate("unavailable"); }
    });
    inflight = work;
    void work.finally(() => { if (inflight === work) inflight = undefined; });
    return work;
  };
  const service: TeacherUnitsCapabilityState = {
    getSnapshot: () => { synchronize(); return snapshot; },
    subscribe: listener => { if (disposed) return () => undefined; listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin: kind => {
      if (!synchronize() || options.visibility?.visibilityState === "hidden" ||
          (kind === "mutation" && snapshot.status !== "enabled")) return null;
      const sequence = snapshot.sequence + 1;
      if (kind === "display") clearExpiry();
      emit(kind === "display" ? "checking" : snapshot.status, snapshot.epoch, sequence);
      return Object.freeze({ epoch: snapshot.epoch, sequence, context: Object.freeze(context!.slice()), startedAt: clock() });
    },
    current,
    publish: (ticket, observation) => {
      if (!current(ticket)) return false;
      const { policyInstanceId: id, policyGeneration: generation } = observation;
      if (observation.status !== "enabled") {
        if (id && Number.isSafeInteger(generation) && generation! >= 1) {
          if (generation! < (generations.get(id) ?? 0)) { invalidate("incompatible"); return false; }
          generations.set(id, generation!);
        }
        invalidate(observation.status);
        return true;
      }
      if (!id || !Number.isSafeInteger(generation) || generation! < 1 || generation! < (generations.get(id) ?? 0)) {
        invalidate("incompatible");
        return false;
      }
      generations.set(id, generation!);
      clearExpiry();
      expiresAt = clock() + 30000;
      emit("enabled");
      const epoch = snapshot.epoch;
      timer = setTimeout(() => { if (!disposed && snapshot.epoch === epoch && snapshot.status === "enabled") invalidate(); }, 30000);
      return true;
    },
    invalidate,
    setDiscover: fn => { discovery = fn; },
    refresh,
    revalidate: () => {
      synchronize();
      return snapshot.status === "unknown" || snapshot.status === "stale" ? refresh() : Promise.resolve();
    },
    enter: next => {
      synchronize();
      if (surface !== next) { surface = next; invalidate(); }
      return refresh();
    },
    addCleanup: fn => { if (disposed) fn(); else cleanups.add(fn); },
    dispose: () => {
      if (disposed) return;
      invalidate();
      disposed = true;
      clearExpiry();
      listeners.clear();
      for (const fn of cleanups) fn();
      cleanups.clear();
      discovery = undefined;
    },
  };
  const visibility = () => {
    invalidate();
    if (options.visibility?.visibilityState !== "hidden" && surface !== null) void refresh();
  };
  options.visibility?.addEventListener("visibilitychange", visibility);
  service.addCleanup(() => options.visibility?.removeEventListener("visibilitychange", visibility));
  return Object.freeze(service);
}
