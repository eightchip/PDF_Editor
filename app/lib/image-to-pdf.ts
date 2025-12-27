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
  const { width: imgWidth, height: imgHeight } = img;
  let width = imgWidth;
  let height = imgHeight;

  console.log('applyOrientation:', { orientation, imgWidth, imgHeight });

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

  // 向きに応じて変換を適用
  ctx.save();
  
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
      ctx.translate(height, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0, imgWidth, imgHeight);
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

  console.log('applyOrientation result:', { width, height });
  return { width, height };
}

/**
 * 画像ファイルをPDFに変換
 * @param imageFile 画像ファイル（PNG、JPEG、WebPなど）
 * @param manualRotation 手動回転角度（0, 90, 180, 270度）
 * @returns PDFのArrayBuffer
 */
export async function convertImageToPDF(imageFile: File, manualRotation: number = 0): Promise<ArrayBuffer> {
  // 画像を読み込む
  const imageUrl = URL.createObjectURL(imageFile);
  const img = new Image();
  
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = imageUrl;
  });

  // EXIF情報から向きを取得（JPEGのみ、手動回転がない場合のみ）
  let orientation = 1;
  const fileType = imageFile.type.toLowerCase();
  if (manualRotation === 0 && (fileType === 'image/jpeg' || fileType === 'image/jpg')) {
    try {
      orientation = await getImageOrientation(imageFile);
    } catch (error) {
      console.warn('EXIF情報の読み取りに失敗しました:', error);
    }
  }

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
  
  // PDFページのサイズを画像のサイズに合わせる（A4サイズを上限とする）
  const a4Width = 595;
  const a4Height = 842;
  
  // アスペクト比を保ちながらA4サイズに収める
  let pageWidth = pdfImageWidth;
  let pageHeight = pdfImageHeight;
  let imageWidth = pdfImageWidth;
  let imageHeight = pdfImageHeight;
  
  if (pageWidth > a4Width || pageHeight > a4Height) {
    const scale = Math.min(a4Width / pageWidth, a4Height / pageHeight);
    pageWidth = pageWidth * scale;
    pageHeight = pageHeight * scale;
    imageWidth = imageWidth * scale;
    imageHeight = imageHeight * scale;
  }
  
  // ページを作成（画像サイズに合わせる）
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  
  // 画像をページに配置（左上から）
  page.drawImage(pdfImage, {
    x: 0,
    y: 0,
    width: imageWidth,
    height: imageHeight,
  });
  
  // メモリを解放
  URL.revokeObjectURL(imageUrl);
  
  // PDFを保存
  const pdfBytes = await pdfDoc.save();
  return pdfBytes.buffer as ArrayBuffer;
}

