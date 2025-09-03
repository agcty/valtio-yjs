import { describe, it, expect, vi } from 'vitest';
import { planArrayOps } from '../../src/planning/arrayOpsPlanner.js';

describe('Array Operations Planner', () => {
  describe('planArrayOps', () => {
    it('should handle empty operations array', () => {
      const result = planArrayOps([], 3);
      expect(result.sets.size).toBe(0);
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(0);
    });

    it('should categorize single set operation as pure set', () => {
      const ops = [['set', [0], 'new-value', undefined]];
      const result = planArrayOps(ops, 3);
      
      expect(result.sets.size).toBe(1);
      expect(result.sets.get(0)).toBe('new-value');
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(0);
    });

    it('should categorize single delete operation as pure delete', () => {
      const ops = [['delete', [1], 'old-value']];
      const result = planArrayOps(ops, 3);
      
      expect(result.sets.size).toBe(0);
      expect(result.deletes.size).toBe(1);
      expect(result.deletes.has(1)).toBe(true);
      expect(result.replaces.size).toBe(0);
    });

    it('should identify delete + set at same index as replace operation', () => {
      const ops = [
        ['delete', [1], 'old-value'],
        ['set', [1], 'new-value', undefined]
      ];
      const result = planArrayOps(ops, 3);
      
      expect(result.sets.size).toBe(0);
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(1);
      expect(result.replaces.get(1)).toBe('new-value');
    });

    it('should identify set + delete at same index as replace operation (order reversed)', () => {
      const ops = [
        ['set', [2], 'new-value', undefined],
        ['delete', [2], 'old-value']
      ];
      const result = planArrayOps(ops, 5);
      
      expect(result.sets.size).toBe(0);
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(1);
      expect(result.replaces.get(2)).toBe('new-value');
    });

    it('should handle multiple pure sets', () => {
      const ops = [
        ['set', [0], 'value-0', undefined],
        ['set', [2], 'value-2', undefined],
        ['set', [4], 'value-4', undefined]
      ];
      const result = planArrayOps(ops, 3);
      
      expect(result.sets.size).toBe(3);
      expect(result.sets.get(0)).toBe('value-0');
      expect(result.sets.get(2)).toBe('value-2');
      expect(result.sets.get(4)).toBe('value-4');
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(0);
    });

    it('should handle multiple pure deletes', () => {
      const ops = [
        ['delete', [0], 'old-0'],
        ['delete', [2], 'old-2'],
        ['delete', [4], 'old-4']
      ];
      const result = planArrayOps(ops, 5);
      
      expect(result.sets.size).toBe(0);
      expect(result.deletes.size).toBe(3);
      expect(result.deletes.has(0)).toBe(true);
      expect(result.deletes.has(2)).toBe(true);
      expect(result.deletes.has(4)).toBe(true);
      expect(result.replaces.size).toBe(0);
    });

    it('should handle multiple replaces', () => {
      const ops = [
        ['delete', [1], 'old-1'],
        ['set', [1], 'new-1', undefined],
        ['delete', [3], 'old-3'],
        ['set', [3], 'new-3', undefined]
      ];
      const result = planArrayOps(ops, 5);
      
      expect(result.sets.size).toBe(0);
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(2);
      expect(result.replaces.get(1)).toBe('new-1');
      expect(result.replaces.get(3)).toBe('new-3');
    });

    it('should handle mix of sets, deletes, and replaces', () => {
      const ops = [
        ['set', [0], 'pure-set', undefined],    // pure set
        ['delete', [1], 'old-1'],               // part of replace
        ['set', [1], 'replace-value', undefined], // part of replace
        ['delete', [2], 'old-2'],               // pure delete
        ['set', [4], 'another-set', undefined]  // pure set
      ];
      const result = planArrayOps(ops, 5);
      
      expect(result.sets.size).toBe(2);
      expect(result.sets.get(0)).toBe('pure-set');
      expect(result.sets.get(4)).toBe('another-set');
      
      expect(result.deletes.size).toBe(1);
      expect(result.deletes.has(2)).toBe(true);
      
      expect(result.replaces.size).toBe(1);
      expect(result.replaces.get(1)).toBe('replace-value');
    });

    it('should warn about potential moves when both deletes and sets exist', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const ops = [
        ['delete', [1], 'old-value'],
        ['set', [3], 'new-value', undefined]  // different indices = potential move
      ];
      const result = planArrayOps(ops, 5);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Potential array move detected'),
        expect.objectContaining({
          deletes: [1],
          sets: [3],
          length: 5
        })
      );
      
      // But operations should still be categorized correctly
      expect(result.deletes.size).toBe(1);
      expect(result.deletes.has(1)).toBe(true);
      expect(result.sets.size).toBe(1);
      expect(result.sets.get(3)).toBe('new-value');
      expect(result.replaces.size).toBe(0);
      
      consoleSpy.mockRestore();
    });

    it('should not warn about moves when replaces are involved', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const ops = [
        ['delete', [1], 'old-value'],
        ['set', [1], 'new-value', undefined]  // same index = replace, not move
      ];
      const result = planArrayOps(ops, 5);
      
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(result.replaces.size).toBe(1);
      expect(result.replaces.get(1)).toBe('new-value');
      
      consoleSpy.mockRestore();
    });

    it('should ignore non-array operations', () => {
      const ops = [
        ['set', [0], 'array-value', undefined],     // valid array set
        ['set', ['key'], 'map-value', undefined],   // map set (should be ignored)
        ['delete', [1], 'old-value'],               // valid array delete
        ['delete', ['key']],                        // map delete (should be ignored)
        ['some-other-op', [2]],                     // unknown operation
        'invalid-op'                                // completely invalid
      ];
      const result = planArrayOps(ops, 3);
      
      expect(result.sets.size).toBe(1);
      expect(result.sets.get(0)).toBe('array-value');
      expect(result.deletes.size).toBe(1);
      expect(result.deletes.has(1)).toBe(true);
      expect(result.replaces.size).toBe(0);
    });

    it('should handle string indices by normalizing them to numbers', () => {
      const ops = [
        ['set', ['0'], 'value-at-0', undefined],
        ['delete', ['2'], 'old-value'],
        ['set', ['2'], 'new-value', undefined]
      ];
      const result = planArrayOps(ops, 5);
      
      expect(result.sets.size).toBe(1);
      expect(result.sets.get(0)).toBe('value-at-0');
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(1);
      expect(result.replaces.get(2)).toBe('new-value');
    });

    it('should handle complex values in operations', () => {
      const complexValue = { nested: { deep: 'value' }, array: [1, 2, 3] };
      const ops = [
        ['set', [0], complexValue, undefined]
      ];
      const result = planArrayOps(ops, 3);
      
      expect(result.sets.size).toBe(1);
      expect(result.sets.get(0)).toEqual(complexValue);
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(0);
    });

    it('should handle null and undefined values', () => {
      const ops = [
        ['set', [0], null, undefined],
        ['set', [1], undefined, undefined],
        ['delete', [2], null],
        ['set', [2], 'replacement', undefined]
      ];
      const result = planArrayOps(ops, 5);
      
      expect(result.sets.size).toBe(2);
      expect(result.sets.get(0)).toBeNull();
      expect(result.sets.get(1)).toBeUndefined();
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(1);
      expect(result.replaces.get(2)).toBe('replacement');
    });

    it('should handle edge case with zero-length array', () => {
      const ops = [
        ['set', [0], 'first-item', undefined]
      ];
      const result = planArrayOps(ops, 0);
      
      expect(result.sets.size).toBe(1);
      expect(result.sets.get(0)).toBe('first-item');
      expect(result.deletes.size).toBe(0);
      expect(result.replaces.size).toBe(0);
    });

    it('should handle large indices correctly', () => {
      const ops = [
        ['set', [1000], 'large-index-value', undefined],
        ['delete', [999], 'old-value']
      ];
      const result = planArrayOps(ops, 100);
      
      expect(result.sets.size).toBe(1);
      expect(result.sets.get(1000)).toBe('large-index-value');
      expect(result.deletes.size).toBe(1);
      expect(result.deletes.has(999)).toBe(true);
      expect(result.replaces.size).toBe(0);
    });
  });
});
