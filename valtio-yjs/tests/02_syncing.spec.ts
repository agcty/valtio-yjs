/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from 'valtio-yjs';

describe('https://codesandbox.io/s/ni1fk', () => {
  it('update proxy value through ydoc', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    const { proxy: p1 } = createYjsProxy<{ foo?: string }>(doc1, {
      getRoot: (d) => d.getMap('map'),
    });
    const { proxy: p2 } = createYjsProxy<{ foo?: string }>(doc2, {
      getRoot: (d) => d.getMap('map'),
    });

    p1.foo = 'a';
    await Promise.resolve();
    expect(p1.foo).toBe('a');
    expect(doc1.getMap('map').get('foo')).toBe('a');
    expect(doc2.getMap('map').get('foo')).toBe('a');
    expect(p2.foo).toBe('a');

    await Promise.resolve();
    p1.foo = 'b';
    await Promise.resolve();
    expect(p1.foo).toBe('b');
    expect(doc1.getMap('map').get('foo')).toBe('b');
    expect(doc2.getMap('map').get('foo')).toBe('b');
    expect(p2.foo).toBe('b');
  });

  it('update proxy nested value through ydoc', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    const { proxy: p1 } = createYjsProxy<{ foo?: { bar?: string } }>(doc1, {
      getRoot: (d) => d.getMap('map'),
    });
    const { proxy: p2 } = createYjsProxy<{ foo?: { bar?: string } }>(doc2, {
      getRoot: (d) => d.getMap('map'),
    });

    p1.foo = { bar: 'a' };
    await Promise.resolve();
    expect(p1.foo.bar).toBe('a');
    expect((doc1.getMap('map') as any).get('foo').get('bar')).toBe('a');
    expect((doc2.getMap('map') as any).get('foo').get('bar')).toBe('a');
    expect(p2.foo?.bar).toBe('a');

    await Promise.resolve();
    p1.foo.bar = 'b';
    await Promise.resolve();
    expect(p1.foo.bar).toBe('b');
    expect((doc1.getMap('map') as any).get('foo').get('bar')).toBe('b');
    expect((doc2.getMap('map') as any).get('foo').get('bar')).toBe('b');
    expect(p2.foo?.bar).toBe('b');
  });
});

describe('nested objects and arrays', () => {
  it('array in object', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    const { proxy: p1, bootstrap: boot1 } = createYjsProxy<{ texts: string[] }>(doc1, {
      getRoot: (d) => d.getMap('map'),
    });
    const { proxy: p2 } = createYjsProxy<{ texts: string[] }>(doc2, {
      getRoot: (d) => d.getMap('map'),
    });
    boot1({ texts: [] });

    p1.texts.push('a');
    await Promise.resolve();
    expect(p1.texts[0]).toBe('a');
    expect((doc1.getMap('map') as any).get('texts').get(0)).toBe('a');
    expect((doc2.getMap('map') as any).get('texts').get(0)).toBe('a');
    expect(p2.texts[0]).toBe('a');

    await Promise.resolve();
    p1.texts.push('b');
    await Promise.resolve();
    expect(p1.texts[1]).toBe('b');
    expect((doc1.getMap('map') as any).get('texts').get(1)).toBe('b');
    expect((doc2.getMap('map') as any).get('texts').get(1)).toBe('b');
    expect(p2.texts[1]).toBe('b');
  });

  it('object in array', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    type FooObj = { foo: string };
    const { proxy: p1, bootstrap: boot1 } = createYjsProxy<FooObj[]>(doc1, {
      getRoot: (d) => d.getArray('arr'),
    });
    const { proxy: p2 } = createYjsProxy<FooObj[]>(doc2, {
      getRoot: (d) => d.getArray('arr'),
    });
    boot1([]);

    p1.push({ foo: 'a' });
    await Promise.resolve();
    expect(p1[0]!.foo).toBe('a');
    expect((doc1.getArray('arr').get(0) as unknown as Y.Map<FooObj>).get('foo')).toBe('a');
    expect((doc2.getArray('arr').get(0) as unknown as Y.Map<FooObj>).get('foo')).toBe('a');
    expect(p2[0]!.foo).toBe('a');

    await Promise.resolve();
    p1.push({ foo: 'b' });
    await Promise.resolve();
    expect(p1[1]!.foo).toBe('b');
    expect((doc1.getArray('arr').get(1) as unknown as Y.Map<FooObj>).get('foo')).toBe('b');
    expect((doc2.getArray('arr').get(1) as unknown as Y.Map<FooObj>).get('foo')).toBe('b');
    expect(p2[1]!.foo).toBe('b');
  });

  it('array in array', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    const { proxy: p1, bootstrap: boot1 } = createYjsProxy<string[][]>(doc1, {
      getRoot: (d) => d.getArray('arr'),
    });
    const { proxy: p2 } = createYjsProxy<string[][]>(doc2, {
      getRoot: (d) => d.getArray('arr'),
    });
    boot1([]);

    p1.push(['a']);
    await Promise.resolve();
    expect(p1[0]![0]).toBe('a');
    expect((doc1.getArray('arr').get(0) as unknown as Y.Array<string[]>).get(0)).toBe('a');
    expect((doc2.getArray('arr').get(0) as unknown as Y.Array<string[]>).get(0)).toBe('a');
    expect(p2[0]![0]).toBe('a');

    await Promise.resolve();
    p1.push(['b']);
    await Promise.resolve();
    expect(p1[1]![0]).toBe('b');
    expect((doc1.getArray('arr').get(1) as unknown as Y.Array<string[]>).get(0)).toBe('b');
    expect((doc2.getArray('arr').get(1) as unknown as Y.Array<string[]>).get(0)).toBe('b');
    expect(p2[1]![0]).toBe('b');
  });
});
