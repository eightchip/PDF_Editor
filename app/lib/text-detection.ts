/**
 * PDFテキスト検出とバウンディングボックス取得
 */

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  transform: number[];
  fontName?: string; // フォント名
  fontSize?: number; // フォントサイズ
}

/**
 * PDFページからテキストを抽出し、バウンディングボックスを取得
 */
export async function extractTextItems(
  pdfPage: import('pdfjs-dist').PDFPageProxy,
  scale: number = 1.0
): Promise<TextItem[]> {
  const textContent = await pdfPage.getTextContent();
  const viewport = pdfPage.getViewport({ scale });
  const textItems: TextItem[] = [];

  for (const item of textContent.items) {
    if ('str' in item && item.str.trim()) {
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      
      // PDF.jsのtransform配列: [a, b, c, d, e, f]
      // e = x, f = y (PDF座標系、左下が原点)
      // transform[0] = a, transform[3] = d はスケール因子
      const pdfX = transform[4];
      const pdfY = transform[5];
      
      // テキストの幅と高さを取得
      // PDF.jsのtextContentにはwidthとheightが含まれている場合と含まれていない場合がある
      let width = (item as any).width;
      let height = (item as any).height;
      
      // width/heightが取得できない場合は、フォントサイズから推定
      if (!width || !height) {
        const fontSize = (item as any).fontSize || 12;
        const scale = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1]);
        height = fontSize * scale;
        // 文字列の幅は正確に計算するのが困難なので、文字数から概算
        width = height * 0.6 * item.str.length; // 概算値
      }
      
      // PDF座標系からviewport座標系への変換
      // PDF座標系: 左下が原点、Y軸が上向き
      // viewport座標系: 左上が原点、Y軸が下向き
      const viewportX = pdfX;
      const viewportY = viewport.height - pdfY; // Y座標を反転
      
      // テキストボックスの左上隅を計算
      // transform[5]はベースラインの位置を表すので、実際のテキストボックスの位置を計算
      // テキストは通常ベースラインより上に描画されるので、y座標を調整
      // ハイライト範囲が少し上にはみ出さないように、少し下に調整（heightの5%分下げる）
      // ディセンダー（「り」などの下にはみ出す部分）を含めるため、heightを少し大きくする
      const x = viewportX;
      const adjustedHeight = height * 1.15; // ディセンダーを含めるため、heightを15%増やす
      const y = viewportY - adjustedHeight + (adjustedHeight * 0.05); // テキストの上端を計算（少し下に調整）

      // フォント情報を取得
      const pdfFontSize = (item as any).fontSize || 12;
      const fontName = (item as any).fontName || 'Arial'; // デフォルトフォント
      
      // PDF座標系のフォントサイズをviewport座標系に変換
      // transform配列からスケールを計算
      // transform[0] = a, transform[3] = d はスケール因子
      // ただし、PDF.jsのfontSizeは既にPDF座標系でのサイズなので、
      // viewport座標系に変換する際には、viewportのスケールを考慮する必要がある
      // しかし、実際のテキストの高さ（height）から逆算する方が正確
      // テキストの高さは通常フォントサイズの約1.0-1.2倍なので、それを考慮
      const viewportFontSize = height / 1.15; // adjustedHeightから元のheightに戻し、さらにフォントサイズに変換
      
      textItems.push({
        str: item.str,
        x,
        y,
        width,
        height: adjustedHeight, // 調整後のheightを使用
        transform,
        fontName,
        fontSize: viewportFontSize, // viewport座標系のフォントサイズ
      });
    }
  }

  return textItems;
}

/**
 * 指定座標に最も近いテキスト行を見つける
 */
export function findNearestTextLine(
  textItems: TextItem[],
  x: number,
  y: number,
  threshold: number = 10
): { y: number; items: TextItem[] } | null {
  // Y座標でグループ化
  const lines = new Map<number, TextItem[]>();
  
  for (const item of textItems) {
    const lineY = Math.round(item.y);
    if (!lines.has(lineY)) {
      lines.set(lineY, []);
    }
    lines.get(lineY)!.push(item);
  }

  // 最も近い行を見つける
  let nearestLine: { y: number; items: TextItem[] } | null = null;
  let minDistance = threshold;

  for (const [lineY, items] of lines.entries()) {
    const distance = Math.abs(y - lineY);
    if (distance < minDistance) {
      minDistance = distance;
      nearestLine = { y: lineY, items };
    }
  }

  return nearestLine;
}

/**
 * 指定座標に最も近いテキストアイテムのバウンディングボックスを見つける（ハイライト用）
 * クリックした文字のみをハイライトする（行全体ではない）
 */
export function findTextBoundingBox(
  textItems: TextItem[],
  x: number,
  y: number,
  threshold: number = 30
): { x: number; y: number; width: number; height: number; textItem?: TextItem } | null {
  // 最も近いテキストアイテムを見つける
  let nearestItem: TextItem | null = null;
  let minDistance = threshold;

  for (const item of textItems) {
    // バウンディングボックス内にクリック位置があるかチェック（優先）
    const isInside = x >= item.x && x <= item.x + item.width &&
                     y >= item.y && y <= item.y + item.height;
    
    if (isInside) {
      nearestItem = item;
      break; // バウンディングボックス内なら、それを選択して終了
    }
    
    // バウンディングボックス内でない場合、距離を計算
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
    
    if (distance < minDistance) {
      minDistance = distance;
      nearestItem = item;
    }
  }

  if (!nearestItem) return null;

  // クリックしたテキストアイテムのみのバウンディングボックスを返す（テキストアイテムも含める）
  return {
    x: nearestItem.x,
    y: nearestItem.y,
    width: nearestItem.width,
    height: nearestItem.height,
    textItem: nearestItem,
  };
}

/**
 * ストロークを平滑化（Catmull-Romスプライン）
 */
export function smoothStroke(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 3) return points;

  const smoothed: Array<{ x: number; y: number }> = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : points[i + 1];

    // Catmull-Romスプラインで補間
    for (let t = 0.1; t < 1; t += 0.1) {
      const t2 = t * t;
      const t3 = t2 * t;

      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      );

      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      );

      smoothed.push({ x, y });
    }
  }

  smoothed.push(points[points.length - 1]);
  return smoothed;
}

