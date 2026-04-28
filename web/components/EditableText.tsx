'use client';

import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { getNodeText } from '@/lib/nodes';
import type { NodeSnapshot } from '@/lib/node-types';
import { dimHex } from '@/lib/text-style';

interface EditableTextProps {
  node: NodeSnapshot;
  stagePos: { x: number; y: number };
  stageScale: number;
  onClose: () => void;
}

/**
 * HTML overlay textarea bound to a node's `Y.Text`. Two-way binding pattern:
 *
 *   Yjs → DOM:  the textarea value is reset to the Y.Text's current string
 *               whenever the underlying CRDT changes (from any source).
 *
 *   DOM → Yjs:  on every input event, we diff the previous value against the
 *               new value and translate that into a Y.Text insert/delete pair.
 *               Doing it as a single insert+delete (instead of replacing the
 *               whole string) preserves remote concurrent edits — typing in
 *               two tabs at the same time merges character-by-character.
 *
 * The overlay is positioned in screen coordinates by re-projecting through the
 * stage transform.
 */
export function EditableText({ node, stagePos, stageScale, onClose }: EditableTextProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(node.content);
  // We keep the last DOM value so we can compute a minimal diff against it
  const lastValueRef = useRef(node.content);

  /* ── Subscribe to remote Y.Text changes ─────────────────────────────── */
  useEffect(() => {
    const ytext = getNodeText(node.id);
    if (!ytext) return;

    function pull() {
      const current = ytext!.toString();
      lastValueRef.current = current;
      setValue(current);
    }

    pull();
    ytext.observe(pull);
    return () => ytext.unobserve(pull);
    // node.id is stable for the lifetime of this overlay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  /* ── Auto-focus on mount ────────────────────────────────────────────── */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    // place cursor at end
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  /* ── DOM → Yjs binding ──────────────────────────────────────────────── */
  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const prev = lastValueRef.current;
    setValue(next);

    if (next === prev) return;

    const ytext = getNodeText(node.id);
    if (!ytext) return;

    applyDiffToYText(ytext, prev, next);
    lastValueRef.current = next;
  }

  /* ── Position overlay over the node ─────────────────────────────────── */
  const screenX = node.x * stageScale + stagePos.x;
  const screenY = node.y * stageScale + stagePos.y;

  const isSticky = node.type === 'sticky';
  const isText = node.type === 'text';
  if (!isSticky && !isText) return null;

  const fs = node.fontSize * stageScale;
  const fontWeight = node.fontBold ? 700 : 400;
  const fontStyle = node.fontItalic ? 'italic' : 'normal';

  return (
    <div
      className="absolute"
      style={{
        left: screenX + (isSticky ? 12 * stageScale : 0),
        top: screenY + (isSticky ? 12 * stageScale : 0),
        width: (node.width - (isSticky ? 24 : 0)) * stageScale,
        height: isSticky ? (node.height - 24) * stageScale : 'auto',
        transformOrigin: 'top left',
      }}
    >
      <textarea
        ref={textareaRef}
        className="w-full h-full resize-none outline-none border-none"
        style={{
          fontSize: fs,
          lineHeight: isSticky ? 1.4 : 1.3,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight,
          fontStyle,
          textDecoration: node.textUnderline ? 'underline' : undefined,
          color: value ? node.textColor : dimHex(node.textColor, isSticky ? 0.45 : 0.5),
          background: 'transparent',
          padding: 0,
          minHeight: isText ? Math.max(28, node.fontSize * 1.3) * stageScale : undefined,
        }}
        value={value}
        onChange={onInput}
        onBlur={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder={isSticky ? 'Type something…' : 'Text'}
      />
    </div>
  );
}

/**
 * Compute the minimal single-edit diff between `prev` and `next` and apply
 * it to the given Y.Text inside one transaction. Handles inserts, deletes,
 * and replacements — anything more complex still works (it just becomes a
 * single delete-and-insert at the changed range).
 */
function applyDiffToYText(ytext: Y.Text, prev: string, next: string): void {
  // Find common prefix
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start++;

  // Find common suffix length
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }

  const removeLen = endPrev - start;
  const insertText = next.slice(start, endNext);

  ytext.doc?.transact(() => {
    if (removeLen > 0) ytext.delete(start, removeLen);
    if (insertText.length > 0) ytext.insert(start, insertText);
  }, 'local');
}
