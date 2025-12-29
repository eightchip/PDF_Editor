/**
 * PDF.jsの初期化とページレンダリング
 */

let pdfjsLib: typeof import('pdfjs-dist') | null = null;

/**
 * PDF.jsを動的に読み込む
 */
async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsLib) {
    return pdfjsLib;
  }

  // クライアント側でのみ実行
  if (typeof window === 'undefined') {
    throw new Error('PDF.js can only be used on the client side');
  }

  // Workerのパスを設定
  const pdfjs = await import('pdfjs-dist');
  
  // pdfjs-dist 5.xでは、Workerファイルのパスを適切に設定する必要がある
  // 本番環境ではCDNから読み込む方が確実
  if (typeof window !== 'undefined') {
    // バージョン番号を取得（pdfjs-dist 5.4.449を使用）
    const version = '5.4.449';
    
    // 本番環境ではCDNから読み込む（より確実）
    // pdfjs-dist 5.xでは、Workerファイルは.mjs形式
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
      // Vercelや本番環境ではCDNから読み込む
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
      console.log('PDF.js Worker: CDNから読み込み', pdfjs.GlobalWorkerOptions.workerSrc);
    } else {
      // 開発環境では、publicフォルダのWorkerファイルを使用
      // フォールバックとしてCDNも試す
      try {
        const workerUrl = new URL('/pdf.worker.min.js', window.location.origin).toString();
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        console.log('PDF.js Worker: ローカルファイルから読み込み', workerUrl);
      } catch (error) {
        console.warn('Workerファイルの設定に失敗、CDNから読み込みを試みます:', error);
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
      }
    }
  }

  pdfjsLib = pdfjs;
  return pdfjs;
}

/**
 * PDFドキュメントを読み込む
 */
export async function loadPDF(file: File) {
  const pdfjs = await loadPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  return await loadingTask.promise;
}

/**
 * PDFページをcanvasにレンダリング
 */
export async function renderPage(
  pdfPage: import('pdfjs-dist').PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number = 1.0,
  rotation: number = 0
): Promise<{ width: number; height: number }> {
  const viewport = pdfPage.getViewport({ scale, rotation });
  const context = canvas.getContext('2d');
  
  if (!context) {
    throw new Error('Failed to get canvas context');
  }

  // デバイスピクセル比を考慮
  const devicePixelRatio = window.devicePixelRatio || 1;
  const outputScale = devicePixelRatio;

  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  context.scale(outputScale, outputScale);

  const renderContext = {
    canvasContext: context,
    viewport: viewport,
    canvas: canvas,
  };

  await pdfPage.render(renderContext).promise;

  return {
    width: viewport.width,
    height: viewport.height,
  };
}

