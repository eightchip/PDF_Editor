import { PDFDocument, rgb } from 'pdf-lib';
import type { Stroke, TextAnnotation, ShapeAnnotation } from './db';

/**
 * 16進数カラーをRGBに変換
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255,
      }
    : { r: 0, g: 0, b: 0 };
}

/**
 * PDFに注釈を焼き込んでエクスポート（線分を個別に描画 + テキスト注釈）
 */
export async function exportAnnotatedPDFV2(
  originalPdfBytes: ArrayBuffer,
  annotations: Record<number, Stroke[]>,
  pageSizes: Record<number, { width: number; height: number }>,
  textAnnotations?: Record<number, TextAnnotation[]>,
  shapeAnnotations?: Record<number, ShapeAnnotation[]>
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const pages = pdfDoc.getPages();
  
  // デフォルトフォントを取得
  const helveticaFont = await pdfDoc.embedFont('Helvetica');

  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const page = pages[i];
    const pageStrokes = annotations[pageNumber];
    const pageTexts = textAnnotations?.[pageNumber] || [];
    const pageShapes = shapeAnnotations?.[pageNumber] || [];
    
    const pageSize = pageSizes[pageNumber];
    if (!pageSize) continue;

    // ストロークを描画
    if (pageStrokes && pageStrokes.length > 0) {
      for (const stroke of pageStrokes) {
        if (stroke.tool === 'eraser') {
          continue;
        }

        const color = hexToRgb(stroke.color);
        
        // ハイライトの場合は半透明の矩形として描画
        if (stroke.tool === 'highlight') {
          if (stroke.points.length >= 4) {
            // 矩形の4つの角から矩形を計算
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            
            for (const point of stroke.points) {
              const x = point.x * pageSize.width;
              const y = (1 - point.y) * pageSize.height; // Y座標を反転
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
            
            const rectX = minX;
            const rectY = minY;
            const rectW = maxX - minX;
            const rectH = maxY - minY;
            
            // 半透明の矩形を描画（opacity: 0.3）
            page.drawRectangle({
              x: rectX,
              y: rectY,
              width: rectW,
              height: rectH,
              color: rgb(color.r, color.g, color.b),
              opacity: 0.3,
            });
          } else if (stroke.points.length >= 2) {
            // 点が少ない場合は線として描画（後方互換性）
            for (let j = 0; j < stroke.points.length - 1; j++) {
              const p1 = stroke.points[j];
              const p2 = stroke.points[j + 1];
              
              const x1 = p1.x * pageSize.width;
              const y1 = (1 - p1.y) * pageSize.height; // Y座標を反転
              const x2 = p2.x * pageSize.width;
              const y2 = (1 - p2.y) * pageSize.height; // Y座標を反転

              page.drawLine({
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 },
                thickness: stroke.width,
                color: rgb(color.r, color.g, color.b),
                opacity: 0.3,
              });
            }
          }
          continue; // ハイライトはここで終了
        }

        // 通常のペンストローク
        if (stroke.points.length < 2) {
          continue;
        }
        
        // 各線分を個別に描画
        for (let j = 0; j < stroke.points.length - 1; j++) {
          const p1 = stroke.points[j];
          const p2 = stroke.points[j + 1];
          
          const x1 = p1.x * pageSize.width;
          const y1 = (1 - p1.y) * pageSize.height; // Y座標を反転
          const x2 = p2.x * pageSize.width;
          const y2 = (1 - p2.y) * pageSize.height; // Y座標を反転

          page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            thickness: stroke.width,
            color: rgb(color.r, color.g, color.b),
          });
        }
      }
    }

    // テキスト注釈を描画
    if (pageTexts.length > 0) {
      for (const textAnnotation of pageTexts) {
        try {
          const color = hexToRgb(textAnnotation.color);
          const x = textAnnotation.x * pageSize.width;
          const y = (1 - textAnnotation.y) * pageSize.height; // Y座標を反転

          // WinAnsiエンコーディングで表現できない文字をスキップまたは置換
          // 日本語などの非ASCII文字は描画をスキップ
          const text = textAnnotation.text;
          const asciiText = text.split('').filter(char => {
            const code = char.charCodeAt(0);
            return code >= 32 && code <= 126; // ASCII文字のみ
          }).join('');

          if (asciiText.length > 0) {
            page.drawText(asciiText, {
              x,
              y,
              size: textAnnotation.fontSize,
              font: helveticaFont,
              color: rgb(color.r, color.g, color.b),
            });
          }
        } catch (error) {
          // エンコーディングエラーが発生した場合はスキップ
          console.warn('テキスト注釈の描画に失敗しました:', error);
        }
      }
    }

    // 図形注釈を描画
    if (pageShapes.length > 0) {
      for (const shape of pageShapes) {
        const color = hexToRgb(shape.color);
        const x1 = shape.x1 * pageSize.width;
        const y1 = (1 - shape.y1) * pageSize.height; // Y座標を反転
        const x2 = shape.x2 * pageSize.width;
        const y2 = (1 - shape.y2) * pageSize.height; // Y座標を反転

        switch (shape.type) {
          case 'line':
            page.drawLine({
              start: { x: x1, y: y1 },
              end: { x: x2, y: y2 },
              thickness: shape.width,
              color: rgb(color.r, color.g, color.b),
            });
            break;

          case 'rectangle':
            const rectX = Math.min(x1, x2);
            const rectY = Math.min(y1, y2);
            const rectW = Math.abs(x2 - x1);
            const rectH = Math.abs(y2 - y1);
            if (shape.fill) {
              // 塗りつぶしの場合は半透明にする
              page.drawRectangle({
                x: rectX,
                y: rectY,
                width: rectW,
                height: rectH,
                color: rgb(color.r, color.g, color.b),
                opacity: 0.5,
              });
            } else {
              page.drawRectangle({
                x: rectX,
                y: rectY,
                width: rectW,
                height: rectH,
                borderColor: rgb(color.r, color.g, color.b),
                borderWidth: shape.width,
              });
            }
            break;

          case 'circle':
            const centerX = (x1 + x2) / 2;
            const centerY = (y1 + y2) / 2;
            const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) / 2;
            if (shape.fill) {
              // 塗りつぶしの場合は半透明にする
              page.drawCircle({
                x: centerX,
                y: centerY,
                size: radius * 2,
                color: rgb(color.r, color.g, color.b),
                opacity: 0.5,
              });
            } else {
              page.drawCircle({
                x: centerX,
                y: centerY,
                size: radius * 2,
                borderColor: rgb(color.r, color.g, color.b),
                borderWidth: shape.width,
              });
            }
            break;

          case 'arrow':
            // 線を描画
            page.drawLine({
              start: { x: x1, y: y1 },
              end: { x: x2, y: y2 },
              thickness: shape.width,
              color: rgb(color.r, color.g, color.b),
            });
            // 矢印の先端を描画（簡易版：三角形）
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const arrowLength = shape.width * 3;
            const arrowAngle = Math.PI / 6;
            const arrowX1 = x2 - arrowLength * Math.cos(angle - arrowAngle);
            const arrowY1 = y2 - arrowLength * Math.sin(angle - arrowAngle);
            const arrowX2 = x2 - arrowLength * Math.cos(angle + arrowAngle);
            const arrowY2 = y2 - arrowLength * Math.sin(angle + arrowAngle);
            
            page.drawLine({
              start: { x: x2, y: y2 },
              end: { x: arrowX1, y: arrowY1 },
              thickness: shape.width,
              color: rgb(color.r, color.g, color.b),
            });
            page.drawLine({
              start: { x: x2, y: y2 },
              end: { x: arrowX2, y: arrowY2 },
              thickness: shape.width,
              color: rgb(color.r, color.g, color.b),
            });
            break;
        }
      }
    }
  }

  return await pdfDoc.save();
}

