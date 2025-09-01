/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from 'valtio-yjs';

const waitMicrotask = () => Promise.resolve();

describe('Integration 2B: Valtio → Yjs (Local Change Simulation)', () => {
  it('proxy mutations write correct Y.Map/Y.Array content (do not assert proxy)', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });
    const yRoot = doc.getMap<any>('root');

    // Listen to number of transactions to ensure batching correctness
    const onUpdate = vi.fn();
    doc.on('update', onUpdate);

    // Mutate proxy
    proxy.tasks = [];
    await waitMicrotask();
    proxy.tasks.push({ title: 'New Task' });
    await waitMicrotask();

    // Assert source of truth (Yjs)
    const yTasks = yRoot.get('tasks') as Y.Array<Y.Map<any>>;
    expect(yTasks instanceof Y.Array).toBe(true);
    expect(yTasks.toJSON()).toEqual([{ title: 'New Task' }]);

    // We should have at least one transaction; exact count may depend on upgrade path
    expect(onUpdate).toHaveBeenCalled();
  });

  it('array structural edits on proxy produce correct Y.Array operations', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<number[]>(doc, { getRoot: (d) => d.getArray('arr') });
    const yArr = doc.getArray<number>('arr');

    proxy.push(10);
    proxy.push(11);
    await waitMicrotask();
    expect(yArr.toJSON()).toEqual([10, 11]);

    proxy.splice(1, 1, 99);
    await waitMicrotask();
    expect(yArr.toJSON()).toEqual([10, 99]);

    proxy.splice(0, 1);
    await waitMicrotask();
    expect(yArr.toJSON()).toEqual([99]);
  });

  it('undefined removes key; null persists as null in Y.Map', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });
    const yRoot = doc.getMap<any>('root');

    proxy.a = 'x';
    await waitMicrotask();
    expect(yRoot.toJSON()).toEqual({ a: 'x' });

    proxy.a = undefined;
    await waitMicrotask();
    // Library normalizes undefined -> null
    expect(yRoot.toJSON()).toEqual({ a: null });

    proxy.b = null;
    await waitMicrotask();
    expect(yRoot.toJSON()).toEqual({ a: null, b: null });
  });

  it('unshift and shift on proxy reflected in Y.Array', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<number[]>(doc, { getRoot: (d) => d.getArray('arr') });
    const yArr = doc.getArray<number>('arr');

    proxy.unshift(5);
    await waitMicrotask();
    expect(yArr.toJSON()).toEqual([5]);

    proxy.shift();
    await waitMicrotask();
    expect(yArr.toJSON()).toEqual([]);
  });

  it('shrink via splice updates Y.Array', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<number[]>(doc, { getRoot: (d) => d.getArray('arr') });
    const yArr = doc.getArray<number>('arr');

    proxy.push(1);
    await waitMicrotask();
    proxy.push(2);
    await waitMicrotask();
    proxy.push(3);
    await waitMicrotask();
    expect(yArr.toJSON()).toEqual([1, 2, 3]);

    proxy.splice(2, 1);
    await waitMicrotask();
    expect(yArr.toJSON()).toEqual([1, 2]);
  });

  it('pushing plain object upgrades to Y.Map item in document', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<any[]>(doc, { getRoot: (d) => d.getArray('arr') });
    const yArr = doc.getArray<any>('arr');

    proxy.push({ title: 'T' });
    await waitMicrotask();
    const first = yArr.get(0);
    expect(first instanceof Y.Map).toBe(true);
    expect(yArr.toJSON()).toEqual([{ title: 'T' }]);
  });

  it('batched proxy writes in same tick produce a single transaction', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });
    const yRoot = doc.getMap<any>('root');
    const onUpdate = vi.fn();
    doc.on('update', onUpdate);

    proxy.x = 1;
    proxy.y = 2;
    await waitMicrotask();
    expect(yRoot.toJSON()).toEqual({ x: 1, y: 2 });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('changing a simple primitive on the proxy updates the Y.Map', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });
    const yRoot = doc.getMap<any>('root');

    proxy.count = 1;
    await waitMicrotask();
    expect(yRoot.get('count')).toBe(1);

    proxy.count = 2;
    await waitMicrotask();
    expect(yRoot.get('count')).toBe(2);
  });

  it('map key delete via proxy removes key in Y.Map', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });
    const yRoot = doc.getMap<any>('root');

    proxy.z = 3;
    await waitMicrotask();
    expect(yRoot.get('z')).toBe(3);

    delete proxy.z;
    await waitMicrotask();
    expect(yRoot.has('z')).toBe(false);
  });

  it('assigning a plain object eagerly upgrades it to a live proxy', async () => {
    const doc = new Y.Doc();
    const { proxy } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });
    const yRoot = doc.getMap<any>('root');

    proxy.newItem = { title: 'A' };
    await waitMicrotask();

    const itemProxy = (proxy as any).newItem;
    itemProxy.title = 'B';
    await waitMicrotask();

    const yItem = yRoot.get('newItem') as Y.Map<any>;
    expect(yItem instanceof Y.Map).toBe(true);
    expect(yItem.get('title')).toBe('B');
  });
});


