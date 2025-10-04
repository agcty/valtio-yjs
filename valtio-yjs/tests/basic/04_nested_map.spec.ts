/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from '../../src/index';

const waitMicrotask = () => Promise.resolve();

describe('nested map operations', () => {
  it('nested map direct property set', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<{ items: { item1: { color: string } } }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    bootstrap({ items: { item1: { color: 'blue' } } });
    await waitMicrotask();

    p.items.item1.color = 'red';
    await waitMicrotask();

    expect(m.get('items').get('item1').get('color')).toStrictEqual('red');
  });

  it('nested map 1 level outer set', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<{ items: { item1: { color: string } } }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    bootstrap({ items: { item1: { color: 'blue' } } });
    await waitMicrotask();

    p.items.item1 = { color: 'red' };
    await waitMicrotask();

    expect(m.get('items').get('item1').get('color')).toStrictEqual('red');
  });

  it('nested map 2 level outer set', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<{ items: { item1: { color: string } } }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    bootstrap({ items: { item1: { color: 'blue' } } });
    await waitMicrotask();

    p.items = { item1: { color: 'red' } };
    await waitMicrotask();

    expect(m.get('items').get('item1').get('color')).toStrictEqual('red');
  });

  it('nested map array property replace', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<{ items: { item1: { point: number[] } } }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    bootstrap({ items: { item1: { point: [0, 0] } } });
    await waitMicrotask();

    p.items.item1.point = [100, 100];
    await waitMicrotask();

    expect(m.get('items').get('item1').get('point').toJSON()).toStrictEqual([100, 100]);
  });

  it('nested map syncs between two docs', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const { proxy: proxy1 } = createYjsProxy<Record<string, any>>(doc1, {
      getRoot: (d) => d.getMap('root'),
    });
    const { proxy: proxy2 } = createYjsProxy<Record<string, any>>(doc2, {
      getRoot: (d) => d.getMap('root'),
    });

    const listener1 = vi.fn((update) => {
      Y.applyUpdate(doc2, update);
    });
    const listener2 = vi.fn();

    doc1.on('update', listener1);
    doc2.on('update', listener2);

    proxy1.b = { b: 'b' };
    await waitMicrotask();

    expect(listener1).toBeCalledTimes(1);
    expect(listener2).toBeCalledTimes(1);
  });

  it('nested map uses yjs value on initialization', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const { proxy: proxy1, bootstrap: bootstrap1 } = createYjsProxy<{ items: { item1: { color: string } } }>(doc1, {
      getRoot: (d) => d.getMap('root'),
    });

    const map1 = doc1.getMap<any>('root');
    const map2 = doc2.getMap<any>('root');

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    bootstrap1({ items: { item1: { color: 'blue' } } });
    await waitMicrotask();

    proxy1.items = { item1: { color: 'red' } };
    await waitMicrotask();
    expect(map1.get('items').get('item1').get('color')).toStrictEqual('red');

    const { proxy: proxy2 } = createYjsProxy<{ items: { item1: { color: string } } }>(doc2, {
      getRoot: (d) => d.getMap('root'),
    });
    await waitMicrotask();

    expect(map2.get('items').get('item1').get('color')).toStrictEqual('red');
    expect(proxy2.items.item1.color).toStrictEqual('red');
  });

  it('creates a reasonable number of updates on bootstrap', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const { proxy: proxy1, bootstrap: bootstrap1 } = createYjsProxy<Record<string, any>>(doc1, {
      getRoot: (d) => d.getMap('root'),
    });

    const listener1 = vi.fn();
    const listener2 = vi.fn();

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
      listener1();
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
      listener2();
    });

    bootstrap1({ items: {} });
    await waitMicrotask();
    
    proxy1.items.item1 = { color: 'red' };
    proxy1.items.item2 = { color: 'red' };
    proxy1.items.item3 = { color: 'red' };
    await waitMicrotask();

    const { proxy: proxy2 } = createYjsProxy<Record<string, any>>(doc2, {
      getRoot: (d) => d.getMap('root'),
    });
    await waitMicrotask();

    // Bootstrap + 1 update for the three items
    expect(listener1).toBeCalledTimes(2);
    expect(listener2).toBeCalledTimes(2);
    expect(proxy2.items.item1.color).toBe('red');
  });

  it('nested map delete', async () => {
    type State = Record<
      'items',
      {
        [key: string]: {
          color: string;
        };
      }
    >;
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<State>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    bootstrap({
      items: { item1: { color: 'blue' }, item2: { color: 'red' } },
    });
    await waitMicrotask();

    delete p.items.item1;
    await waitMicrotask();

    expect(m.get('items').get('item1')).toBeUndefined();
    expect(m.get('items').get('item2')).toBeDefined();
  });

  it('nested map delete child and parent', async () => {
    type State = Record<
      'parents',
      {
        [key: string]: Record<
          'children',
          {
            [key: string]: {
              color: string;
            };
          }
        >;
      }
    >;
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<State>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    const m = doc.getMap<any>('root');

    bootstrap({
      parents: {
        parent1: {
          children: {
            child1: { color: 'blue' },
          },
        },
        parent2: {
          children: {
            child2: { color: 'red' },
          },
        },
      },
    });
    await waitMicrotask();

    delete p.parents.parent1!.children.child1;
    delete p.parents.parent1;
    await waitMicrotask();

    expect(m.toJSON()).toStrictEqual({
      parents: {
        parent2: {
          children: {
            child2: { color: 'red' },
          },
        },
      },
    });
  });

  it('nested map rejects undefined values', async () => {
    const doc = new Y.Doc();
    const { proxy: p } = createYjsProxy<{ a?: { b: number; c: string | null } }>(doc, {
      getRoot: (d) => d.getMap('root'),
    });
    
    // undefined is not allowed, must use null instead
    expect(() => {
      p.a = { b: 1, c: undefined as any };
    }).toThrow('undefined is not allowed');
    
    // null works fine
    p.a = { b: 1, c: null };
    await waitMicrotask();
    expect(doc.getMap('root').get('a')).toBeDefined();
  });
});
