'use client';

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { nodes } from './yjs';
import { nodeToSnapshot } from './nodes';
import type { NodeSnapshot } from './node-types';

/**
 * Subscribe to the entire `nodes` Y.Map and re-render the caller whenever any
 * node — or any property on any node — changes. Returns a stable array of
 * plain snapshots ready to feed into Konva components.
 *
 * Implementation note: we use `observeDeep` so child Y.Map mutations also
 * trigger the rebuild. The snapshot array is rebuilt in full each time;
 * because nodes are tiny this is cheap up to several thousand of them.
 */
export function useYjsNodes(): NodeSnapshot[] {
  const [snapshot, setSnapshot] = useState<NodeSnapshot[]>(() => collect());

  useEffect(() => {
    const update = () => setSnapshot(collect());
    nodes.observeDeep(update);
    return () => nodes.unobserveDeep(update);
  }, []);

  return snapshot;
}

function collect(): NodeSnapshot[] {
  const out: NodeSnapshot[] = [];
  nodes.forEach((map) => {
    if (map instanceof Y.Map) out.push(nodeToSnapshot(map));
  });
  // Stable z-order: oldest first, newest on top.
  out.sort((a, b) => a.created_at - b.created_at);
  return out;
}
