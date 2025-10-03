# Y.Text Reactivity Investigation & Fix - Handoff Document

## Summary

Successfully fixed Y.Text reactivity in valtio-yjs so that React components re-render when Y.Text content changes. However, there's a remaining React controlled component issue in the example app that needs resolution.

---

## Problem 1: Y.Text Changes Didn't Trigger React Re-renders ✅ FIXED

### The Issue

When `proxy.text.insert()` or `proxy.text.delete()` was called on a Y.Text object, React components using `useSnapshot(proxy)` did NOT re-render to show the updated text.

### Root Cause

The original implementation in `valtio-yjs/src/bridge/leaf-reactivity.ts` tried to manually trigger Valtio's internal notification system by accessing `proxyState[3]` (listeners), but this was incorrect:

```typescript
// OLD BROKEN CODE:
const listeners = (proxyState as any)[3]; // ❌ This index doesn't exist!
```

**Why it failed:**

- Valtio's `ProxyState` is a 3-element tuple: `[target, ensureVersion, addListener]`
- There is no `proxyState[3]` - that was a wrong assumption
- The Y.Text observe handler fired, but Valtio listeners were never notified

### The Fix

**Created a version counter approach** (similar to Valtio's `proxyMap` and `proxySet`):

1. **Added a version counter symbol** to the parent proxy object:

```typescript
// valtio-yjs/src/bridge/leaf-reactivity.ts
const LEAF_VERSION_SYMBOL = Symbol("valtio-yjs:leafVersion");

// Initialize on parent proxy
objProxy[LEAF_VERSION_SYMBOL] = 0;

// Increment when Y.Text changes
const handler = () => {
  const currentVersion = objProxy[LEAF_VERSION_SYMBOL] as number;
  objProxy[LEAF_VERSION_SYMBOL] = currentVersion + 1;
};
leafNode.observe(handler);
```

2. **Created a wrapper proxy** that touches the version counter on property access:

```typescript
// valtio-yjs/src/bridge/leaf-wrapper.ts
export function createLeafWrapper<T extends YLeafType>(
  leafNode: T,
  parentProxy: Record<string | symbol, unknown>
): T {
  return new Proxy(leafNode, {
    get(target: T, prop: string | symbol, receiver: unknown): unknown {
      // Touch version counter to create Valtio dependency
      if (LEAF_VERSION_SYMBOL in parentProxy) {
        void parentProxy[LEAF_VERSION_SYMBOL];
      }
      // Forward to Y.Text
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });
}
```

3. **Updated all leaf node creation** to use the wrapper:

- `valtio-yjs/src/bridge/valtio-bridge.ts` - in `getOrCreateValtioProxyForYMap` and `getOrCreateValtioProxyForYArray`
- `valtio-yjs/src/reconcile/reconciler.ts` - in `reconcileValtioMap` and `reconcileValtioArray`

**How it works:**

1. Component calls `snap.text.toString()` → wrapper proxy intercepts → touches `parentProxy[LEAF_VERSION_SYMBOL]` → Valtio tracks this dependency
2. Y.Text changes → observer fires → increments `parentProxy[LEAF_VERSION_SYMBOL]`
3. Valtio sees the version counter changed → notifies subscribers → React re-renders

### Test Results ✅

All 5 tests pass:

```bash
cd valtio-yjs/valtio-yjs
pnpm vitest run tests/integration/ytext-reactivity.spec.tsx

✓ updates React component when Y.Text content changes
✓ updates React component on Y.Text delete operations
✓ updates React component when Y.Text is modified from remote changes
✓ handles multiple rapid Y.Text changes
✓ displays character count that updates reactively
```

**Multiple sequential Y.Text changes work perfectly** - tested with rapid inserts of 'H', 'e', 'l', 'l', 'o'.

---

## Problem 2: Controlled Textarea Feedback Loop ❌ STILL BROKEN

### The Issue

In `examples/06_ytext/src/app.tsx`, users can only type one character. After typing, the textarea stops accepting input.

### Root Cause

Now that Y.Text reactivity works, it creates a **React controlled component feedback loop**:

**User types "h":**

1. `onChange` fires → `handleTextChange` called
2. `proxy.text.insert(0, 'h')`
3. Y.Text changes → triggers re-render (our fix working!)
4. React sees `value={textContent}` changed
5. **React fires `onChange` AGAIN** (controlled component behavior)
6. `handleTextChange` sees old="h", new="he" (from the textarea's value)
7. Tries to insert "e", but user didn't type "e"!
8. This continues in a loop

**Browser logs confirm this:**

```
[handleTextChange] {newValue: '...h', oldValue: '...', ...}
[INSERT] {inserted: 'h', ...}
[handleTextChange] {newValue: '...he', oldValue: '...h', ...} // ← Spurious onChange!
[REPLACE] {char: 'e'}  // ← Wrong!
[handleTextChange] {newValue: '...hl', oldValue: '...he', ...} // ← Another spurious onChange!
```

### Attempted Fix (Didn't Work)

Added `isLocalChangeRef` to track when we're processing a user change and ignore subsequent onChange events:

```typescript
// examples/06_ytext/src/app.tsx
const isLocalChangeRef = useRef(false);

const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  // Ignore if already processing
  if (isLocalChangeRef.current) {
    console.log("[IGNORING] - already processing local change");
    return;
  }

  isLocalChangeRef.current = true;
  // ... do Y.Text update ...
};

useEffect(() => {
  // Restore cursor and reset flag
  if (cursorPositionRef.current !== null) {
    textareaRef.current.setSelectionRange(pos, pos);
    cursorPositionRef.current = null;
  }
  isLocalChangeRef.current = false; // Reset for next keystroke
}, [textContent]);
```

**This approach didn't work** - still only one character can be typed.

---

## Next Steps to Fix the Textarea Issue

### Option 1: Use Uncontrolled Component with Ref Updates

Instead of `value={textContent}`, use `defaultValue` and manually update the textarea:

```typescript
const textareaRef = useRef<HTMLTextAreaElement>(null);

useEffect(() => {
  if (textareaRef.current && !isLocalChangeRef.current) {
    const textarea = textareaRef.current;
    const oldValue = textarea.value;
    const newValue = textContent;

    if (oldValue !== newValue) {
      const cursorPos = textarea.selectionStart;
      textarea.value = newValue;
      textarea.setSelectionRange(cursorPos, cursorPos);
    }
  }
}, [textContent]);

return (
  <textarea
    ref={textareaRef}
    defaultValue={textContent} // ← defaultValue, not value
    onChange={handleTextChange}
  />
);
```

### Option 2: Debounce/Batch Y.Text Updates

Only update Y.Text after user stops typing:

```typescript
const updateTimeoutRef = useRef<number | null>(null);

const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const newValue = e.target.value;
  setLocalValue(newValue); // Update local state immediately

  if (updateTimeoutRef.current) {
    clearTimeout(updateTimeoutRef.current);
  }

  updateTimeoutRef.current = setTimeout(() => {
    // Apply to Y.Text after debounce
    applyChangesToYText(newValue);
  }, 50);
};
```

### Option 3: Compare Event Target with Actual DOM

Check if the onChange came from a real user event:

```typescript
const lastUserInputRef = useRef<string>("");

const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const newValue = e.target.value;

  // Only process if this is genuinely new user input
  if (newValue === lastUserInputRef.current) {
    return; // Skip - this is from our own update
  }

  lastUserInputRef.current = newValue;
  // ... process Y.Text update ...
};
```

### Option 4: Use ContentEditable Instead

Avoid the controlled component issue entirely:

```typescript
<div
  ref={editableRef}
  contentEditable
  onInput={handleInput}
  suppressContentEditableWarning
/>
```

---

## Files Modified

### Core Library (Working)

1. **`valtio-yjs/src/bridge/leaf-wrapper.ts`** - NEW FILE

   - `createLeafWrapper()` - Creates proxy that touches version counter
   - `unwrapLeaf()` - Extracts original Y.Text
   - `LEAF_VERSION_SYMBOL` - Symbol for version tracking

2. **`valtio-yjs/src/bridge/leaf-reactivity.ts`** - MODIFIED

   - Removed incorrect `proxyState[3]` access
   - Now uses version counter: `objProxy[LEAF_VERSION_SYMBOL]++`
   - Imports `LEAF_VERSION_SYMBOL` from `leaf-wrapper.ts`

3. **`valtio-yjs/src/bridge/valtio-bridge.ts`** - MODIFIED

   - `getOrCreateValtioProxyForYMap()` - wraps leaves with `createLeafWrapper()`
   - `getOrCreateValtioProxyForYArray()` - wraps leaves with `createLeafWrapper()`
   - `upgradeChildIfNeeded()` - wraps leaves with `createLeafWrapper()`

4. **`valtio-yjs/src/reconcile/reconciler.ts`** - MODIFIED
   - All places that create leaf nodes now use `createLeafWrapper()`

### Example App (Broken)

5. **`examples/06_ytext/src/app.tsx`** - MODIFIED
   - Added `cursorPositionRef` for cursor restoration
   - Added `isLocalChangeRef` to prevent feedback loop (didn't work)
   - Added extensive debug logging
   - **Still has the controlled component issue**

### Tests (Passing)

6. **`valtio-yjs/tests/integration/ytext-reactivity.spec.tsx`** - NEW FILE
   - 5 comprehensive tests, all passing
   - Tests multiple rapid inserts - works perfectly

---

## Key Insights

1. **The library reactivity fix is correct and complete** ✅

   - Multiple sequential Y.Text changes work fine
   - React components re-render properly
   - Tests prove this works

2. **The textarea issue is NOT a library bug** ❌

   - It's a React controlled component pattern issue
   - The fix needs to be in the example app, not the library
   - This is a common problem with collaborative text editors

3. **Reference Implementation Needed**
   - Look at how other collaborative editors handle this:
     - ProseMirror with Yjs - uses uncontrolled approach
     - CodeMirror with Yjs - custom text input handling
     - Slate with Yjs - intercepts events at editor level

---

## Commands to Test

```bash
# Test library reactivity (should pass)
cd /Users/alex/code/valtio-yjs/valtio-yjs
pnpm vitest run tests/integration/ytext-reactivity.spec.tsx

# Run example app (textarea broken)
cd /Users/alex/code/valtio-yjs/examples/06_ytext
pnpm dev
# Open browser, try typing multiple characters - only one works

# Build library
cd /Users/alex/code/valtio-yjs/valtio-yjs
pnpm build
```

---

## Debug: What to Check in Browser Console

When you type "hello" in the textarea, you should see:

**First keystroke "h" (correct):**

```
[handleTextChange] {newValue: '...h', oldValue: '...', isLocalChange: false}
[INSERT] {inserted: 'h', ...}
```

**Problem - spurious onChange events:**

```
[handleTextChange] {newValue: '...he', oldValue: '...h', isLocalChange: true}
[IGNORING] - already processing local change  // ← This should prevent it
```

If you still see `[INSERT]` or `[REPLACE]` logs for characters you didn't type, the guard isn't working.

---

## Recommended Approach for Next AI

Focus on **Option 1 (Uncontrolled Component)** as it's the cleanest solution for collaborative text editing. The pattern should be:

1. Use `defaultValue` not `value`
2. Manually sync textarea.value with Y.Text in useEffect
3. Only when change is NOT from local user input
4. Preserve cursor position carefully

Good luck! The library is fixed, just need to solve the React textarea pattern. 🎯
