# Architectural Decisions

## 1) afterTransaction vs observeDeep

- Problem: Reliably listen for remote changes, including those affecting parts of the document not yet materialized as Valtio proxies.
- Options:
  - observeDeep / observe: granular events but problematic for lazy materialization; listeners do not exist on unmaterialized nodes and require walking parents manually.
  - afterTransaction: global visibility; naïvely reconciling everything would be slow.
- Decision: Use `yRoot.observeDeep`.
- Rationale: Naturally scopes to the chosen root, preserves lazy materialization by walking to the nearest materialized ancestor, and avoids global reconciliation. A future switchable adapter can leverage `changedParentTypes` for very large docs.

## 2) Many Proxies (Controller Tree) vs Single Snapshot Proxy

- Problem: Shape Valtio state to enable granular reactivity and ergonomic mutations.
- Options:
  - Single proxy over `toJSON()` snapshot: simple to implement but loses identity and granular updates; requires diffing and causes update bounce.
  - Many proxies (live controller tree): one Valtio proxy per `Y.Map`/`Y.Array` that issues direct Yjs ops.
- Decision: Many proxies (the Live Controller model).
- Rationale: Enables surgical UI updates with `useSnapshot` and preserves identity links between UI dependencies and specific collaborative objects.

## 3) Encapsulated Context vs Global Module State

- Problem: Where to store instance-scoped caches and disposers.
- Options: Module-level globals vs per-instance `SynchronizationContext`.
- Decision: Encapsulate in `SynchronizationContext`.
- Rationale: Prevents cross-instance interference, simplifies tests, and makes lifecycle management explicit (`disposeAll`).

## 4) Eager Upgrade on Local Writes vs Parent-Level Nested Routing

- Problem: Assigning a plain object/array to a controller creates a period where the Valtio tree contains plain values while the Y tree expects live controllers. Subsequent nested edits would surface as deeper paths on the parent, tempting parent listeners to route and mutate grandchildren, violating encapsulation and not scaling with depth.
- Options:
  - Parent-level nested routing: detect `path.length > 1` in parent subscriptions and manually forward to child Y types.
  - Eager upgrade: on write, convert plain values to Y types and immediately replace them with controller proxies under a reconciliation lock.
- Decision: Eager upgrade on write.
- Rationale: Restores encapsulation (parents only handle direct children), scales recursively (children handle their own edits), and eliminates brittle, leaky abstractions.

## 5) Per-Controller vs Centralized Batching

- Problem: Interleaved `doc.transact` calls across controllers lead to re-entrancy, partial shapes, and hard-to-reason timing during object insertion.
- Options:
  - Per-controller batching: simpler but still allows competing transactions in the same tick.
  - Centralized batching: one scheduler per context flushes once per microtask.
- Decision: Centralized batching in `SynchronizationContext`.
- Rationale: Guarantees a single transaction per tick, deterministic ordering (map deletes → map sets → array deletes → array sets), coalesces duplicate writes, and runs all eager upgrades post-transaction under the reconciliation lock.

## 6) Why a Reconciliation Lock when Yjs already does CRDTs?

- Problem: Yjs reconciles concurrent edits in the Y document, but our bridge must mirror Y → Valtio and translate Valtio → Y. Without a guard, inbound structural writes to the Valtio proxy would be observed by controllers and reflected back into Y, causing loops and redundant transactions.
- Options:
  - Rely solely on Yjs origin checks: prevents the synchronizer from acting on our own Y transactions, but does not stop controller listeners from creating new Y transactions in response to reconciler writes.
  - Add a reconciliation lock at the Valtio layer: mark a critical section so controller subscriptions no-op while the reconciler (or post-transaction eager upgrades) mutate the proxy.
- Decision: Use a reconciliation lock (`withReconcilingLock`).
- Rationale: Separates responsibilities and keeps flows one-way during inbound updates. The origin guard stops Yjs-level echo; the lock stops Valtio-level reflection. Together they avoid feedback loops, reduce redundant writes/relay traffic, and ensure deterministic, cheap reconciliation.
