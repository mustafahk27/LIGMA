import * as Y from 'yjs';
import { snapshotAcls } from './yjs-diff.js';

export type Role = 'lead' | 'contributor' | 'viewer';

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string; nodeId?: string };

/**
 * The single source of truth for "is this Yjs update allowed?"
 *
 * Strategy: clone the current room doc, apply the candidate update to the
 * clone, then diff the ACL snapshots before vs. after. For each touched
 * node id we run the role rules:
 *
 *   - viewers can never mutate
 *   - editing a locked node requires `lead`
 *   - flipping a node's lock state requires `lead`
 *   - creating a node already-locked requires `lead`
 *   - deleting a locked node requires `lead`
 *
 * If the verdict is OK, the caller (ydoc-store.applyAndBroadcast) applies
 * the same update to the real room doc — the clone is throw-away.
 *
 * Note: this function never mutates `roomDoc`. The caller is responsible
 * for calling `Y.applyUpdate(roomDoc, incoming)` after a green light.
 */
export function validateUpdate(
  roomDoc: Y.Doc,
  incoming: Uint8Array,
  role: Role,
  actorId: string,
): ValidationResult {
  // Fast-path: viewers can never mutate ANY field, regardless of ACLs
  if (role === 'viewer') {
    return { ok: false, reason: 'viewers cannot mutate the canvas' };
  }

  const before = snapshotAcls(roomDoc);

  // Clone-and-apply so we can inspect the post-mutation state without
  // committing to it. Y.applyUpdate is synchronous and idempotent given
  // the same starting state, so this is safe.
  const clone = new Y.Doc();
  try {
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(roomDoc));
    Y.applyUpdate(clone, incoming);
  } catch (err) {
    return { ok: false, reason: 'malformed yjs update' };
  }

  const after = snapshotAcls(clone);

  const ids = new Set<string>([...before.keys(), ...after.keys()]);

  for (const id of ids) {
    const oldAcl = before.get(id);
    const newAcl = after.get(id);

    // ── Delete ───────────────────────────────────────────────────────
    if (oldAcl && !newAcl) {
      if (oldAcl.locked && role !== 'lead') {
        return { ok: false, reason: 'cannot delete a locked node', nodeId: id };
      }
      continue;
    }

    // ── Create ───────────────────────────────────────────────────────
    if (!oldAcl && newAcl) {
      if (newAcl.locked && role !== 'lead') {
        return { ok: false, reason: 'only leads can create locked nodes', nodeId: id };
      }
      continue;
    }

    // ── Modify ───────────────────────────────────────────────────────
    if (oldAcl && newAcl) {
      if (oldAcl.locked && role !== 'lead') {
        return { ok: false, reason: 'node is locked', nodeId: id };
      }
      if (oldAcl.locked !== newAcl.locked && role !== 'lead') {
        return { ok: false, reason: 'only leads can change lock state', nodeId: id };
      }
      // Per-user block: leads can change blockedUsers; blocked users cannot mutate
      if (oldAcl.blockedUsers.includes(actorId) && role !== 'lead') {
        return { ok: false, reason: 'you have been blocked from editing this node', nodeId: id };
      }
      const blockedChanged = JSON.stringify(oldAcl.blockedUsers.slice().sort()) !==
                             JSON.stringify(newAcl.blockedUsers.slice().sort());
      if (blockedChanged && role !== 'lead') {
        return { ok: false, reason: 'only leads can change per-user access', nodeId: id };
      }
    }
  }

  return { ok: true };
}
