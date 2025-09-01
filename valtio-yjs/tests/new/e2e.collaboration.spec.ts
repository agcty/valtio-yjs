/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, it, expect } from 'vitest';
import { createRelayedProxiesMapRoot, waitMicrotask } from './test-helpers.js';

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
});


