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

  // Workerのパスを設定（Next.jsのpublicフォルダから読み込む）
  const pdfjs = await import('pdfjs-dist');
  // Next.jsではpublicフォルダのファイルがルートパスで提供される
  // pdfjs-dist 5.xではworkerファイルは.mjs形式だが、.jsとしても動作する
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '/pdf.worker.min.js',
    window.location.origin
  ).toString();

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

