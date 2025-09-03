// Internal type used for pending compute entries in batched operations
export type PendingEntry = {
  compute: () => unknown;
  after?: (yValue: unknown) => void; // post-integration callback for map keys and array entries
};

// Simplified type for map entries - no compute function needed, value is already resolved
export type PendingMapEntry = {
  value: unknown;
  after?: (yValue: unknown) => void; // post-integration callback for map keys
};

// Simplified type for array entries - used for both sets and replaces
export type PendingArrayEntry = {
  value: unknown;
  after?: (yValue: unknown) => void; // post-integration callback for array entries
};
