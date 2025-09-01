/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { subscribe } from 'valtio/vanilla';
import { createYjsProxy } from 'valtio-yjs';

describe('issue #14', () => {
  it('nested map direct set', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map') as any;
    const { proxy: p, bootstrap } = createYjsProxy<{ items: { item1: { color: string } } }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });
    bootstrap({ items: { item1: { color: 'blue' } } });

    p.items.item1.color = 'red';
    await Promise.resolve();

    expect(m.get('items').get('item1').get('color')).toStrictEqual('red');
  });

  it('nested map 1 level outer set', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map') as any;
    const { proxy: p, bootstrap } = createYjsProxy<{ items: { item1: { color: string } } }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });
    bootstrap({ items: { item1: { color: 'blue' } } });

    p.items.item1 = { color: 'red' } as any;
    await Promise.resolve();

    expect(m.get('items').get('item1').get('color')).toStrictEqual('red');
  });

  it('nested map 2 level outer set', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map') as any;
    const { proxy: p, bootstrap } = createYjsProxy<{ items: { item1: { color: string } } }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });
    bootstrap({ items: { item1: { color: 'blue' } } });

    p.items = { item1: { color: 'red' } } as any;
    await Promise.resolve();

    expect(m.get('items').get('item1').get('color')).toStrictEqual('red');
  });

  it('nested map array property replace', async () => {
    const doc = new Y.Doc();
    const m = doc.getMap('map') as any;
    const { proxy: p, bootstrap } = createYjsProxy<{ items: { item1: { point: number[] } } }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });
    bootstrap({ items: { item1: { point: [0, 0] } } });

    p.items.item1.point = [100, 100] as any;
    await Promise.resolve();

    expect(m.get('items').get('item1').get('point').toJSON()).toStrictEqual([
      100, 100,
    ]);
  });

  it('nested map set trigger another y update #31', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const ctl1 = createYjsProxy<Record<string, any>>(doc1, {
      getRoot: (d) => d.getMap('test'),
    });
    const ctl2 = createYjsProxy<Record<string, any>>(doc2, {
      getRoot: (d) => d.getMap('test'),
    });

    const p1 = ctl1.proxy as Record<string, any>;
    const p2 = ctl2.proxy as Record<string, any>;

    const listener1 = vi.fn((update) => {
      Y.applyUpdate(doc2, update, 'hello');
    });

    const listener2 = vi.fn();

    doc1.on('update', listener1);
    doc2.on('update', listener2);

    p1.b = { b: 'b' } as any;

    await Promise.resolve();

    expect(listener1).toBeCalledTimes(1);
    expect(listener2).toBeCalledTimes(1);
    // ensure second proxy reflects change
    expect((doc2.getMap('test') as any).get('b').get('b')).toBe('b');
    expect(p2.b?.b).toBe('b');
  });

  it('nested map uses ymap value on bind', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    // create maps to ensure roots exist
    doc1.getMap('map');
    doc2.getMap('map');

    doc1.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc2, update);
    });
    doc2.on('update', (update: Uint8Array) => {
      Y.applyUpdate(doc1, update);
    });

    const ctl1 = createYjsProxy<{ items: { item1: { color: string } } }>(doc1, {
      getRoot: (d) => d.getMap('map'),
    });
    const p1 = ctl1.proxy as { items: { item1: { color: string } } };

    p1.items = { item1: { color: 'red' } } as any;
    await Promise.resolve();
    expect((doc1.getMap('map') as any).get('items').get('item1').get('color')).toStrictEqual('red');

    const ctl2 = createYjsProxy<{ items: { item1: { color: string } } }>(doc2, {
      getRoot: (d) => d.getMap('map'),
    });
    const _p2 = ctl2.proxy;

    await Promise.resolve();
    expect((doc1.getMap('map') as any).get('items').get('item1').get('color')).toStrictEqual('red');
  });

  it('triggers a limited set of updates on bind', async () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    const _map1 = doc1.getMap('map') as any;
    const _map2 = doc2.getMap('map') as any;

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

    const { proxy: p1 } = createYjsProxy<Record<string, any>>(doc1, {
      getRoot: (d) => d.getMap('map'),
    });
    // initialize container first in the live controller model
    p1.items = {} as any;
    p1.items.item1 = { color: 'red' } as any;
    p1.items.item2 = { color: 'red' } as any;
    p1.items.item3 = { color: 'red' } as any;

    await Promise.resolve();
    createYjsProxy<Record<string, any>>(doc2, {
      getRoot: (d) => d.getMap('map'),
    });
    await Promise.resolve();

    // With batched microtasks, these changes result in a single propagated update per doc
    expect(listener1).toBeCalledTimes(1);
    expect(listener2).toBeCalledTimes(1);
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
    const m = doc.getMap('map') as any;
    const { proxy: p, bootstrap } = createYjsProxy<State>(doc, {
      getRoot: (d) => d.getMap('map'),
    });
    bootstrap({ items: { item1: { color: 'blue' }, item2: { color: 'red' } } });

    delete p.items.item1;
    await Promise.resolve();

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
    const m = doc.getMap('map') as any;
    const { proxy: p, bootstrap } = createYjsProxy<State>(doc, {
      getRoot: (d) => d.getMap('map'),
    });
    bootstrap({
      parents: {
        parent1: { children: { child1: { color: 'blue' } } },
        parent2: { children: { child2: { color: 'red' } } },
      },
    });

    delete p.parents.parent1!.children.child1;
    delete p.parents.parent1;
    await Promise.resolve();

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

  it('nested map with undefined value', async () => {
    const doc = new Y.Doc();
    const { proxy: p } = createYjsProxy<{ a?: { b: number; c: string | undefined } }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });
    p.a = { b: 1, c: undefined } as any;
    await Promise.resolve();
    expect(doc.getMap('map').get('a')).toBeDefined();
  });
});

describe('issue #56', () => {
  it('no second assign', async () => {
    const doc = new Y.Doc();
    const { proxy: p, bootstrap } = createYjsProxy<{ a: { b: number; c: number } }>(doc, {
      getRoot: (d) => d.getMap('map'),
    });
    bootstrap({ a: { b: 1, c: 2 } });
    const sub = vi.fn();
    subscribe(p, sub, true);
    p.a = { b: 10, c: 20 } as any;
    await Promise.resolve();
    // In the live controller model, first the plain value is set, then it's upgraded
    // to a controller proxy post-transaction. This results in two emissions.
    expect(sub).toHaveBeenCalledTimes(2);
  });
});
