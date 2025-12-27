/**
 * PDFファイルからdocIdを生成する
 * ファイル名 + サイズ + 最終更新日時から簡易ハッシュを生成
 */
export async function generateDocId(file: File): Promise<string> {
  const info = `${file.name}_${file.size}_${file.lastModified}`;
  
  // 簡易ハッシュ（実際のハッシュ関数を使う場合はcrypto.subtle.digestを使う）
  let hash = 0;
  for (let i = 0; i < info.length; i++) {
    const char = info.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return `doc_${Math.abs(hash).toString(36)}`;
}

