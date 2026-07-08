# audit/

Audit-record helpers and audit-only triggers.

## Scope

- Shared helpers that other domains call to write audit records inside their own transactions.
- Any trigger whose sole purpose is audit-record maintenance.

## Not in scope

- Log lines. Logs go through `shared/logging/`. Audit records are durable Firestore documents; logs are not.
- Business logic that happens to write audit records as a side effect. That logic belongs in its own domain.
