import { PlatformError, type LmsProviderId } from "../../shared";
import { googleClassroomAdapter } from "./google-classroom/adapter";
import type { LmsProviderAdapter } from "./provider";

// Provider registry per LMS_INTEGRATION_ARCHITECTURE.md §3.3 and PDR-020a.
// The registry is the single canonical way core code resolves an adapter
// for a provider identifier. It is the closed-set gate that keeps
// provider neutrality permanent (PDR-020f): the union `LmsProviderId` and
// this map advance together, and no core path ever reaches for a
// provider adapter through a different route.
const REGISTRY: ReadonlyMap<LmsProviderId, LmsProviderAdapter> = new Map<
  LmsProviderId,
  LmsProviderAdapter
>([[googleClassroomAdapter.providerId, googleClassroomAdapter]]);

export function listRegisteredProviders(): readonly LmsProviderAdapter[] {
  return Array.from(REGISTRY.values());
}

export function isRegisteredProvider(
  providerId: string,
): providerId is LmsProviderId {
  return REGISTRY.has(providerId as LmsProviderId);
}

export function getProviderAdapter(
  providerId: LmsProviderId,
): LmsProviderAdapter {
  const adapter = REGISTRY.get(providerId);
  if (!adapter) {
    throw new PlatformError(
      "lms.unknownProvider",
      `Provider "${providerId}" is not registered.`,
    );
  }
  return adapter;
}
