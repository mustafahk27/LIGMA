'use client';

import { useEffect, useState } from 'react';
import { awareness } from './ws-provider';
import type { AwarenessState, AwarenessIdentity } from './awareness-identity';
import type { NodeSnapshot } from './node-types';

export interface ZoneOccupancy {
  zone: NodeSnapshot;
  users: AwarenessIdentity[];
}

export function usePresenceZones(nodes: NodeSnapshot[]) {
  const [occupancy, setOccupancy] = useState<{ zones: ZoneOccupancy[], outside: AwarenessIdentity[] }>({ zones: [], outside: [] });

  useEffect(() => {
    function calculate() {
      const zones = nodes.filter(n => n.type === 'zone');
      const states = awareness.getStates() as Map<number, AwarenessState>;
      
      const outside: AwarenessIdentity[] = [];
      const zoneMap = new Map<string, AwarenessIdentity[]>();
      zones.forEach(z => zoneMap.set(z.id, []));

      states.forEach((state) => {
        if (!state.identity) return;
        
        let inZoneId: string | null = null;
        if (state.cursor) {
          const cx = state.cursor.x;
          const cy = state.cursor.y;
          
          // Reverse loop to pick top-most zone if overlapping
          for (let i = zones.length - 1; i >= 0; i--) {
             const z = zones[i];
             if (cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height) {
                inZoneId = z.id;
                break;
             }
          }
        }
        
        if (inZoneId) {
          zoneMap.get(inZoneId)?.push(state.identity);
        } else {
          outside.push(state.identity);
        }
      });
      
      const activeZones: ZoneOccupancy[] = zones.map(z => ({
        zone: z,
        users: zoneMap.get(z.id) || []
      }));
      
      const nextOccupancy = { zones: activeZones, outside };
      
      setOccupancy((prev) => {
        const prevStr = JSON.stringify(prev);
        const nextStr = JSON.stringify(nextOccupancy);
        if (prevStr === nextStr) return prev;
        return nextOccupancy;
      });
    }
    
    calculate();
    
    awareness.on('change', calculate);
    return () => {
      awareness.off('change', calculate);
    };
  }, [nodes]);

  return occupancy;
}
