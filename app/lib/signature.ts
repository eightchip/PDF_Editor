/**
 * 電子署名・承認機能
 */

import { PDFDocument, PDFPage, rgb } from 'pdf-lib';

export interface Signature {
  id: string;
  signerName: string; // 署名者名
  signerEmail?: string; // 署名者メールアドレス
  signDate: Date; // 署名日時
  signatureImage?: string; // 署名画像（Base64）
  signatureText?: string; // 署名テキスト（画像がない場合）
  position: {
    pageNumber: number;
    x: number; // 0..1 の比率
    y: number; // 0..1 の比率
    width: number; // 0..1 の比率
    height: number; // 0..1 の比率
  };
  reason?: string; // 署名理由
  location?: string; // 署名場所
  imageWidth?: number; // 署名画像の幅（%、デフォルト100）
  imageHeight?: number; // 署名画像の高さ（%、デフォルト100）
  fontSize?: number; // フォントサイズ（デフォルト10）
}

export interface ApprovalWorkflow {
  id: string;
  documentId: string;
  approvers: ApprovalStep[];
  currentStep: number; // 現在の承認ステップ
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  createdAt: Date;
  completedAt?: Date;
}

export interface ApprovalStep {
  stepNumber: number;
  approverName: string;
  approverEmail?: string;
  role?: string; // 役職（例: "部長", "経理担当"）
  required: boolean; // 必須承認者かどうか
  status: 'pending' | 'approved' | 'rejected';
  signature?: Signature;
  approvedAt?: Date;
  comment?: string; // 承認コメント
}

/**
 * PDFに署名を追加
 */
export async function addSignatureToPDF(
  pdfDoc: PDFDocument,
  signature: Signature
): Promise<void> {
  const pages = pdfDoc.getPages();
  const pageIndex = signature.position.pageNumber - 1;
  
  if (pageIndex < 0 || pageIndex >= pages.length) {
    throw new Error(`無効なページ番号: ${signature.position.pageNumber}`);
  }
  
  const page = pages[pageIndex];
  const { width: pageWidth, height: pageHeight } = page.getSize();
  
  // 座標をPDF座標系に変換
  const x = signature.position.x * pageWidth;
  const y = signature.position.y * pageHeight;
  const width = signature.position.width * pageWidth;
  const height = signature.position.height * pageHeight;
  
  // 署名ボックスを描画（外枠は既存のフォーマットの線と重ならないように、少し内側に描画）
  const borderOffset = 2; // 外枠のオフセット（既存の線と重ならないように）
  page.drawRectangle({
    x: x + borderOffset,
    y: y + borderOffset,
    width: width - borderOffset * 2,
    height: height - borderOffset * 2,
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
    color: rgb(1, 1, 1), // 白背景
  });
  
  // 署名画像がある場合は埋め込み
  if (signature.signatureImage) {
    try {
      // Base64画像をデコード
      let imageData = signature.signatureImage;
      if (imageData.includes(',')) {
        imageData = imageData.split(',')[1];
      }
      
      // Base64デコード
      const binaryString = atob(imageData);
      const imageBytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        imageBytes[i] = binaryString.charCodeAt(i);
      }
      
      // 画像を埋め込み（PNGまたはJPEGを判定）
      let pdfImage;
      if (signature.signatureImage.startsWith('data:image/png') || signature.signatureImage.includes('image/png')) {
        pdfImage = await pdfDoc.embedPng(imageBytes);
      } else if (signature.signatureImage.startsWith('data:image/jpeg') || signature.signatureImage.startsWith('data:image/jpg') || signature.signatureImage.includes('image/jpeg') || signature.signatureImage.includes('image/jpg')) {
        pdfImage = await pdfDoc.embedJpg(imageBytes);
      } else {
        // デフォルトはPNGとして扱う
        pdfImage = await pdfDoc.embedPng(imageBytes);
      }
      
      // 画像のアスペクト比を保持してサイズを計算
      const imageAspectRatio = pdfImage.width / pdfImage.height;
      const boxAspectRatio = (width - 10) / (height - 10);
      
      // ユーザーが指定したサイズ比率を適用
      const imageWidthRatio = (signature.imageWidth || 100) / 100;
      const imageHeightRatio = (signature.imageHeight || 100) / 100;
      
      let drawWidth = (width - 10) * imageWidthRatio;
      let drawHeight = (height - 10) * imageHeightRatio;
      
      // アスペクト比を保持しながら、指定されたサイズ比率内に収める
      if (imageAspectRatio > boxAspectRatio) {
        // 画像の方が横長 → 幅に合わせる
        const adjustedHeight = drawWidth / imageAspectRatio;
        if (adjustedHeight > drawHeight) {
          drawWidth = drawHeight * imageAspectRatio;
        } else {
          drawHeight = adjustedHeight;
        }
      } else {
        // 画像の方が縦長 → 高さに合わせる
        const adjustedWidth = drawHeight * imageAspectRatio;
        if (adjustedWidth > drawWidth) {
          drawHeight = drawWidth / imageAspectRatio;
        } else {
          drawWidth = adjustedWidth;
        }
      }
      
      // 画像を中央に配置（PDF座標系は左下が原点）
      const drawX = x + (width - drawWidth) / 2;
      // 画像を署名ボックスの上部に配置（署名者名の下に表示）
      const drawY = y + height - drawHeight - 20; // 上端から画像の高さ分下げて、さらに20px下げる（テキスト用のスペース）
      
      console.log('署名画像描画:', {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
        boxX: x,
        boxY: y,
        boxWidth: width,
        boxHeight: height,
      });
      
      // 画像を描画
      page.drawImage(pdfImage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
      });
    } catch (error) {
      console.error('署名画像の埋め込みに失敗:', error);
      console.error('エラー詳細:', error instanceof Error ? error.message : String(error));
      console.error('署名画像データ:', signature.signatureImage?.substring(0, 100));
    }
  }
  
  // 署名情報をテキストで表示
  // 日本語文字をサポートするため、テキストを画像として描画
  const fontSize = signature.fontSize || 10;
  const lineHeight = fontSize * 1.3;
  
  // PDF座標系ではyは下から上に向かって増える
  // 署名ボックスの下端はy、上端はy + height
  // テキストは署名ボックスの下部に配置
  // 署名画像がある場合は、画像の下にテキストを配置
  // 署名画像がない場合は、署名ボックスの中央から下にテキストを配置
  let textY: number;
  if (signature.signatureImage) {
    // 画像がある場合、画像の下（署名ボックスの下部）にテキストを配置
    textY = y + 10; // 下端から少し上に
  } else {
    // 画像がない場合、中央より少し下に配置
    textY = y + height / 2 - 20; // 中央から少し上に
  }
  
  console.log('署名テキスト描画:', {
    signerName: signature.signerName,
    textY,
    boxX: x,
    boxY: y,
    boxHeight: height,
    hasImage: !!signature.signatureImage,
  });
  
  // 署名者名を画像として描画（日本語対応）
  if (signature.signerName) {
    try {
      // Canvasでテキストを画像化
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = `${fontSize}px Arial, sans-serif`;
        const textMetrics = ctx.measureText(signature.signerName);
        const textWidth = textMetrics.width;
        const textHeight = fontSize * 1.2;
        
        canvas.width = textWidth + 10;
        canvas.height = textHeight + 10;
        
        // 背景を透明に
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // テキストを描画
        ctx.font = `${fontSize}px Arial, sans-serif`;
        ctx.fillStyle = '#000000';
        ctx.fillText(signature.signerName, 5, fontSize + 5);
        
        // CanvasをPNG画像として取得
        const imageData = canvas.toDataURL('image/png');
        const imageDataBase64 = imageData.split(',')[1];
        const imageBytes = Uint8Array.from(atob(imageDataBase64), c => c.charCodeAt(0));
        
        // PDFに画像として埋め込み
        const textImage = await pdfDoc.embedPng(imageBytes);
        page.drawImage(textImage, {
          x: x + 5,
          y: textY,
          width: textWidth + 10,
          height: textHeight + 10,
        });
        
        textY -= lineHeight;
      }
    } catch (error) {
      console.warn('署名者名の画像化に失敗、テキスト描画を試行:', error);
      // フォールバック: ASCII文字のみの場合のみテキスト描画を試行
      try {
        const font = await pdfDoc.embedFont('Helvetica');
        // ASCII文字のみかチェック
        if (/^[\x00-\x7F]*$/.test(signature.signerName)) {
          page.drawText(signature.signerName, {
            x: x + 5,
            y: textY,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          });
          textY -= lineHeight;
        }
      } catch (fallbackError) {
        console.error('署名者名の描画に失敗:', fallbackError);
      }
    }
  }
  
  // メールアドレスを画像として描画（日本語対応）
  if (signature.signerEmail) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const emailText = `メール: ${signature.signerEmail}`;
        ctx.font = `${fontSize - 1}px Arial, sans-serif`;
        const textMetrics = ctx.measureText(emailText);
        const textWidth = textMetrics.width;
        const textHeight = (fontSize - 1) * 1.2;
        
        canvas.width = textWidth + 10;
        canvas.height = textHeight + 10;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSize - 1}px Arial, sans-serif`;
        ctx.fillStyle = '#808080';
        ctx.fillText(emailText, 5, fontSize - 1 + 5);
        
        const imageData = canvas.toDataURL('image/png');
        const imageDataBase64 = imageData.split(',')[1];
        const imageBytes = Uint8Array.from(atob(imageDataBase64), c => c.charCodeAt(0));
        
        const textImage = await pdfDoc.embedPng(imageBytes);
        page.drawImage(textImage, {
          x: x + 5,
          y: textY,
          width: textWidth + 10,
          height: textHeight + 10,
        });
        textY -= lineHeight;
      }
    } catch (error) {
      console.warn('メールアドレスの画像化に失敗:', error);
    }
  }
  
  // 署名日時を画像として描画（日本語対応）
  const signDateStr = signature.signDate.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const dateText = `署名日時: ${signDateStr}`;
      ctx.font = `${fontSize - 1}px Arial, sans-serif`;
      const textMetrics = ctx.measureText(dateText);
      const textWidth = textMetrics.width;
      const textHeight = (fontSize - 1) * 1.2;
      
      canvas.width = textWidth + 10;
      canvas.height = textHeight + 10;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${fontSize - 1}px Arial, sans-serif`;
      ctx.fillStyle = '#000000'; // 日付を黒に変更
      ctx.fillText(dateText, 5, fontSize - 1 + 5);
      
      const imageData = canvas.toDataURL('image/png');
      const imageDataBase64 = imageData.split(',')[1];
      const imageBytes = Uint8Array.from(atob(imageDataBase64), c => c.charCodeAt(0));
      
      const textImage = await pdfDoc.embedPng(imageBytes);
      page.drawImage(textImage, {
        x: x + 5,
        y: textY,
        width: textWidth + 10,
        height: textHeight + 10,
      });
      textY -= lineHeight;
    }
  } catch (error) {
    console.warn('署名日時の画像化に失敗:', error);
  }
  
  // 署名理由を画像として描画（日本語対応）
  if (signature.reason) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const reasonText = `理由: ${signature.reason}`;
        ctx.font = `${fontSize - 1}px Arial, sans-serif`;
        const textMetrics = ctx.measureText(reasonText);
        const textWidth = textMetrics.width;
        const textHeight = (fontSize - 1) * 1.2;
        
        canvas.width = textWidth + 10;
        canvas.height = textHeight + 10;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSize - 1}px Arial, sans-serif`;
        ctx.fillStyle = '#808080';
        ctx.fillText(reasonText, 5, fontSize - 1 + 5);
        
        const imageData = canvas.toDataURL('image/png');
        const imageDataBase64 = imageData.split(',')[1];
        const imageBytes = Uint8Array.from(atob(imageDataBase64), c => c.charCodeAt(0));
        
        const textImage = await pdfDoc.embedPng(imageBytes);
        page.drawImage(textImage, {
          x: x + 5,
          y: textY,
          width: textWidth + 10,
          height: textHeight + 10,
        });
        textY -= lineHeight;
      }
    } catch (error) {
      console.warn('署名理由の画像化に失敗:', error);
    }
  }
  
  // 署名場所を画像として描画（日本語対応）
  if (signature.location) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const locationText = `場所: ${signature.location}`;
        ctx.font = `${fontSize - 1}px Arial, sans-serif`;
        const textMetrics = ctx.measureText(locationText);
        const textWidth = textMetrics.width;
        const textHeight = (fontSize - 1) * 1.2;
        
        canvas.width = textWidth + 10;
        canvas.height = textHeight + 10;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSize - 1}px Arial, sans-serif`;
        ctx.fillStyle = '#808080';
        ctx.fillText(locationText, 5, fontSize - 1 + 5);
        
        const imageData = canvas.toDataURL('image/png');
        const imageDataBase64 = imageData.split(',')[1];
        const imageBytes = Uint8Array.from(atob(imageDataBase64), c => c.charCodeAt(0));
        
        const textImage = await pdfDoc.embedPng(imageBytes);
        page.drawImage(textImage, {
          x: x + 5,
          y: textY,
          width: textWidth + 10,
          height: textHeight + 10,
        });
      }
    } catch (error) {
      console.warn('署名場所の画像化に失敗:', error);
    }
  }
  
  // 署名テキスト（画像がない場合）を画像として描画（日本語対応）
  if (!signature.signatureImage && signature.signatureText) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.font = `${fontSize + 2}px Arial, sans-serif`;
        const textMetrics = ctx.measureText(signature.signatureText);
        const textWidth = textMetrics.width;
        const textHeight = (fontSize + 2) * 1.2;
        
        canvas.width = textWidth + 10;
        canvas.height = textHeight + 10;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = `${fontSize + 2}px Arial, sans-serif`;
        ctx.fillStyle = '#000000';
        ctx.fillText(signature.signatureText, 5, fontSize + 2 + 5);
        
        const imageData = canvas.toDataURL('image/png');
        const imageDataBase64 = imageData.split(',')[1];
        const imageBytes = Uint8Array.from(atob(imageDataBase64), c => c.charCodeAt(0));
        
        const textImage = await pdfDoc.embedPng(imageBytes);
        page.drawImage(textImage, {
          x: x + 5,
          y: y + height / 2,
          width: textWidth + 10,
          height: textHeight + 10,
        });
      }
    } catch (error) {
      console.warn('署名テキストの画像化に失敗:', error);
    }
  }
}

/**
 * 承認ワークフローの初期化
 */
export function createApprovalWorkflow(
  documentId: string,
  approvers: Omit<ApprovalStep, 'stepNumber' | 'status'>[]
): ApprovalWorkflow {
  const steps: ApprovalStep[] = approvers.map((approver, index) => ({
    stepNumber: index + 1,
    ...approver,
    status: index === 0 ? 'pending' : 'pending',
  }));
  
  return {
    id: `workflow_${Date.now()}`,
    documentId,
    approvers: steps,
    currentStep: 1,
    status: 'pending',
    createdAt: new Date(),
  };
}

/**
 * 承認ステップを実行
 */
export function approveStep(
  workflow: ApprovalWorkflow,
  stepNumber: number,
  signature: Signature,
  comment?: string
): ApprovalWorkflow {
  const step = workflow.approvers.find(s => s.stepNumber === stepNumber);
  if (!step) {
    throw new Error(`承認ステップ ${stepNumber} が見つかりません`);
  }
  
  if (step.status !== 'pending') {
    throw new Error(`承認ステップ ${stepNumber} は既に処理済みです`);
  }
  
  // ステップを承認
  step.status = 'approved';
  step.signature = signature;
  step.approvedAt = new Date();
  step.comment = comment;
  
  // 次のステップに進む
  const nextStep = workflow.approvers.find(s => s.stepNumber === stepNumber + 1);
  if (nextStep) {
    workflow.currentStep = stepNumber + 1;
    workflow.status = 'pending';
  } else {
    // すべてのステップが完了
    workflow.status = 'completed';
    workflow.completedAt = new Date();
  }
  
  return workflow;
}

/**
 * 承認ステップを却下
 */
export function rejectStep(
  workflow: ApprovalWorkflow,
  stepNumber: number,
  comment?: string
): ApprovalWorkflow {
  const step = workflow.approvers.find(s => s.stepNumber === stepNumber);
  if (!step) {
    throw new Error(`承認ステップ ${stepNumber} が見つかりません`);
  }
  
  step.status = 'rejected';
  step.comment = comment;
  workflow.status = 'rejected';
  
  return workflow;
}

/**
 * 署名IDを生成
 */
export function generateSignatureId(): string {
  return `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

