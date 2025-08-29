/* eslint @typescript-eslint/no-explicit-any: "off" */
import * as Y from 'yjs';
import { VALTIO_YJS_ORIGIN } from './constants.js';
import { createYjsController, getValtioProxyForYType } from './controller.js';

/**
 * Sets up a one-way listener from Yjs to Valtio.
 * On remote changes, it notifies the correct controller proxy to trigger UI updates.
 * @returns A dispose function to clean up the listener.
 */
export function setupSyncListener(doc: Y.Doc): () => void {
  const handleAfterTransaction = (transaction: Y.Transaction) => {
    // Ignore changes originating from our own proxy setters.
    if (transaction.origin === VALTIO_YJS_ORIGIN) {
      return;
    }

    // For each changed parent type, minimally apply changes into the corresponding Valtio proxy
    transaction.changedParentTypes.forEach((parentType) => {
      const proxy = getValtioProxyForYType(parentType as any);
      if (!proxy) return;

      if (parentType instanceof Y.Map) {
        // Read keys from parentType and set minimal keys (cheap for maps)
        for (const k of Array.from(parentType.keys())) {
          const key = String(k);
          const yVal = parentType.get(key);
          if (yVal instanceof Y.AbstractType) {
            if (!(key in proxy) || proxy[key] !== getValtioProxyForYType(yVal)) {
              proxy[key] = createYjsController(yVal, doc);
            }
          } else {
            if (proxy[key] !== yVal) proxy[key] = yVal;
          }
        }
        // Remove deleted keys
        Object.keys(proxy as Record<string, any>).forEach((k) => {
          if (!parentType.has(k as string)) delete proxy[k];
        });
      }
    });
  };

  // 'afterTransaction' is a robust way to listen for all changes, batched.
  doc.on('afterTransaction', handleAfterTransaction);

  return () => {
    doc.off('afterTransaction', handleAfterTransaction);
  };
}


