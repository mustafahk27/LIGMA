import * as Y from 'yjs';

export interface AclSnapshot {
  locked: boolean;
}

/**
 * Walk the room's `nodes` Y.Map and return a Map<nodeId, AclSnapshot>
 * containing just the ACL fields. This is the minimal info needed to
 * decide whether a future mutation is authorised — full content is
 * irrelevant for RBAC.
 */
export function snapshotAcls(doc: Y.Doc): Map<string, AclSnapshot> {
  const out = new Map<string, AclSnapshot>();
  const nodes = doc.getMap('nodes');
  nodes.forEach((node, id) => {
    if (!(node instanceof Y.Map)) return;
    const acl = (node.get('acl') as { locked?: boolean } | undefined) ?? {};
    out.set(id, { locked: !!acl.locked });
  });
  return out;
}
