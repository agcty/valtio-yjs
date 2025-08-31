/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from 'valtio-yjs';

describe('createYjsProxy (map)', () => {
  it('simple map', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map');
    const { proxy: p } = createYjsProxy<{ foo?: string }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    expect(p.foo).toBe(undefined);

    m.set('foo', 'a');
    expect(p.foo).toBe('a');

    p.foo = 'b';
    await Promise.resolve();
    expect(m.get('foo')).toBe('b');
  });

  it('simple map with bootstrap + ydoc initial values', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map');
    const { proxy: p, bootstrap } = createYjsProxy<{ foo?: string; bar?: number }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    bootstrap({ foo: 'a' });
    m.set('bar', 1);

    expect(p.foo).toBe('a');
    expect(p.bar).toBe(1);
    expect(m.get('foo')).toBe('a');
    expect(m.get('bar')).toBe(1);

    m.set('foo', 'b');
    expect(p.foo).toBe('b');

    p.bar = 2;
    await Promise.resolve();
    expect(m.get('bar')).toBe(2);
  });

  it('simple map with null value', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map');
    const { proxy: p } = createYjsProxy<{ foo: string | null }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    p.foo = null;
    await Promise.resolve();
    expect(p.foo).toBe(null);
    expect(m.get('foo')).toBe(null);

    m.set('foo', 'bar');
    expect(p.foo).toBe('bar');
    expect(m.get('foo')).toBe('bar');

    p.foo = null;
    await Promise.resolve();
    expect(p.foo).toBe(null);
    expect(m.get('foo')).toBe(null);
  });

  it('nested map (from proxy)', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map') as any;
    const { proxy: p } = createYjsProxy<{ foo?: { bar?: string } }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    expect(p.foo).toBe(undefined);
    expect(m.get('foo')).toBe(undefined);

    p.foo = { bar: 'a' } as any;
    await Promise.resolve();
    expect((p as any).foo.bar).toBe('a');
    expect(m.get('foo').get('bar')).toBe('a');

    m.get('foo').set('bar', 'b');
    expect((p as any).foo.bar).toBe('b');
    expect(m.get('foo').get('bar')).toBe('b');
  });

  it('nested map (from y.map)', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map') as any;
    const { proxy: p } = createYjsProxy<{ foo?: { bar?: string } }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    expect(p.foo).toBe(undefined);
    expect(m.get('foo')).toBe(undefined);

    m.set('foo', new Y.Map());
    m.get('foo').set('bar', 'a');
    expect((p as any)?.foo?.bar).toBe('a');
    expect(m.get('foo').get('bar')).toBe('a');

    (p as any).foo.bar = 'b';
    await Promise.resolve();
    expect((p as any)?.foo?.bar).toBe('b');
    expect(m.get('foo').get('bar')).toBe('b');
  });

  it('bootstrap is a single transaction', async () => {
    const doc = new Y.Doc();
    const { bootstrap } = createYjsProxy<{ foo?: string; bar?: number }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    const listener = vi.fn();
    doc.on('update', listener);

    bootstrap({ foo: 'a', bar: 5 });

    expect(listener).toBeCalledTimes(1);
  });

  it('can dispose (unsubscribe)', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map');
    const { proxy: p, dispose } = createYjsProxy<{ foo?: string }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });

    dispose();
    expect(p.foo).toBe(undefined);

    m.set('foo', 'a');
    expect(m.get('foo')).toBe('a');
    expect(p.foo).toBe(undefined);

    p.foo = 'b';
    await Promise.resolve();
    expect(m.get('foo')).toBe('a');
    expect(p.foo).toBe('b');
  });
});

describe('createYjsProxy (array)', () => {
  it('simple array', async () => {
    const doc = new Y.Doc();
    const a = doc.getArray<string>('arr');
    const { proxy: p } = createYjsProxy<string[]>(doc, {
      getRoot: (d) => d.getArray('arr'),
    });

    expect(p).toEqual([]);
    expect(a.toJSON()).toEqual([]);

    a.push(['a']);
    await Promise.resolve();
    expect(a.toJSON()).toEqual(['a']);
    expect(p).toEqual(['a']);

    p.push('b');
    await Promise.resolve();
    expect(p).toEqual(['a', 'b']);
    expect(a.toJSON()).toEqual(['a', 'b']);
  });

  describe('simple array with various operations', () => {
    const create = () => {
      const doc = new Y.Doc();
      const a = doc.getArray<number>('arr');
      const ctl = createYjsProxy<number[]>(doc, {
        getRoot: (d) => d.getArray('arr'),
      });
      ctl.bootstrap([10, 11, 12, 13]);
      return { doc, a, p: ctl.proxy as number[] };
    };

    it('a push', async () => {
      const { a, p } = create();
      a.push([20]);
      await Promise.resolve();
      expect(a.toJSON()).toEqual([10, 11, 12, 13, 20]);
      expect(p).toEqual([10, 11, 12, 13, 20]);
    });

    it('p push', async () => {
      const { a, p } = create();
      p.push(21);
      await Promise.resolve();
      expect(p).toEqual([10, 11, 12, 13, 21]);
      expect(a.toJSON()).toEqual([10, 11, 12, 13, 21]);
    });

    it('a pop', async () => {
      const { a, p } = create();
      a.push([20]);
      await Promise.resolve();
      a.delete(4, 1);
      await Promise.resolve();
      expect(a.toJSON()).toEqual([10, 11, 12, 13]);
      expect(p).toEqual([10, 11, 12, 13]);
    });

    it('p pop', async () => {
      const { a, p } = create();
      p.push(20);
      await Promise.resolve();
      p.pop();
      await Promise.resolve();
      expect(p).toEqual([10, 11, 12, 13]);
      expect(a.toJSON()).toEqual([10, 11, 12, 13]);
    });

    it('a unshift', async () => {
      const { a, p } = create();
      a.unshift([9]);
      await Promise.resolve();
      expect(a.toJSON()).toEqual([9, 10, 11, 12, 13]);
      expect(p).toEqual([9, 10, 11, 12, 13]);
    });

    it('a shift', async () => {
      const { a, p } = create();
      a.unshift([9]);
      await Promise.resolve();
      a.delete(0, 1);
      await Promise.resolve();
      expect(p).toEqual([10, 11, 12, 13]);
      expect(a.toJSON()).toEqual([10, 11, 12, 13]);
    });

    it('a replace', async () => {
      const { doc, a, p } = create();
      doc.transact(() => {
        a.delete(2, 1);
        a.insert(2, [99]);
      });
      await Promise.resolve();
      expect(p).toEqual([10, 11, 99, 13]);
      expect(a.toJSON()).toEqual([10, 11, 99, 13]);
    });

    it('p replace', async () => {
      const { a, p } = create();
      p[2] = 98;
      await Promise.resolve();
      expect(p).toEqual([10, 11, 98, 13]);
      expect(a.toJSON()).toEqual([10, 11, 98, 13]);
    });

    it('p splice (delete+insert) — treated as replace (no moves)', async () => {
      const { a, p } = create();
      p.splice(2, 1, 97);
      await Promise.resolve();
      expect(p).toEqual([10, 11, 97, 13]);
      expect(a.toJSON()).toEqual([10, 11, 97, 13]);
    });

    it('p splice (delete)', async () => {
      const { a, p } = create();
      p.splice(1, 1);
      await Promise.resolve();
      expect(p).toEqual([10, 12, 13]);
      expect(a.toJSON()).toEqual([10, 12, 13]);
    });

    // Note: Insert that requires shifting (moves) is not supported at library level.
  });
});
