/**
 * 目次自動生成機能
 * PDFの見出しから目次を自動生成
 */

export interface TableOfContentsEntry {
  title: string;
  page: number;
  level: number; // 1, 2, 3... (階層レベル)
  y: number; // ページ内でのY座標（ジャンプ用）
}

/**
 * PDFページから見出しを抽出
 * @param pdfPage PDF.jsのページオブジェクト
 * @param pageNumber ページ番号（1ベース）
 * @returns 見出しエントリの配列
 */
export async function extractHeadings(
  pdfPage: import('pdfjs-dist').PDFPageProxy,
  pageNumber: number
): Promise<TableOfContentsEntry[]> {
  const textContent = await pdfPage.getTextContent();
  const viewport = pdfPage.getViewport({ scale: 1.0 });
  const entries: TableOfContentsEntry[] = [];

  // テキストアイテムを分析して見出しを検出
  const textItems: Array<{
    str: string;
    fontSize: number;
    fontName: string;
    x: number;
    y: number;
    width: number;
  }> = [];

  for (const item of textContent.items) {
    if ('str' in item && item.str.trim()) {
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const pdfX = transform[4];
      const pdfY = transform[5];
      
      // フォントサイズを取得
      const fontSize = (item as any).fontSize || 12;
      const fontName = (item as any).fontName || '';
      
      // スケールを考慮したフォントサイズ
      const scale = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1]);
      const actualFontSize = fontSize * scale;
      
      // 幅を取得
      let width = (item as any).width;
      if (!width) {
        width = actualFontSize * 0.6 * item.str.length;
      }
      
      // viewport座標系に変換
      const viewportX = pdfX;
      const viewportY = viewport.height - pdfY;
      
      textItems.push({
        str: item.str.trim(),
        fontSize: actualFontSize,
        fontName: fontName.toLowerCase(),
        x: viewportX,
        y: viewportY,
        width,
      });
    }
  }

  // 各ページで最も大きいフォントサイズを取得
  const fontSizes = textItems.map(item => item.fontSize).filter(fs => fs > 0);
  if (fontSizes.length === 0) return [];

  const maxFontSize = Math.max(...fontSizes);
  
  // 最大フォントサイズの90%以上を最大フォントサイズとみなす（誤差を考慮）
  const threshold = maxFontSize * 0.9;

  // 見出し候補を収集
  const candidateEntries: Array<{
    title: string;
    fontSize: number;
    y: number;
    x: number;
  }> = [];

  for (const item of textItems) {
    // 最大フォントサイズに近いもののみを見出し候補として検出
    if (item.fontSize >= threshold) {
      const isNotNumber = !/^\d+[\.\)]?\s*$/.test(item.str); // ページ番号などではない
      const isNotPageNumber = !/^p\.?\d+$/i.test(item.str.trim()); // "p.1"などのページ番号表記ではない
      
      // ページ番号や数字のみのテキストは除外
      if (isNotNumber && isNotPageNumber) {
        candidateEntries.push({
          title: item.str,
          fontSize: item.fontSize,
          y: item.y,
          x: item.x,
        });
      }
    }
  }

  if (candidateEntries.length === 0) return [];

  // 同じ行の見出しをマージ（複数のテキストアイテムが同じ行にある場合）
  const mergedCandidates: Array<{
    title: string;
    fontSize: number;
    y: number;
    x: number;
  }> = [];
  const processed = new Set<number>();

  for (let i = 0; i < candidateEntries.length; i++) {
    if (processed.has(i)) continue;

    const candidate = candidateEntries[i];
    let mergedTitle = candidate.title;
    let mergedY = candidate.y;
    let mergedX = candidate.x;
    let maxFont = candidate.fontSize;

    // 同じY座標（±5px）にある見出しを探す
    for (let j = i + 1; j < candidateEntries.length; j++) {
      if (processed.has(j)) continue;
      
      const otherCandidate = candidateEntries[j];
      if (Math.abs(candidate.y - otherCandidate.y) < 5) {
        // 同じ行の見出しをマージ
        mergedTitle += ' ' + otherCandidate.title;
        maxFont = Math.max(maxFont, otherCandidate.fontSize);
        mergedX = Math.min(mergedX, otherCandidate.x); // 左端のX座標を使用
        processed.add(j);
      }
    }

    mergedCandidates.push({
      title: mergedTitle.trim(),
      fontSize: maxFont,
      y: mergedY,
      x: mergedX,
    });

    processed.add(i);
  }

  // 各ページから1つだけ見出しを選択（最大フォントサイズ、または最も上にあるもの）
  if (mergedCandidates.length === 0) return [];

  // フォントサイズが最大のものを優先、同じ場合はY座標が小さいもの（上にあるもの）を選択
  mergedCandidates.sort((a, b) => {
    if (Math.abs(a.fontSize - b.fontSize) > 1) {
      return b.fontSize - a.fontSize; // フォントサイズが大きい順
    }
    return a.y - b.y; // Y座標が小さい順（上にあるもの）
  });

  // 最も適切な見出しを1つだけ選択
  const selectedCandidate = mergedCandidates[0];

  return [{
    title: selectedCandidate.title,
    page: pageNumber,
    level: 1,
    y: selectedCandidate.y,
  }];
}

/**
 * 全ページから目次を生成
 * @param pdfDoc PDF.jsのドキュメントオブジェクト
 * @returns 目次エントリの配列（全ページ分、見出しがないページは空の見出し）
 */
export async function generateTableOfContents(
  pdfDoc: import('pdfjs-dist').PDFDocumentProxy
): Promise<TableOfContentsEntry[]> {
  const allEntries: TableOfContentsEntry[] = [];
  const totalPages = pdfDoc.numPages;

  console.log(`目次生成開始: 総ページ数 ${totalPages}`);
  console.log(`デバッグ: pdfDoc.numPages = ${totalPages}, 取得対象: ページ2からページ${totalPages + 1}まで (表示はP01からP${totalPages}まで)`);
  
  // ページ1をスキップして、ページ2から開始（表示はP01から）
  // ページ49（totalPages+1）まで取得を試みる（表示はP48）
  for (let pageNum = 2; pageNum <= totalPages + 1; pageNum++) {
    try {
      // 0ベースインデックスに変換（PDF.jsは0ベース）
      // ページ2 = index 1, ページ3 = index 2, ..., ページ49 = index 48
      const pageIndex = pageNum - 1;
      
      console.log(`デバッグ: ページ ${pageNum} (index ${pageIndex}) を処理中...`);
      
      // ページインデックスの検証
      // totalPagesを超える場合でも、実際にgetPageを試みてエラーを確認する
      if (pageIndex < 0) {
        console.warn(`デバッグ: 無効なページインデックス (負の値): ${pageIndex}`);
        continue;
      }
      
      // PDF.jsのgetPageは0ベースインデックスを使用
      // リトライロジックを削除し、通常通り取得
      // totalPagesを超える場合でも、実際に取得を試みる
      let page;
      try {
        console.log(`デバッグ: pdfDoc.getPage(${pageIndex}) を呼び出し中... (pageNum: ${pageNum}, totalPages: ${totalPages})`);
        page = await pdfDoc.getPage(pageIndex);
        console.log(`デバッグ: ページ ${pageNum} (index ${pageIndex}) の取得に成功`);
      } catch (getPageError: any) {
        console.error(`デバッグ: pdfDoc.getPage(${pageIndex}) でエラー (pageNum: ${pageNum}, totalPages: ${totalPages}):`, getPageError);
        console.error(`デバッグ: エラーの詳細 - メッセージ: "${getPageError?.message}", 名前: "${getPageError?.name}", スタック:`, getPageError?.stack);
        
        // エラーが発生した場合、見出しなしとして処理
        const displayPage = pageNum - 1; // 表示ページ番号
        allEntries.push({
          title: '（見出しなし）',
          page: displayPage,
          level: 1,
          y: 0,
        });
        console.log(`ページ ${pageNum}: 取得失敗のため見出しなしとして処理 (表示ページ: ${displayPage})`);
        continue;
      }
      
      // extractHeadingsには実際のページ番号を渡す
      console.log(`デバッグ: ページ ${pageNum} (index ${pageIndex}) の見出しを抽出中...`);
      const entries = await extractHeadings(page, pageNum);
      console.log(`デバッグ: ページ ${pageNum} から ${entries.length} 個の見出し候補を取得`);
      
      // 各ページから1つの見出しだけを取得
      if (entries.length > 0) {
        // 既に1つだけ返されるはずだが、念のため最初の1つだけを使用
        // ページ番号を1つ減らして表示（ページ2→P01、ページ3→P02、...、ページ49→P48）
        const entry = { ...entries[0] };
        entry.page = pageNum - 1; // 表示ページ番号（ページ2 → 1、ページ3 → 2、...）
        allEntries.push(entry);
        console.log(`ページ ${pageNum}: 見出しを検出 - "${entry.title}" (表示ページ: ${entry.page})`);
      } else {
        // 見出しがないページでもエントリを作成
        const displayPage = pageNum - 1; // 表示ページ番号
        console.log(`デバッグ: ページ ${pageNum} から見出しが見つかりませんでした`);
        allEntries.push({
          title: '（見出しなし）',
          page: displayPage,
          level: 1,
          y: 0,
        });
        console.log(`ページ ${pageNum}: 見出しなし (表示ページ: ${displayPage})`);
      }
    } catch (error) {
      console.error(`ページ ${pageNum} の見出し抽出に失敗:`, error);
      // エラーが発生しても、見出しなしのエントリを作成
      const displayPage = pageNum - 1; // 表示ページ番号
      allEntries.push({
        title: '（見出しなし）',
        page: displayPage,
        level: 1,
        y: 0,
      });
      console.log(`ページ ${pageNum}: エラーのため見出しなしとして処理 (表示ページ: ${displayPage})`);
    }
  }

  // ページ番号順にソート（念のため）
  allEntries.sort((a, b) => a.page - b.page);

  console.log(`目次生成完了: ${allEntries.length}個のエントリ（ページ2から${totalPages + 1}まで、表示はP01からP${totalPages}まで）`);
  console.log(`デバッグ: 最終ページの処理状況 - 総ページ数: ${totalPages}, 最後に処理したページ: ${totalPages + 1} (index: ${totalPages})`);
  
  // 最後のエントリの詳細をログ出力
  if (allEntries.length > 0) {
    const lastEntry = allEntries[allEntries.length - 1];
    console.log(`デバッグ: 最後のエントリ - 表示ページ: ${lastEntry.page}, 見出し: "${lastEntry.title}"`);
  }

  // 期待値は totalPages 個（ページ2からページ49まで = 48個）
  const expectedCount = totalPages;
  if (allEntries.length !== expectedCount) {
    console.warn(`警告: エントリ数が一致しません。期待値: ${expectedCount}, 実際: ${allEntries.length}`);
    console.warn(`デバッグ: 不足しているエントリ数: ${expectedCount - allEntries.length}`);
  }
  
  // 各ページの取得状況を確認
  const pageNumbers = allEntries.map(e => e.page).sort((a, b) => a - b);
  console.log(`デバッグ: 取得されたページ番号の範囲: P${pageNumbers[0]} から P${pageNumbers[pageNumbers.length - 1]} まで`);
  const missingPages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (!pageNumbers.includes(i)) {
      missingPages.push(i);
    }
  }
  if (missingPages.length > 0) {
    console.warn(`デバッグ: 欠落している表示ページ番号: ${missingPages.join(', ')}`);
  }

  return allEntries;
}

