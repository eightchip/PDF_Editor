import { openDB, DBSchema, IDBPDatabase } from 'idb';

export type Point = { x: number; y: number; p?: number };
export type Stroke = { 
  id?: string; // 後方互換性のためオプショナル
  tool: 'pen' | 'eraser' | 'highlight'; 
  color: string; 
  width: number; 
  points: Point[] 
};

export type TextAnnotation = {
  id: string;
  x: number; // 0..1 の比率
  y: number; // 0..1 の比率
  text: string;
  fontSize: number;
  color: string;
  width?: number; // テキストボックスの幅（オプション）
  height?: number; // テキストボックスの高さ（オプション）
};

export type ShapeAnnotation = {
  id: string;
  type: 'line' | 'rectangle' | 'circle' | 'arrow' | 'stamp';
  x1: number; // 0..1 の比率
  y1: number; // 0..1 の比率
  x2: number; // 0..1 の比率
  y2: number; // 0..1 の比率
  color: string;
  width: number;
  fill?: boolean; // 塗りつぶし（矩形・円のみ）
  // スタンプ用の追加プロパティ
  stampType?: string; // スタンプの種類（'approved', 'rejected', 'date', 'custom'など）
  stampImage?: string; // カスタムスタンプの画像データ（base64）
  stampText?: string; // スタンプに表示するテキスト（日付など）
};

interface AnnotationsDB extends DBSchema {
  annotations: {
    key: string; // `${docId}_${pageNumber}`
    value: Stroke[];
  };
  textAnnotations: {
    key: string; // `${docId}_${pageNumber}`
    value: TextAnnotation[];
  };
  shapeAnnotations: {
    key: string; // `${docId}_${pageNumber}`
    value: ShapeAnnotation[];
  };
  signatures: {
    key: string; // `${docId}_${signatureId}`
    value: import('./signature').Signature;
  };
  approvalWorkflows: {
    key: string; // `${docId}_${workflowId}`
    value: import('./signature').ApprovalWorkflow;
  };
  watermarkHistory: {
    key: string; // `watermark_${text}`
    value: { text: string; timestamp: number };
  };
  ocrResults: {
    key: string; // `${docId}_${pageNumber}`
    value: import('./ocr').OCRResult;
  };
  tableOfContents: {
    key: string; // `${docId}`
    value: import('./table-of-contents').TableOfContentsEntry[];
  };
}

let dbInstance: IDBPDatabase<AnnotationsDB> | null = null;

/**
 * IndexedDBを開く
 */
async function getDB(): Promise<IDBPDatabase<AnnotationsDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    dbInstance = await openDB<AnnotationsDB>('pdf-annotations', 8, {
      upgrade(db, oldVersion) {
        // 既存のオブジェクトストアが存在しない場合のみ作成
        if (!db.objectStoreNames.contains('annotations')) {
          db.createObjectStore('annotations');
        }
        if (!db.objectStoreNames.contains('textAnnotations')) {
          db.createObjectStore('textAnnotations');
        }
        if (!db.objectStoreNames.contains('shapeAnnotations')) {
          db.createObjectStore('shapeAnnotations');
        }
        if (!db.objectStoreNames.contains('signatures')) {
          db.createObjectStore('signatures');
        }
        if (!db.objectStoreNames.contains('approvalWorkflows')) {
          db.createObjectStore('approvalWorkflows');
        }
        if (!db.objectStoreNames.contains('watermarkHistory')) {
          db.createObjectStore('watermarkHistory');
        }
        if (!db.objectStoreNames.contains('ocrResults')) {
          db.createObjectStore('ocrResults');
        }
        if (!db.objectStoreNames.contains('tableOfContents')) {
          db.createObjectStore('tableOfContents');
        }
      },
      // 既存のデータベースがより新しいバージョンの場合のエラーを処理
      blocked() {
        console.warn('IndexedDB is blocked by another tab');
      },
      blocking() {
        console.warn('IndexedDB needs to be closed in other tabs');
      },
    });
  } catch (error) {
    // バージョンエラーの場合、既存のデータベースを削除して再作成
    if (error instanceof Error && error.name === 'VersionError') {
      console.warn('IndexedDB version mismatch. Deleting and recreating database...');
      try {
        // 既存のデータベースを削除
        const deleteReq = indexedDB.deleteDatabase('pdf-annotations');
        await new Promise<void>((resolve, reject) => {
          deleteReq.onsuccess = () => resolve();
          deleteReq.onerror = () => reject(deleteReq.error);
          deleteReq.onblocked = () => {
            console.warn('IndexedDB delete is blocked');
            resolve(); // ブロックされても続行
          };
        });
        
        // データベースを再作成
        dbInstance = await openDB<AnnotationsDB>('pdf-annotations', 8, {
          upgrade(db) {
            db.createObjectStore('annotations');
            db.createObjectStore('textAnnotations');
            db.createObjectStore('shapeAnnotations');
            db.createObjectStore('signatures');
            db.createObjectStore('approvalWorkflows');
            db.createObjectStore('watermarkHistory');
            db.createObjectStore('ocrResults');
            db.createObjectStore('tableOfContents');
          },
        });
      } catch (recreateError) {
        console.error('Failed to recreate IndexedDB:', recreateError);
        throw recreateError;
      }
    } else {
      throw error;
    }
  }

  return dbInstance;
}

/**
 * ページの注釈を保存
 */
export async function saveAnnotations(
  docId: string,
  pageNumber: number,
  strokes: Stroke[]
): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  await db.put('annotations', strokes, key);
}

/**
 * ページの注釈を読み込み
 */
export async function loadAnnotations(
  docId: string,
  pageNumber: number
): Promise<Stroke[]> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  const strokes = await db.get('annotations', key);
  return strokes || [];
}

/**
 * ページの注釈を削除
 */
export async function deleteAnnotations(
  docId: string,
  pageNumber: number
): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  await db.delete('annotations', key);
}

/**
 * 全ページの注釈を取得
 */
export async function getAllAnnotations(
  docId: string,
  totalPages: number
): Promise<Record<number, Stroke[]>> {
  const db = await getDB();
  const annotations: Record<number, Stroke[]> = {};
  
  for (let page = 1; page <= totalPages; page++) {
    const key = `${docId}_${page}`;
    const strokes = await db.get('annotations', key);
    if (strokes && strokes.length > 0) {
      annotations[page] = strokes;
    }
  }
  
  return annotations;
}

/**
 * ページのテキスト注釈を保存
 */
export async function saveTextAnnotations(
  docId: string,
  pageNumber: number,
  texts: TextAnnotation[]
): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  await db.put('textAnnotations', texts, key);
}

/**
 * ページのテキスト注釈を読み込み
 */
export async function loadTextAnnotations(
  docId: string,
  pageNumber: number
): Promise<TextAnnotation[]> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  const texts = await db.get('textAnnotations', key);
  return texts || [];
}

/**
 * ページのテキスト注釈を削除
 */
export async function deleteTextAnnotations(
  docId: string,
  pageNumber: number
): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  await db.delete('textAnnotations', key);
}

/**
 * 全ページのテキスト注釈を取得
 */
export async function getAllTextAnnotations(
  docId: string,
  totalPages: number
): Promise<Record<number, TextAnnotation[]>> {
  const db = await getDB();
  const texts: Record<number, TextAnnotation[]> = {};
  
  for (let page = 1; page <= totalPages; page++) {
    const key = `${docId}_${page}`;
    const pageTexts = await db.get('textAnnotations', key);
    if (pageTexts && pageTexts.length > 0) {
      texts[page] = pageTexts;
    }
  }
  
  return texts;
}

/**
 * ページの図形注釈を保存
 */
export async function saveShapeAnnotations(
  docId: string,
  pageNumber: number,
  shapes: ShapeAnnotation[]
): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  await db.put('shapeAnnotations', shapes, key);
}

/**
 * ページの図形注釈を読み込み
 */
export async function loadShapeAnnotations(
  docId: string,
  pageNumber: number
): Promise<ShapeAnnotation[]> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  const shapes = await db.get('shapeAnnotations', key);
  return shapes || [];
}

/**
 * ページの図形注釈を削除
 */
export async function deleteShapeAnnotations(
  docId: string,
  pageNumber: number
): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  await db.delete('shapeAnnotations', key);
}

/**
 * 全ページの図形注釈を取得
 */
export async function getAllShapeAnnotations(
  docId: string,
  totalPages: number
): Promise<Record<number, ShapeAnnotation[]>> {
  const db = await getDB();
  const shapes: Record<number, ShapeAnnotation[]> = {};
  
  for (let page = 1; page <= totalPages; page++) {
    const key = `${docId}_${page}`;
    const pageShapes = await db.get('shapeAnnotations', key);
    if (pageShapes && pageShapes.length > 0) {
      shapes[page] = pageShapes;
    }
  }
  
  return shapes;
}

// 署名関連の関数
export async function saveSignature(docId: string, signature: import('./signature').Signature): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${signature.id}`;
  await db.put('signatures', signature, key);
}

export async function getAllSignatures(docId: string): Promise<import('./signature').Signature[]> {
  const db = await getDB();
  const tx = db.transaction('signatures', 'readonly');
  const store = tx.objectStore('signatures');
  const allKeys = await store.getAllKeys();
  
  // docIdでフィルタリング
  const matchingKeys = allKeys.filter(key => String(key).startsWith(`${docId}_`));
  const signatures: import('./signature').Signature[] = [];
  
  for (const key of matchingKeys) {
    const sig = await store.get(key);
    if (sig) {
      signatures.push(sig);
    }
  }
  
  return signatures;
}

export async function deleteSignature(docId: string, signatureId: string): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${signatureId}`;
  await db.delete('signatures', key);
}

// 承認ワークフロー関連の関数
export async function saveApprovalWorkflow(docId: string, workflow: import('./signature').ApprovalWorkflow): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${workflow.id}`;
  await db.put('approvalWorkflows', workflow, key);
}

export async function getAllApprovalWorkflows(docId: string): Promise<import('./signature').ApprovalWorkflow[]> {
  const db = await getDB();
  const tx = db.transaction('approvalWorkflows', 'readonly');
  const store = tx.objectStore('approvalWorkflows');
  const allKeys = await store.getAllKeys();
  
  // docIdでフィルタリング
  const matchingKeys = allKeys.filter(key => String(key).startsWith(`${docId}_`));
  const workflows: import('./signature').ApprovalWorkflow[] = [];
  
  for (const key of matchingKeys) {
    const wf = await store.get(key);
    if (wf) {
      workflows.push(wf);
    }
  }
  
  return workflows;
}

// 透かし履歴関連の関数
export async function saveWatermarkHistory(text: string): Promise<void> {
  if (!text || text.trim() === '') return;
  const db = await getDB();
  const key = `watermark_${text.trim()}`;
  await db.put('watermarkHistory', { text: text.trim(), timestamp: Date.now() }, key);
}

export async function getAllWatermarkHistory(): Promise<string[]> {
  const db = await getDB();
  const tx = db.transaction('watermarkHistory', 'readonly');
  const store = tx.objectStore('watermarkHistory');
  const allValues = await store.getAll();
  
  // タイムスタンプでソート（新しい順）
  const sorted = allValues
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(item => item.text);
  
  // 重複を除去
  return Array.from(new Set(sorted));
}

// OCR結果関連の関数
export async function saveOCRResult(
  docId: string,
  pageNumber: number,
  result: import('./ocr').OCRResult
): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  await db.put('ocrResults', result, key);
}

export async function loadOCRResult(
  docId: string,
  pageNumber: number
): Promise<import('./ocr').OCRResult | undefined> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  return await db.get('ocrResults', key);
}

export async function getAllOCRResults(
  docId: string,
  totalPages: number
): Promise<Record<number, import('./ocr').OCRResult>> {
  const results: Record<number, import('./ocr').OCRResult> = {};
  
  for (let page = 1; page <= totalPages; page++) {
    const result = await loadOCRResult(docId, page);
    if (result) {
      results[page] = result;
    }
  }
  
  return results;
}

export async function deleteOCRResult(
  docId: string,
  pageNumber: number
): Promise<void> {
  const db = await getDB();
  const key = `${docId}_${pageNumber}`;
  await db.delete('ocrResults', key);
}

export async function saveTableOfContents(
  docId: string,
  entries: import('./table-of-contents').TableOfContentsEntry[]
): Promise<void> {
  const db = await getDB();
  const key = docId;
  await db.put('tableOfContents', entries, key);
}

export async function loadTableOfContents(
  docId: string
): Promise<import('./table-of-contents').TableOfContentsEntry[] | undefined> {
  const db = await getDB();
  const key = docId;
  return await db.get('tableOfContents', key);
}

export async function deleteTableOfContents(
  docId: string
): Promise<void> {
  const db = await getDB();
  const key = docId;
  await db.delete('tableOfContents', key);
}

