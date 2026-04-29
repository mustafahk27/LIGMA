'use client';

import { useEffect, useRef, useState } from 'react';
import { useHeatmap, HeatmapFilter } from '@/lib/heatmap';
import { useYjsNodes } from '@/lib/use-yjs-nodes';
import { useUiStore } from '@/store/ui';

interface MinimapProps {
  filter: HeatmapFilter;
  visible: boolean;
  onJump?: (x: number, y: number) => void;
}

// Pre-compute the 256-color gradient map for the orange -> red transition
let paletteData: Uint8ClampedArray | null = null;
function getPalette() {
  if (paletteData) return paletteData;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return new Uint8ClampedArray(256 * 4);
  const grad = ctx.createLinearGradient(0, 0, 256, 0);
  
  grad.addColorStop(0.0, 'rgba(253, 186, 116, 0)');
  grad.addColorStop(0.2, 'rgba(253, 186, 116, 0.4)');
  grad.addColorStop(0.5, 'rgba(251, 146, 60, 0.6)');
  grad.addColorStop(0.8, 'rgba(249, 115, 22, 0.8)');
  grad.addColorStop(1.0, 'rgba(239, 68, 68, 1)');
  
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 1);
  paletteData = ctx.getImageData(0, 0, 256, 1).data;
  return paletteData;
}

let circleTemplate: HTMLCanvasElement | null = null;
function getCircleTemplate(radius: number) {
  if (circleTemplate && circleTemplate.width === radius * 2) return circleTemplate;
  const c = document.createElement('canvas');
  c.width = radius * 2;
  c.height = radius * 2;
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  
  const grad = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(radius, radius, radius, 0, Math.PI * 2);
  ctx.fill();
  circleTemplate = c;
  return c;
}

export function Minimap({ filter, visible, onJump }: MinimapProps) {
  const { cells, maxHeat } = useHeatmap(filter);
  const nodes = useYjsNodes();
  const stageScale = useUiStore((s) => s.stageScale);
  const stagePos = useUiStore((s) => s.stagePos);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bounds, setBounds] = useState({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 });

  const [size, setSize] = useState({ w: 240, h: 160 });
  const [pos, setPos] = useState({ x: 16, y: 0 });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setPos({ x: 16, y: window.innerHeight - 160 - 16 });
    setInitialized(true);
  }, []);

  // Update bounds based on nodes and heatmap cells
  useEffect(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + n.height > maxY) maxY = n.y + n.height;
    });

    cells.forEach(c => {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    });

    // Add padding
    minX -= 500;
    minY -= 500;
    maxX += 500;
    maxY += 500;

    // Ensure minimum size so it doesn't zoom too far in on empty canvas
    if (minX === Infinity) {
      minX = -1000;
      minY = -1000;
      maxX = 1000;
      maxY = 1000;
    }

    // Preserve aspect ratio of minimap
    const mapAspect = size.w / size.h;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const contentAspect = contentW / contentH;

    if (contentAspect > mapAspect) {
      // Content is wider, expand height
      const targetH = contentW / mapAspect;
      const dh = (targetH - contentH) / 2;
      minY -= dh;
      maxY += dh;
    } else {
      // Content is taller, expand width
      const targetW = contentH * mapAspect;
      const dw = (targetW - contentW) / 2;
      minX -= dw;
      maxX += dw;
    }

    setBounds({ minX, minY, maxX, maxY });
  }, [nodes, cells, size.w, size.h]);

  // Render Minimap
  useEffect(() => {
    if (!visible || !initialized || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, size.w, size.h);

    const worldW = bounds.maxX - bounds.minX;
    const worldH = bounds.maxY - bounds.minY;
    const scaleX = size.w / worldW;
    const scaleY = size.h / worldH;

    const toMiniX = (x: number) => (x - bounds.minX) * scaleX;
    const toMiniY = (y: number) => (y - bounds.minY) * scaleY;

    // 1. Draw Nodes
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;

    nodes.forEach(n => {
      const x = toMiniX(n.x);
      const y = toMiniY(n.y);
      const w = Math.max(n.width * scaleX, 2); // Ensure visible
      const h = Math.max(n.height * scaleY, 2);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    });

    // 2. Draw Heatmap (KDE) on an offscreen canvas
    if (cells.length > 0 && maxHeat > 0) {
      const heatCanvas = document.createElement('canvas');
      heatCanvas.width = size.w;
      heatCanvas.height = size.h;
      const heatCtx = heatCanvas.getContext('2d', { willReadFrequently: true });
      if (!heatCtx) return;

      heatCtx.globalCompositeOperation = 'lighter';
      
      const baseRadius = 250; // Large radius in world space to create smooth clouds
      const radius = Math.max(10, baseRadius * scaleX);
      const circle = getCircleTemplate(radius);

      for (const cell of cells) {
        const mx = toMiniX(cell.x);
        const my = toMiniY(cell.y);
        const intensity = cell.heat / maxHeat;
        
        heatCtx.globalAlpha = Math.max(0.05, Math.min(intensity, 1));
        heatCtx.drawImage(circle, mx - radius, my - radius);
      }

      // Colorize the heat map
      const imageData = heatCtx.getImageData(0, 0, size.w, size.h);
      const data = imageData.data;
      const palette = getPalette();

      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3]!;
        if (alpha === 0) continue;
        
        const offset = alpha * 4;
        data[i] = palette[offset]!;       // R
        data[i + 1] = palette[offset + 1]!; // G
        data[i + 2] = palette[offset + 2]!; // B
        data[i + 3] = palette[offset + 3]!; // A
      }

      heatCtx.putImageData(imageData, 0, 0);
      
      // Draw the colorized heatmap over the nodes
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.8;
      ctx.drawImage(heatCanvas, 0, 0);
      ctx.globalAlpha = 1.0;
    }
  }, [visible, initialized, nodes, cells, maxHeat, bounds, size.w, size.h]);

  if (!visible || !initialized) return null;

  // Viewport calculation
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  const scaleX = size.w / worldW;
  const scaleY = size.h / worldH;

  const viewportW = (window.innerWidth / stageScale) * scaleX;
  const viewportH = (window.innerHeight / stageScale) * scaleY;
  const viewportX = ((-stagePos.x / stageScale) - bounds.minX) * scaleX;
  const viewportY = ((-stagePos.y / stageScale) - bounds.minY) * scaleY;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onJump) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    // Map minimap click back to world coordinate (center of viewport)
    const worldX = (mx / scaleX) + bounds.minX;
    const worldY = (my / scaleY) + bounds.minY;
    onJump(worldX, worldY);
  };

  const handleDragStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = pos.x;
    const startY = pos.y;
    const pointerX = e.clientX;
    const pointerY = e.clientY;
    
    const handleMove = (ev: PointerEvent) => {
      setPos({ x: startX + (ev.clientX - pointerX), y: startY + (ev.clientY - pointerY) });
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startW = size.w;
    const startH = size.h;
    const pointerX = e.clientX;
    const pointerY = e.clientY;
    
    const handleMove = (ev: PointerEvent) => {
      setSize({
        w: Math.max(120, startW + (ev.clientX - pointerX)),
        h: Math.max(80, startH + (ev.clientY - pointerY))
      });
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <div 
      className="absolute z-50 rounded-lg overflow-hidden border-2 border-[var(--border)] shadow-2xl bg-[#0c1020] flex flex-col"
      style={{ left: pos.x, top: pos.y, width: size.w, height: size.h + 20 }}
    >
      {/* Drag Handle */}
      <div 
        className="w-full h-[20px] bg-[var(--surface-2)] border-b border-[var(--border)] flex items-center px-2 cursor-grab active:cursor-grabbing select-none"
        onPointerDown={handleDragStart}
      >
        <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-3)]">Radar</span>
      </div>

      <div className="relative flex-1" style={{ cursor: 'crosshair' }} onClick={handleClick} title="Minimap (Click to jump)">
        <canvas 
          ref={canvasRef} 
          width={size.w} 
          height={size.h} 
          className="absolute inset-0"
        />
        {/* Viewport Indicator */}
        <div 
          className="absolute border border-white pointer-events-none"
          style={{
            left: viewportX,
            top: viewportY,
            width: viewportW,
            height: viewportH,
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
          }}
        />
      </div>

      {/* Resize Handle */}
      <div 
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10"
        onPointerDown={handleResizeStart}
      >
        <svg viewBox="0 0 10 10" className="w-full h-full opacity-30">
          <path d="M8 10L10 8M5 10L10 5M2 10L10 2" stroke="white" strokeWidth="1"/>
        </svg>
      </div>
    </div>
  );
}
