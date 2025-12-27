import type { Stroke, TextAnnotation, ShapeAnnotation } from './db';

/**
 * 注釈データのエクスポート形式
 */
export interface ExportData {
  version: string;
  docId: string;
  totalPages: number;
  annotations: Record<number, Stroke[]>;
  textAnnotations?: Record<number, TextAnnotation[]>;
  shapeAnnotations?: Record<number, ShapeAnnotation[]>;
  exportedAt: string;
}

/**
 * 全ページの注釈をJSON形式でエクスポート
 */
export async function exportAnnotationsToJSON(
  docId: string,
  totalPages: number,
  annotations: Record<number, Stroke[]>,
  textAnnotations?: Record<number, TextAnnotation[]>,
  shapeAnnotations?: Record<number, ShapeAnnotation[]>
): Promise<string> {
  const exportData: ExportData = {
    version: '1.2',
    docId,
    totalPages,
    annotations,
    textAnnotations,
    shapeAnnotations,
    exportedAt: new Date().toISOString(),
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * JSON形式の注釈データをインポート
 */
export function importAnnotationsFromJSON(jsonString: string): ExportData {
  try {
    const data = JSON.parse(jsonString) as ExportData;
    
    // バリデーション
    if (!data.docId || !data.annotations || typeof data.totalPages !== 'number') {
      throw new Error('Invalid export data format');
    }

    return data;
  } catch (error) {
    throw new Error('Failed to parse JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
}

