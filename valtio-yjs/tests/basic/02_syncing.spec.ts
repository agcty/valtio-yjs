/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../../src/index';

const waitMicrotask = () => Promise.resolve();

describe('two-way syncing between docs', () => {
  it('update proxy value syncs to remote doc', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    const { proxy: p1 } = createYjsProxy<{ foo?: string }>(doc1, {
      getRoot: (d) => d.getMap('root'),
    });
    const { proxy: p2 } = createYjsProxy<{ foo?: string }>(doc2, {
      getRoot: (d) => d.getMap('root'),
    });

    const m1 = doc1.getMap<any>('root');
    const m2 = doc2.getMap<any>('root');

    p1.foo = 'a';
    await waitMicrotask();
    expect(p1.foo).toBe('a');
    expect(m1.get('foo')).toBe('a');
    expect(m2.get('foo')).toBe('a');
    expect(p2.foo).toBe('a');

    p1.foo = 'b';
    await waitMicrotask();
    expect(p1.foo).toBe('b');
    expect(m1.get('foo')).toBe('b');
    expect(m2.get('foo')).toBe('b');
    expect(p2.foo).toBe('b');
  });

  it('update nested proxy value syncs to remote doc', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    const { proxy: p1 } = createYjsProxy<{ foo?: { bar?: string } }>(doc1, {
      getRoot: (d) => d.getMap('root'),
    });
    const { proxy: p2 } = createYjsProxy<{ foo?: { bar?: string } }>(doc2, {
      getRoot: (d) => d.getMap('root'),
    });

    const m1 = doc1.getMap<any>('root');
    const m2 = doc2.getMap<any>('root');

    p1.foo = { bar: 'a' };
    await waitMicrotask();
    expect(p1.foo.bar).toBe('a');
    expect(m1.get('foo').get('bar')).toBe('a');
    expect(m2.get('foo').get('bar')).toBe('a');
    expect(p2.foo?.bar).toBe('a');

    p1.foo.bar = 'b';
    await waitMicrotask();
    expect(p1.foo.bar).toBe('b');
    expect(m1.get('foo').get('bar')).toBe('b');
    expect(m2.get('foo').get('bar')).toBe('b');
    expect(p2.foo?.bar).toBe('b');
  });
});

describe('nested objects and arrays sync', () => {
  it('array in object syncs', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    const { proxy: p1, bootstrap: b1 } = createYjsProxy<{ texts: string[] }>(doc1, {
      getRoot: (d) => d.getMap('root'),
    });
    const { proxy: p2 } = createYjsProxy<{ texts: string[] }>(doc2, {
      getRoot: (d) => d.getMap('root'),
    });

    b1({ texts: [] });
    await waitMicrotask();

    const m1 = doc1.getMap<any>('root');
    const m2 = doc2.getMap<any>('root');

    p1.texts.push('a');
    await waitMicrotask();
    expect(p1.texts[0]).toBe('a');
    expect(m1.get('texts').get(0)).toBe('a');
    expect(m2.get('texts').get(0)).toBe('a');
    expect(p2.texts[0]).toBe('a');

    p1.texts.push('b');
    await waitMicrotask();
    expect(p1.texts[1]).toBe('b');
    expect(m1.get('texts').get(1)).toBe('b');
    expect(m2.get('texts').get(1)).toBe('b');
    expect(p2.texts[1]).toBe('b');
  });

  it('object in array syncs', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    type FooObj = { foo: string };
    const { proxy: p1 } = createYjsProxy<FooObj[]>(doc1, {
      getRoot: (d) => d.getArray('root'),
    });
    const { proxy: p2 } = createYjsProxy<FooObj[]>(doc2, {
      getRoot: (d) => d.getArray('root'),
    });

    const a1 = doc1.getArray<any>('root');
    const a2 = doc2.getArray<any>('root');

    p1.push({ foo: 'a' });
    await waitMicrotask();
    expect(p1[0]!.foo).toBe('a');
    expect((a1.get(0) as Y.Map<any>).get('foo')).toBe('a');
    expect((a2.get(0) as Y.Map<any>).get('foo')).toBe('a');
    expect(p2[0]!.foo).toBe('a');

    p1.push({ foo: 'b' });
    await waitMicrotask();
    expect(p1[1]!.foo).toBe('b');
    expect((a1.get(1) as Y.Map<any>).get('foo')).toBe('b');
    expect((a2.get(1) as Y.Map<any>).get('foo')).toBe('b');
    expect(p2[1]!.foo).toBe('b');
  });

  it('array in array syncs', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    const { proxy: p1 } = createYjsProxy<string[][]>(doc1, {
      getRoot: (d) => d.getArray('root'),
    });
    const { proxy: p2 } = createYjsProxy<string[][]>(doc2, {
      getRoot: (d) => d.getArray('root'),
    });

    const a1 = doc1.getArray<any>('root');
    const a2 = doc2.getArray<any>('root');

    p1.push(['a']);
    await waitMicrotask();
    expect(p1[0]![0]).toBe('a');
    expect((a1.get(0) as Y.Array<any>).get(0)).toBe('a');
    expect((a2.get(0) as Y.Array<any>).get(0)).toBe('a');
    expect(p2[0]![0]).toBe('a');

    p1.push(['b']);
    await waitMicrotask();
    expect(p1[1]![0]).toBe('b');
    expect((a1.get(1) as Y.Array<any>).get(0)).toBe('b');
    expect((a2.get(1) as Y.Array<any>).get(0)).toBe('b');
    expect(p2[1]![0]).toBe('b');
  });
});
