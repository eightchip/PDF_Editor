import { PDFDocument, rgb, type Rotation } from 'pdf-lib';
import type { Stroke, TextAnnotation, ShapeAnnotation } from './db';
import { setFormFieldValues, calculateFormFields, type FormField } from './forms';

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
 * @param originalPdfBytes 元のPDFバイト
 * @param annotations 注釈データ
 * @param pageSizes ページサイズ
 * @param textAnnotations テキスト注釈（オプション）
 * @param shapeAnnotations 図形注釈（オプション）
 */
export async function exportAnnotatedPDFV2(
  originalPdfBytes: ArrayBuffer,
  annotations: Record<number, Stroke[]>,
  pageSizes: Record<number, { width: number; height: number }>,
  textAnnotations?: Record<number, TextAnnotation[]>,
  shapeAnnotations?: Record<number, ShapeAnnotation[]>,
  formFields?: FormField[],
  formFieldValues?: Record<string, string | boolean | string[]>,
  signatures?: undefined,
  watermarkText?: undefined,
  pageRotations?: Record<number, number>
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const pages = pdfDoc.getPages();
  
  // フォームフィールドに値を設定
  if (formFields && formFields.length > 0 && formFieldValues) {
    try {
      // 計算フィールドを計算
      const calculatedValues = calculateFormFields(formFields, formFieldValues);
      // フォームに値を設定
      await setFormFieldValues(pdfDoc, calculatedValues);
    } catch (error) {
      console.warn('フォームフィールドの設定に失敗:', error);
    }
  }
  
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

    // ページ回転を適用
    const rotation = pageRotations?.[pageNumber] || 0;
    if (rotation !== 0) {
      // pdf-libのRotation型は0 | 90 | 180 | 270のリテラル型
      let validRotation: Rotation;
      if (rotation === 90) {
        validRotation = 90 as unknown as Rotation;
      } else if (rotation === 180) {
        validRotation = 180 as unknown as Rotation;
      } else if (rotation === 270) {
        validRotation = 270 as unknown as Rotation;
      } else {
        validRotation = 0 as unknown as Rotation;
      }
      page.setRotation(validRotation);
    }

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
              opacity: textAnnotation.opacity ?? 1.0, // 文字の濃さを適用
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

          case 'circle': {
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
          }

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

          case 'stamp': {
            // スタンプの描画
            const stampX = Math.min(x1, x2);
            const stampY = Math.min(y1, y2);
            const stampW = Math.abs(x2 - x1);
            const stampH = Math.abs(y2 - y1);
            const centerX = stampX + stampW / 2;
            const centerY = stampY + stampH / 2;
            const radius = Math.min(stampW, stampH) / 2;

            if (shape.stampType === 'approved') {
              // 承認スタンプ
              page.drawCircle({
                x: centerX,
                y: centerY,
                size: radius * 2,
                borderColor: rgb(0.06, 0.72, 0.51), // #10b981
                borderWidth: shape.width * 2,
              });
              // チェックマーク（簡易版：線で表現）
              const checkSize = radius * 0.3;
              page.drawLine({
                start: { x: centerX - checkSize, y: centerY },
                end: { x: centerX, y: centerY + checkSize },
                thickness: shape.width * 2,
                color: rgb(0.06, 0.72, 0.51),
              });
              page.drawLine({
                start: { x: centerX, y: centerY + checkSize },
                end: { x: centerX + checkSize, y: centerY - checkSize },
                thickness: shape.width * 2,
                color: rgb(0.06, 0.72, 0.51),
              });
              if (shape.stampText) {
                page.drawText(shape.stampText, {
                  x: centerX,
                  y: centerY + radius * 0.7,
                  size: Math.min(stampW, stampH) * 0.15,
                  color: rgb(0.06, 0.72, 0.51),
                });
              }
            } else if (shape.stampType === 'rejected') {
              // 却下スタンプ
              page.drawCircle({
                x: centerX,
                y: centerY,
                size: radius * 2,
                borderColor: rgb(0.94, 0.27, 0.27), // #ef4444
                borderWidth: shape.width * 2,
              });
              // ×マーク
              const crossSize = radius * 0.5;
              page.drawLine({
                start: { x: centerX - crossSize, y: centerY - crossSize },
                end: { x: centerX + crossSize, y: centerY + crossSize },
                thickness: shape.width * 2,
                color: rgb(0.94, 0.27, 0.27),
              });
              page.drawLine({
                start: { x: centerX + crossSize, y: centerY - crossSize },
                end: { x: centerX - crossSize, y: centerY + crossSize },
                thickness: shape.width * 2,
                color: rgb(0.94, 0.27, 0.27),
              });
              if (shape.stampText) {
                page.drawText(shape.stampText, {
                  x: centerX,
                  y: centerY + radius * 0.7,
                  size: Math.min(stampW, stampH) * 0.15,
                  color: rgb(0.94, 0.27, 0.27),
                });
              }
            } else if (shape.stampType === 'date') {
              // 日付スタンプ
              page.drawCircle({
                x: centerX,
                y: centerY,
                size: radius * 2,
                borderColor: rgb(color.r, color.g, color.b),
                borderWidth: shape.width * 2,
              });
              const dateText = shape.stampText || new Date().toLocaleDateString('ja-JP');
              page.drawText(dateText, {
                x: centerX,
                y: centerY,
                size: Math.min(stampW, stampH) * 0.2,
                color: rgb(color.r, color.g, color.b),
              });
            } else if (shape.stampImage) {
              // カスタム画像スタンプ（pdf-libでは画像の埋め込みが必要）
              // 簡易版：テキストで代替
              if (shape.stampText) {
                page.drawText(shape.stampText, {
                  x: stampX,
                  y: stampY + stampH,
                  size: Math.min(stampW, stampH) * 0.2,
                  color: rgb(color.r, color.g, color.b),
                });
              }
            } else {
              // デフォルトスタンプ
              page.drawRectangle({
                x: stampX,
                y: stampY,
                width: stampW,
                height: stampH,
                borderColor: rgb(color.r, color.g, color.b),
                borderWidth: shape.width * 2,
              });
              if (shape.stampText) {
                page.drawText(shape.stampText, {
                  x: centerX,
                  y: centerY,
                  size: Math.min(stampW, stampH) * 0.2,
                  color: rgb(color.r, color.g, color.b),
                });
              }
            }
            break;
          }
        }
      }
    }

  }

  // PDFを保存
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

