'use client';

import { awareness } from './ws-provider';

export interface AwarenessIdentity {
  id: string;
  name: string;
  color: string;
  role: string;
}

export interface AwarenessCursor {
  /** Stage (canvas) coordinates — NOT screen coordinates. */
  x: number;
  y: number;
}

export interface AwarenessState {
  identity?: AwarenessIdentity;
  cursor?: AwarenessCursor | null;
}

/**
 * Set the local user's identity in awareness — called once after auth so
 * other clients can render labelled cursors. The cursor position itself is
 * updated via {@link setLocalCursor} on every mousemove.
 */
export function setLocalIdentity(identity: AwarenessIdentity): void {
  awareness.setLocalStateField('identity', identity);
}

/**
 * Update the local user's cursor in stage coordinates.
 * Pass `null` when the cursor leaves the canvas so other clients hide it.
 */
export function setLocalCursor(x: number | null, y?: number): void {
  if (x === null) {
    awareness.setLocalStateField('cursor', null);
  } else {
    awareness.setLocalStateField('cursor', { x, y: y ?? 0 });
  }
}

export function clearLocalAwareness(): void {
  awareness.setLocalState(null);
}
