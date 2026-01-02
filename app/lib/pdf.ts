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

/**
 * PDFページのテキストレイヤーを生成（テキスト選択可能にする）
 */
export async function renderTextLayer(
  pdfPage: import('pdfjs-dist').PDFPageProxy,
  textLayerDiv: HTMLDivElement,
  viewport: import('pdfjs-dist').PageViewport
): Promise<void> {
  // 既存のテキストレイヤーをクリア
  textLayerDiv.innerHTML = '';
  textLayerDiv.style.width = `${viewport.width}px`;
  textLayerDiv.style.height = `${viewport.height}px`;

  try {
    const textContent = await pdfPage.getTextContent();
    const textItems = textContent.items;

    // テキストアイテムをspan要素として配置
    for (let i = 0; i < textItems.length; i++) {
      const item = textItems[i];
      if (!('str' in item) || !item.str) continue;

      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const pdfX = transform[4];
      const pdfY = transform[5];

      // PDF座標系からviewport座標系への変換
      // PDF座標系: 左下が原点、Y軸が上向き
      // viewport座標系: 左上が原点、Y軸が下向き
      const tx = pdfX;
      const ty = viewport.height - pdfY;

      // フォントサイズとスケールを取得
      const fontSize = (item as any).fontSize || 12;
      const scaleX = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1]);
      const scaleY = Math.sqrt(transform[2] * transform[2] + transform[3] * transform[3]);
      const actualFontSize = fontSize * Math.max(scaleX, scaleY);

      // テキストの幅を取得
      const width = (item as any).width || 0;
      const height = (item as any).height || actualFontSize;

      // span要素を作成
      const span = document.createElement('span');
      span.textContent = item.str;
      span.style.position = 'absolute';
      span.style.left = `${tx}px`;
      span.style.top = `${ty - height}px`; // ベースラインから上端に調整
      span.style.fontSize = `${actualFontSize}px`;
      span.style.fontFamily = (item as any).fontName || 'sans-serif';
      span.style.color = 'rgba(0, 0, 0, 0)'; // 完全に透明にして、canvasのテキストが見えるように
      span.style.cursor = 'text';
      span.style.userSelect = 'text';
      span.style.webkitUserSelect = 'text';
      span.style.setProperty('-moz-user-select', 'text');
      span.style.setProperty('-ms-user-select', 'text');
      span.style.whiteSpace = 'pre';
      span.style.lineHeight = '1';
      span.style.transformOrigin = '0% 0%';
      span.style.width = width > 0 ? `${width}px` : 'auto';
      span.style.height = `${height}px`;
      span.style.display = 'inline-block';
      span.style.verticalAlign = 'baseline';
      span.style.pointerEvents = 'auto'; // クリックイベントを受け取る

      // 回転を考慮
      const angle = Math.atan2(transform[1], transform[0]) * (180 / Math.PI);
      if (Math.abs(angle) > 0.1) {
        span.style.transform = `rotate(${angle}deg)`;
      }

      textLayerDiv.appendChild(span);
    }
  } catch (error) {
    console.error('テキストレイヤーの生成に失敗:', error);
  }
}

