/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from 'valtio-yjs';

const waitMicrotask = () => Promise.resolve();

describe('Valtio Operation Analysis', () => {
  function captureOperations(callback: () => void): unknown[][] {
    const operations: unknown[][] = [];
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation((...args) => {
      if (args[0]?.includes?.('[controller][array] ops')) {
        try {
          const ops = JSON.parse(args[1] as string);
          operations.push(ops);
        } catch {
          // ignore parse errors
        }
      }
    });
    
    callback();
    consoleSpy.mockRestore();
    return operations;
  }

  describe('Understanding Valtio Array Operations', () => {
    it('should analyze what operations Valtio generates for splice replace', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<string[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<string>('arr');

      // Setup initial state
      proxy.push('a', 'b', 'c');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['a', 'b', 'c']);

      // Capture operations for splice replace
      const operations = captureOperations(() => {
        proxy.splice(1, 1, 'B'); // Replace 'b' with 'B' at index 1
      });
      await waitMicrotask();

      console.log('=== SPLICE REPLACE ANALYSIS ===');
      console.log('Operation: proxy.splice(1, 1, "B")');
      console.log('Initial state: ["a", "b", "c"]');
      console.log('Expected result: ["a", "B", "c"]');
      console.log('Valtio operations generated:');
      operations.forEach((ops, i) => {
        console.log(`  Batch ${i + 1}:`, ops);
      });
      console.log('Actual Y.Array result:', yArr.toJSON());
      console.log('Actual proxy result:', JSON.stringify(proxy));
    });

    it('should analyze what operations Valtio generates for splice delete', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<string[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<string>('arr');

      // Setup initial state
      proxy.push('a', 'b', 'c');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['a', 'b', 'c']);

      // Capture operations for splice delete
      const operations = captureOperations(() => {
        proxy.splice(1, 1); // Delete element at index 1
      });
      await waitMicrotask();

      console.log('=== SPLICE DELETE ANALYSIS ===');
      console.log('Operation: proxy.splice(1, 1)');
      console.log('Initial state: ["a", "b", "c"]');
      console.log('Expected result: ["a", "c"]');
      console.log('Valtio operations generated:');
      operations.forEach((ops, i) => {
        console.log(`  Batch ${i + 1}:`, ops);
      });
      console.log('Actual Y.Array result:', yArr.toJSON());
      console.log('Actual proxy result:', JSON.stringify(proxy));
    });

    it('should analyze what operations Valtio generates for splice insert', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<string[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<string>('arr');

      // Setup initial state
      proxy.push('a', 'c');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['a', 'c']);

      // Capture operations for splice insert
      const operations = captureOperations(() => {
        proxy.splice(1, 0, 'b'); // Insert 'b' at index 1
      });
      await waitMicrotask();

      console.log('=== SPLICE INSERT ANALYSIS ===');
      console.log('Operation: proxy.splice(1, 0, "b")');
      console.log('Initial state: ["a", "c"]');
      console.log('Expected result: ["a", "b", "c"]');
      console.log('Valtio operations generated:');
      operations.forEach((ops, i) => {
        console.log(`  Batch ${i + 1}:`, ops);
      });
      console.log('Actual Y.Array result:', yArr.toJSON());
      console.log('Actual proxy result:', JSON.stringify(proxy));
    });

    it('should analyze what operations Valtio generates for direct assignment', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<string[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<string>('arr');

      // Setup initial state
      proxy.push('a', 'b', 'c');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['a', 'b', 'c']);

      // Capture operations for direct assignment
      const operations = captureOperations(() => {
        proxy[1] = 'B'; // Direct assignment
      });
      await waitMicrotask();

      console.log('=== DIRECT ASSIGNMENT ANALYSIS ===');
      console.log('Operation: proxy[1] = "B"');
      console.log('Initial state: ["a", "b", "c"]');
      console.log('Expected result: ["a", "B", "c"]');
      console.log('Valtio operations generated:');
      operations.forEach((ops, i) => {
        console.log(`  Batch ${i + 1}:`, ops);
      });
      console.log('Actual Y.Array result:', yArr.toJSON());
      console.log('Actual proxy result:', JSON.stringify(proxy));
    });

    it('should analyze what operations Valtio generates for push', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<string[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<string>('arr');

      // Setup initial state
      proxy.push('a', 'b');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['a', 'b']);

      // Capture operations for push
      const operations = captureOperations(() => {
        proxy.push('c');
      });
      await waitMicrotask();

      console.log('=== PUSH ANALYSIS ===');
      console.log('Operation: proxy.push("c")');
      console.log('Initial state: ["a", "b"]');
      console.log('Expected result: ["a", "b", "c"]');
      console.log('Valtio operations generated:');
      operations.forEach((ops, i) => {
        console.log(`  Batch ${i + 1}:`, ops);
      });
      console.log('Actual Y.Array result:', yArr.toJSON());
      console.log('Actual proxy result:', JSON.stringify(proxy));
    });

    it('should analyze what operations Valtio generates for unshift', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<string[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<string>('arr');

      // Setup initial state
      proxy.push('b', 'c');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['b', 'c']);

      // Capture operations for unshift
      const operations = captureOperations(() => {
        proxy.unshift('a');
      });
      await waitMicrotask();

      console.log('=== UNSHIFT ANALYSIS ===');
      console.log('Operation: proxy.unshift("a")');
      console.log('Initial state: ["b", "c"]');
      console.log('Expected result: ["a", "b", "c"]');
      console.log('Valtio operations generated:');
      operations.forEach((ops, i) => {
        console.log(`  Batch ${i + 1}:`, ops);
      });
      console.log('Actual Y.Array result:', yArr.toJSON());
      console.log('Actual proxy result:', JSON.stringify(proxy));
    });
  });

  describe('Complex Operation Patterns', () => {
    it('should analyze multiple operations in same microtask', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<string[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<string>('arr');

      // Setup initial state
      proxy.push('a', 'b', 'c');
      await waitMicrotask();

      // Capture operations for multiple operations
      const operations = captureOperations(() => {
        proxy.splice(1, 1, 'B'); // Replace at index 1
        proxy.push('d');         // Add at end
        proxy.unshift('start');  // Add at beginning
      });
      await waitMicrotask();

      console.log('=== MULTIPLE OPERATIONS ANALYSIS ===');
      console.log('Operations: splice(1,1,"B"), push("d"), unshift("start")');
      console.log('Initial state: ["a", "b", "c"]');
      console.log('Expected result: ["start", "a", "B", "c", "d"]');
      console.log('Valtio operations generated:');
      operations.forEach((ops, i) => {
        console.log(`  Batch ${i + 1}:`, ops);
      });
      console.log('Actual Y.Array result:', yArr.toJSON());
      console.log('Actual proxy result:', JSON.stringify(proxy));
    });
  });
});
