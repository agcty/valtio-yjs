import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../src/index.js';

const waitMicrotask = () => Promise.resolve();

describe('Valtio Proxy vs Raw Y Type behavior', () => {
  describe('Normal usage: Moving Valtio controller proxies', () => {
    it('should allow moving array items (Valtio proxies)', async () => {
      const doc = new Y.Doc();
      const { proxy, bootstrap } = createYjsProxy<unknown[]>(doc, {
        getRoot: (d) => d.getArray('data'),
      });

      // Bootstrap with nested objects
      bootstrap([
        { id: 1, nested: { value: 'a' } },
        { id: 2, nested: { value: 'b' } },
        { id: 3, nested: { value: 'c' } },
      ]);
      await waitMicrotask();

      // Move item from index 0 to index 2 (normal pattern)
      const [moved] = proxy.splice(0, 1);
      proxy.splice(2, 0, moved);
      await waitMicrotask();

      // Should work without errors
      expect(proxy).toEqual([
        { id: 2, nested: { value: 'b' } },
        { id: 3, nested: { value: 'c' } },
        { id: 1, nested: { value: 'a' } },
      ]);

      const yArr = doc.getArray('data');
      expect(yArr.toJSON()).toEqual([
        { id: 2, nested: { value: 'b' } },
        { id: 3, nested: { value: 'c' } },
        { id: 1, nested: { value: 'a' } },
      ]);
    });

    it('should allow copying/reassigning map values (Valtio proxies)', async () => {
      const doc = new Y.Doc();
      const { proxy, bootstrap } = createYjsProxy<Record<string, unknown>>(doc, {
        getRoot: (d) => d.getMap('root'),
      });

      bootstrap({ item: { nested: { value: 42 } } });
      await waitMicrotask();

      // Copy the Valtio proxy to another key
      (proxy as Record<string, unknown>).backup = proxy.item;
      await waitMicrotask();

      // Should work - both refer to independent clones in Yjs
      expect((proxy as Record<string, unknown>).backup).toEqual({ nested: { value: 42 } });
      expect(proxy.item).toEqual({ nested: { value: 42 } });

      // Verify in Yjs
      const yRoot = doc.getMap('root');
      expect(yRoot.has('item')).toBe(true);
      expect(yRoot.has('backup')).toBe(true);
    });

    it('should allow moving complex nested structures', async () => {
      const doc = new Y.Doc();
      const { proxy, bootstrap } = createYjsProxy<unknown[]>(doc, {
        getRoot: (d) => d.getArray('data'),
      });

      // Complex nested structure
      bootstrap([
        {
          id: 1,
          children: [{ name: 'child1' }, { name: 'child2' }],
          metadata: { created: '2024-01-01' },
        },
        {
          id: 2,
          children: [{ name: 'child3' }],
          metadata: { created: '2024-01-02' },
        },
      ]);
      await waitMicrotask();

      // Move the first complex item to the end
      const [moved] = proxy.splice(0, 1);
      proxy.push(moved);
      await waitMicrotask();

      // Should work without errors
      expect((proxy[0] as Record<string, unknown>).id).toBe(2);
      expect((proxy[1] as Record<string, unknown>).id).toBe(1);
      expect(proxy.length).toBe(2);
    });
  });

  describe('Abnormal usage: Directly assigning raw Y types', () => {
    it('should prevent assigning raw Y.Map that already has a parent', async () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      const { proxy: proxy1 } = createYjsProxy<Record<string, unknown>>(doc1, {
        getRoot: (d) => d.getMap('root1'),
      });

      const { proxy: proxy2 } = createYjsProxy<Record<string, unknown>>(doc2, {
        getRoot: (d) => d.getMap('root2'),
      });

      // Create a nested structure in doc1
      (proxy1 as Record<string, unknown>).item = { nested: { value: 42 } };
      await waitMicrotask();

      // Get the raw Y type (abnormal - you'd never do this in normal usage)
      const yRoot1 = doc1.getMap('root1');
      const yItem = yRoot1.get('item') as Y.Map<unknown>;
      const yNested = yItem.get('nested') as Y.Map<unknown>;

      // Verify it has a parent
      expect(yNested.parent).toBe(yItem);

      // Attempt to assign the raw Y type to doc2 - should throw
      expect(() => {
        (proxy2 as Record<string, unknown>).stolen = yNested as unknown;
      }).toThrow(/Cannot re-assign a collaborative object that is already in the document/i);
    });

    it('should prevent assigning raw Y.Array that already has a parent', async () => {
      const doc = new Y.Doc();
      const { proxy, bootstrap } = createYjsProxy<Record<string, unknown>>(doc, {
        getRoot: (d) => d.getMap('root'),
      });

      // Create an array in the document
      (proxy as Record<string, unknown>).items = ['a', 'b', 'c'];
      await waitMicrotask();

      // Get the raw Y.Array (abnormal usage)
      const yRoot = doc.getMap('root');
      const yItems = yRoot.get('items') as Y.Array<unknown>;

      // Verify it has a parent
      expect(yItems.parent).toBe(yRoot);

      // Attempt to reassign the raw Y.Array - should throw
      expect(() => {
        (proxy as Record<string, unknown>).backup = yItems as unknown;
      }).toThrow(/Cannot re-assign a collaborative object that is already in the document/i);
    });
  });

  describe('Edge cases: Distinguishing Valtio proxies from raw Y types', () => {
    it('should handle orphaned Y types (no parent) correctly', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<Record<string, unknown>>(doc, {
        getRoot: (d) => d.getMap('root'),
      });

      // Create an orphaned Y.Map (not yet in a document)
      const orphanedYMap = new Y.Map();
      orphanedYMap.set('value', 42);

      // Verify it has no parent
      expect(orphanedYMap.parent).toBeNull();

      // Assigning orphaned Y types should work (no parent = safe to attach)
      (proxy as Record<string, unknown>).orphan = orphanedYMap as unknown;
      await waitMicrotask();

      // Should be attached successfully
      const yRoot = doc.getMap('root');
      expect(yRoot.has('orphan')).toBe(true);
      const yOrphan = yRoot.get('orphan') as Y.Map<unknown>;
      expect(yOrphan.get('value')).toBe(42);
    });

    it('should allow same-document reassignment via Valtio proxies', async () => {
      const doc = new Y.Doc();
      const { proxy, bootstrap } = createYjsProxy<Record<string, unknown>>(doc, {
        getRoot: (d) => d.getMap('root'),
      });

      bootstrap({ source: { data: { value: 123 } } });
      await waitMicrotask();

      // Reassign via Valtio proxy (normal usage)
      // Note: This creates a deep clone automatically because the Y type already has a parent
      (proxy as Record<string, unknown>).destination = (proxy as Record<string, unknown>).source;
      await waitMicrotask();

      // Both should exist
      expect((proxy as Record<string, unknown>).source).toEqual({ data: { value: 123 } });
      expect((proxy as Record<string, unknown>).destination).toEqual({ data: { value: 123 } });

      // Verify both exist in Yjs as independent structures
      const yRoot = doc.getMap('root');
      expect(yRoot.has('source')).toBe(true);
      expect(yRoot.has('destination')).toBe(true);

      // The key point: this doesn't throw even though the underlying Y type has a parent
      // because the conversion layer handles it automatically
    });
  });

  describe('Documentation examples', () => {
    it('demonstrates the difference between normal and abnormal usage', async () => {
      const doc1 = new Y.Doc();
      const doc2 = new Y.Doc();

      const { proxy: proxy1 } = createYjsProxy<Record<string, unknown>>(doc1, {
        getRoot: (d) => d.getMap('root1'),
      });

      const { proxy: proxy2 } = createYjsProxy<Record<string, unknown>>(doc2, {
        getRoot: (d) => d.getMap('root2'),
      });

      // Set up initial state
      (proxy1 as Record<string, unknown>).item = { value: 42 };
      await waitMicrotask();

      // ✅ NORMAL: Working with Valtio proxies
      const valtioItem = (proxy1 as Record<string, unknown>).item;
      expect(() => {
        (proxy1 as Record<string, unknown>).copy = valtioItem; // This works!
      }).not.toThrow();

      await waitMicrotask();

      // ❌ ABNORMAL: Working with raw Y types (requires reaching into internals)
      const yRoot1 = doc1.getMap('root1');
      const rawYItem = yRoot1.get('item') as Y.Map<unknown>;
      expect(() => {
        (proxy2 as Record<string, unknown>).stolen = rawYItem as unknown; // This throws!
      }).toThrow(/Cannot re-assign/i);
    });
  });
});
