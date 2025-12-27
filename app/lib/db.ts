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
  type: 'line' | 'rectangle' | 'circle' | 'arrow';
  x1: number; // 0..1 の比率
  y1: number; // 0..1 の比率
  x2: number; // 0..1 の比率
  y2: number; // 0..1 の比率
  color: string;
  width: number;
  fill?: boolean; // 塗りつぶし（矩形・円のみ）
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
}

let dbInstance: IDBPDatabase<AnnotationsDB> | null = null;

/**
 * IndexedDBを開く
 */
async function getDB(): Promise<IDBPDatabase<AnnotationsDB>> {
  if (dbInstance) {
    return dbInstance;
  }

  dbInstance = await openDB<AnnotationsDB>('pdf-annotations', 3, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains('annotations')) {
        db.createObjectStore('annotations');
      }
      if (!db.objectStoreNames.contains('textAnnotations')) {
        db.createObjectStore('textAnnotations');
      }
      if (!db.objectStoreNames.contains('shapeAnnotations')) {
        db.createObjectStore('shapeAnnotations');
      }
    },
  });

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

