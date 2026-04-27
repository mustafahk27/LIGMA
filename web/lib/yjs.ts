import * as Y from 'yjs';

/**
 * The single authoritative Y.Doc for this browser tab.
 *
 * All canvas nodes live inside the 'nodes' Y.Map.
 * Each value is itself a Y.Map so sub-keys can be observed independently.
 *
 * This module is a singleton — import it from anywhere and you get the same doc.
 */
export const ydoc = new Y.Doc();

/**
 * Top-level shared map: nodeId → Y.Map<unknown>
 *
 * Each node Y.Map has keys: id, type, x, y, width, height, author_id,
 * created_at, acl, intent — and a Y.Text value stored under the key 'content'.
 */
export const nodes = ydoc.getMap<Y.Map<unknown>>('nodes');
