'use client';

import * as Y from 'yjs';
import { ydoc } from './yjs';
import { useEffect, useState } from 'react';

// Yjs map: key = `${userId}:${timeChunk}:${cellX}:${cellY}`, value = total heat (number)
export const heatmapChunks = ydoc.getMap<number>('heatmap_chunks');

export const HEATMAP_GRID_SIZE = 20;
const CHUNK_MS = 60000;

let localHeat = new Map<string, number>();
let flushInterval: ReturnType<typeof setInterval> | null = null;
let currentUserId = '';

export function startHeatmapTracking(userId: string) {
  currentUserId = userId;
  if (!flushInterval) {
    flushInterval = setInterval(flushHeatmap, 5000);
  }
}

export function stopHeatmapTracking() {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  flushHeatmap();
}

/**
 * Log activity to the heatmap.
 * @param x Stage coordinate X
 * @param y Stage coordinate Y
 * @param amount Weight of the interaction (e.g. move=1, click=5, edit=10)
 */
export function trackActivity(x: number, y: number, amount: number = 1) {
  if (!currentUserId) return;
  const cellX = Math.floor(x / HEATMAP_GRID_SIZE);
  const cellY = Math.floor(y / HEATMAP_GRID_SIZE);
  const timeChunk = Math.floor(Date.now() / CHUNK_MS);
  
  const key = `${timeChunk}:${cellX}:${cellY}`;
  localHeat.set(key, (localHeat.get(key) || 0) + amount);
}

function flushHeatmap() {
  if (localHeat.size === 0 || !currentUserId) return;
  
  ydoc.transact(() => {
    for (const [key, heat] of localHeat.entries()) {
      const fullKey = `${currentUserId}:${key}`;
      const existing = heatmapChunks.get(fullKey) || 0;
      heatmapChunks.set(fullKey, existing + heat);
    }
  }, 'local');
  
  localHeat.clear();
}

export interface HeatmapCell {
  x: number;
  y: number;
  heat: number;
}

export type HeatmapFilter = '5m' | '1h' | 'all';

/**
 * Hook to retrieve aggregated heatmap cells based on the filter.
 */
export function useHeatmap(filter: HeatmapFilter): { cells: HeatmapCell[], maxHeat: number } {
  const [data, setData] = useState<{ cells: HeatmapCell[], maxHeat: number }>({ cells: [], maxHeat: 0 });

  useEffect(() => {
    const compute = () => {
      const now = Date.now();
      let minChunk = 0;
      if (filter === '5m') {
        minChunk = Math.floor((now - 5 * 60 * 1000) / CHUNK_MS);
      } else if (filter === '1h') {
        minChunk = Math.floor((now - 60 * 60 * 1000) / CHUNK_MS);
      }

      const grid = new Map<string, number>();
      
      heatmapChunks.forEach((heat, key) => {
        // key format: userId:timeChunk:cellX:cellY
        const parts = key.split(':');
        if (parts.length === 4) {
          const timeChunk = parseInt(parts[1], 10);
          if (timeChunk >= minChunk) {
            const cellX = parts[2];
            const cellY = parts[3];
            const gridKey = `${cellX}:${cellY}`;
            grid.set(gridKey, (grid.get(gridKey) || 0) + heat);
          }
        }
      });

      const cells: HeatmapCell[] = [];
      let maxHeat = 0;
      for (const [gridKey, heat] of grid.entries()) {
        if (heat > maxHeat) maxHeat = heat;
        const [cx, cy] = gridKey.split(':').map(Number);
        cells.push({ x: cx * HEATMAP_GRID_SIZE + HEATMAP_GRID_SIZE / 2, y: cy * HEATMAP_GRID_SIZE + HEATMAP_GRID_SIZE / 2, heat });
      }

      setData({ cells, maxHeat });
    };

    compute();
    
    heatmapChunks.observe(compute);
    // Also recompute every minute to let old chunks expire if filter is time-based
    const interval = setInterval(compute, 60000);
    
    return () => {
      heatmapChunks.unobserve(compute);
      clearInterval(interval);
    };
  }, [filter]);

  return data;
}
