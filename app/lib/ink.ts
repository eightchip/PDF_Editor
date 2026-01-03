import type { Point, Stroke } from './db';

/**
 * ストロークをcanvasに描画
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  canvasWidth: number,
  canvasHeight: number
): void {
  if (stroke.points.length === 0) return;

  ctx.save();

  if (stroke.tool === 'pen') {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  } else if (stroke.tool === 'highlight') {
    // ハイライトの場合は半透明で矩形を描画（テキストの上に直接重なる）
    // 通常のハイライトモード
    ctx.globalAlpha = 0.3;
    ctx.globalCompositeOperation = 'multiply'; // 下のPDFと乗算
    ctx.fillStyle = stroke.color;
  } else if (stroke.tool === 'redact') {
    // 墨消しモード：背景と同じ色で覆う（テキストを非表示にする）
    ctx.globalAlpha = 1.0; // 完全に不透明
    ctx.globalCompositeOperation = 'source-over'; // 通常の描画モード
    ctx.fillStyle = '#FFFFFF'; // 白で固定（背景色と同じ）
    
    // pointsが4つ以上ある場合（矩形の4つの角）は矩形として描画
    if (stroke.points.length >= 4) {
      // 矩形の左上と右下の点を計算
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      
      for (const point of stroke.points) {
        const x = point.x * canvasWidth;
        const y = point.y * canvasHeight;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      
      const rectX = minX;
      const rectY = minY;
      const rectW = maxX - minX;
      const rectH = maxY - minY;
      
      ctx.fillRect(rectX, rectY, rectW, rectH);
      
      // テキスト情報がある場合は、ハイライト上には描画しない（墨消しのみ）
      // テキストは別のテキスト注釈として配置される
    } else {
      // 従来のストローク描画（後方互換性のため）
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      const firstPoint = stroke.points[0];
      ctx.moveTo(firstPoint.x * canvasWidth, firstPoint.y * canvasHeight);
      
      for (let i = 1; i < stroke.points.length; i++) {
        const point = stroke.points[i];
        ctx.lineTo(point.x * canvasWidth, point.y * canvasHeight);
      }
      
      ctx.fill();
      ctx.stroke();
    }
    
    ctx.restore();
    return; // ハイライトはここで終了
  } else if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  ctx.beginPath();
  const firstPoint = stroke.points[0];
  ctx.moveTo(firstPoint.x * canvasWidth, firstPoint.y * canvasHeight);

  for (let i = 1; i < stroke.points.length; i++) {
    const point = stroke.points[i];
    ctx.lineTo(point.x * canvasWidth, point.y * canvasHeight);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * 全ストロークを再描画
 * @param clearCanvas trueの場合、キャンバスをクリアしてから描画（デフォルト: true）
 */
export function redrawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  canvasWidth: number,
  canvasHeight: number,
  clearCanvas: boolean = true
): void {
  // 現在のtransformを保存（devicePixelRatioなどを保持）
  const currentTransform = ctx.getTransform();
  
  // コンテキストの状態をリセット（前の描画の影響を完全にクリア）
  // 実際のキャンバスサイズでクリア（clearCanvasがtrueの場合のみ）
  if (clearCanvas) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // transformを元に戻す（devicePixelRatioを保持）
    // DOMMatrixから個別の値を取得してsetTransformに渡す
    ctx.setTransform(
      currentTransform.a, currentTransform.b,
      currentTransform.c, currentTransform.d,
      currentTransform.e, currentTransform.f
    );
  }
  
  // 各ストロークを描画（各ストロークは独立して描画される）
  for (const stroke of strokes) {
    drawStroke(ctx, stroke, canvasWidth, canvasHeight);
  }
}

/**
 * 座標をcanvas座標から比率(0..1)に変換
 */
export function normalizePoint(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number
): Point {
  return {
    x: Math.max(0, Math.min(1, x / canvasWidth)),
    y: Math.max(0, Math.min(1, y / canvasHeight)),
  };
}

/**
 * 比率(0..1)からcanvas座標に変換
 */
export function denormalizePoint(
  point: Point,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  return {
    x: point.x * canvasWidth,
    y: point.y * canvasHeight,
  };
}

