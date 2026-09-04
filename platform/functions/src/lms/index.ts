import {
  ensureLmsDurableStorageBindings,
  isFunctionsRuntime,
} from "./shared/durable-storage";

// Sprint 23D. Auto-install the durable Firestore-backed OAuth state
// and token stores when the module is loaded inside a Cloud Functions
// runtime (production or Firebase Emulator Suite). Unit tests neither
// import this module directly nor set the runtime env vars, so the
// in-process defaults remain active under jest.
if (isFunctionsRuntime()) {
  ensureLmsDurableStorageBindings();
}

export { lmsAssignmentsPublish } from "./assignments-publish";
export { lmsDeepLinkResolve } from "./deep-link-resolve";
export { lmsClassesDiscover } from "./classes-discover";
export { lmsClassesImport } from "./classes-import";
export { lmsClassesRefresh } from "./classes-refresh";
export { lmsClassesRefreshRoster } from "./classes-refresh-roster";
export { lmsClassesSyncRoster } from "./classes-sync-roster";
export { lmsClassesListTopics } from "./classes-list-topics";
export { lmsConnectionsBegin } from "./connections-begin";
export { lmsConnectionsComplete } from "./connections-complete";
export { lmsConnectionsDescribe } from "./connections-describe";
export { lmsConnectionsDisconnect } from "./connections-disconnect";
export { lmsProvidersList } from "./providers-list";
