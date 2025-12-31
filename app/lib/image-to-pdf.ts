/**
 * 画像をPDFに変換するユーティリティ
 */

import { PDFDocument, rgb } from 'pdf-lib';

/**
 * EXIF情報から画像の向きを取得
 */
async function getImageOrientation(file: File): Promise<number> {
  // クライアント側でのみ実行
  if (typeof window === 'undefined') {
    return 1;
  }

  try {
    // exif-jsを動的にインポート（CommonJS形式なのでdefaultがない場合がある）
    const exifModule = await import('exif-js');
    const EXIF = (exifModule as any).default || exifModule;
    
    return new Promise((resolve, reject) => {
      try {
        EXIF.getData(file as any, function(this: any) {
          try {
            const orientation = EXIF.getTag(this, 'Orientation') || 1;
            console.log('EXIF Orientation:', orientation);
            resolve(orientation);
          } catch (err) {
            console.warn('EXIF tag取得エラー:', err);
            resolve(1);
          }
        });
      } catch (err) {
        console.warn('EXIF getDataエラー:', err);
        resolve(1);
      }
    });
  } catch (error) {
    console.warn('EXIF情報の読み取りに失敗しました:', error);
    return 1;
  }
}

/**
 * EXIF情報に基づいて画像を回転・反転させる
 */
function applyOrientation(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  orientation: number
): { width: number; height: number } {
  // 画像の実際のサイズを取得（naturalWidth/naturalHeightを使用）
  // 注意: ブラウザは画像を読み込む際にEXIF情報を自動的に適用しないため、
  // naturalWidth/naturalHeightは常に元の画像サイズを返す
  const imgWidth = img.naturalWidth || img.width;
  const imgHeight = img.naturalHeight || img.height;
  let width = imgWidth;
  let height = imgHeight;

  console.log('applyOrientation:', { orientation, imgWidth, imgHeight, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });

  // 向きに応じてcanvasサイズを調整
  switch (orientation) {
    case 5: // 時計回り90度回転 + 水平反転
    case 6: // 時計回り90度回転
    case 7: // 反時計回り90度回転 + 水平反転
    case 8: // 反時計回り90度回転
      // 90度回転する場合は幅と高さを入れ替え
      width = imgHeight;
      height = imgWidth;
      break;
    default:
      // その他の場合は元のサイズ
      width = imgWidth;
      height = imgHeight;
      break;
  }

  canvas.width = width;
  canvas.height = height;

  // canvasをクリア
  ctx.clearRect(0, 0, width, height);
  
  // 画像の実際のサイズを確認（naturalWidth/naturalHeightを使用）
  // 注意: img.widthとimg.heightは表示サイズで、naturalWidth/naturalHeightが実際のサイズ
  const naturalWidth = img.naturalWidth || imgWidth;
  const naturalHeight = img.naturalHeight || imgHeight;
  console.log('画像の実際のサイズ:', { naturalWidth, naturalHeight, imgWidth, imgHeight, orientation });

  // 向きに応じて変換を適用
  // 注意: ctx.save()の前に変換を適用する必要がある
  ctx.save();
  
  // デバッグ: 変換前のcanvas状態を確認
  if (orientation === 6) {
    console.log('EXIF Orientation 6: 変換前のcanvas状態', {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      imgWidth,
      imgHeight,
      width,
      height
    });
  }
  
  // デバッグ: 変換前の状態を確認
  if (orientation === 6) {
    console.log('EXIF Orientation 6: 変換前のcanvas状態', {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      imgWidth,
      imgHeight,
      width,
      height
    });
  }
  
  switch (orientation) {
    case 2: // 水平反転
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
      break;
    case 3: // 180度回転
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
      break;
    case 4: // 垂直反転
      ctx.translate(0, height);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
      break;
    case 5: // 時計回り90度回転 + 水平反転
      ctx.translate(height, 0);
      ctx.rotate(Math.PI / 2);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
      break;
    case 6: // 時計回り90度回転（最も一般的）
      // 回転後のサイズ: width = imgHeight, height = imgWidth
      // EXIF Orientation 6: 時計回り90度回転
      // 画像を時計回りに90度回転させる
      console.log('EXIF Orientation 6: 回転処理開始', { 
        imgWidth, 
        imgHeight, 
        canvasWidth: width, 
        canvasHeight: height,
        translateX: height,
        translateY: 0,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      });
      // EXIF Orientation: 6 の場合、画像を時計回りに90度回転
      // 正しい実装: 原点を右端（height位置）に移動してから時計回り90度回転
      // その後、画像を左上（0, 0）から描画
      // 注意: heightは回転後のcanvasの高さ（元のimgWidth）
      // EXIF Orientation: 6 の場合、画像を時計回りに90度回転
      // 正しい実装: 原点を右端（height位置）に移動してから時計回り90度回転
      // その後、画像を左上（0, 0）から描画
      // 注意: heightは回転後のcanvasの高さ（元のimgWidth）
      // デバッグ: 変換前の状態を確認
      const beforeTransform = ctx.getTransform();
      console.log('EXIF Orientation 6: 変換前のtransform', beforeTransform);
      
      // EXIF Orientation: 6 の場合、画像を時計回りに90度回転
      // 正しい実装: 原点を右端（height位置）に移動してから時計回り90度回転
      // その後、画像を左上（0, 0）から描画
      // 注意: heightは回転後のcanvasの高さ（元のimgWidth）
      // 標準的な実装: 原点を右端に移動してから回転
      ctx.translate(height, 0);
      ctx.rotate(Math.PI / 2);
      
      // デバッグ: 変換後の状態を確認
      const afterTransform = ctx.getTransform();
      console.log('EXIF Orientation 6: 変換後のtransform', afterTransform);
      
      // 画像を描画（元のサイズで）
      // 注意: 画像を描画する際、元の画像サイズ（imgWidth x imgHeight）を使用
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
      
      // デバッグ: 描画後のcanvasの内容を確認
      const imageData = ctx.getImageData(0, 0, Math.min(100, width), Math.min(100, height));
      console.log('EXIF Orientation 6: 描画後のcanvas内容（最初の100x100ピクセル）', {
        dataLength: imageData.data.length,
        hasContent: imageData.data.some((v, i) => i % 4 !== 3 && v !== 0) // アルファチャンネル以外に非ゼロ値があるか
      });
      
      console.log('EXIF Orientation 6: 回転処理完了', {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        imageDataURL: canvas.toDataURL('image/png').substring(0, 50) + '...'
      });
      break;
    case 7: // 反時計回り90度回転 + 水平反転
      ctx.translate(0, width);
      ctx.rotate(-Math.PI / 2);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
      break;
    case 8: // 反時計回り90度回転
      ctx.translate(0, width);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
      break;
    default: // 1: 通常
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
      break;
  }

  ctx.restore();

  console.log('applyOrientation result:', { width, height, canvasWidth: canvas.width, canvasHeight: canvas.height });
  return { width, height };
}

/**
 * 画像ファイルをPDFに変換
 * @param imageFile 画像ファイル（PNG、JPEG、WebPなど）
 * @param manualRotation 手動回転角度（0, 90, 180, 270度）
 * @returns PDFのArrayBuffer
 */
export async function convertImageToPDF(imageFile: File, manualRotation: number = 0): Promise<ArrayBuffer> {
  // EXIF情報から向きを取得（JPEGのみ、手動回転がない場合のみ）
  // 画像を読み込む前にEXIF情報を取得
  // 一時的にEXIF Orientationを無視して進める
  let orientation = 1; // 常に1（通常）として扱う
  const fileType = imageFile.type.toLowerCase();
  // EXIF Orientationを無視するため、以下のコードをコメントアウト
  /*
  if (manualRotation === 0 && (fileType === 'image/jpeg' || fileType === 'image/jpg')) {
    try {
      orientation = await getImageOrientation(imageFile);
    } catch (error) {
      console.warn('EXIF情報の読み取りに失敗しました:', error);
    }
  }
  */
  console.log('EXIF Orientationを無視して進めます。orientation =', orientation);

  // 手動回転を適用
  if (manualRotation !== 0) {
    // 手動回転をorientationに変換
    if (manualRotation === 90) {
      orientation = 6; // 時計回り90度
    } else if (manualRotation === 180) {
      orientation = 3; // 180度
    } else if (manualRotation === 270) {
      orientation = 8; // 反時計回り90度
    }
  }

  // 画像を読み込む
  const imageUrl = URL.createObjectURL(imageFile);
  const img = new Image();
  
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = imageUrl;
  });

  // 手動回転を適用
  if (manualRotation !== 0) {
    // 手動回転をorientationに変換
    if (manualRotation === 90) {
      orientation = 6; // 時計回り90度
    } else if (manualRotation === 180) {
      orientation = 3; // 180度
    } else if (manualRotation === 270) {
      orientation = 8; // 反時計回り90度
    }
  }

  // canvasで画像を正しい向きに修正
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // 向きを適用して画像を描画
  const { width: correctedWidth, height: correctedHeight } = applyOrientation(
    canvas,
    ctx,
    img,
    orientation
  );

  console.log('Canvasサイズ確認:', { 
    canvasWidth: canvas.width, 
    canvasHeight: canvas.height, 
    correctedWidth, 
    correctedHeight,
    imgWidth: img.width,
    imgHeight: img.height,
    orientation
  });

  // デバッグ: canvasの内容を確認（開発環境のみ）
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    // canvasの内容を一時的に表示して確認
    const debugImg = document.createElement('img');
    debugImg.src = canvas.toDataURL('image/png');
    debugImg.style.position = 'fixed';
    debugImg.style.top = '10px';
    debugImg.style.right = '10px';
    debugImg.style.width = '200px';
    debugImg.style.height = 'auto';
    debugImg.style.border = '2px solid red';
    debugImg.style.zIndex = '99999';
    debugImg.onload = () => {
      console.log('デバッグ画像を表示しました（右上）');
      setTimeout(() => {
        if (debugImg.parentNode) {
          debugImg.parentNode.removeChild(debugImg);
        }
      }, 3000);
    };
    document.body.appendChild(debugImg);
  }

  // canvasから画像データを取得（PNG形式で品質を保持）
  const imageData = canvas.toDataURL('image/png');
  const base64Data = imageData.split(',')[1];
  const binaryString = atob(base64Data);
  const pngBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pngBytes[i] = binaryString.charCodeAt(i);
  }

  // PDFドキュメントを作成
  const pdfDoc = await PDFDocument.create();
  
  // 画像をPDFに埋め込む
  const pdfImage = await pdfDoc.embedPng(pngBytes);
  const { width: pdfImageWidth, height: pdfImageHeight } = pdfImage.size();
  
  console.log('PDF画像サイズ:', { pdfImageWidth, pdfImageHeight, correctedWidth, correctedHeight });
  
  // PDFページのサイズを画像のサイズに合わせる（A4サイズを上限とする）
  // 注意: canvasから取得したPNG画像のサイズは、canvasのサイズと一致するはず
  // しかし、念のため両方を確認して使用
  const a4Width = 595;
  const a4Height = 842;
  
  // アスペクト比を保ちながらA4サイズに収める
  // canvasのサイズ（correctedWidth/Height）を使用
  let pageWidth = correctedWidth;
  let pageHeight = correctedHeight;
  // PDFに埋め込まれた画像のサイズを使用（canvasサイズと一致するはず）
  let imageWidth = pdfImageWidth;
  let imageHeight = pdfImageHeight;
  
  // ページサイズがA4を超える場合はスケールダウン
  if (pageWidth > a4Width || pageHeight > a4Height) {
    const scale = Math.min(a4Width / pageWidth, a4Height / pageHeight);
    pageWidth = pageWidth * scale;
    pageHeight = pageHeight * scale;
    imageWidth = imageWidth * scale;
    imageHeight = imageHeight * scale;
  }
  
  console.log('PDFページサイズ:', { pageWidth, pageHeight, imageWidth, imageHeight });
  
  // ページを作成（画像サイズに合わせる）
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  
  // 画像をページに配置（PDF座標系は左下が原点、Y軸は上向き）
  // 画像をページ全体にフィットさせる（余白なし）
  // 画像のサイズがページのサイズと一致するようにする
  // y: 0 で画像の下部をページの下部に配置（これで画像がページ全体を埋める）
  page.drawImage(pdfImage, {
    x: 0,
    y: 0, // 画像の下部をページの下部に配置
    width: pageWidth, // ページ幅に合わせる
    height: pageHeight, // ページ高さに合わせる
  });
  
  console.log('PDF画像配置完了:', { 
    x: 0, 
    y: 0, 
    width: pageWidth, 
    height: pageHeight,
    pageSize: [pageWidth, pageHeight],
    imageSize: [pdfImageWidth, pdfImageHeight]
  });
  
  // メモリを解放
  URL.revokeObjectURL(imageUrl);
  
  // PDFを保存
  const pdfBytes = await pdfDoc.save();
  return pdfBytes.buffer as ArrayBuffer;
}

