import type { NodeSnapshot } from './node-types';

/** Padding around polyline stroke for selection / hit visuals. */
const PEN_STROKE_PAD = 6;

/**
 * Bounding box of a node's rendered content in **local group coordinates**
 * (same space as Konva children of the node's `<Group>`).
 */
export function nodeLocalContentBounds(node: NodeSnapshot): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  switch (node.type) {
    case 'pen':
      return penBounds(node.points);
    case 'circle':
      return { x: 0, y: 0, width: node.width, height: node.height };
    default:
      return { x: 0, y: 0, width: node.width, height: node.height };
  }
}

function penBounds(points: number[]): { x: number; y: number; width: number; height: number } {
  if (points.length < 2) {
    return { x: -4, y: -4, width: 8, height: 8 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i] ?? 0;
    const y = points[i + 1] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const p = PEN_STROKE_PAD;
  return {
    x: minX - p,
    y: minY - p,
    width: Math.max(maxX - minX + 2 * p, 8),
    height: Math.max(maxY - minY + 2 * p, 8),
  };
}
