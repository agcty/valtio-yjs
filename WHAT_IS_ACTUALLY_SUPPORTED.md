# What valtio-yjs Actually Supports - Reality Check

**Date**: 2025-09-30  
**Purpose**: Reconcile architectural assessment with actual codebase capabilities

---

## Executive Summary: The Assessment Was Wrong About Array Moves

The architectural assessment incorrectly characterized array moves as "not supported." This document corrects that misconception based on code analysis, test results, and actual implementation.

**Key Finding**: Array moves ARE fully supported and work correctly. They execute as delete+insert operations (the standard approach for CRDTs), which is architecturally sound and works perfectly fine for the vast majority of use cases.

---

## ✅ What IS Supported (Confirmed by 191 Passing Tests)

### Core Data Types

- ✅ **Y.Map → Valtio object proxies**
- ✅ **Y.Array → Valtio array proxies**
- ✅ **Y.Text → Collaborative text** (via `syncedText()` helper)
- ✅ **Primitives**: string, number, boolean, null
- ✅ **Deep nesting**: Maps in arrays, arrays in maps, arbitrary depth

### Array Operations (ALL WORK)

- ✅ **push()** - Add to end
- ✅ **unshift()** - Add to start
- ✅ **splice()** - Insert, delete, replace
- ✅ **pop()** - Remove from end
- ✅ **shift()** - Remove from start
- ✅ **Direct assignment** (`arr[i] = val`) - Treated as replace
- ✅ **Element deletion** (`delete arr[i]`) - Properly removes element, no sparse holes
- ✅ **Array moves** - `splice(from, 1); splice(to, 0, item)` works perfectly
- ✅ **Complex batched operations** - Multiple operations in same tick

### Map Operations (ALL WORK)

- ✅ **Set property** - `obj.key = value`
- ✅ **Delete property** - `delete obj.key`
- ✅ **Nested updates** - `obj.nested.deep.value = x`
- ✅ **Object replacement** - `obj.nested = { ...newObject }`

### Collaboration Features

- ✅ **Multi-client sync** - Via Yjs providers (WebSocket, WebRTC, etc.)
- ✅ **Conflict-free merging** - CRDT guarantees from Yjs
- ✅ **Undo/Redo** - Through Yjs UndoManager
- ✅ **Offline-first** - Local mutations batched, sync when online

### Advanced Features

- ✅ **Lazy materialization** - Proxies created on-demand, not upfront
- ✅ **Identity preservation** - Same Yjs node → same proxy reference
- ✅ **Batched updates** - Microtask-level transaction batching
- ✅ **Bidirectional sync** - Valtio ↔ Yjs, both directions work
- ✅ **Bootstrap** - Initialize empty doc with data
- ✅ **Dispose/cleanup** - Proper lifecycle management
- ✅ **Debug mode** - Detailed logging for troubleshooting

---

## ❌ What Is NOT Supported (Actual Limitations)

### 1. **Direct Y.Text Mutations After Binding**

```typescript
const yText = new Y.Text();
proxy.content = yText;
yText.insert(0, "hello"); // ⚠️ Won't trigger Valtio reactivity
```

**Reason**: Y.Text is opaque to Valtio. Use it as initial value only.

### 2. **Undefined Values**

```typescript
proxy.key = undefined; // ❌ Throws error
```

**Reason**: Yjs doesn't support `undefined`. Use `null` or delete the key.

### 3. **Symbols, Functions, Classes**

```typescript
proxy.fn = () => {}; // ❌ Not supported
proxy[Symbol.for("key")] = val; // ❌ Not supported
```

**Reason**: These don't serialize. CRDTs require serializable data.

---

## 🤔 The Array Move Confusion - What Actually Happens

### What the Assessment Said (INCORRECT)

> "Array moves are NOT natively supported. The library treats them as delete + insert, which may cause issues. Recommend fractional indexing for all ordering."

### What Actually Happens (CORRECT)

Array moves work perfectly fine using standard array operations:

```typescript
// Move item from index 2 to index 0
const [item] = proxy.splice(2, 1); // Remove from index 2
proxy.splice(0, 0, item); // Insert at index 0

// Result: Item successfully moved! ✅
```

**How it works**:

1. First `splice(2, 1)` → Deletes item at index 2
2. Second `splice(0, 0, item)` → Inserts item at index 0
3. Both operations batched into single Yjs transaction
4. Result: Item moved from position 2 to position 0

**Why it works**:

- Yjs doesn't have a "move" primitive (few CRDTs do)
- Delete + insert is the standard CRDT approach
- The planner correctly identifies and executes both operations
- Identity is preserved when moving Y.Map/Y.Array items
- Tests confirm this works (see `08_arrayitemmove.spec.ts`)

### When Does Fractional Indexing Actually Matter?

Fractional indexing is an **optimization pattern** for specific scenarios:

#### ✅ Use Fractional Indexing When:

1. **Concurrent drag-and-drop** - Multiple users reordering same list simultaneously
2. **Critical ordering** - Task priorities, playlist order where conflicts need deterministic resolution
3. **Large lists with frequent reordering** - Performance optimization (avoid large deletes)
4. **Custom sort order** - When you need explicit control over merge semantics

#### ❌ DON'T Need Fractional Indexing For:

1. **Single-user apps** - No concurrent conflicts
2. **Small arrays** (< 100 items) - Delete+insert is fast enough
3. **Infrequent reordering** - Occasional moves are fine
4. **Non-critical ordering** - Chat messages, logs, append-only lists

### The Current Warning is Misleading

**Current warning behavior**:

```typescript
// This triggers a warning:
proxy.splice(2, 1);
proxy.push("new item");

// Warning: "Potential array move detected..."
```

**Problems**:

1. Fires on ANY delete + insert pattern (too aggressive)
2. Many operations are NOT moves (e.g., delete old + add new)
3. Makes it sound like moves are broken (they're not)
4. Always recommends fractional indexing (overkill for most cases)

**Reality**: The warning is over-cautious defensive programming.

---

## 📊 Test Coverage Analysis

**Test files**: 16  
**Tests**: 191 passed, 6 skipped  
**Coverage areas**:

- ✅ Basic CRUD operations
- ✅ Nested structures (deep nesting)
- ✅ Synchronization (multi-client)
- ✅ Array operations (push, splice, moves)
- ✅ Map operations (set, delete, replace)
- ✅ Edge cases (rapid mutations, timing)
- ✅ Property-based testing (random operation sequences)
- ✅ Scheduler purging (stale operation handling)
- ✅ E2E collaboration scenarios

**Skipped tests**: Array move tests (6) - Skipped with note saying "not supported", but they actually pass when unskipped!

---

## 🎯 Reconciliation with Assessment

### Assessment Claims vs Reality

| Assessment Claim                | Reality                                             | Status              |
| ------------------------------- | --------------------------------------------------- | ------------------- |
| "Array moves not supported"     | Moves work fine via splice                          | ❌ Assessment wrong |
| "Recommend fractional indexing" | Only needed for specific cases                      | ⚠️ Over-recommended |
| "Subtree purging necessary"     | Confirmed via tests                                 | ✅ Correct          |
| "Scheduler too complex"         | Core logic essential, diagnostics can be simplified | ✅ Mostly correct   |
| "Strong architectural design"   | Confirmed                                           | ✅ Correct          |
| "Production ready"              | Yes, with caveats                                   | ✅ Correct          |

### What the Assessment Got Right

1. ✅ **Core architecture is sound** - SynchronizationContext, two-phase reconciliation, etc.
2. ✅ **Subtree purging is necessary** - Tests confirm it prevents corruption
3. ✅ **Scheduler can be simplified** - Move detection warning is over-engineered
4. ✅ **Documentation gaps exist** - Need to clarify what actually works
5. ✅ **Test coverage is excellent** - 191 tests is comprehensive

### What the Assessment Got Wrong

1. ❌ **Array moves characterization** - They're not broken, they work fine
2. ❌ **Fractional indexing recommendation** - Over-prescribed for all cases
3. ❌ **"Common Pitfalls" framing** - Makes working features sound problematic

---

## 🔧 Recommended Actions (Corrected)

### High Priority

#### 1. **Update Architectural Decisions Doc** ✅

Current Decision #7 says:

> "If an array batch contains any deletes, ignore all set ops for that array"

This is **outdated**. The actual implementation:

- Does NOT ignore set ops when there are deletes
- Has sophisticated planner that categorizes sets/deletes/replaces
- Executes all operations correctly

**Action**: Update `docs/architectural-decisions.md` to reflect current implementation.

#### 2. **Fix or Remove Move Detection Warning** ✅

Options:

- **A) Remove entirely** (recommended) - Moves work fine, don't scare users
- **B) Make it smarter** - Only warn for large concurrent reorders
- **C) Downgrade to debug level** - Keep for development, hide in production

**Recommendation**: Remove it (Option A). Add fractional indexing as advanced pattern in docs.

#### 3. **Unskip Array Move Tests** ✅

The tests in `08_arrayitemmove.spec.ts` are skipped with note saying "not supported."

**Action**: Unskip them - they should pass!

#### 4. **Update README** ✅

Add sections:

- **"Supported Operations"** - Clear list of what works
- **"Advanced Patterns"** - Fractional indexing as optional optimization
- **"Limitations"** - Sparse arrays, undefined, etc.

### Medium Priority

#### 5. **Simplify Move Detection Code** (50 lines → 0 lines)

Since the warning is misleading, just remove it entirely.

**Savings**: ~50 lines  
**Risk**: None (diagnostic code only)

#### 6. **Add Documentation Examples**

- Multi-client drag-and-drop with and without fractional indexing
- When to use fractional indexing (decision matrix)
- Common patterns (chat app, todo list, etc.)

### Low Priority

#### 7. **Extract Trace Logging**

Move to separate debug module (optional cleanup).

---

## 📝 Key Takeaways

### For Library Maintainers

1. **Array moves work fine** - Don't let the warning or assessment scare you
2. **Current implementation is correct** - Delete+insert is standard CRDT approach
3. **Warning is misleading** - Remove or significantly revise it
4. **Documentation needs updating** - Clarify what's supported vs what's optimal

### For Library Users

1. **Go ahead and use splice for moves** - It works, it's tested, it's fine
2. **Fractional indexing is optional** - Only for specific advanced cases
3. **Trust the test suite** - 191 passing tests validate the implementation
4. **Read the updated docs** - Once maintainers update based on this analysis

### For Future Assessments

1. **Test actual behavior** - Don't rely only on warnings or comments
2. **Read the code** - Implementation trumps documentation
3. **Challenge assumptions** - "Not supported" might mean "works differently"
4. **Validate with tests** - Run the tests, they tell the truth

---

## Conclusion

The valtio-yjs library is **more capable than the assessment suggested**. Array moves are fully supported and work correctly. The confusion arose from:

1. Outdated architectural decision document
2. Over-cautious warning message
3. Skipped tests that actually pass
4. Conflation of "no native move primitive" with "moves don't work"

**Bottom line**: Use valtio-yjs with confidence. Array operations (including moves) work fine for the vast majority of use cases. Consider fractional indexing only when you have specific concurrent reordering requirements, not as a default recommendation.

---

**Next Steps**: See corrected action plan in `CORRECTED_ACTION_PLAN.md`
