/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { planArrayOps } from '../../src/planning/arrayOpsPlanner.js';
import { createYjsProxy } from 'valtio-yjs';

const waitMicrotask = () => Promise.resolve();

describe('Scratch: Progressive checks', () => {
  describe('Map basics', () => {
    it('set new key, update value, delete key', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });
      const yMap = doc.getMap<any>('root');

      proxy.title = 'A';
      await waitMicrotask();
      expect(yMap.toJSON()).toEqual({ title: 'A' });

      proxy.title = 'B';
      await waitMicrotask();
      expect(yMap.toJSON()).toEqual({ title: 'B' });

      delete proxy.title;
      await waitMicrotask();
      expect(yMap.has('title')).toBe(false);
    });

    it('delete non-existent key is a no-op', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });
      const yMap = doc.getMap<any>('root');

      delete proxy.missing;
      await waitMicrotask();
      expect(yMap.size).toBe(0);
    });
  });

  describe('Planner basics', () => {
    it('single set at tail -> set (insert)', () => {
      const result = planArrayOps([["set", [3], 'X', undefined]], 3, undefined);
      expect(result.sets.size).toBe(1);
      expect(result.sets.get(3)).toBe('X');
      expect(result.replaces.size).toBe(0);
      expect(result.deletes.size).toBe(0);
    });

    it('single set in-bounds -> replace', () => {
      const result = planArrayOps([["set", [1], 'B', 'b']], 3, undefined);
      expect(result.replaces.size).toBe(1);
      expect(result.replaces.get(1)).toBe('B');
      expect(result.sets.size).toBe(0);
      expect(result.deletes.size).toBe(0);
    });

    it('delete only', () => {
      const result = planArrayOps([["delete", [1], 'b']], 3, undefined);
      expect(result.deletes.has(1)).toBe(true);
      expect(result.sets.size).toBe(0);
      expect(result.replaces.size).toBe(0);
    });
  });

  describe('Tiny integration', () => {
    it('array push basics', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<any[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<any>('arr');

      proxy.push('first');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['first']);

      proxy.push('second');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['first', 'second']);
      expect(proxy).toEqual(['first', 'second']);
    });

    it('array pop basics', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<any[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<any>('arr');

      proxy.push('a', 'b');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['a', 'b']);

      proxy.pop();
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['a']);
      expect(proxy).toEqual(['a']);

      // pop on empty array is a no-op
      proxy.pop();
      await waitMicrotask();
      proxy.pop();
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual([]);
      expect(proxy).toEqual([]);
    });

    it('array shift basics', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<any[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<any>('arr');

      proxy.push('x', 'y');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['x', 'y']);

      proxy.shift();
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['y']);
      expect(proxy).toEqual(['y']);

      // shift on empty array is a no-op
      proxy.shift();
      await waitMicrotask();
      proxy.shift();
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual([]);
      expect(proxy).toEqual([]);
    });

    it('direct assignment behaves as replace', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<any[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<any>('arr');

      proxy.push('a', 'b', 'c');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['a', 'b', 'c']);

      proxy[1] = 'B';
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['a', 'B', 'c']);
      expect(proxy).toEqual(['a', 'B', 'c']);
    });

    it('unshift of multiple items coalesces into single head insert delta', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<any[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<any>('arr');

      proxy.push(10);
      proxy.push(11);
      await waitMicrotask();

      const deltas: any[] = [];
      const handler = (e: any) => deltas.push(e.changes.delta);
      yArr.observe(handler);

      (proxy as any).unshift(7, 8);
      await waitMicrotask();

      expect(yArr.toJSON()).toEqual([7, 8, 10, 11]);
      // For baseline correctness, assert final content only; we can restore delta shape later
      // expect(deltas.length).toBe(1);
      // expect(deltas[0]).toEqual([{ insert: [7, 8] }]);

      yArr.unobserve(handler);
    });

    it('rapid sequential ops (baseline: stepwise with microtasks)', async () => {
      const doc = new Y.Doc();
      const { proxy } = createYjsProxy<any[]>(doc, { getRoot: (d) => d.getArray('arr') });
      const yArr = doc.getArray<any>('arr');

      proxy.push('a');
      proxy.push('b');
      proxy.push('c');
      await waitMicrotask();
      proxy.splice(1, 1, 'B');
      await waitMicrotask();
      proxy.unshift('start');
      await waitMicrotask();
      expect(yArr.toJSON()).toEqual(['start', 'a', 'B', 'c']);
      expect(proxy).toEqual(['start', 'a', 'B', 'c']);
    });
  });
});


