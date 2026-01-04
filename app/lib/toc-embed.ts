/**
 * 目次埋め込み機能
 * 目次ページを生成してPDFに埋め込む
 */

import { PDFDocument, rgb, PDFFont, PDFPage } from 'pdf-lib';
import type { TableOfContentsEntry } from './table-of-contents';

/**
 * 日本語テキストを画像として描画するためのヘルパー関数
 */
async function drawJapaneseTextAsImage(
  pdfDoc: PDFDocument,
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontFamily: string = 'sans-serif',
  color: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 }
): Promise<void> {
  // ブラウザ環境でない場合はスキップ
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // フォントを設定
    ctx.font = `${fontSize}px ${fontFamily}`;
    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const textHeight = fontSize * 1.2;

    // キャンバスサイズを設定（余白を含む）
    const padding = 2;
    canvas.width = textWidth + padding * 2;
    canvas.height = textHeight + padding * 2;

    // 背景を透明にする（白ではなく透明）
    // clearRectだけでは不十分なので、明示的に透明にする
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 背景を透明にする（デフォルトで透明だが、念のため）

    // テキストを描画
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
    ctx.textBaseline = 'top';
    ctx.fillText(text, padding, padding);

    // 画像データを取得（透明背景を保持）
    const imageData = canvas.toDataURL('image/png');
    const imageDataBase64 = imageData.split(',')[1];
    const imageBytes = Uint8Array.from(atob(imageDataBase64), c => c.charCodeAt(0));

    // PDFに画像を埋め込む
    // PDF座標系は左下が原点でY軸が上向きなので、Y座標を変換する必要がある
    const textImage = await pdfDoc.embedPng(imageBytes);
    const pageHeight = page.getHeight();
    const imageHeight = textHeight + padding * 2;
    // Y座標を反転：Canvas座標系（上から下）→ PDF座標系（下から上）
    // yはCanvas座標系での上端位置、PDF座標系では下端位置に変換
    // drawImageのyは画像の左下隅の位置を指定する
    // yはCanvas座標系での上端位置なので、PDF座標系では pageHeight - y - imageHeight になる
    const pdfY = pageHeight - y - imageHeight;
    
    page.drawImage(textImage, {
      x: x - padding,
      y: pdfY,
      width: textWidth + padding * 2,
      height: imageHeight,
    });
  } catch (error) {
    console.warn('日本語テキストの画像化に失敗:', error);
  }
}

export interface TOCEmbedOptions {
  orientation: 'portrait' | 'landscape'; // 縦横
  columns: number; // 段組み（1, 2, 3など）
  marginTop: number; // 上余白（mm）
  marginBottom: number; // 下余白（mm）
  marginLeft: number; // 左余白（mm）
  marginRight: number; // 右余白（mm）
  fontSize: number; // フォントサイズ（pt）
  lineHeight: number; // 行間（pt）
  pageNumberFontSize: number; // ページ番号のフォントサイズ（pt）
}

const DEFAULT_OPTIONS: TOCEmbedOptions = {
  orientation: 'portrait',
  columns: 1,
  marginTop: 20,
  marginBottom: 20,
  marginLeft: 20,
  marginRight: 20,
  fontSize: 10,
  lineHeight: 14,
  pageNumberFontSize: 10,
};

/**
 * mmをポイントに変換
 */
function mmToPt(mm: number): number {
  return mm * 2.83465;
}

/**
 * 目次ページを生成
 * @param entries 目次エントリ
 * @param options オプション
 * @returns 生成されたPDFドキュメント
 */
export async function generateTOCPages(
  entries: TableOfContentsEntry[],
  options: Partial<TOCEmbedOptions> = {}
): Promise<PDFDocument> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const tocDoc = await PDFDocument.create();
  
  // フォントを埋め込む
  const helveticaFont = await tocDoc.embedFont('Helvetica');
  const helveticaBoldFont = await tocDoc.embedFont('Helvetica-Bold');
  
  // ページサイズを決定（A4）
  const a4Width = mmToPt(210);
  const a4Height = mmToPt(297);
  
  const pageWidth = opts.orientation === 'portrait' ? a4Width : a4Height;
  const pageHeight = opts.orientation === 'portrait' ? a4Height : a4Width;
  
  // 余白をポイントに変換
  const marginTop = mmToPt(opts.marginTop);
  const marginBottom = mmToPt(opts.marginBottom);
  const marginLeft = mmToPt(opts.marginLeft);
  const marginRight = mmToPt(opts.marginRight);
  
  // 利用可能な領域を計算
  const contentWidth = pageWidth - marginLeft - marginRight;
  const contentHeight = pageHeight - marginTop - marginBottom;
  // 列間の余白を考慮（列数が2以上の場合は列間に10ptの余白を設ける）
  const columnGap = opts.columns > 1 ? 10 : 0;
  const columnWidth = (contentWidth - (columnGap * (opts.columns - 1))) / opts.columns;
  
  // エントリをフィルタリング（「見出しなし」を除外）
  const validEntries = entries.filter(e => e.title !== '（見出しなし）' && e.title.trim() !== '');
  
  if (validEntries.length === 0) {
    // エントリがない場合は空のページを作成
    const page = tocDoc.addPage([pageWidth, pageHeight]);
    await drawJapaneseTextAsImage(
      tocDoc,
      page,
      '目次',
      marginLeft,
      marginTop, // Canvas座標系でのY座標（上から）
      16,
      'sans-serif',
      { r: 0, g: 0, b: 0 }
    );
    return tocDoc;
  }
  
  // エントリを行に分割して配置
  // currentYはCanvas座標系（上から下）で管理する
  let currentPage: PDFPage | null = null;
  let currentColumn = 0;
  // Canvas座標系でのY座標（上から下、上端が0）
  // タイトルの下に余白を設ける位置を計算
  const titleHeight = 16 * 1.2; // タイトルの高さ
  const titleBottomMargin = 10; // タイトルとエントリの間の余白
  let currentY = marginTop + titleHeight + titleBottomMargin; // Canvas座標系でのY座標
  let entryIndex = 0;
  
  // タイトル「目次」を描画
  const drawTitle = async (page: PDFPage) => {
    // Canvas座標系でのY座標（上から下）
    await drawJapaneseTextAsImage(
      tocDoc,
      page,
      '目次',
      marginLeft,
      marginTop, // Canvas座標系でのY座標（上から）
      16,
      'sans-serif',
      { r: 0, g: 0, b: 0 }
    );
  };
  
  // 新しいページを作成
  const createNewPage = async () => {
    currentPage = tocDoc.addPage([pageWidth, pageHeight]);
    currentColumn = 0;
    // Canvas座標系でのY座標をリセット（タイトルの下に余白を設ける）
    currentY = marginTop + titleHeight + titleBottomMargin;
    await drawTitle(currentPage);
  };
  
  // 最初のページを作成
  await createNewPage();
  
  // 各エントリを描画
  for (const entry of validEntries) {
    // 現在の列のX座標を計算（列間の余白を考慮）
    const columnGap = opts.columns > 1 ? 10 : 0;
    const columnX = marginLeft + (currentColumn * (columnWidth + columnGap));
    
    // テキストの幅を計算
    const titleText = entry.title;
    const pageText = `P${String(entry.page).padStart(2, '0')}`;
    
    // テキストの幅を測定（日本語対応：Canvasを使用）
    let titleWidth = 0;
    let displayTitle = titleText;
    
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = `${opts.fontSize}px sans-serif`;
        titleWidth = ctx.measureText(titleText).width;
        
        // ページ番号の幅を計算
        const pageWidth_text = helveticaFont.widthOfTextAtSize(pageText, opts.pageNumberFontSize);
        const availableWidth = columnWidth - pageWidth_text - 20; // 20ptの余裕
        
        // タイトルが長い場合は切り詰める
        if (titleWidth > availableWidth) {
          let truncated = '';
          for (let i = 0; i < titleText.length; i++) {
            const testText = truncated + titleText[i];
            const testWidth = ctx.measureText(testText).width;
            if (testWidth > availableWidth - 10) { // 10ptの余裕
              truncated += '...';
              break;
            }
            truncated = testText;
          }
          displayTitle = truncated;
          titleWidth = ctx.measureText(displayTitle).width;
        }
      }
    } else {
      // サーバーサイドの場合は簡易計算
      titleWidth = titleText.length * opts.fontSize * 0.6;
    }
    
    const pageWidth_text = helveticaFont.widthOfTextAtSize(pageText, opts.pageNumberFontSize);
    
    // 次の行に収まるかチェック（Canvas座標系で下方向に移動）
    // 下端の位置を計算（Canvas座標系では下方向が正）
    const bottomY = pageHeight - marginBottom; // Canvas座標系での下端位置
    if (currentY + opts.lineHeight > bottomY) {
      // 次の列に移動
      currentColumn++;
      if (currentColumn >= opts.columns) {
        // 次のページに移動
        await createNewPage();
      } else {
        // 同じページの次の列（Canvas座標系でY座標をリセット）
        currentY = marginTop + titleHeight + titleBottomMargin;
      }
    }
    
    // タイトルを描画（日本語対応）
    await drawJapaneseTextAsImage(
      tocDoc,
      currentPage!,
      displayTitle,
      columnX,
      currentY,
      opts.fontSize,
      'sans-serif',
      { r: 0, g: 0, b: 0 }
    );
    
    // ドットリーダーを描画（省略）
    // ページ番号を右揃えで描画（英数字のみなので通常のdrawTextを使用）
    // PDF座標系ではY座標を変換する必要がある
    const pageX = columnX + columnWidth - pageWidth_text - 10;
    // PDF座標系でのY座標（drawTextはベースライン位置を指定）
    // currentYはCanvas座標系（上から下）なので、PDF座標系（下から上）に変換
    // drawTextのyはベースラインの位置を指定するので、テキストの高さを考慮
    // currentYはCanvas座標系での上端位置、PDF座標系では pageHeight - currentY が上端位置
    // ベースラインは上端から少し下にあるので、フォントサイズの約0.8倍下に配置
    const pdfY = pageHeight - currentY - opts.pageNumberFontSize * 0.2;
    currentPage!.drawText(pageText, {
      x: pageX,
      y: pdfY,
      size: opts.pageNumberFontSize,
      font: helveticaFont,
      color: rgb(0, 0, 0),
    });
    
    // 次の行に移動（Canvas座標系では下に移動するので加算）
    currentY += opts.lineHeight;
    entryIndex++;
  }
  
  return tocDoc;
}

/**
 * PDFに目次ページを埋め込む
 * @param originalPdfBytes 元のPDFバイト
 * @param tocEntries 目次エントリ
 * @param insertPageNumber 挿入するページ番号（1ベース、デフォルト2）
 * @param options オプション
 * @returns 埋め込み済みPDFのバイト
 */
export async function embedTOCIntoPDF(
  originalPdfBytes: ArrayBuffer,
  tocEntries: TableOfContentsEntry[],
  insertPageNumber: number = 2,
  options: Partial<TOCEmbedOptions> = {}
): Promise<Uint8Array> {
  // 目次ページ数を取得（先に生成してページ数を確認）
  const tempTocDoc = await generateTOCPages(tocEntries, options);
  const tocPageCount = tempTocDoc.getPageCount();
  
  // ページ番号を再計算（目次ページを埋め込むと、元のページ番号がずれる）
  // 例：2ページ目に目次を1ページ埋め込む場合
  // 元の2ページ目 → 3ページ目（+1）
  // 元の3ページ目 → 4ページ目（+1）
  // したがって、insertPageNumber以降のページ番号は +tocPageCount する必要がある
  const adjustedEntries = tocEntries.map(entry => {
    // 挿入位置より前のページは変更なし、挿入位置以降のページは目次ページ数分だけ増やす
    if (entry.page < insertPageNumber) {
      return entry; // 挿入位置より前のページは変更なし
    } else {
      return {
        ...entry,
        page: entry.page + tocPageCount, // 挿入位置以降のページは目次ページ数分だけ増やす
      };
    }
  });
  
  // 目次ページを再生成（調整後のページ番号で）
  const tocDoc = await generateTOCPages(adjustedEntries, options);
  
  // 元のPDFを読み込む
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  
  // 目次ページを取得
  const tocPages = tocDoc.getPages();
  
  if (tocPages.length === 0) {
    throw new Error('目次ページが生成されませんでした');
  }
  
  // 指定された位置に挿入（insertPageNumberは1ベース、insertPageは0ベース）
  const insertIndex = Math.max(0, Math.min(insertPageNumber - 1, pdfDoc.getPageCount()));
  
  // 目次ページを元のPDFにコピーして挿入（最初のページから順に）
  const copiedPages = await pdfDoc.copyPages(tocDoc, tocPages.map((_, i) => i));
  
  // 逆順で挿入（最初のページが最後に来るように）
  for (let i = copiedPages.length - 1; i >= 0; i--) {
    pdfDoc.insertPage(insertIndex, copiedPages[i]);
  }
  
  // PDFを保存
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

