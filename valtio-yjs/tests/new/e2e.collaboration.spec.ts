/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createRelayedProxiesMapRoot, createRelayedProxiesArrayRoot, waitMicrotask } from './test-helpers.js';

describe('E2E Collaboration: two docs with relayed updates', () => {
  it('deep reconciliation on remote changes (unmaterialized -> materialized)', async () => {
    const { proxyA, proxyB, bootstrapA } = createRelayedProxiesMapRoot();

    // Step 1-2: Initialize on A and only touch top-level on B
    bootstrapA({ data: { a: { b: { c: 1 } } } });
    await waitMicrotask();
    // Access only the top-level container on B (do not drill in yet)
    // This should not force deep materialization yet
    // Access but don't drill deeper yet
    const shallow = proxyB.data;

    // Step 3: Change deep child on A
    proxyA.data.a.b.c = 2;
    await waitMicrotask();

    // Step 4: Assert B reflects deep change upon access
    expect(shallow.a.b.c).toBe(2);
  });

  it('array unshift and splice operations from remote client propagate', async () => {
    const { proxyA, proxyB, bootstrapA } = createRelayedProxiesMapRoot();

    // Initialize list on A and let it sync to B
    bootstrapA({ list: ['x', 'y'] });
    await waitMicrotask();
    expect(Array.isArray(proxyB.list)).toBe(true);
    expect(proxyB.list).toEqual(['x', 'y']);

    // Perform unshift on A and verify B sees the change
    proxyA.list.unshift('new');
    await waitMicrotask();
    expect(proxyB.list[0]).toBe('new');

    // Perform splice on A and verify B sees the change
    proxyA.list.splice(1, 1, 'mid');
    await waitMicrotask();
    expect(proxyB.list).toEqual(['new', 'mid', 'y']);

    // Remove first element on A and verify B
    proxyA.list.splice(0, 1);
    await waitMicrotask();
    expect(proxyB.list).toEqual(['mid', 'y']);
  });

  it('remote: ancestor+direct array updates in one relay tick apply once with identity preserved', async () => {
    const { docA, proxyA, proxyB, bootstrapA } = createRelayedProxiesMapRoot();
    bootstrapA({ container: {} });
    await waitMicrotask();

    // On A: in one transaction, create an inner array and insert items
    docA.transact(() => {
      const yRoot = docA.getMap<any>('root');
      const container = yRoot.get('container') as Y.Map<any>;
      const yList = new Y.Array<number>();
      container.set('list', yList);
      yList.insert(0, [1, 2]);
    });

    await waitMicrotask();
    expect(Array.isArray(proxyB.container.list)).toBe(true);
    expect(proxyB.container.list).toEqual([1, 2]);
    const prevItem = proxyB.container.list[0];

    // Further remote update to verify identity stability
    proxyA.container.list.splice(0, 1, 9);
    await waitMicrotask();
    expect(proxyB.container.list[0]).not.toBe(prevItem);
    expect(proxyB.container.list).toEqual([9, 2]);
  });

  it('nested arrays: structural delete+insert on inner array propagates without corruption', async () => {
    const { proxyA, proxyB, bootstrapA } = createRelayedProxiesMapRoot();
    // Shape: root: { lists: [ [a,b], [c] ] }
    bootstrapA({ lists: [['a', 'b'], ['c']] });
    await waitMicrotask();
    expect(proxyB.lists.length).toBe(2);
    expect(proxyB.lists[0]).toEqual(['a', 'b']);
    expect(proxyB.lists[1]).toEqual(['c']);

    // On A: replace element at index 0 of inner array via splice(0,1,'x')
    // Our V->Y path models set as delete+insert at same index; ensure B receives consistent content
    proxyA.lists[0].splice(0, 1, 'x');
    await waitMicrotask();
    expect(proxyB.lists[0]).toEqual(['x', 'b']);

    // On A: delete at tail of inner array (structural delete only)
    proxyA.lists[0].splice(1, 1);
    await waitMicrotask();
    expect(proxyB.lists[0]).toEqual(['x']);

    // On A: push new plain object at outer level that contains an inner array
    // and then mutate nested to ensure upgrades and propagation remain stable
    proxyA.lists.push(['d']);
    await waitMicrotask();
    expect(proxyB.lists.length).toBe(3);
    expect(proxyB.lists[2]).toEqual(['d']);
    proxyA.lists[2].unshift('z');
    await waitMicrotask();
    expect(proxyB.lists[2]).toEqual(['z', 'd']);
  });

  it('array root: nested Y.Array items accept head/tail inserts and delete+insert in two clients', async () => {
    const { proxyA, proxyB, bootstrapA } = createRelayedProxiesArrayRoot();
    // Root is an array of arrays
    bootstrapA([[1, 2], [3]]);
    await waitMicrotask();
    expect(proxyB.length).toBe(2);
    expect(proxyB[0]).toEqual([1, 2]);
    expect(proxyB[1]).toEqual([3]);

    // A performs unshift on inner array 0
    proxyA[0].unshift(0);
    await waitMicrotask();
    expect(proxyB[0]).toEqual([0, 1, 2]);

    // A performs delete+insert style replace at index 1
    proxyA[0].splice(1, 1, 9);
    await waitMicrotask();
    expect(proxyB[0]).toEqual([0, 9, 2]);

    // B performs a tail push on inner array 1; verify A receives it (directional symmetry)
    proxyB[1].push(4, 5);
    await waitMicrotask();
    expect(proxyA[1]).toEqual([3, 4, 5]);
  });

  it('deeply nested: second inner array (2 items) propagates updates across docs', async () => {
    const { proxyA, proxyB, bootstrapA } = createRelayedProxiesMapRoot();
    // Initialize: outer array has two items; second is an inner array with two elements
    bootstrapA({ matrix: [[], ['a', 'b']] });
    await waitMicrotask();
    expect(Array.isArray(proxyB.matrix)).toBe(true);
    expect(proxyB.matrix.length).toBe(2);
    expect(proxyB.matrix[1]).toEqual(['a', 'b']);

    // Push into the second inner array on A -> B should see it
    proxyA.matrix[1].push('c');
    await waitMicrotask();
    expect(proxyB.matrix[1]).toEqual(['a', 'b', 'c']);

    // Unshift into the same inner array -> B should see head insert
    proxyA.matrix[1].unshift('z');
    await waitMicrotask();
    expect(proxyB.matrix[1]).toEqual(['z', 'a', 'b', 'c']);

    // Replace middle element via splice (delete+insert) -> B should see replacement
    proxyA.matrix[1].splice(2, 1, 'X');
    await waitMicrotask();
    expect(proxyB.matrix[1]).toEqual(['z', 'a', 'X', 'c']);
  });

  describe('deeply nested direct mutations without bootstrap', () => {
    it('should propagate direct deep mutations on empty root', async () => {
      const { proxyA, proxyB } = createRelayedProxiesMapRoot();

      // Directly assign a deeply nested structure on proxyA
      proxyA.deep = { foo: { bar: { baz: [1, 2, { qux: 'hello' }] } } };
      await waitMicrotask();

      // Mutate deeply on proxyA
      proxyA.deep.foo.bar.baz[2].qux = 'world';
      await waitMicrotask();

      // Add a new property at the deepest object
      proxyA.deep.foo.bar.baz[2].newProp = 42;
      await waitMicrotask();

      // Push a new element to the array
      proxyA.deep.foo.bar.baz.push({ extra: true });
      await waitMicrotask();

      // Mutate the new object
      proxyA.deep.foo.bar.baz[3].extra = false;
      await waitMicrotask();

      // All changes should be visible on proxyB
      expect(proxyB.deep.foo.bar.baz[2].qux).toBe('world');
      expect(proxyB.deep.foo.bar.baz[2].newProp).toBe(42);
      expect(proxyB.deep.foo.bar.baz.length).toBe(4);
      expect(proxyB.deep.foo.bar.baz[3].extra).toBe(false);
    });

    it('should propagate direct deep mutations from both sides', async () => {
      const { proxyA, proxyB } = createRelayedProxiesMapRoot();

      // Assign a nested structure from A
      proxyA.tree = { left: { value: 1 }, right: { value: 2 } };
      await waitMicrotask();

      // Mutate from B
      proxyB.tree.left.value = 10;
      await waitMicrotask();

      // Add a new nested object from B
      proxyB.tree.left.child = { leaf: true };
      await waitMicrotask();

      // Mutate from A
      proxyA.tree.right.value = 20;
      await waitMicrotask();

      // Add a new array from A
      proxyA.tree.right.children = [{ id: 'a' }];
      await waitMicrotask();

      // Push to the array from B
      proxyB.tree.right.children.push({ id: 'b' });
      await waitMicrotask();

      // Mutate the pushed object from A
      proxyA.tree.right.children[1].id = 'b2';
      await waitMicrotask();

      // All changes should be visible on both sides
      expect(proxyA.tree.left.value).toBe(10);
      expect(proxyB.tree.left.value).toBe(10);
      expect(proxyA.tree.left.child.leaf).toBe(true);
      expect(proxyB.tree.left.child.leaf).toBe(true);
      expect(proxyA.tree.right.value).toBe(20);
      expect(proxyB.tree.right.value).toBe(20);
      expect(proxyA.tree.right.children.length).toBe(2);
      expect(proxyB.tree.right.children.length).toBe(2);
      expect(proxyA.tree.right.children[1].id).toBe('b2');
      expect(proxyB.tree.right.children[1].id).toBe('b2');
    });
  });
});
