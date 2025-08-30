# Data Flow

## 1) Local Change (UI -> Yjs -> Network)

Scenario: `userProxy.profile.email = '...'` in the UI.

1. Accessing `profile` returns the `profile` controller (a Valtio proxy for a `Y.Map`).
2. The Valtio subscription on the object proxy receives a top-level `set` operation for `email`.
3. We start `doc.transact(..., VALTIO_YJS_ORIGIN)`.
4. Call `yProfileMap.set('email', '...')` (or convert complex values using converter utilities if needed).
5. The transaction ends.
6. `doc.on('afterTransaction')` fires, but is ignored because `origin === VALTIO_YJS_ORIGIN`.
7. `doc.on('update')` may fire via the provider and propagate to peers.

## 2) Remote Change (Network -> Yjs -> UI)

Scenario: A peer inserts a new item into a shared list (a `Y.Array`).

1. The provider applies the update: `Y.applyUpdate(doc, update)`.
2. `doc.on('afterTransaction')` fires with a remote origin.
3. The synchronizer reads `transaction.changedParentTypes` and finds the relevant Y array.
4. It finds the nearest materialized ancestor (often the same array) and calls `reconcileValtioArray(context, yArray, doc)`.
5. The reconciler builds new content, materializing controllers for any new Y children (for example, a `Y.Map` for the new list item).
6. The reconciler splices the Valtio array proxy to match the Y array (the Valtio array holds controller proxies for nested Y objects, not plain objects).
7. Valtio detects the splice; components using `useSnapshot` of that proxy re-render.
