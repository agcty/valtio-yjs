import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../src/index';

const waitMicrotask = () => Promise.resolve();

describe('Map validation rollback', () => {
  it('should rollback map changes on validation error (nested undefined)', async () => {
    const doc = new Y.Doc();
    const { proxy, bootstrap } = createYjsProxy<Record<string, unknown>>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    
    bootstrap({ user: { name: 'Alice', age: 30 } });
    await waitMicrotask();
    
    const originalState = { ...proxy.user as object };
    const yRoot = doc.getMap('root');
    
    // Try to assign an object with nested undefined (should fail validation)
    expect(() => {
      (proxy as Record<string, unknown>).user = { name: 'Bob', invalid: undefined };
    }).toThrow('[valtio-yjs] undefined is not allowed');
    
    // Should rollback to original state in proxy
    expect(proxy.user).toEqual(originalState);
    
    // Yjs should still have original state
    expect(yRoot.get('user')).toBeInstanceOf(Y.Map);
    const yUser = yRoot.get('user') as Y.Map<unknown>;
    expect(yUser.get('name')).toBe('Alice');
    expect(yUser.get('age')).toBe(30);
  });

  it('should rollback individual key change on validation error', async () => {
    const doc = new Y.Doc();
    const { proxy, bootstrap } = createYjsProxy<Record<string, unknown>>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    
    bootstrap({ a: 1, b: 2, c: 3 });
    await waitMicrotask();
    
    const yRoot = doc.getMap('root');
    
    // Valid changes should succeed
    (proxy as Record<string, unknown>).a = 10;
    await waitMicrotask();
    expect(yRoot.get('a')).toBe(10);
    
    // Invalid change should fail and rollback only that key
    expect(() => {
      (proxy as Record<string, unknown>).invalid = { nested: undefined };
    }).toThrow('[valtio-yjs] undefined is not allowed');
    
    // The invalid key should not be set in proxy (rolled back)
    expect((proxy as Record<string, unknown>).invalid).toBeUndefined();
    
    // Yjs should not have the invalid key
    expect(yRoot.has('invalid')).toBe(false);
    
    // Other keys should remain untouched
    expect(yRoot.get('a')).toBe(10);
    expect(yRoot.get('b')).toBe(2);
    expect(yRoot.get('c')).toBe(3);
  });

  it('should rollback on function assignment', async () => {
    const doc = new Y.Doc();
    const { proxy, bootstrap } = createYjsProxy<Record<string, unknown>>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    
    bootstrap({ data: { value: 42 } });
    await waitMicrotask();
    
    const originalState = { ...proxy.data as object };
    const yRoot = doc.getMap('root');
    
    // Try to assign a function (not allowed)
    expect(() => {
      (proxy as Record<string, unknown>).data = { callback: () => {} };
    }).toThrow('Unable to convert function');
    
    // Should rollback to original state
    expect(proxy.data).toEqual(originalState);
    
    // Yjs should still have original state
    const yData = yRoot.get('data') as Y.Map<unknown>;
    expect(yData.get('value')).toBe(42);
  });

  it('should rollback on non-plain object assignment', async () => {
    const doc = new Y.Doc();
    const { proxy, bootstrap } = createYjsProxy<Record<string, unknown>>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    
    bootstrap({ settings: { mode: 'light' } });
    await waitMicrotask();
    
    const originalState = { ...proxy.settings as object };
    const yRoot = doc.getMap('root');
    
    class CustomClass {
      constructor(public x: number) {}
    }
    
    // Try to assign a non-plain object
    expect(() => {
      (proxy as Record<string, unknown>).settings = { custom: new CustomClass(42) };
    }).toThrow('Unable to convert non-plain object');
    
    // Should rollback to original state
    expect(proxy.settings).toEqual(originalState);
    
    // Yjs should still have original state
    const ySettings = yRoot.get('settings') as Y.Map<unknown>;
    expect(ySettings.get('mode')).toBe('light');
  });

  it('should handle delete operations without rollback issues', async () => {
    const doc = new Y.Doc();
    const { proxy, bootstrap } = createYjsProxy<Record<string, unknown>>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    
    bootstrap({ a: 1, b: 2 });
    await waitMicrotask();
    
    const yRoot = doc.getMap('root');
    
    // Delete operations should work normally
    delete (proxy as Record<string, unknown>).a;
    await waitMicrotask();
    
    expect(proxy.a).toBeUndefined();
    expect(yRoot.has('a')).toBe(false);
    expect(yRoot.get('b')).toBe(2);
  });

  it('should match array rollback behavior pattern', async () => {
    const docArray = new Y.Doc();
    const docMap = new Y.Doc();
    
    const { proxy: arrayProxy, bootstrap: bootstrapArray } = createYjsProxy<unknown[]>(docArray, {
      getRoot: (d) => d.getArray('data'),
    });
    
    const { proxy: mapProxy, bootstrap: bootstrapMap } = createYjsProxy<Record<string, unknown>>(docMap, {
      getRoot: (d) => d.getMap('data'),
    });
    
    // Bootstrap both with valid data
    bootstrapArray([{ id: 1, value: 'a' }]);
    bootstrapMap({ item: { id: 1, value: 'a' } });
    await waitMicrotask();
    
    // Try to assign invalid data to both
    let arrayError: Error | undefined;
    let mapError: Error | undefined;
    
    try {
      arrayProxy[0] = { id: 2, nested: { invalid: undefined } };
    } catch (err) {
      arrayError = err as Error;
    }
    
    try {
      (mapProxy as Record<string, unknown>).item = { id: 2, nested: { invalid: undefined } };
    } catch (err) {
      mapError = err as Error;
    }
    
    // Both should throw similar errors
    expect(arrayError).toBeDefined();
    expect(mapError).toBeDefined();
    expect(arrayError?.message).toContain('undefined is not allowed');
    expect(mapError?.message).toContain('undefined is not allowed');
    
    // Both should maintain original state
    expect((arrayProxy[0] as Record<string, unknown>).id).toBe(1);
    expect(((mapProxy as Record<string, unknown>).item as Record<string, unknown>).id).toBe(1);
    
    // Both Yjs docs should have original state
    expect(docArray.getArray('data').toJSON()).toEqual([{ id: 1, value: 'a' }]);
    expect(docMap.getMap('data').toJSON()).toEqual({ item: { id: 1, value: 'a' } });
  });
});
