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
  
  // Workerファイルの読み込み方法（優先順位順）
  if (typeof window !== 'undefined') {
    const version = '5.4.449';
    
    // 方法1: publicフォルダのWorkerファイルを使用（開発環境で確実）
    const localWorkerUrl = new URL('/pdf.worker.min.js', window.location.origin).toString();
    
    // 方法2: unpkg CDNから読み込む（本番環境で確実）
    const unpkgWorkerUrl = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
    
    // 方法3: jsdelivr CDNから読み込む（フォールバック）
    const jsdelivrWorkerUrl = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
    
    // 開発環境ではローカルファイルを優先、本番環境ではunpkg CDNを使用
    if (process.env.NODE_ENV === 'development') {
      pdfjs.GlobalWorkerOptions.workerSrc = localWorkerUrl;
      console.log('PDF.js Worker: ローカルファイルから読み込み', localWorkerUrl);
    } else {
      // 本番環境ではunpkg CDNを使用（より確実）
      pdfjs.GlobalWorkerOptions.workerSrc = unpkgWorkerUrl;
      console.log('PDF.js Worker: unpkg CDNから読み込み', unpkgWorkerUrl);
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

