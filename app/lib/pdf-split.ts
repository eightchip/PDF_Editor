/**
 * PDF分割機能
 */

import { PDFDocument } from 'pdf-lib';

/**
 * PDFから指定されたページを抽出
 * @param pdfBytes 元のPDFバイト
 * @param pageNumbers 抽出するページ番号の配列（1から始まる）
 * @returns 分割されたPDFのバイト
 */
export async function splitPDF(
  pdfBytes: ArrayBuffer,
  pageNumbers: number[]
): Promise<Uint8Array> {
  const sourceDoc = await PDFDocument.load(pdfBytes);
  const newDoc = await PDFDocument.create();
  
  // ページ番号をソート
  const sortedPages = [...pageNumbers].sort((a, b) => a - b);
  
  // 指定されたページをコピー
  for (const pageNum of sortedPages) {
    if (pageNum < 1 || pageNum > sourceDoc.getPageCount()) {
      throw new Error(`無効なページ番号: ${pageNum}`);
    }
    
    const [copiedPage] = await newDoc.copyPages(sourceDoc, [pageNum - 1]);
    newDoc.addPage(copiedPage);
  }
  
  const resultBytes = await newDoc.save();
  return resultBytes;
}

/**
 * PDFを複数のPDFに分割（各ページを個別のPDFに）
 * @param pdfBytes 元のPDFバイト
 * @returns 各ページのPDFバイトの配列
 */
export async function splitPDFByPages(
  pdfBytes: ArrayBuffer
): Promise<Uint8Array[]> {
  const sourceDoc = await PDFDocument.load(pdfBytes);
  const totalPages = sourceDoc.getPageCount();
  const results: Uint8Array[] = [];
  
  for (let i = 0; i < totalPages; i++) {
    const newDoc = await PDFDocument.create();
    const [copiedPage] = await newDoc.copyPages(sourceDoc, [i]);
    newDoc.addPage(copiedPage);
    
    const pageBytes = await newDoc.save();
    results.push(pageBytes);
  }
  
  return results;
}

/**
 * PDFを範囲で分割
 * @param pdfBytes 元のPDFバイト
 * @param ranges ページ範囲の配列（例: [{start: 1, end: 5}, {start: 6, end: 10}]）
 * @returns 各範囲のPDFバイトの配列
 */
export async function splitPDFByRanges(
  pdfBytes: ArrayBuffer,
  ranges: Array<{ start: number; end: number }>
): Promise<Uint8Array[]> {
  const sourceDoc = await PDFDocument.load(pdfBytes);
  const totalPages = sourceDoc.getPageCount();
  const results: Uint8Array[] = [];
  
  for (const range of ranges) {
    if (range.start < 1 || range.end > totalPages || range.start > range.end) {
      throw new Error(`無効なページ範囲: ${range.start}-${range.end}`);
    }
    
    const newDoc = await PDFDocument.create();
    const pageNumbers: number[] = [];
    
    for (let i = range.start; i <= range.end; i++) {
      pageNumbers.push(i - 1); // PDF-libは0ベース
    }
    
    const copiedPages = await newDoc.copyPages(sourceDoc, pageNumbers);
    copiedPages.forEach(page => newDoc.addPage(page));
    
    const rangeBytes = await newDoc.save();
    results.push(rangeBytes);
  }
  
  return results;
}

/**
 * PDFをページグループで分割（各グループ内のすべてのページを1つのPDFにまとめる）
 * @param pdfBytes 元のPDFバイト
 * @param pageGroups ページ番号の配列の配列（例: [[1, 2, 3, 5, 7, 8, 9], [11, 12, 13, 15, 17, 18, 19]]）
 * @returns 各グループのPDFバイトの配列
 */
export async function splitPDFByPageGroups(
  pdfBytes: ArrayBuffer,
  pageGroups: number[][]
): Promise<Uint8Array[]> {
  const sourceDoc = await PDFDocument.load(pdfBytes);
  const totalPages = sourceDoc.getPageCount();
  const results: Uint8Array[] = [];
  
  for (const pageGroup of pageGroups) {
    if (pageGroup.length === 0) continue;
    
    // ページ番号をソートして重複を除去
    const uniquePages = [...new Set(pageGroup)].sort((a, b) => a - b);
    
    // 有効なページ番号のみを抽出
    const validPages = uniquePages.filter(page => page >= 1 && page <= totalPages);
    
    if (validPages.length === 0) continue;
    
    const newDoc = await PDFDocument.create();
    const pageNumbers = validPages.map(page => page - 1); // PDF-libは0ベース
    
    const copiedPages = await newDoc.copyPages(sourceDoc, pageNumbers);
    copiedPages.forEach(page => newDoc.addPage(page));
    
    const groupBytes = await newDoc.save();
    results.push(groupBytes);
  }
  
  return results;
}

