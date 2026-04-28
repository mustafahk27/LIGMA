'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { getNodeText, updateNode } from '@/lib/nodes';
import type { NodeSnapshot } from '@/lib/node-types';
import { dimHex } from '@/lib/text-style';

/** Match Canvas transformer minimums */
const MIN_TEXT_BOX_H = 24;
const MIN_STICKY_BOX_H = 52;
/** Top + bottom inner padding for sticky (matches ShapeRenderer). */
const STICKY_TEXT_PAD_Y = 24;

interface EditableTextProps {
  node: NodeSnapshot;
  stagePos: { x: number; y: number };
  stageScale: number;
  onClose: () => void;
}

/**
 * HTML textarea over a text / sticky node. Height follows `scrollHeight` (no scrollbar);
 * `node.height` updates in canvas space so Konva bounds / selection / resize stay aligned.
 */
export function EditableText({ node, stagePos, stageScale, onClose }: EditableTextProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState(node.content);
  const lastValueRef = useRef(node.content);

  const isSticky = node.type === 'sticky';
  const isText = node.type === 'text';
  const lineHeight = isSticky ? 1.4 : 1.3;

  /** Content width in **screen** px — must match wrapped layout & Konva Text `width`. */
  const contentWidthPx = Math.max(
    8,
    (node.width - (isSticky ? 24 : 0)) * stageScale,
  );

  function syncCanvasHeightToTextarea(el: HTMLTextAreaElement): void {
    el.style.overflow = 'hidden';
    el.style.overflowY = 'hidden';
    el.style.boxSizing = 'border-box';
    el.style.width = `${contentWidthPx}px`;

    el.style.height = '0px';
    const minPx = Math.ceil(node.fontSize * lineHeight * stageScale);
    const sh = Math.max(el.scrollHeight, minPx);
    el.style.height = `${sh}px`;

    const contentCanvasH = sh / stageScale;

    let nextH: number;
    if (isSticky) {
      nextH = Math.ceil(contentCanvasH + STICKY_TEXT_PAD_Y);
      nextH = Math.max(MIN_STICKY_BOX_H, nextH);
    } else {
      nextH = Math.ceil(contentCanvasH);
      nextH = Math.max(MIN_TEXT_BOX_H, nextH);
    }

    if (Math.abs(nextH - node.height) > 0.25) {
      updateNode(node.id, { height: nextH });
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    syncCanvasHeightToTextarea(el);
  }, [
    value,
    contentWidthPx,
    node.height,
    node.fontSize,
    node.fontBold,
    node.fontItalic,
    node.textUnderline,
    isSticky,
    node.id,
    stageScale,
    lineHeight,
  ]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  function onInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const prev = lastValueRef.current;
    setValue(next);

    if (next === prev) return;

    const ytext = getNodeText(node.id);
    if (!ytext) return;

    applyDiffToYText(ytext, prev, next);
    lastValueRef.current = next;

    queueMicrotask(() => syncCanvasHeightToTextarea(e.target));
  }

  if (!isSticky && !isText) return null;

  const screenX = node.x * stageScale + stagePos.x;
  const screenY = node.y * stageScale + stagePos.y;

  const fs = node.fontSize * stageScale;
  const fontWeight = node.fontBold ? 700 : 400;
  const fontStyle = node.fontItalic ? 'italic' : 'normal';

  return (
    <div
      className="absolute overflow-visible"
      style={{
        left: screenX + (isSticky ? 12 * stageScale : 0),
        top: screenY + (isSticky ? 12 * stageScale : 0),
        width: contentWidthPx,
        minWidth: contentWidthPx,
        maxWidth: contentWidthPx,
      }}
    >
      <textarea
        ref={textareaRef}
        className="resize-none border-none bg-transparent p-0 outline-none block"
        spellCheck={false}
        rows={1}
        style={{
          width: contentWidthPx,
          minWidth: contentWidthPx,
          maxWidth: contentWidthPx,
          overflow: 'hidden',
          overflowY: 'hidden',
          overflowX: 'hidden',
          wordBreak: 'break-word',
          fontSize: fs,
          lineHeight,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontWeight,
          fontStyle,
          textDecoration: node.textUnderline ? 'underline' : undefined,
          color: value ? node.textColor : dimHex(node.textColor, isSticky ? 0.45 : 0.5),
          minHeight: `${node.fontSize * lineHeight * stageScale}px`,
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

function applyDiffToYText(ytext: Y.Text, prev: string, next: string): void {
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start++;

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
