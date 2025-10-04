/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../../src/index';

const waitMicrotask = () => Promise.resolve();

describe('basic map operations', () => {
  it('simple map', async () => {
    const doc = new Y.Doc();
    const { proxy: p } = createYjsProxy<{ foo?: string }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    expect(p.foo).toBe(undefined);

    m.set('foo', 'a');
    await waitMicrotask();
    expect(p.foo).toBe('a');

    p.foo = 'b';
    await waitMicrotask();
    expect(m.get('foo')).toBe('b');
  });

  it('simple map with initial values via bootstrap', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<{ foo?: string; bar?: number }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    bootstrap({ foo: 'a', bar: 1 });
    await waitMicrotask();

    expect(p.foo).toBe('a');
    expect(p.bar).toBe(1);
    expect(m.get('foo')).toBe('a');
    expect(m.get('bar')).toBe(1);

    m.set('foo', 'b');
    await waitMicrotask();
    expect(p.foo).toBe('b');

    p.bar = 2;
    await waitMicrotask();
    expect(m.get('bar')).toBe(2);
  });

  it('simple map with null value', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<{ foo: string | null }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    bootstrap({ foo: null });
    await waitMicrotask();

    expect(p.foo).toBe(null);
    expect(m.get('foo')).toBe(null);

    m.set('foo', 'bar');
    await waitMicrotask();
    expect(p.foo).toBe('bar');
    expect(m.get('foo')).toBe('bar');

    p.foo = null;
    await waitMicrotask();
    expect(p.foo).toBe(null);
    expect(m.get('foo')).toBe(null);
  });

  it('nested map (from proxy)', async () => {
    const doc = new Y.Doc();
    const { proxy: p } = createYjsProxy<{ foo?: { bar?: string } }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    expect(p.foo).toBe(undefined);
    expect(m.get('foo')).toBe(undefined);

    p.foo = { bar: 'a' };
    await waitMicrotask();
    expect(p.foo.bar).toBe('a');
    expect(m.get('foo').get('bar')).toBe('a');

    m.get('foo').set('bar', 'b');
    await waitMicrotask();
    expect(p.foo.bar).toBe('b');
    expect(m.get('foo').get('bar')).toBe('b');
  });

  it('nested map (from y.map)', async () => {
    const doc = new Y.Doc();
    const { proxy: p } = createYjsProxy<{ foo?: { bar?: string } }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    expect(p.foo).toBe(undefined);
    expect(m.get('foo')).toBe(undefined);

    const nestedMap = new Y.Map();
    nestedMap.set('bar', 'a');
    m.set('foo', nestedMap);
    await waitMicrotask();

    expect(p?.foo?.bar).toBe('a');
    expect(m.get('foo').get('bar')).toBe('a');

    (p as any).foo.bar = 'b';
    await waitMicrotask();
    expect(p?.foo?.bar).toBe('b');
    expect(m.get('foo').get('bar')).toBe('b');
  });

  it('bootstrap creates a single transaction', async () => {
    const doc = new Y.Doc();
    const { bootstrap } = createYjsProxy<{ foo?: string; bar?: number }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });

    const listener = vi.fn();
    doc.on('update', listener);

    bootstrap({ foo: 'a', bar: 5 });
    await waitMicrotask();

    expect(listener).toBeCalledTimes(1);
  });

  it('can dispose to stop syncing', async () => {
    const doc = new Y.Doc();
    const { proxy: p, dispose } = createYjsProxy<{ foo?: string }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    dispose();
    expect(p.foo).toBe(undefined);

    m.set('foo', 'a');
    await waitMicrotask();
    expect(m.get('foo')).toBe('a');
    expect(p.foo).toBe(undefined);

    p.foo = 'b';
    await waitMicrotask();
    expect(m.get('foo')).toBe('a');
    expect(p.foo).toBe('b');
  });
});

describe('basic array operations', () => {
  it('simple array', async () => {
    const doc = new Y.Doc();
    const { proxy: p } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<string>('root');

    expect(p).toEqual([]);
    expect(a.toJSON()).toEqual([]);

    a.push(['a']);
    await waitMicrotask();
    expect(a.toJSON()).toEqual(['a']);
    expect(p).toEqual(['a']);

    p.push('b');
    await waitMicrotask();
    expect(p).toEqual(['a', 'b']);
    expect(a.toJSON()).toEqual(['a', 'b']);
  });

  it('array push', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<number[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<number>('root');

    bootstrap([10, 11, 12, 13]);
    await waitMicrotask();

    a.push([20]);
    await waitMicrotask();
    expect(a.toJSON()).toEqual([10, 11, 12, 13, 20]);
    expect(p).toEqual([10, 11, 12, 13, 20]);

    p.push(21);
    await waitMicrotask();
    expect(p).toEqual([10, 11, 12, 13, 20, 21]);
    expect(a.toJSON()).toEqual([10, 11, 12, 13, 20, 21]);
  });

  it('array pop', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<number[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<number>('root');

    bootstrap([10, 11, 12, 13]);
    await waitMicrotask();

    a.delete(a.length - 1, 1);
    await waitMicrotask();
    expect(a.toJSON()).toEqual([10, 11, 12]);
    expect(p).toEqual([10, 11, 12]);

    p.pop();
    await waitMicrotask();
    expect(p).toEqual([10, 11]);
    expect(a.toJSON()).toEqual([10, 11]);
  });

  it('array unshift', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<number[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<number>('root');

    bootstrap([10, 11, 12, 13]);
    await waitMicrotask();

    a.unshift([9]);
    await waitMicrotask();
    expect(a.toJSON()).toEqual([9, 10, 11, 12, 13]);
    expect(p).toEqual([9, 10, 11, 12, 13]);

    p.unshift(8);
    await waitMicrotask();
    expect(p).toEqual([8, 9, 10, 11, 12, 13]);
    expect(a.toJSON()).toEqual([8, 9, 10, 11, 12, 13]);
  });

  it('array shift', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<number[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<number>('root');

    bootstrap([10, 11, 12, 13]);
    await waitMicrotask();

    a.delete(0, 1);
    await waitMicrotask();
    expect(a.toJSON()).toEqual([11, 12, 13]);
    expect(p).toEqual([11, 12, 13]);

    p.shift();
    await waitMicrotask();
    expect(p).toEqual([12, 13]);
    expect(a.toJSON()).toEqual([12, 13]);
  });

  it('array index replacement', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<number[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<number>('root');

    bootstrap([10, 11, 12, 13]);
    await waitMicrotask();

    doc.transact(() => {
      a.delete(2, 1);
      a.insert(2, [99]);
    });
    await waitMicrotask();
    expect(p).toEqual([10, 11, 99, 13]);
    expect(a.toJSON()).toEqual([10, 11, 99, 13]);

    p[2] = 98;
    await waitMicrotask();
    expect(p).toEqual([10, 11, 98, 13]);
    expect(a.toJSON()).toEqual([10, 11, 98, 13]);
  });

  it('array splice (delete+insert)', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<number[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<number>('root');

    bootstrap([10, 11, 12, 13]);
    await waitMicrotask();

    p.splice(2, 1, 97);
    await waitMicrotask();
    expect(p).toEqual([10, 11, 97, 13]);
    expect(a.toJSON()).toEqual([10, 11, 97, 13]);
  });

  it('array splice (delete)', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<number[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<number>('root');

    bootstrap([10, 11, 12, 13]);
    await waitMicrotask();

    p.splice(1, 1);
    await waitMicrotask();
    expect(p).toEqual([10, 12, 13]);
    expect(a.toJSON()).toEqual([10, 12, 13]);
  });

  it('array splice (insert)', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<number[]>(doc, {
      getRoot: (d) => d.getArray('root'),
    });
    const a = doc.getArray<number>('root');

    bootstrap([10, 11, 12, 13]);
    await waitMicrotask();

    p.splice(1, 0, 95, 96);
    await waitMicrotask();
    expect(p).toEqual([10, 95, 96, 11, 12, 13]);
    expect(a.toJSON()).toEqual([10, 95, 96, 11, 12, 13]);
  });
});
