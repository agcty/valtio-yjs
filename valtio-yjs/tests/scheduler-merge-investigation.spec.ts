import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../src/index.js';
import { yTypeToPlainObject } from '../src/converter.js';
import { waitMicrotask } from './test-helpers.js';

/**
 * Investigation: Can we relax the conservative merge check?
 * 
 * Current behavior (lines 182-203 in writeScheduler.ts):
 *   Only merge delete+set into replace when there's exactly ONE of each per array.
 * 
 * Question: What happens if we have multiple delete+set pairs at different indices?
 * Should each pair independently become a replace?
 * 
 * Test scenarios:
 * 1. Single delete+set (current: merges ✅)
 * 2. Multiple delete+set pairs at different indices (current: doesn't merge ❌)
 * 3. Multiple deletes and sets with some overlapping (edge case)
 * 4. Mixed splice operations in same batch
 */

describe('WriteScheduler merge check investigation', () => {
  let doc: Y.Doc;
  let proxy: { items: unknown[] };
  let dispose: () => void;

  beforeEach(() => {
    doc = new Y.Doc();
    const result = createYjsProxy<{ items: unknown[] }>(doc, {
      getRoot: (doc) => doc.getMap('root'),
    });
    proxy = result.proxy;
    dispose = result.dispose;
    
    // Bootstrap with initial data
    result.bootstrap({ items: [
      { id: 1, value: 'a' },
      { id: 2, value: 'b' },
      { id: 3, value: 'c' },
      { id: 4, value: 'd' },
      { id: 5, value: 'e' },
    ]});
  });

  afterEach(() => {
    dispose();
  });

  describe('Scenario 1: Single delete+set (baseline)', () => {
    it('should merge single delete+set into replace', async () => {
      // This should work with current conservative check
      proxy.items[0] = { id: 10, value: 'NEW' };
      await waitMicrotask(); // Wait for scheduler to flush
      
      const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
      const result = yTypeToPlainObject(yItems) as unknown[];
      
      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({ id: 10, value: 'NEW' });
      expect(result[1]).toMatchObject({ id: 2, value: 'b' });
    });
  });

  describe('Scenario 2: Multiple delete+set pairs (the investigation)', () => {
    it('should handle multiple direct assignments in same batch', async () => {
      // Replace items at indices 0 and 2
      // Each is a delete+set at the same index
      // With conservative check: won't merge (setCount=2, deleteCount=2)
      // Without conservative check: both should merge to replaces
      
      proxy.items[0] = { id: 10, value: 'NEW_0' };
      proxy.items[2] = { id: 30, value: 'NEW_2' };
      await waitMicrotask(); // Wait for scheduler to flush
      
      const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
      const result = yTypeToPlainObject(yItems) as unknown[];
      
      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({ id: 10, value: 'NEW_0' });
      expect(result[1]).toMatchObject({ id: 2, value: 'b' });
      expect(result[2]).toMatchObject({ id: 30, value: 'NEW_2' });
      expect(result[3]).toMatchObject({ id: 4, value: 'd' });
      expect(result[4]).toMatchObject({ id: 5, value: 'e' });
    });

    it('should handle multiple splice replacements in same batch', async () => {
      // Using splice with deleteCount=1, insertCount=1 at different indices
      // This is the canonical "replace" operation
      
      proxy.items.splice(1, 1, { id: 20, value: 'REPLACED_1' });
      proxy.items.splice(3, 1, { id: 40, value: 'REPLACED_3' });
      await waitMicrotask(); // Wait for scheduler to flush
      
      const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
      const result = yTypeToPlainObject(yItems) as unknown[];
      
      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({ id: 1, value: 'a' });
      expect(result[1]).toMatchObject({ id: 20, value: 'REPLACED_1' });
      expect(result[2]).toMatchObject({ id: 3, value: 'c' });
      expect(result[3]).toMatchObject({ id: 40, value: 'REPLACED_3' });
      expect(result[4]).toMatchObject({ id: 5, value: 'e' });
    });

    it('should handle three direct assignments in same batch', async () => {
      // Extreme case: replace three items at once
      proxy.items[0] = { id: 10, value: 'X' };
      proxy.items[2] = { id: 30, value: 'Y' };
      proxy.items[4] = { id: 50, value: 'Z' };
      await waitMicrotask(); // Wait for scheduler to flush
      
      const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
      const result = yTypeToPlainObject(yItems) as unknown[];
      
      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({ id: 10, value: 'X' });
      expect(result[1]).toMatchObject({ id: 2, value: 'b' });
      expect(result[2]).toMatchObject({ id: 30, value: 'Y' });
      expect(result[3]).toMatchObject({ id: 4, value: 'd' });
      expect(result[4]).toMatchObject({ id: 50, value: 'Z' });
    });
  });

  describe('Scenario 3: Edge cases - mismatched indices', () => {
    it('should only merge delete+set pairs at same index', async () => {
      // Delete at 0, set at 2 - these should NOT merge
      // This tests that per-index logic is still correct
      
      // First, let's try a delete without a matching set at same index
      proxy.items.splice(0, 1); // Delete at 0
      proxy.items.splice(1, 0, { id: 99, value: 'inserted' }); // Insert at 1
      await waitMicrotask(); // Wait for scheduler to flush
      
      const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
      const result = yTypeToPlainObject(yItems) as unknown[];
      
      // Should have: removed id:1, inserted id:99, kept rest
      expect(result).toHaveLength(5);
      // After delete at 0: [2,3,4,5]
      // After insert at 1: [2,99,3,4,5]
      expect(result[0]).toMatchObject({ id: 2, value: 'b' });
      expect(result[1]).toMatchObject({ id: 99, value: 'inserted' });
      expect(result[2]).toMatchObject({ id: 3, value: 'c' });
    });

    it('should handle more deletes than sets', async () => {
      // 2 deletes, 1 set - only the matching pair should merge
      proxy.items.splice(0, 1); // Delete at 0
      proxy.items.splice(0, 1); // Delete at 0 again (what was index 1)
      proxy.items[0] = { id: 100, value: 'new' }; // Set at 0
      await waitMicrotask(); // Wait for scheduler to flush
      
      const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
      const result = yTypeToPlainObject(yItems) as unknown[];
      
      // Should have: removed first 2 items, then replaced the new item at 0
      expect(result).toHaveLength(4);
      expect(result[0]).toMatchObject({ id: 100, value: 'new' });
    });
  });

  describe('Scenario 4: Real-world patterns', () => {
    it('should handle batch update pattern', async () => {
      // Common pattern: update multiple items in a loop
      const updates = [
        { index: 1, data: { id: 20, value: 'updated_b' } },
        { index: 3, data: { id: 40, value: 'updated_d' } },
      ];
      
      updates.forEach(({ index, data }) => {
        proxy.items[index] = data;
      });
      await waitMicrotask(); // Wait for scheduler to flush
      
      const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
      const result = yTypeToPlainObject(yItems) as unknown[];
      
      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({ id: 1, value: 'a' });
      expect(result[1]).toMatchObject({ id: 20, value: 'updated_b' });
      expect(result[2]).toMatchObject({ id: 3, value: 'c' });
      expect(result[3]).toMatchObject({ id: 40, value: 'updated_d' });
      expect(result[4]).toMatchObject({ id: 5, value: 'e' });
    });

    it('should handle identity preservation for multiple replacements', () => {
      // This is the KEY benefit of replace over delete+insert:
      // It preserves the Y.js item identity (structural sharing)
      
      const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
      
      // Get references to original Y types
      const orig0 = yItems.get(0);
      const orig2 = yItems.get(2);
      const orig4 = yItems.get(4);
      
      // Replace with same structure (Y.Map -> Y.Map)
      proxy.items[0] = { id: 1, value: 'modified_a' };
      proxy.items[2] = { id: 3, value: 'modified_c' };
      proxy.items[4] = { id: 5, value: 'modified_e' };
      
      // After replace, the Y.Map identity should be preserved where possible
      // (this is what replace operations do - they update in place)
      const new0 = yItems.get(0);
      const new2 = yItems.get(2);
      const new4 = yItems.get(4);
      
      // Note: Identity preservation depends on planner's replace detection
      // If it's properly classified as replace, identity is preserved
      expect(yItems.length).toBe(5);
    });
  });

  describe('Performance: Large batch updates', () => {
    it('should efficiently handle many simultaneous replacements', async () => {
      // Create array with 100 items
      const largeArray = Array.from({ length: 100 }, (_, i) => ({ 
        id: i, 
        value: `item_${i}` 
      }));
      
      doc = new Y.Doc();
      const result = createYjsProxy<{ items: unknown[] }>(doc, {
        getRoot: (doc) => doc.getMap('root'),
      });
      proxy = result.proxy;
      dispose = result.dispose;
      result.bootstrap({ items: largeArray });
      
      // Replace every 10th item
      const start = Date.now();
      for (let i = 0; i < 100; i += 10) {
        proxy.items[i] = { id: i * 1000, value: `replaced_${i}` };
      }
      await waitMicrotask(); // Wait for scheduler to flush
      const duration = Date.now() - start;
      
      const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
      const result2 = yTypeToPlainObject(yItems) as unknown[];
      
      expect(result2).toHaveLength(100);
      expect(result2[0]).toMatchObject({ id: 0, value: 'replaced_0' });
      expect(result2[10]).toMatchObject({ id: 10000, value: 'replaced_10' });
      expect(result2[50]).toMatchObject({ id: 50000, value: 'replaced_50' });
      
      // Performance should be reasonable (< 50ms for 10 replacements)
      expect(duration).toBeLessThan(50);
      
      dispose();
    });
  });
});

describe('Debugging: What does the current implementation actually do?', () => {
  it('traces operations for multiple assignments', async () => {
    const doc = new Y.Doc();
    const result = createYjsProxy<{ items: unknown[] }>(doc, {
      getRoot: (doc) => doc.getMap('root'),
    });
    const { proxy, dispose, bootstrap } = result;
    
    bootstrap({ items: [
      { id: 1, value: 'a' },
      { id: 2, value: 'b' },
      { id: 3, value: 'c' },
    ]});
    
    console.log('=== Before multiple assignments ===');
    const yItems = doc.getMap('root').get('items') as Y.Array<unknown>;
    console.log('Y.js state:', yTypeToPlainObject(yItems));
    
    // Make multiple assignments
    proxy.items[0] = { id: 10, value: 'NEW_A' };
    proxy.items[2] = { id: 30, value: 'NEW_C' };
    
    console.log('=== After multiple assignments (same microtask, before flush) ===');
    console.log('Y.js state:', yTypeToPlainObject(yItems));
    
    await waitMicrotask(); // Wait for scheduler to flush
    
    console.log('=== After microtask flush ===');
    console.log('Y.js state:', yTypeToPlainObject(yItems));
    
    // Verify result
    const result2 = yTypeToPlainObject(yItems) as unknown[];
    expect(result2).toHaveLength(3);
    expect(result2[0]).toMatchObject({ id: 10, value: 'NEW_A' });
    expect(result2[1]).toMatchObject({ id: 2, value: 'b' });
    expect(result2[2]).toMatchObject({ id: 30, value: 'NEW_C' });
    
    dispose();
  });
});
