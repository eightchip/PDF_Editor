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
    // 墨消し機能：黒色の場合は墨消しとして扱う（opacityを低くして黒をデフォルト）
    // 色の正規化（様々な形式に対応）
    const normalizedColor = stroke.color.toLowerCase().trim();
    const isRedact = normalizedColor === '#000000' || 
                     normalizedColor === 'black' || 
                     normalizedColor === 'rgb(0, 0, 0)' ||
                     normalizedColor === 'rgba(0, 0, 0, 1)' ||
                     normalizedColor === 'rgba(0, 0, 0, 0.5)' ||
                     normalizedColor === 'rgba(0, 0, 0, 0.3)';
    
    if (isRedact) {
      // 墨消しモード：黒で覆う（opacityを低く）
      ctx.globalAlpha = 0.5; // 墨消し用のopacity
      ctx.globalCompositeOperation = 'source-over'; // 通常の描画モード
      ctx.fillStyle = '#000000'; // 黒で固定
    } else {
      // 通常のハイライトモード
      ctx.globalAlpha = 0.3;
      ctx.globalCompositeOperation = 'multiply'; // 下のPDFと乗算
      ctx.fillStyle = stroke.color;
    }
    
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
      
      // テキスト情報がある場合は、テキストを描画（元のテキストと同じフォント・サイズで）
      if (stroke.text && stroke.fontName && stroke.fontSize && stroke.textX !== undefined && stroke.textY !== undefined) {
        ctx.save();
        // テキスト描画用の設定
        ctx.globalAlpha = 1.0; // テキストは不透明
        ctx.globalCompositeOperation = 'source-over'; // 通常の描画モード
        ctx.fillStyle = '#000000'; // テキストは黒色
        
        // フォントサイズをそのまま使用
        // stroke.fontSizeは既にviewport座標系（scale=1.0）に変換されている
        // canvasWidth/canvasHeightは既にスケールが適用されているので、そのまま使用できる
        const actualFontSize = stroke.fontSize;
        
        // フォント名を正規化（PDF.jsのフォント名は複雑な場合がある）
        let fontFamily = stroke.fontName;
        // PDF.jsのフォント名から実際のフォント名を抽出
        if (fontFamily.includes('+')) {
          fontFamily = fontFamily.split('+')[1] || fontFamily;
        }
        if (fontFamily.includes('-')) {
          fontFamily = fontFamily.split('-')[0] || fontFamily;
        }
        // 日本語フォントのフォールバック
        if (!fontFamily || fontFamily === 'Arial') {
          fontFamily = 'sans-serif';
        }
        
        ctx.font = `${actualFontSize}px ${fontFamily}`;
        ctx.textBaseline = 'top'; // 上端基準
        ctx.textAlign = 'left'; // 左揃え
        
        // テキストの位置を計算（正規化座標から実際の座標へ）
        const textX = stroke.textX * canvasWidth;
        const textY = stroke.textY * canvasHeight;
        
        // デバッグ用ログ
        console.log('テキスト描画:', {
          text: stroke.text,
          fontSize: actualFontSize,
          fontName: fontFamily,
          position: { x: textX, y: textY },
          canvasSize: { width: canvasWidth, height: canvasHeight },
          normalized: { x: stroke.textX, y: stroke.textY }
        });
        
        // テキストを描画
        ctx.fillText(stroke.text, textX, textY);
        ctx.restore();
      }
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

