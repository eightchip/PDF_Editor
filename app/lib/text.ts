import type { TextAnnotation } from './db';

/**
 * テキストを指定された幅に合わせて折り返す（日本語と英語の両方に対応）
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  
  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    
    // 日本語と英語が混在する場合に対応
    // 日本語の場合は空白がないため、文字単位で処理
    // 英語の場合は単語単位で処理（可能な限り）
    
    // まず、空白で分割して単語単位で処理を試みる
    const words = paragraph.split(/(\s+)/); // 空白文字も保持
    let currentLine = '';
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      
      // 単語が空白のみの場合はそのまま追加
      if (/^\s+$/.test(word)) {
        currentLine += word;
        continue;
      }
      
      // 単語を追加した場合の幅を測定
      const testLine = currentLine + word;
      const metrics = ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine !== '') {
        // 現在の行を保存
        lines.push(currentLine.trim());
        
        // 新しい行を開始
        // 単語自体がmaxWidthを超える場合は、文字単位で分割
        const wordMetrics = ctx.measureText(word);
        if (wordMetrics.width > maxWidth) {
          // 文字単位で分割（日本語対応）
          let charLine = '';
          for (let j = 0; j < word.length; j++) {
            const char = word[j];
            const charTestLine = charLine + char;
            const charMetrics = ctx.measureText(charTestLine);
            
            if (charMetrics.width > maxWidth && charLine !== '') {
              lines.push(charLine);
              charLine = char;
            } else {
              charLine = charTestLine;
            }
          }
          currentLine = charLine;
        } else {
          currentLine = word;
        }
      } else {
        currentLine = testLine;
      }
    }
    
    // 最後の行を追加
    if (currentLine.trim() !== '') {
      lines.push(currentLine.trim());
    }
  }
  
  return lines;
}

/**
 * テキスト注釈をcanvasに描画
 * ユーザーが入力した改行（\n）をそのまま反映する（自動折り返しは行わない）
 * @param scale フォントサイズのスケール（デフォルト: 1.0、サムネイル用に調整可能）
 */
export function drawTextAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: TextAnnotation,
  canvasWidth: number,
  canvasHeight: number,
  scale: number = 1.0
): void {
  const x = annotation.x * canvasWidth;
  const y = annotation.y * canvasHeight;

  ctx.save();
  
  const scaledFontSize = annotation.fontSize * scale;
  
  // フォント名を設定（指定されている場合）
  if (annotation.fontName) {
    let fontFamily = annotation.fontName;
    // PDF.jsのフォント名から実際のフォント名を抽出
    // 例: "+Arial-Bold" → "Arial", "MSゴシック" → "MSゴシック"
    if (fontFamily.includes('+')) {
      const afterPlus = fontFamily.split('+')[1];
      if (afterPlus) {
        fontFamily = afterPlus;
      }
    }
    // ハイフンで分割するが、日本語フォント名（MSゴシック、明朝体など）は保持
    if (fontFamily.includes('-') && !fontFamily.match(/[ひらがなカタカナ漢字]/)) {
      // 英語フォント名の場合のみ分割（例: "Arial-Bold" → "Arial"）
      fontFamily = fontFamily.split('-')[0] || fontFamily;
    }
    // フォールバック（Arialのみ）
    if (!fontFamily || fontFamily === 'Arial') {
      fontFamily = 'sans-serif';
    }
    ctx.font = `${scaledFontSize}px ${fontFamily}`;
  } else {
    ctx.font = `${scaledFontSize}px sans-serif`;
  }
  ctx.fillStyle = annotation.color;
  ctx.textBaseline = 'top';
  
  // ユーザーが入力した改行（\n）で分割して、そのまま描画
  // 自動折り返しは行わない（ユーザーがShift+Enterで入力した改行をそのまま反映）
  const lines = annotation.text.split('\n');
  
  // 各行を描画
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * scaledFontSize * 1.2);
  });
  
  ctx.restore();
}

/**
 * 全テキスト注釈を再描画
 * @param scale フォントサイズのスケール（デフォルト: 1.0、サムネイル用に調整可能）
 */
export function redrawTextAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: TextAnnotation[],
  canvasWidth: number,
  canvasHeight: number,
  scale: number = 1.0
): void {
  for (const annotation of annotations) {
    drawTextAnnotation(ctx, annotation, canvasWidth, canvasHeight, scale);
  }
}

/**
 * テキスト注釈のIDを生成
 */
export function generateTextId(): string {
  return `text_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

