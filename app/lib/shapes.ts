import type { ShapeAnnotation } from './db';

/**
 * 図形注釈をcanvasに描画
 */
export function drawShapeAnnotation(
  ctx: CanvasRenderingContext2D,
  shape: ShapeAnnotation,
  canvasWidth: number,
  canvasHeight: number
): void {
  const x1 = shape.x1 * canvasWidth;
  const y1 = shape.y1 * canvasHeight;
  const x2 = shape.x2 * canvasWidth;
  const y2 = shape.y2 * canvasHeight;

  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (shape.fill) {
    ctx.fillStyle = shape.color;
  }

  switch (shape.type) {
    case 'line':
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      break;

    case 'rectangle':
      const rectX = Math.min(x1, x2);
      const rectY = Math.min(y1, y2);
      const rectW = Math.abs(x2 - x1);
      const rectH = Math.abs(y2 - y1);
      if (shape.fill) {
        ctx.fillRect(rectX, rectY, rectW, rectH);
      } else {
        ctx.strokeRect(rectX, rectY, rectW, rectH);
      }
      break;

    case 'circle':
      const centerX = (x1 + x2) / 2;
      const centerY = (y1 + y2) / 2;
      const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) / 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      if (shape.fill) {
        ctx.fill();
      } else {
        ctx.stroke();
      }
      break;

    case 'arrow':
      // 線を描画
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // 矢印の先端を描画
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const arrowLength = shape.width * 3;
      const arrowAngle = Math.PI / 6; // 30度

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - arrowLength * Math.cos(angle - arrowAngle),
        y2 - arrowLength * Math.sin(angle - arrowAngle)
      );
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - arrowLength * Math.cos(angle + arrowAngle),
        y2 - arrowLength * Math.sin(angle + arrowAngle)
      );
      ctx.stroke();
      break;
  }

  ctx.restore();
}

/**
 * 全図形注釈を再描画
 */
export function redrawShapeAnnotations(
  ctx: CanvasRenderingContext2D,
  shapes: ShapeAnnotation[],
  canvasWidth: number,
  canvasHeight: number
): void {
  for (const shape of shapes) {
    drawShapeAnnotation(ctx, shape, canvasWidth, canvasHeight);
  }
}

/**
 * 図形注釈のIDを生成
 */
export function generateShapeId(): string {
  return `shape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

