/**
 * OCR結果・シナリオのエクセルエクスポート・インポート機能
 */

import { OCRResult } from './ocr';
import ExcelJS from 'exceljs';

export interface ExcelExportOptions {
  includePageNumber: boolean;
  includeOCRResult: boolean;
  includeScenario: boolean;
  includeOCRConfidence: boolean;
  includeOCRWords: boolean;
}

export interface ExcelRow {
  pageNumber?: number;
  ocrResult?: string;
  ocrConfidence?: number;
  ocrWords?: string;
  scenario?: string;
}

/**
 * OCR結果とシナリオをエクセル形式でエクスポート
 */
export async function exportToExcel(
  ocrResults: Record<number, OCRResult>,
  scenarios: Record<number, string>,
  options: ExcelExportOptions
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('OCR結果・シナリオ');
  
  // ヘッダー行を作成
  const headers: string[] = [];
  if (options.includePageNumber) headers.push('ページ番号');
  if (options.includeOCRResult) {
    headers.push('OCR結果');
    if (options.includeOCRConfidence) headers.push('OCR信頼度');
    if (options.includeOCRWords) headers.push('OCR単語情報');
  }
  if (options.includeScenario) headers.push('シナリオ');
  
  worksheet.addRow(headers);
  
  // ヘッダー行のスタイル設定
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };
  
  // データ行を追加
  const maxPage = Math.max(
    ...Object.keys(ocrResults).map(Number),
    ...Object.keys(scenarios).map(Number),
    0
  );
  
  for (let page = 1; page <= maxPage; page++) {
    const row: (string | number)[] = [];
    
    if (options.includePageNumber) {
      row.push(page);
    }
    
    if (options.includeOCRResult && ocrResults[page]) {
      row.push(ocrResults[page].text);
      
      if (options.includeOCRConfidence) {
        row.push(ocrResults[page].confidence);
      }
      
      if (options.includeOCRWords) {
        row.push(JSON.stringify(ocrResults[page].words));
      }
    } else if (options.includeOCRResult) {
      row.push('');
      if (options.includeOCRConfidence) row.push('');
      if (options.includeOCRWords) row.push('');
    }
    
    if (options.includeScenario && scenarios[page]) {
      row.push(scenarios[page]);
    } else if (options.includeScenario) {
      row.push('');
    }
    
    // 少なくとも1つのフィールドが含まれている場合のみ行を追加
    if (row.length > 0) {
      worksheet.addRow(row);
    }
  }
  
  // 列幅を調整
  worksheet.columns.forEach((column, index) => {
    if (index === 0 && options.includePageNumber) {
      column.width = 12; // ページ番号
    } else if (index === 1 && options.includeOCRResult) {
      column.width = 50; // OCR結果
    } else if (options.includeOCRConfidence && 
               ((options.includePageNumber && index === 2) || (!options.includePageNumber && index === 1))) {
      column.width = 12; // OCR信頼度
    } else if (options.includeOCRWords) {
      column.width = 50; // OCR単語
    } else {
      column.width = 50; // シナリオ
    }
  });
  
  // バイナリ形式でエクスポート
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * エクセルファイルからOCR結果とシナリオをインポート
 */
export async function importFromExcel(
  file: File,
  options: ExcelExportOptions
): Promise<{ ocrResults: Record<number, OCRResult>; scenarios: Record<number, string> }> {
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = await file.arrayBuffer();
  await workbook.xlsx.load(arrayBuffer);
  
  const worksheet = workbook.getWorksheet(1); // 最初のワークシート
  if (!worksheet) {
    throw new Error('ワークシートが見つかりません');
  }
  
  const ocrResults: Record<number, OCRResult> = {};
  const scenarios: Record<number, string> = {};
  
  // ヘッダー行をスキップしてデータ行を処理
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // ヘッダー行をスキップ
    
    let colIndex = 0;
    const rowData: ExcelRow = {};
    
    if (options.includePageNumber) {
      rowData.pageNumber = row.getCell(colIndex + 1).value as number;
      colIndex++;
    }
    
    if (options.includeOCRResult) {
      rowData.ocrResult = row.getCell(colIndex + 1).value as string;
      colIndex++;
      
      if (options.includeOCRConfidence) {
        rowData.ocrConfidence = row.getCell(colIndex + 1).value as number;
        colIndex++;
      }
      
      if (options.includeOCRWords) {
        rowData.ocrWords = row.getCell(colIndex + 1).value as string;
        colIndex++;
      }
    }
    
    if (options.includeScenario) {
      const scenarioValue = row.getCell(colIndex + 1).value;
      rowData.scenario = scenarioValue != null ? String(scenarioValue) : '';
    }
    
    const pageNumber = rowData.pageNumber;
    if (!pageNumber) return;
    
    if (options.includeOCRResult && rowData.ocrResult && rowData.ocrResult.trim() !== '') {
      ocrResults[pageNumber] = {
        text: rowData.ocrResult,
        confidence: rowData.ocrConfidence || 0,
        words: rowData.ocrWords ? JSON.parse(rowData.ocrWords) : [],
      };
    }
    
    // シナリオを追加（空欄の場合は空文字列で上書き）
    if (options.includeScenario) {
      scenarios[pageNumber] = rowData.scenario || '';
    }
  });
  
  return { ocrResults, scenarios };
}

