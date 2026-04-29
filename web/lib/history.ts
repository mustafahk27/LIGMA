import * as Y from 'yjs';
import { nodes } from './yjs';

const LOCAL_ORIGINS = new Set<unknown>([null, 'local']);

/**
 * Canvas history manager (undo/redo) for local edits only.
 *
 * Tracks all mutations under the shared nodes map, including nested Y.Text edits.
 */
export const canvasUndoManager = new Y.UndoManager(nodes, {
  captureTimeout: 350,
  trackedOrigins: LOCAL_ORIGINS,
});

export function undoCanvas(): void {
  canvasUndoManager.undo();
}

export function redoCanvas(): void {
  canvasUndoManager.redo();
}

export function canUndoCanvas(): boolean {
  return canvasUndoManager.undoStack.length > 0;
}

export function canRedoCanvas(): boolean {
  return canvasUndoManager.redoStack.length > 0;
}

export function clearCanvasHistory(): void {
  canvasUndoManager.clear();
}
