'use client';

import { useEffect, useState } from 'react';
import { awareness } from './ws-provider';
import type { AwarenessState } from './awareness-identity';

/**
 * Returns the set of `user.id`s currently active in this room.
 *
 * Backed by Yjs Awareness — every connected client publishes their identity
 * (id, name, color, role) into the awareness Map, and the server relays
 * those updates to every other peer. A user appears here as soon as we
 * receive their identity payload, and disappears when they disconnect
 * (Awareness expires their state automatically after a timeout).
 */
export function useOnlineMembers(): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => collect());

  useEffect(() => {
    function pull() {
      setIds(collect());
    }
    pull();
    awareness.on('change', pull);
    return () => {
      awareness.off('change', pull);
    };
  }, []);

  return ids;
}

function collect(): Set<string> {
  const states = awareness.getStates() as Map<number, AwarenessState>;
  const out = new Set<string>();
  states.forEach((state) => {
    const id = state?.identity?.id;
    if (id) out.add(id);
  });
  return out;
}
