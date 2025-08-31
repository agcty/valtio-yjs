import * as Y from 'yjs';
import { isYArray, isYMap } from './guards.js';

// Event types and type guards for Yjs observeDeep events

export interface YMapEvent extends Y.YEvent<Y.Map<unknown>> {
  keysChanged: Set<string>;
}

export function isYMapEvent(event: unknown): event is YMapEvent {
  return !!event && typeof event === 'object' && isYMap((event as { target?: unknown }).target);
}

export type YArrayDelta = Array<{ retain?: number; delete?: number; insert?: unknown[] }>;

export interface YArrayEvent extends Y.YEvent<Y.Array<unknown>> {
  changes: {
    added: Set<Y.Item>;
    deleted: Set<Y.Item>;
    delta: YArrayDelta;
    keys: Map<string, { action: 'add' | 'delete' | 'update'; oldValue: unknown }>;
  };
}

export function isYArrayEvent(event: unknown): event is YArrayEvent {
  return !!event && typeof event === 'object' && isYArray((event as { target?: unknown }).target);
}


