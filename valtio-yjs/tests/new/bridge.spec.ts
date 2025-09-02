/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from 'valtio-yjs';

describe('Bridge Mechanics: createYjsProxy and bootstrap', () => {
  it('createYjsProxy returns a valid proxy (map root)', async () => {
    const doc = new Y.Doc();
    const { proxy, dispose } = createYjsProxy<Record<string, unknown>>(doc, {
      getRoot: (d) => d.getMap('root'),
    });

    expect(typeof proxy).toBe('object');
    expect(proxy).not.toBeNull();
    dispose();
  });

  it('bootstrap aborts on non-empty ydoc (map)', async () => {
    const doc = new Y.Doc();
    const yRoot = doc.getMap('root');
    yRoot.set('preexisting', 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { bootstrap } = createYjsProxy<Record<string, unknown>>(doc, {
      getRoot: (d) => d.getMap('root'),
    });

    bootstrap({ foo: 'bar' });
    expect(warn).toHaveBeenCalled();
    expect(yRoot.has('foo')).toBe(false);
    warn.mockRestore();
  });

  it('dispose stops propagation (Y→V and V→Y) and is idempotent', async () => {
    const doc = new Y.Doc();
    const { proxy, dispose } = createYjsProxy<Record<string, unknown>>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const yRoot = doc.getMap<any>('root');

    // Baseline: write through proxy reflects in Y
    (proxy as any).a = 1;
    await Promise.resolve();
    expect(yRoot.get('a')).toBe(1);

    // Dispose
    dispose();

    // After dispose: Y change should not reflect into proxy
    yRoot.set('b', 2);
    await Promise.resolve();
    expect((proxy as any).b).toBeUndefined();

    // After dispose: proxy change should not reflect into Y
    (proxy as any).c = 3;
    await Promise.resolve();
    expect(yRoot.has('c')).toBe(false);

    // Idempotent
    expect(() => dispose()).not.toThrow();
  });

  it('bootstrap converts deep plain object to Y types (map)', async () => {
    const doc = new Y.Doc();
    const yRoot = doc.getMap('root');
    const { bootstrap } = createYjsProxy<any>(doc, {
      getRoot: (d) => d.getMap('root'),
    });

    const initial = {
      users: [
        { id: 'u1', profile: { name: 'Alice', tags: ['x', 'y'] } },
        { id: 'u2', profile: { name: 'Bob', tags: [] } },
      ],
      meta: { count: 2, active: true, nothing: null, undef: undefined },
    };

    bootstrap(initial);

    // undefined is dropped in Yjs, so meta.undef should be absent
    const json = yRoot.toJSON();
    expect(json).toEqual({
      users: [
        { id: 'u1', profile: { name: 'Alice', tags: ['x', 'y'] } },
        { id: 'u2', profile: { name: 'Bob', tags: [] } },
      ],
      meta: { count: 2, active: true, nothing: null },
    });
  });

  it('bootstrap materializes live proxies allowing immediate same-tick nested edits', async () => {
    const doc = new Y.Doc();
    const yRoot = doc.getMap<any>('root');
    const { proxy, bootstrap } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });

    bootstrap({ item: { title: 'A', tags: [] } });
    // same tick nested edit via proxy
    (proxy as any).item.title = 'B';
    await Promise.resolve();

    const yItem = yRoot.get('item') as Y.Map<any>;
    expect(yItem instanceof Y.Map).toBe(true);
    expect(yItem.get('title')).toBe('B');
  });

  it('bootstrap converts Date to ISO string', async () => {
    const doc = new Y.Doc();
    const yRoot = doc.getMap<any>('root');
    const { bootstrap } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });

    const d = new Date('2020-01-01T00:00:00.000Z');
    bootstrap({ myDate: d });

    expect(yRoot.get('myDate')).toBe('2020-01-01T00:00:00.000Z');
  });

  it('bootstrap converts RegExp to string representation', async () => {
    const doc = new Y.Doc();
    const yRoot = doc.getMap<any>('root');
    const { bootstrap } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });

    const r = /abc/gi;
    bootstrap({ myRegex: r });

    expect(yRoot.get('myRegex')).toBe(r.toString());
  });

  it('bootstrap throws on unknown non-plain object types', async () => {
    const doc = new Y.Doc();
    const yRoot = doc.getMap<any>('root');
    const { bootstrap } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });

    class Foo { constructor(public x: number) {} }
    const foo = new Foo(42);

    expect(() => bootstrap({ myFoo: foo })).toThrowError();
    // Ensure nothing was written due to pre-conversion failure
    expect(yRoot.has('myFoo')).toBe(false);
  });

  it('bootstrap throws when nested unsupported types are present', async () => {
    const doc = new Y.Doc();
    const yRoot = doc.getMap<any>('root');
    const { bootstrap } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });

    const input = { ok: { a: 1 }, bad: new Map([['a', 1]]) };
    expect(() => bootstrap(input)).toThrowError();
    expect(yRoot.size).toBe(0);
  });

  it('createYjsProxy works with array root and bootstrap fills Y.Array', async () => {
    const doc = new Y.Doc();
    const { proxy, bootstrap } = createYjsProxy<any[]>(doc, {
      getRoot: (d) => d.getArray('arr'),
    });

    expect(Array.isArray(proxy)).toBe(true);

    const initial = [
      { id: 1, children: [{ k: 'a' }, { k: 'b' }] },
      { id: 2, children: [] },
    ];
    bootstrap(initial);

    const yArr = doc.getArray('arr');
    expect(yArr.toJSON()).toEqual(initial);
  });

  it('bootstrap aborts on non-empty ydoc (array)', async () => {
    const doc = new Y.Doc();
    const yArr = doc.getArray('arr');
    yArr.insert(0, [1]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { bootstrap } = createYjsProxy<any[]>(doc, {
      getRoot: (d) => d.getArray('arr'),
    });

    bootstrap([{ x: 1 }]);
    expect(warn).toHaveBeenCalled();
    expect(yArr.toJSON()).toEqual([1]);
    warn.mockRestore();
  });

  it('bootstrap warns and is a no-op when called twice', async () => {
    const doc = new Y.Doc();
    const yRoot = doc.getMap<any>('root');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { bootstrap } = createYjsProxy<any>(doc, { getRoot: (d) => d.getMap('root') });

    bootstrap({ a: 1 });
    await Promise.resolve();
    expect(yRoot.toJSON()).toEqual({ a: 1 });

    // Second call should warn and not modify
    bootstrap({ b: 2 });
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    expect(yRoot.toJSON()).toEqual({ a: 1 });
    warn.mockRestore();
  });
});


