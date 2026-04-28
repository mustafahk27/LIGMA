'use client';

import { createNode } from './nodes';

function templateGroupId(): string {
  return `tpl_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

export type CanvasTemplateId = 'retro' | 'swot' | 'flow' | 'mindmap' | 'standup';

export interface CanvasTemplateMeta {
  id: CanvasTemplateId;
  title: string;
  blurb: string;
}

export const CANVAS_TEMPLATE_LIST: CanvasTemplateMeta[] = [
  {
    id: 'retro',
    title: 'Sprint retro',
    blurb: 'Went well · Improve · Actions — extract tasks from stickies',
  },
  {
    id: 'swot',
    title: 'SWOT',
    blurb: 'Strengths, weaknesses, opportunities, threats',
  },
  {
    id: 'flow',
    title: 'Linear flow',
    blurb: 'Plan → Build → Review → Ship',
  },
  {
    id: 'mindmap',
    title: 'Mind map',
    blurb: 'Central topic + branches for brainstorming',
  },
  {
    id: 'standup',
    title: 'Daily standup',
    blurb: 'Yesterday · Today · Blockers',
  },
];

function arrowSeg(
  authorId: string,
  groupId: string,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
): string {
  const x0 = Math.min(sx, ex);
  const y0 = Math.min(sy, ey);
  const w = Math.max(8, Math.abs(ex - sx));
  const h = Math.max(8, Math.abs(ey - sy));
  return createNode({
    type: 'arrow',
    author_id: authorId,
    group_id: groupId,
    x: x0,
    y: y0,
    width: w,
    height: h,
    points: [sx - x0, sy - y0, ex - x0, ey - y0],
  });
}

/**
 * Drop a premade layout at `anchor` (stage coordinates). Returns created node ids
 * in creation order (later = higher z-index / more on top).
 */
export function insertCanvasTemplate(
  templateId: CanvasTemplateId,
  authorId: string,
  anchor: { x: number; y: number },
): string[] {
  const cx = anchor.x;
  const cy = anchor.y;
  const ids: string[] = [];
  const groupId = templateGroupId();

  switch (templateId) {
    case 'retro': {
      const w = 200;
      const h = 160;
      const gap = 24;
      const top = cy - h / 2 - 20;
      const totalW = w * 3 + gap * 2;
      const left = cx - totalW / 2;
      const presets: { title: string; fill: string }[] = [
        { title: 'Went well', fill: '#86efac' },
        { title: 'To improve', fill: '#fca5a5' },
        { title: 'Action items', fill: '#93c5fd' },
      ];
      for (let i = 0; i < 3; i++) {
        const x = left + i * (w + gap);
        ids.push(
          createNode({
            type: 'sticky',
            author_id: authorId,
            group_id: groupId,
            x,
            y: top,
            width: w,
            height: h,
            fill: presets[i]!.fill,
            content: `${presets[i]!.title}\n\n• `,
          }),
        );
      }
      break;
    }

    case 'swot': {
      const cellW = 200;
      const cellH = 160;
      const gap = 20;
      const labels: { title: string; stroke: string; fill: string }[] = [
        { title: 'Strengths', stroke: '#22c55e', fill: '#0f172a' },
        { title: 'Weaknesses', stroke: '#f87171', fill: '#0f172a' },
        { title: 'Opportunities', stroke: '#38bdf8', fill: '#0f172a' },
        { title: 'Threats', stroke: '#c084fc', fill: '#0f172a' },
      ];
      const top = cy - cellH - gap / 2;
      const bot = cy + gap / 2;
      const leftCol = cx - cellW - gap / 2;
      const rightCol = cx + gap / 2;
      for (let i = 0; i < 4; i++) {
        const col = i % 2 === 0 ? leftCol : rightCol;
        const row = i < 2 ? top : bot;
        const { title, stroke, fill } = labels[i]!;
        ids.push(
          createNode({
            type: 'round_rect',
            author_id: authorId,
            group_id: groupId,
            x: col,
            y: row,
            width: cellW,
            height: cellH,
            stroke,
            fill,
          }),
        );
        ids.push(
          createNode({
            type: 'text',
            author_id: authorId,
            group_id: groupId,
            x: col + 14,
            y: row + 18,
            width: cellW - 28,
            height: 40,
            content: title,
          }),
        );
      }
      break;
    }

    case 'flow': {
      const boxW = 220;
      const boxH = 72;
      const vGap = 36;
      const labels = ['Plan', 'Build', 'Review', 'Ship'];
      const baseY = cy - ((labels.length - 1) * (boxH + vGap) + boxH) / 2;
      const left = cx - boxW / 2;

      for (let i = 0; i < labels.length; i++) {
        const y = baseY + i * (boxH + vGap);
        ids.push(
          createNode({
            type: 'round_rect',
            author_id: authorId,
            group_id: groupId,
            x: left,
            y,
            width: boxW,
            height: boxH,
            stroke: '#4575f3',
          }),
        );
        ids.push(
          createNode({
            type: 'text',
            author_id: authorId,
            group_id: groupId,
            x: left + 16,
            y: y + 18,
            width: boxW - 32,
            height: 40,
            content: labels[i],
            fontSize: 18,
          }),
        );
        if (i < labels.length - 1) {
          const y1 = y + boxH;
          const y2 = baseY + (i + 1) * (boxH + vGap);
          ids.push(
            arrowSeg(authorId, groupId, cx, y1 + 2, cx, y2 - 2),
          );
        }
      }
      break;
    }

    case 'mindmap': {
      const hubR = 100;
      const hub = createNode({
        type: 'round_rect',
        author_id: authorId,
        group_id: groupId,
        x: cx - hubR,
        y: cy - 44,
        width: hubR * 2,
        height: 88,
        stroke: '#8b5cf6',
      });
      ids.push(hub);
      ids.push(
        createNode({
          type: 'text',
          author_id: authorId,
          group_id: groupId,
          x: cx - hubR + 16,
          y: cy - 26,
          width: hubR * 2 - 32,
          height: 44,
          content: 'Topic',
          fontSize: 20,
          fontBold: true,
        }),
      );

      const branchW = 160;
      const branchH = 100;
      const rad = 200;
      for (let idx = 0; idx < 5; idx++) {
        const ang = -Math.PI / 2 + (idx * 2 * Math.PI) / 5;
        const bx = cx + rad * Math.cos(ang) - branchW / 2;
        const by = cy + rad * Math.sin(ang) - branchH / 2;
        const palette = ['#fde68a', '#93c5fd', '#86efac', '#fca5a5', '#c4b5fd'];
        ids.push(
          createNode({
            type: 'sticky',
            author_id: authorId,
            group_id: groupId,
            x: bx,
            y: by,
            width: branchW,
            height: branchH,
            fill: palette[idx % palette.length]!,
            content: `Branch ${idx + 1}\n\n`,
          }),
        );
      }
      break;
    }

    case 'standup': {
      const w = 210;
      const h = 150;
      const gap = 18;
      const titles = ['Yesterday', 'Today', 'Blockers'];
      const fills = ['#fde68a', '#86efac', '#fca5a5'];
      const total = w * 3 + gap * 2;
      const left0 = cx - total / 2;
      const top = cy - h / 2;
      for (let i = 0; i < 3; i++) {
        ids.push(
          createNode({
            type: 'sticky',
            author_id: authorId,
            group_id: groupId,
            x: left0 + i * (w + gap),
            y: top,
            width: w,
            height: h,
            fill: fills[i]!,
            content: `${titles[i]}\n\n• `,
          }),
        );
      }
      break;
    }
  }

  return ids;
}
