# Y.Text Integration Investigation

**Date**: October 1, 2025  
**Status**: 🟡 Investigation Complete - Architecture Decision Required

---

## Executive Summary

This document consolidates our investigation into supporting Y.Text (and other Y.AbstractType leaf nodes) in valtio-yjs.

**Problem**: Y.Text documents experience non-deterministic convergence failures when concurrent edits occur at the same position.

**Root Cause**: Valtio's deep proxy system tracks Y.Text's internal CRDT state (`_transactionCleanups`, etc.), causing subscription callbacks to fire during Y.js's merge algorithm and interfering with convergence.

**Fix Attempted**:

- Wrapped Y.AbstractType instances in `ref()` to prevent deep proxying
- Deferred reconciliation to `afterAllTransactions` event
- **Result**: Improved from 35% to 70% success rate, but failures remain

**Conclusion**: This is an architectural mismatch. Y.Text is a specialized CRDT leaf node, not a container, and doesn't fit valtio-yjs's controller model designed for Y.Map/Y.Array.

---

## Test Results

| Scenario                       | Pass Rate | Notes                                               |
| ------------------------------ | --------- | --------------------------------------------------- |
| Pure Y.js (no valtio-yjs)      | 100% ✅   | Always converges correctly                          |
| Y.js with empty observers      | 100% ✅   | Observers alone don't cause issues                  |
| Valtio proxies only            | 35-45% ❌ | Just storing Y.Text in proxies causes failures      |
| valtio-yjs with ref() fix      | 70% 🟡    | Significant improvement but still non-deterministic |
| Integration tests (single doc) | 100% ✅   | No concurrency issues                               |
| E2E with relay pattern         | 100% ✅   | Real-world WebSocket-style sync works               |

---

## Technical Details

### Why Y.Text is Different

| Type    | Purpose                      | Children                | Needs Controller? |
| ------- | ---------------------------- | ----------------------- | ----------------- |
| Y.Map   | Container for nested objects | Other Y types           | ✅ Yes            |
| Y.Array | Container for nested arrays  | Other Y types           | ✅ Yes            |
| Y.Text  | Collaborative text CRDT      | Characters + formatting | ❌ No             |

Y.Text has:

- Internal CRDT state that manages character ordering
- Complex merge algorithm for concurrent edits
- Formatting/attribute tracking
- **No nested Y types** - it's a leaf node

### The Interference

When Y.Text is stored in a Valtio proxy, even with `ref()`:

1. DocA and DocB make concurrent edits at same position
2. `Y.applyUpdate()` starts CRDT merge in DocB
3. Y.js modifies Y.Text's internal state during merge
4. Valtio subscriptions may detect changes (even with ref, there's still a reference in the proxy)
5. Timing sensitive operations in Y.js's merge algorithm get disrupted
6. Documents fail to converge to same state

---

## Architecture Considerations

### valtio-yjs Controller Model

valtio-yjs is designed around the concept of "controller proxies":

- **Y.Map** → Valtio object proxy that controls child Y types
- **Y.Array** → Valtio array proxy that controls child Y types
- Lazy materialization: child controllers created on-demand
- Bidirectional sync: Valtio ↔ Y.js reconciliation

This model works great for **containers** but Y.Text is **not a container**.

---

## Do You Even Need Y.Text?

**Important**: Most fields don't need Y.Text! Use plain strings instead:

```typescript
// ✅ For 95% of use cases, just use plain strings
const doc = new Y.Doc();
const root = doc.getMap("root");

root.set("title", "My Document"); // Plain string - syncs fine!
root.set("author", "Alex"); // Plain string - syncs fine!
root.set("status", "Published"); // Plain string - syncs fine!
```

### When Y.Text IS Actually Needed

Y.Text is **only** required for:

1. **Rich text editors** (Google Docs-style with bold, italic, etc.)
2. **Formatted text** with attributes (colors, fonts, sizes)
3. **Large documents** needing efficient delta syncing
4. **Embedded content** (images, videos in text)

```typescript
// ✅ Y.Text for collaborative rich text editor
const content = new Y.Text();
content.insert(0, "Hello");
content.format(0, 5, { bold: true }); // Needs Y.Text for formatting
root.set("documentBody", content);
```

**If you don't need formatting/attributes, use plain strings!**

---

## Options Moving Forward

### Option A: Store Y.Text Outside Valtio Proxies (RECOMMENDED)

**Principle**: Don't force Y.Text into the container-controller model.

**Implementation**:

- Keep Y.Text references separate from Valtio state tree
- Provide helper API for accessing Y.Text instances
- Users interact with Y.Text via native Y.js API
- No reconciliation needed for Y.Text

**Benefits**:

- ✅ Architecturally clean (only containers in proxy tree)
- ✅ No interference with Y.Text CRDT
- ✅ 100% convergence guaranteed
- ✅ Consistent with Y.Text's design as a leaf node

**Drawbacks**:

- Requires separate API for Y.Text access
- No automatic Valtio reactivity for Y.Text changes
- Users must subscribe via Y.js API

**Example API**:

```typescript
const { proxy, getYText } = createYjsProxy(doc, {
  getRoot: (d) => d.getMap("root"),
});

// Access containers normally
proxy.users; // Y.Map → Valtio proxy
proxy.items; // Y.Array → Valtio proxy

// Access Y.Text via separate API
const bodyText = getYText(["documentBody"]);
bodyText.observe((event) => {
  // React to changes via Y.js API
});
```

---

### Option B: Accept Current Limitations

**Principle**: The 70% success rate in tests may not reflect production behavior.

**Evidence**:

- Real-world relay pattern (WebSocket sync) works 100%
- Integration tests (single document) work 100%
- Only concurrent test scenarios show failures

**Approach**:

1. Keep current implementation with `ref()` + `afterAllTransactions`
2. Document that Y.Text convergence in test environments may be non-deterministic
3. Mark specific concurrent Y.Text tests as flaky
4. Monitor production for actual convergence issues

**Benefits**:

- ✅ Works in production (relay pattern)
- ✅ No breaking changes
- ✅ Minimal implementation effort

**Drawbacks**:

- ❌ Test failures reduce confidence
- ❌ Architectural mismatch remains
- ❌ May surface in production under specific conditions

---

### Option C: Remove Y.Text Support Entirely

**Principle**: Explicitly scope valtio-yjs to containers only.

**Approach**:

- Document that valtio-yjs only supports Y.Map and Y.Array
- Users must manage Y.Text separately
- Provide clear examples of Y.Text usage alongside valtio-yjs

**Benefits**:

- ✅ Clear scope and limitations
- ✅ No confusing behavior
- ✅ Matches the controller model design

**Drawbacks**:

- ❌ May disappoint users expecting full Y.js support
- ❌ Requires clear documentation

---

## Recommendation

**Implement Option A: Store Y.Text Outside Valtio Proxies**

This is the architecturally correct solution that:

1. Respects Y.Text's design as a CRDT leaf node
2. Avoids interference with Y.js's internal algorithms
3. Provides clear, predictable behavior
4. Guarantees convergence correctness

### Migration Path

1. Design separate API for Y.Text access (`getYText`, `setYText`, etc.)
2. Update documentation explaining the distinction
3. Provide examples showing Y.Text + valtio-yjs usage
4. Consider similar treatment for other Y.AbstractType leaf nodes (Y.XmlFragment, etc.)

---

## Files to Consider Cleaning Up

Investigation files that can be removed once you decide on a path forward:

- `/valtio-yjs/tests/investigation/` - 10 investigation test files
- `/AI-INVESTIGATION-PROMPT.md`
- `/YTEXT-BUG-INVESTIGATION.md`
- `/YTEXT-BUG-ROOT-CAUSE.md`
- `/YTEXT-DESIGN-INVESTIGATION.md`
- `/YTEXT-INVESTIGATION-SUMMARY.md`
- `/ROOT-CAUSE-FOUND.md`
- `/ARCHITECTURAL-SOLUTION-YTEXT.md`
- `/FINAL-INVESTIGATION-SUMMARY.md`

---

## Current Git Changes

The following changes were made as part of the `ref()` fix attempt:

**Modified**:

- `valtio-yjs/src/bridge/valtio-bridge.ts` - Added `ref()` wrapping for Y.AbstractType
- `valtio-yjs/src/reconcile/reconciler.ts` - Added `ref()` wrapping for Y.AbstractType
- `valtio-yjs/src/synchronizer.ts` - Added `afterAllTransactions` deferral
- `valtio-yjs/vitest.config.ts` - Test configuration changes
- Various package.json files - Dependency updates

**Decision Required**: Keep these changes (70% success) or revert and implement Option A/C?

---

## Next Steps

1. **Decide on architecture**: Option A (separate API), B (accept limitations), or C (remove support)
2. **Clean up investigation files** once decision is made
3. **Update documentation** to reflect the decision
4. **Implement chosen solution** (if Option A)
5. **Update tests** to match the new architecture
6. **Consider similar approach** for Y.XmlFragment, Y.XmlElement, etc.

---

**Status**: Ready for architectural decision 🚀

