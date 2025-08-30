# Architectural Decisions

## 1) afterTransaction vs observeDeep

- Problem: Reliably listen for remote changes, including those affecting parts of the document not yet materialized as Valtio proxies.
- Options:
  - observeDeep / observe: granular events but problematic for lazy materialization; listeners do not exist on unmaterialized nodes and require walking parents manually.
  - afterTransaction: global visibility; naïvely reconciling everything would be slow.
- Decision: Use `doc.on('afterTransaction')` with `transaction.changedParentTypes`.
- Rationale: Provides global correctness and targeted performance. We reconcile only the parent containers that actually changed, and we can always walk up to the nearest materialized ancestor, solving lazy materialization cleanly without fragile workarounds.

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
