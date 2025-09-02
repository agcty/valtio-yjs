/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { plainObjectToYType, yTypeToPlainObject } from '../../src/converter.js';
import { SynchronizationContext } from '../../src/context.js';

describe('Converters: plainObjectToYType and yTypeToPlainObject', () => {
  it('plainObjectToYType handles primitives, undefined, null', () => {
    const context = new SynchronizationContext();
    const vals = [0, 1, 's', true, null, undefined];
    const converted = vals.map((v) => plainObjectToYType(v, context));
    expect(converted).toEqual([0, 1, 's', true, null, null]);
  });

  it('plainObjectToYType converts nested structures', () => {
    const context = new SynchronizationContext();
    const input = {
      a: 1,
      b: { c: 2, d: [3, { e: 4 }] },
      f: undefined,
    } as const;
    const yVal = plainObjectToYType(input, context) as Y.Map<unknown>;
    expect(yVal instanceof Y.Map).toBe(true);
    // Integrate into a document before reading
    const doc = new Y.Doc();
    const root = doc.getMap('root');
    root.set('val', yVal);
    const json = (root.get('val') as Y.Map<unknown>).toJSON();
    expect(json).toEqual({ a: 1, b: { c: 2, d: [3, { e: 4 }] } });
    // undefined dropped
    expect(json.f).toBeUndefined();
  });

  it('plainObjectToYType converts Date to ISO string', () => {
    const context = new SynchronizationContext();
    const d = new Date('2020-01-01T00:00:00.000Z');
    const out = plainObjectToYType(d, context);
    expect(out).toBe('2020-01-01T00:00:00.000Z');
  });

  it('plainObjectToYType converts RegExp to string representation', () => {
    const context = new SynchronizationContext();
    const r = /abc/gi;
    const out = plainObjectToYType(r, context);
    expect(out).toBe(r.toString());
  });

  it('plainObjectToYType throws on unknown non-plain objects', () => {
    const context = new SynchronizationContext();
    class Foo { constructor(public x: number) {} }
    const foo = new Foo(42);
    expect(() => plainObjectToYType(foo, context)).toThrowError();
  });

  it('plainObjectToYType converts URL to href string', () => {
    const context = new SynchronizationContext();
    const u = new URL('https://example.com/path?q=1');
    const out = plainObjectToYType(u, context);
    expect(out).toBe('https://example.com/path?q=1');
  });

  it('roundtrip: plain → Y → plain for supported shapes (normalized)', () => {
    const context = new SynchronizationContext();
    const input = {
      a: 1,
      b: 's',
      c: true,
      d: null,
      e: undefined,
      f: [1, { x: 2, y: undefined }],
      g: { nested: [{ k: 'v' }] },
      dte: new Date('2020-01-02T00:00:00.000Z'),
      re: /ab+/i,
      url: new URL('https://example.com/x?y=1'),
    } as const;
    const yVal = plainObjectToYType(input, context) as Y.Map<unknown>;
    const doc = new Y.Doc();
    const root = doc.getMap('root');
    root.set('val', yVal);
    const normalized = yTypeToPlainObject(yVal);
    expect(normalized).toEqual({
      a: 1,
      b: 's',
      c: true,
      d: null,
      f: [1, { x: 2 }],
      g: { nested: [{ k: 'v' }] },
      dte: '2020-01-02T00:00:00.000Z',
      re: '/ab+/i',
      url: 'https://example.com/x?y=1',
    });
  });

  it('arrays of special objects convert to string arrays', () => {
    const context = new SynchronizationContext();
    const arr = [new Date('2021-01-01T00:00:00.000Z'), /x/gi, new URL('https://x.test/')];
    const y = plainObjectToYType(arr, context) as Y.Array<unknown>;
    const doc = new Y.Doc();
    const root = doc.getArray('arr');
    root.insert(0, [y]);
    const json = (root.get(0) as Y.Array<unknown>).toJSON();
    expect(json).toEqual(['2021-01-01T00:00:00.000Z', '/x/gi', 'https://x.test/']);
  });

  it('deep undefined values are elided at all nesting levels', () => {
    const context = new SynchronizationContext();
    const input = {
      a: undefined,
      b: { c: undefined, d: [1, undefined, 2], e: [{ f: undefined }, { g: 3 }] },
    } as const;
    const yVal = plainObjectToYType(input, context) as Y.Map<unknown>;
    const doc = new Y.Doc();
    const root = doc.getMap('root');
    root.set('val', yVal);
    const json = (root.get('val') as Y.Map<unknown>).toJSON();
    // In arrays, undefined normalizes to null (not dropped)
    expect(json).toEqual({ b: { d: [1, null, 2], e: [{}, { g: 3 }] } });
  });

  it('throws for unsupported primitives and values', () => {
    const context = new SynchronizationContext();
    expect(() => plainObjectToYType(BigInt(1), context)).toThrowError();
    expect(() => plainObjectToYType(Symbol('x'), context)).toThrowError();
    expect(() => plainObjectToYType(() => {}, context)).toThrowError();
    expect(() => plainObjectToYType(NaN, context)).toThrowError();
    expect(() => plainObjectToYType(Infinity, context)).toThrowError();
  });

  it('throws for unsupported object types', () => {
    const context = new SynchronizationContext();
    expect(() => plainObjectToYType(new Promise(() => {}), context)).toThrowError();
    expect(() => plainObjectToYType(new Error('x'), context)).toThrowError();
    expect(() => plainObjectToYType(new WeakMap(), context)).toThrowError();
    expect(() => plainObjectToYType(new WeakSet(), context)).toThrowError();
    expect(() => plainObjectToYType(new Map([['a', 1]]), context)).toThrowError();
    expect(() => plainObjectToYType(new Set([1, 2, 3]), context)).toThrowError();
    expect(() => plainObjectToYType(new Uint8Array([1, 2]), context)).toThrowError();
    // DOM nodes are not available in happy-dom minimal by default; simulate by custom class
    class NodeLike {}
    expect(() => plainObjectToYType(new NodeLike(), context)).toThrowError();
  });

  it('throws for unsupported nested values in objects and arrays', () => {
    const context = new SynchronizationContext();
    const obj = { ok: 1, bad: new Map([['a', 1]]) } as const;
    expect(() => plainObjectToYType(obj, context)).toThrowError();

    const arr = [1, new Set([1])] as const;
    expect(() => plainObjectToYType(arr, context)).toThrowError();
  });

  it('converts nested Date/RegExp/URL inside containers', () => {
    const context = new SynchronizationContext();
    const d = new Date('2020-01-01T00:00:00.000Z');
    const r = /abc/gi;
    const u = new URL('https://example.com');
    const input = { d, r, u, list: [d, r, u] } as const;
    const yVal = plainObjectToYType(input, context) as Y.Map<unknown>;
    expect(yVal instanceof Y.Map).toBe(true);
    const doc = new Y.Doc();
    const root = doc.getMap('root');
    root.set('val', yVal);
    const json = (root.get('val') as Y.Map<unknown>).toJSON();
    expect(json).toEqual({ d: d.toISOString(), r: r.toString(), u: 'https://example.com/', list: [d.toISOString(), r.toString(), 'https://example.com/'] });
  });

  it('plainObjectToYType leaves AbstractType and controller proxies as-is', () => {
    const context = new SynchronizationContext();
    const yMap = new Y.Map();
    // Simulate controller proxy mapping
    const controller = {};
    context.valtioProxyToYType.set(controller, yMap);

    expect(plainObjectToYType(yMap, context)).toBe(yMap);
    expect(plainObjectToYType(controller, context)).toBe(yMap);
  });

  it('yTypeToPlainObject converts Y types to plain structures', () => {
    const yMap = new Y.Map();
    const arr = new Y.Array();
    arr.insert(0, [1, 2, 3]);
    yMap.set('a', 1);
    yMap.set('b', arr);
    const nested = new Y.Map();
    nested.set('x', 'y');
    yMap.set('c', nested);
    // Integrate into a document before reading
    const doc = new Y.Doc();
    const root = doc.getMap('root');
    root.set('val', yMap);
    const out = yTypeToPlainObject(yMap);
    expect(out).toEqual({ a: 1, b: [1, 2, 3], c: { x: 'y' } });
  });
});


