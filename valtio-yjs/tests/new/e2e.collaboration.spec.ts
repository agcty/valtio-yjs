/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, it, expect } from 'vitest';
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
});


