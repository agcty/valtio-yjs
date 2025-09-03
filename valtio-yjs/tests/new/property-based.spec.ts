/* eslint @typescript-eslint/no-explicit-any: "off" */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createYjsProxy } from 'valtio-yjs';
import * as fc from 'fast-check';

const waitMicrotask = () => Promise.resolve();

describe('Property-Based Testing', () => {
  describe('Random Array Mutation Sequences', () => {
    it('should maintain consistency across random mutation sequences', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 3, maxLength: 10 }),
          fc.array(
            fc.oneof(
              fc.record({ op: fc.constant('push'), value: fc.string() }),
              fc.record({ op: fc.constant('unshift'), value: fc.string() }),
              fc.record({ 
                op: fc.constant('splice'), 
                index: fc.nat(9), 
                deleteCount: fc.nat(3), 
                insertValue: fc.option(fc.string(), { nil: undefined })
              }),
              fc.record({ op: fc.constant('set'), index: fc.nat(9), value: fc.string() }),
              fc.record({ op: fc.constant('delete'), index: fc.nat(9) })
            ),
            { minLength: 1, maxLength: 20 }
          ),
          async (initialItems, operations) => {
            const doc = new Y.Doc();
            const { proxy } = createYjsProxy<any[]>(doc, { 
              getRoot: (d) => d.getArray('arr'), 
              debug: false // Reduce noise for property testing
            });
            const yArr = doc.getArray<any>('arr');

            // Initialize array
            proxy.push(...initialItems);
            await waitMicrotask();
            expect(yArr.toJSON()).toEqual(initialItems);

            // Apply random operations
            for (const operation of operations) {
              try {
                switch (operation.op) {
                  case 'push':
                    proxy.push(operation.value);
                    break;
                  case 'unshift':
                    proxy.unshift(operation.value);
                    break;
                  case 'splice':
                    if (operation.insertValue !== undefined) {
                      proxy.splice(operation.index % Math.max(1, proxy.length), operation.deleteCount, operation.insertValue);
                    } else {
                      proxy.splice(operation.index % Math.max(1, proxy.length), operation.deleteCount);
                    }
                    break;
                  case 'set':
                    if (operation.index < proxy.length) {
                      proxy[operation.index] = operation.value;
                    }
                    break;
                  case 'delete':
                    if (operation.index < proxy.length) {
                      delete proxy[operation.index];
                    }
                    break;
                }
                await waitMicrotask();

                // Verify consistency after each operation
                const yResult = yArr.toJSON();
                const proxyResult = JSON.parse(JSON.stringify(proxy));
                
                expect(yResult).toEqual(proxyResult);
                expect(yResult.every(item => item !== undefined)).toBe(true);
                expect(proxyResult.every((item: any) => item !== undefined)).toBe(true);
                
              } catch (error) {
                console.log('Failed operation:', operation);
                console.log('Array state before operation:', yArr.toJSON());
                console.log('Proxy state before operation:', JSON.stringify(proxy));
                throw error;
              }
            }
          }
        ),
        { numRuns: 10, timeout: 10000 } // Reduced runs for debugging
      );
    });

    it('should maintain sync consistency across two clients with random operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.string({ minLength: 1, maxLength: 3 }), { minLength: 2, maxLength: 5 }),
          fc.array(
            fc.oneof(
              fc.record({ op: fc.constant('push'), value: fc.string() }),
              fc.record({ op: fc.constant('splice-replace'), index: fc.nat(4), value: fc.string() }),
              fc.record({ op: fc.constant('splice-delete'), index: fc.nat(4) })
            ),
            { minLength: 1, maxLength: 10 }
          ),
          async (initialItems, operations) => {
            const docA = new Y.Doc();
            const docB = new Y.Doc();
            
            const { proxy: proxyA } = createYjsProxy<any[]>(docA, { getRoot: (d) => d.getArray('arr') });
            const { proxy: proxyB } = createYjsProxy<any[]>(docB, { getRoot: (d) => d.getArray('arr') });
            
            // Set up bidirectional relay
            docA.on('update', (update: Uint8Array) => Y.applyUpdate(docB, update));
            docB.on('update', (update: Uint8Array) => Y.applyUpdate(docA, update));
            
            // Initialize on A
            proxyA.push(...initialItems);
            await waitMicrotask();
            expect(proxyB).toEqual(initialItems);

            // Apply random operations on A
            for (const operation of operations) {
              try {
                switch (operation.op) {
                  case 'push':
                    proxyA.push(operation.value);
                    break;
                  case 'splice-replace':
                    if (operation.index < proxyA.length) {
                      proxyA.splice(operation.index, 1, operation.value);
                    }
                    break;
                  case 'splice-delete':
                    if (operation.index < proxyA.length && proxyA.length > 1) {
                      proxyA.splice(operation.index, 1);
                    }
                    break;
                }
                await waitMicrotask();

                // Verify both clients are in sync
                const resultA = docA.getArray('arr').toJSON();
                const resultB = docB.getArray('arr').toJSON();
                
                expect(resultA).toEqual(resultB);
                expect(proxyA).toEqual(proxyB);
                expect(resultA.every(item => item !== undefined)).toBe(true);
                
              } catch (error) {
                console.log('Failed operation:', operation);
                console.log('DocA state:', docA.getArray('arr').toJSON());
                console.log('DocB state:', docB.getArray('arr').toJSON());
                console.log('ProxyA:', JSON.stringify(proxyA));
                console.log('ProxyB:', JSON.stringify(proxyB));
                throw error;
              }
            }
          }
        ),
        { numRuns: 5, timeout: 15000 } // Start with fewer runs for debugging
      );
    });
  });

  describe('Planning Logic Property Tests', () => {
    it('should correctly categorize random operation sequences', async () => {
      const { planArrayOps } = await import('../../src/planning/arrayOpsPlanner.js');
      
      await fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.record({
                type: fc.constant('set'),
                index: fc.nat(10),
                value: fc.string()
              }),
              fc.record({
                type: fc.constant('delete'),
                index: fc.nat(10),
                oldValue: fc.string()
              })
            ),
            { minLength: 1, maxLength: 20 }
          ),
          fc.nat(15),
          (operations, arrayLength) => {
            // Convert to Valtio operation format
            const valtioOps = operations.map(op => {
              if (op.type === 'set') {
                return ['set', [op.index], op.value, undefined];
              } else {
                return ['delete', [op.index], op.oldValue];
              }
            });

            const result = planArrayOps(valtioOps, arrayLength, undefined);

            // Verify that all operations are categorized
            const totalOps = result.sets.size + result.deletes.size + result.replaces.size;
            
            // Count unique indices from original operations
            const setIndices = new Set(operations.filter(op => op.type === 'set').map(op => op.index));
            const deleteIndices = new Set(operations.filter(op => op.type === 'delete').map(op => op.index));
            const allIndices = new Set([...setIndices, ...deleteIndices]);
            
            // Total categorized operations should not exceed unique indices
            expect(totalOps).toBeLessThanOrEqual(allIndices.size);
            
            // Verify no index appears in multiple categories
            const resultIndices = new Set([
              ...result.sets.keys(),
              ...result.deletes,
              ...result.replaces.keys()
            ]);
            
            expect(resultIndices.size).toBe(totalOps);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
