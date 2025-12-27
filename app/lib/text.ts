import type { TextAnnotation } from './db';

/**
 * テキスト注釈をcanvasに描画
 */
export function drawTextAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: TextAnnotation,
  canvasWidth: number,
  canvasHeight: number
): void {
  const x = annotation.x * canvasWidth;
  const y = annotation.y * canvasHeight;

  ctx.save();
  ctx.font = `${annotation.fontSize}px sans-serif`;
  ctx.fillStyle = annotation.color;
  ctx.textBaseline = 'top';
  
  // テキストを描画
  const lines = annotation.text.split('\n');
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * annotation.fontSize * 1.2);
  });
  
  ctx.restore();
}

/**
 * 全テキスト注釈を再描画
 */
export function redrawTextAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: TextAnnotation[],
  canvasWidth: number,
  canvasHeight: number
): void {
  for (const annotation of annotations) {
    drawTextAnnotation(ctx, annotation, canvasWidth, canvasHeight);
  }
}

/**
 * テキスト注釈のIDを生成
 */
export function generateTextId(): string {
  return `text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

