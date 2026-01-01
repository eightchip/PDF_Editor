/**
 * OCR（光学文字認識）機能
 * Tesseract.jsを使用してPDFページからテキストを抽出
 */

import { createWorker } from 'tesseract.js';

export interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }>;
}

/**
 * Canvasから画像データを取得してOCR処理を実行
 * @param canvas OCR処理対象のCanvas要素
 * @param language OCR言語（デフォルト: 'jpn+eng'）
 * @returns OCR結果
 */
export async function performOCR(
  canvas: HTMLCanvasElement,
  language: string = 'jpn+eng'
): Promise<OCRResult> {
  try {
    // Tesseract.jsワーカーを作成
    const worker = await createWorker(language);
    
    // Canvasから画像データを取得
    const imageData = canvas.toDataURL('image/png');
    
    // OCR処理を実行
    const result = await worker.recognize(imageData);
    const data = result.data;
    
    // ワーカーを終了
    await worker.terminate();
    
    // 単語レベルの情報を取得
    // data.wordsが存在するか確認
    const words = ((data as any).words || []).map((word: any) => ({
      text: word.text || '',
      bbox: {
        x0: word.bbox?.x0 || 0,
        y0: word.bbox?.y0 || 0,
        x1: word.bbox?.x1 || 0,
        y1: word.bbox?.y1 || 0,
      },
      confidence: word.confidence || 0,
    }));
    
    return {
      text: data.text,
      confidence: data.confidence,
      words: words,
    };
  } catch (error) {
    console.error('OCR処理エラー:', error);
    throw new Error(`OCR処理に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * PDFページをCanvasにレンダリングしてOCR処理を実行
 * @param pdfPage PDF.jsのPDFPageProxyオブジェクト
 * @param scale レンダリングスケール（デフォルト: 2.0、高解像度でOCR精度向上）
 * @param language OCR言語（デフォルト: 'jpn+eng'）
 * @returns OCR結果
 */
export async function performOCROnPDFPage(
  pdfPage: import('pdfjs-dist').PDFPageProxy,
  scale: number = 2.0,
  language: string = 'jpn+eng'
): Promise<OCRResult> {
  // 一時的なCanvasを作成
  const canvas = document.createElement('canvas');
  const viewport = pdfPage.getViewport({ scale });
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to get canvas context');
  }
  
  // PDFページをCanvasにレンダリング
  const renderContext = {
    canvasContext: context,
    viewport: viewport,
    canvas: canvas,
  };
  
  await pdfPage.render(renderContext as any).promise;
  
  // OCR処理を実行
  return await performOCR(canvas, language);
}

/**
 * 複数ページのOCR処理を実行
 * @param pdfPages PDFページの配列
 * @param scale レンダリングスケール
 * @param language OCR言語
 * @param onProgress 進捗コールバック（pageNumber, totalPages）
 * @returns 各ページのOCR結果の配列
 */
export async function performOCROnMultiplePages(
  pdfPages: import('pdfjs-dist').PDFPageProxy[],
  scale: number = 2.0,
  language: string = 'jpn+eng',
  onProgress?: (pageNumber: number, totalPages: number) => void
): Promise<OCRResult[]> {
  const results: OCRResult[] = [];
  
  for (let i = 0; i < pdfPages.length; i++) {
    if (onProgress) {
      onProgress(i + 1, pdfPages.length);
    }
    
    const result = await performOCROnPDFPage(pdfPages[i], scale, language);
    results.push(result);
  }
  
  return results;
}

