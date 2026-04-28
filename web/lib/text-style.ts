/** Konva `Text` `fontStyle` from bold / italic toggles. */
export function konvaFontStyle(bold: boolean, italic: boolean): string {
  if (bold && italic) return 'bold italic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

/** Dim a #rrggbb hex for placeholder / empty copy. */
export function dimHex(hex: string, alpha: number): string {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
