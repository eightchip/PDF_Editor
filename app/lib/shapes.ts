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

    case 'double-line':
      // 二重線（取り消し線）を描画
      const lineAngle = Math.atan2(y2 - y1, x2 - x1);
      const offset = shape.width * 0.8; // 線の間隔（太さに応じて調整）
      const perpX = -Math.sin(lineAngle) * offset;
      const perpY = Math.cos(lineAngle) * offset;

      // 1本目の線
      ctx.beginPath();
      ctx.moveTo(x1 + perpX, y1 + perpY);
      ctx.lineTo(x2 + perpX, y2 + perpY);
      ctx.stroke();

      // 2本目の線
      ctx.beginPath();
      ctx.moveTo(x1 - perpX, y1 - perpY);
      ctx.lineTo(x2 - perpX, y2 - perpY);
      ctx.stroke();
      break;

    case 'polyline-arrow':
      // 折れ線矢印を描画（直角に曲がる矢印）
      if (shape.points && shape.points.length >= 2) {
        ctx.beginPath();
        const firstPoint = shape.points[0];
        ctx.moveTo(firstPoint.x * canvasWidth, firstPoint.y * canvasHeight);
        
        // すべての点を結ぶ線を描画
        for (let i = 1; i < shape.points.length; i++) {
          const point = shape.points[i];
          ctx.lineTo(point.x * canvasWidth, point.y * canvasHeight);
        }
        ctx.stroke();

        // 最後の線分に矢印を描画
        if (shape.points.length >= 2) {
          const lastPoint = shape.points[shape.points.length - 1];
          const prevPoint = shape.points[shape.points.length - 2];
          const lastX = lastPoint.x * canvasWidth;
          const lastY = lastPoint.y * canvasHeight;
          const prevX = prevPoint.x * canvasWidth;
          const prevY = prevPoint.y * canvasHeight;
          
          const arrowAngle = Math.atan2(lastY - prevY, lastX - prevX);
          const arrowLength = shape.width * 3;
          const arrowAngleOffset = Math.PI / 6; // 30度

          ctx.beginPath();
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(
            lastX - arrowLength * Math.cos(arrowAngle - arrowAngleOffset),
            lastY - arrowLength * Math.sin(arrowAngle - arrowAngleOffset)
          );
          ctx.moveTo(lastX, lastY);
          ctx.lineTo(
            lastX - arrowLength * Math.cos(arrowAngle + arrowAngleOffset),
            lastY - arrowLength * Math.sin(arrowAngle + arrowAngleOffset)
          );
          ctx.stroke();
        }
      } else {
        // フォールバック: 通常の矢印として描画
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const angle = Math.atan2(y2 - y1, x2 - x1);
        const arrowLength = shape.width * 3;
        const arrowAngle = Math.PI / 6;

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
      }
      break;

    case 'stamp':
      // スタンプの描画
      const stampX = Math.min(x1, x2);
      const stampY = Math.min(y1, y2);
      const stampW = Math.abs(x2 - x1);
      const stampH = Math.abs(y2 - y1);

      // スタンプの種類に応じて描画
      if (shape.stampType === 'approved') {
        // 承認スタンプ（円形のスタンプ）
        const centerX = stampX + stampW / 2;
        const centerY = stampY + stampH / 2;
        const radius = Math.min(stampW, stampH) / 2;

        // 外側の円
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = shape.width * 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();

        // チェックマーク
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = shape.width * 2;
        ctx.beginPath();
        ctx.moveTo(centerX - radius * 0.4, centerY);
        ctx.lineTo(centerX - radius * 0.1, centerY + radius * 0.3);
        ctx.lineTo(centerX + radius * 0.4, centerY - radius * 0.2);
        ctx.stroke();

        // テキスト
        if (shape.stampText) {
          ctx.fillStyle = '#10b981';
          ctx.font = `bold ${Math.min(stampW, stampH) * 0.15}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(shape.stampText, centerX, centerY + radius * 0.7);
        }
      } else if (shape.stampType === 'rejected') {
        // 却下スタンプ（×マーク）
        const centerX = stampX + stampW / 2;
        const centerY = stampY + stampH / 2;
        const radius = Math.min(stampW, stampH) / 2;

        // 外側の円
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = shape.width * 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();

        // ×マーク
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = shape.width * 2;
        const crossSize = radius * 0.5;
        ctx.beginPath();
        ctx.moveTo(centerX - crossSize, centerY - crossSize);
        ctx.lineTo(centerX + crossSize, centerY + crossSize);
        ctx.moveTo(centerX + crossSize, centerY - crossSize);
        ctx.lineTo(centerX - crossSize, centerY + crossSize);
        ctx.stroke();

        // テキスト
        if (shape.stampText) {
          ctx.fillStyle = '#ef4444';
          ctx.font = `bold ${Math.min(stampW, stampH) * 0.15}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(shape.stampText, centerX, centerY + radius * 0.7);
        }
      } else if (shape.stampType === 'date') {
        // 日付スタンプ
        const centerX = stampX + stampW / 2;
        const centerY = stampY + stampH / 2;
        const radius = Math.min(stampW, stampH) / 2;

        // 外側の円
        ctx.strokeStyle = shape.color || '#3b82f6';
        ctx.lineWidth = shape.width * 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();

        // 日付テキスト
        const dateText = shape.stampText || new Date().toLocaleDateString('ja-JP');
        ctx.fillStyle = shape.color || '#3b82f6';
        ctx.font = `bold ${Math.min(stampW, stampH) * 0.2}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(dateText, centerX, centerY);
      } else if (shape.stampImage) {
        // カスタム画像スタンプ
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, stampX, stampY, stampW, stampH);
        };
        img.src = shape.stampImage;
      } else {
        // デフォルトスタンプ（四角形）
        ctx.strokeStyle = shape.color;
        ctx.lineWidth = shape.width * 2;
        ctx.strokeRect(stampX, stampY, stampW, stampH);
        
        if (shape.stampText) {
          ctx.fillStyle = shape.color;
          ctx.font = `bold ${Math.min(stampW, stampH) * 0.2}px Arial`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(shape.stampText, stampX + stampW / 2, stampY + stampH / 2);
        }
      }
      break;
  }

  ctx.restore();
}

/**
 * 全図形注釈を再描画
 */
export async function redrawShapeAnnotations(
  ctx: CanvasRenderingContext2D,
  shapes: ShapeAnnotation[],
  canvasWidth: number,
  canvasHeight: number
): Promise<void> {
  for (const shape of shapes) {
    if (shape.type === 'stamp' && shape.stampImage) {
      // 画像スタンプの場合は非同期で描画
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const stampX = Math.min(shape.x1, shape.x2) * canvasWidth;
          const stampY = Math.min(shape.y1, shape.y2) * canvasHeight;
          const stampW = Math.abs(shape.x2 - shape.x1) * canvasWidth;
          const stampH = Math.abs(shape.y2 - shape.y1) * canvasHeight;
          ctx.drawImage(img, stampX, stampY, stampW, stampH);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = shape.stampImage!;
      });
    } else {
      drawShapeAnnotation(ctx, shape, canvasWidth, canvasHeight);
    }
  }
}

/**
 * 図形注釈のIDを生成
 */
export function generateShapeId(): string {
  return `shape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

