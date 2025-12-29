# Link NavigatorへのPDFエディター追加手順

## 追加する情報

PDFエディターアプリを「他のアプリ」セクションに追加する際に使用する情報：

### 基本情報
- **アプリ名**: Snap-illustrator (PDF注釈アプリ)
- **URL**: https://pdf-editor-xi-six.vercel.app/
- **説明**: PDFファイルに手書き注釈を追加できるWebアプリケーション。画像ファイルもPDFに変換して結合可能。

### 主な機能
- PDFファイルの読み込みと表示
- 手書き注釈（ペン/消しゴム/ハイライト）
- テキスト注釈
- 図形注釈（線、四角形、円、矢印）
- 画像・PDFの結合機能
- 音声入力によるテキスト入力
- カメラ撮影機能
- 注釈の永続化（IndexedDB）
- 注釈付きPDFのエクスポート

### 技術スタック
- Next.js 16 (App Router)
- TypeScript
- PDF.js
- IndexedDB
- React

## 実装例

Link Navigatorのプロジェクトで「他のアプリ」セクションに追加する場合のコード例：

```tsx
// 他のアプリの配列に追加
const otherApps = [
  // ... 既存のアプリ
  {
    name: "Snap-illustrator",
    url: "https://pdf-editor-xi-six.vercel.app/",
    description: "PDFファイルに手書き注釈を追加できるWebアプリケーション",
    icon: "📝", // または適切なアイコン
    category: "ツール"
  }
];
```

または、JSON形式で管理している場合：

```json
{
  "name": "Snap-illustrator",
  "url": "https://pdf-editor-xi-six.vercel.app/",
  "description": "PDFファイルに手書き注釈を追加できるWebアプリケーション。画像ファイルもPDFに変換して結合可能。",
  "icon": "📝",
  "category": "ツール",
  "features": [
    "手書き注釈",
    "テキスト注釈",
    "図形注釈",
    "画像・PDF結合",
    "音声入力",
    "カメラ撮影"
  ]
}
```

## 次のステップ

1. Link Navigatorのプロジェクトを開く
2. 「他のアプリ」セクションのコードを確認
3. 上記の情報を追加
4. コミット＆プッシュ

