'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { loadPDF, renderPage, renderTextLayer } from './lib/pdf';
import { drawStroke, redrawStrokes, normalizePoint } from './lib/ink';
import { saveAnnotations, loadAnnotations, deleteAnnotations, getAllAnnotations, saveTextAnnotations, loadTextAnnotations, deleteTextAnnotations, getAllTextAnnotations, saveShapeAnnotations, loadShapeAnnotations, deleteShapeAnnotations, getAllShapeAnnotations, type Stroke, type TextAnnotation, type ShapeAnnotation } from './lib/db';
import { generateDocId } from './lib/id';
import { exportAnnotatedPDFV2 } from './lib/export';
import { exportAnnotationsToJSON, importAnnotationsFromJSON } from './lib/json-export';
import { drawTextAnnotation, redrawTextAnnotations, generateTextId } from './lib/text';
import { drawShapeAnnotation, redrawShapeAnnotations, generateShapeId } from './lib/shapes';
import { extractTextItems, findNearestTextLine, findTextBoundingBox, smoothStroke, type TextItem } from './lib/text-detection';
import { convertImageToPDF } from './lib/image-to-pdf';
import { extractFormFields, setFormFieldValues, calculateFormFields, setupCommonCalculations, type FormField } from './lib/forms';
import { generateSignatureId, type Signature } from './lib/signature';
import { saveSignature, getAllSignatures, deleteSignature, saveWatermarkHistory, getAllWatermarkHistory, saveOCRResult, loadOCRResult, getAllOCRResults, deleteOCRResult, saveTableOfContents, loadTableOfContents, saveScenario, loadScenario, getAllScenarios, deleteScenario } from './lib/db';
import { generateTableOfContents, type TableOfContentsEntry } from './lib/table-of-contents';
import { splitPDF, splitPDFByRanges, splitPDFByPageGroups } from './lib/pdf-split';
import { performOCROnPDFPage, type OCRResult } from './lib/ocr';

// OCR結果から不要なスペースと意味不明な文字列を削除する関数
function removeUnnecessarySpaces(text: string): string {
  // 日本語文字（ひらがな、カタカナ、漢字）のUnicode範囲
  const japaneseChar = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/;
  // 句読点
  const punctuation = /[。、]/;
  // 数字
  const number = /[0-9０-９]/;
  // 英語文字
  const englishChar = /[a-zA-ZＡ-Ｚａ-ｚ]/;
  
  let result = text;
  
  // 0. 意味不明な文字列パターンを削除（より積極的に）
  // 「ババババババ...」「vvユvvバサバサ...」「ユユ ユユ ユユ...」などの繰り返しパターン
  result = result.replace(/ババババババババババババババババ[^\n]*/g, '');
  result = result.replace(/ババ[バホリルロN\s]*ババ/g, ''); // 「ババ...ババ」パターン
  result = result.replace(/[バユvvサ]{3,}/g, ''); // 3文字以上の「バ」「ユ」「v」「サ」の繰り返し
  result = result.replace(/[ユユ\s]{3,}/g, ''); // 「ユユ」の繰り返しパターン
  result = result.replace(/バサバサ[バユvvサ\s]*/g, ''); // 「バサバサ...」パターン
  result = result.replace(/サバサバ[バユvvサ\s]*/g, ''); // 「サバサバ...」パターン
  result = result.replace(/ユーユーザー/g, ''); // 「ユーユーザー」パターン
  
  // 意味不明な記号や特殊文字の連続を削除
  result = result.replace(/[=ー\-_]{3,}/g, ''); // 3文字以上の「=」「ー」「-」「_」の連続
  result = result.replace(/[|｜]{3,}/g, ''); // 3文字以上の「|」「｜」の連続
  
  // 意味不明な文字の組み合わせパターンを削除
  result = result.replace(/[vvユバサ]{3,}/g, ''); // 「vv」「ユ」「バ」「サ」の組み合わせ
  
  // 行全体が意味不明な文字列の場合は削除（先に処理）
  const preLines = result.split('\n');
  const preCleanedLines = preLines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // 空行は保持
    
    // 「バババ...」「vvユvv...」などの意味不明な文字列を含む行を削除
    if (/ババ[バホリルロN\s]{5,}/.test(trimmed)) return false;
    if (/[バユvvサ]{5,}/.test(trimmed)) return false;
    if (/ユーユーザー/.test(trimmed)) return false;
    
    return true;
  });
  result = preCleanedLines.join('\n');
  
  // 1. 日本語文字の間のスペースを削除（より積極的に、複数回実行）
  for (let i = 0; i < 3; i++) {
    result = result.replace(/([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])\s+([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])/g, '$1$2');
  }
  
  // 2. 数字と日本語の間のスペースを削除
  result = result.replace(/([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])\s+([0-9０-９])/g, '$1$2');
  result = result.replace(/([0-9０-９])\s+([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])/g, '$1$2');
  
  // 3. カンマやピリオドの前後のスペースを削除
  result = result.replace(/\s+([,，.．])/g, '$1');
  result = result.replace(/([,，.．])\s+/g, '$1');
  
  // 4. 日本語と英語の間のスペースを削除
  result = result.replace(/([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])\s+([a-zA-ZＡ-Ｚａ-ｚ])/g, '$1$2');
  result = result.replace(/([a-zA-ZＡ-Ｚａ-ｚ])\s+([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])/g, '$1$2');
  
  // 5. 句読点の前後のスペースを削除
  result = result.replace(/\s+([。、])/g, '$1');
  result = result.replace(/([。、])\s+/g, '$1');
  
  // 6. 括弧の前後のスペースを削除
  result = result.replace(/\s+([\(（])/g, '$1');
  result = result.replace(/([\)）])\s+/g, '$1');
  
  // 7. コロン、セミコロンの前後のスペースを削除
  result = result.replace(/\s+([:：;；])/g, '$1');
  result = result.replace(/([:：;；])\s+/g, '$1');
  
  // 8. 日本語文字の前後のスペースを削除（句読点以外）
  result = result.replace(/([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])\s+([^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\s。、，.．\(（\)）:：;；,])/g, '$1$2');
  result = result.replace(/([^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\s。、，.．\(（\)）:：;；,])\s+([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])/g, '$1$2');
  
  // 9. 英語単語間のスペース以外の連続スペースを削除
  // 英語文字の間のスペースは保持しつつ、それ以外の連続スペースを削除
  result = result.replace(/([^\s])\s{2,}([^\s])/g, (match, p1, p2, offset, str) => {
    // 英語文字の間のスペースは保持
    if (englishChar.test(p1) && englishChar.test(p2)) {
      return `${p1} ${p2}`;
    }
    // それ以外はスペースを削除
    return `${p1}${p2}`;
  });
  
  // 10. 行頭・行末のスペースを削除
  result = result.trim();
  
  // 11. 改行の前後の不要なスペースを削除
  result = result.replace(/\s*\n\s*/g, '\n');
  
  // 12. 空行を1行にまとめる（連続する空行を1つに）
  result = result.replace(/\n{3,}/g, '\n\n');
  
  // 13. 意味不明な単独文字や記号の行を削除（行全体が意味不明な文字のみの場合）
  const finalLines = result.split('\n');
  const cleanedLines = finalLines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // 空行は保持
    
    // 意味不明な文字のみの行を削除
    if (/^[バユvvサ=ー\-_|｜\s]+$/.test(trimmed)) return false;
    if (/^[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\w\s]{3,}$/.test(trimmed)) return false;
    
    return true;
  });
  result = cleanedLines.join('\n');
  
  // 14. 最終的なスペースの整理（日本語文字の前後からスペースを削除）
  result = result.replace(/([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])\s+/g, '$1');
  result = result.replace(/\s+([\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF])/g, '$1');
  
  return result;
}
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogOverlay,
  DialogPortal,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button"; // Dialog内でのみ使用
import { MdClose, MdSave, MdFileDownload, MdUndo, MdRedo, MdDelete, MdEdit, MdHighlight, MdTextFields, MdShapeLine, MdRectangle, MdCircle, MdArrowForward, MdSelectAll, MdList, MdZoomIn, MdZoomOut, MdRotateRight, MdNavigateBefore, MdNavigateNext, MdImage, MdInsertDriveFile, MdCreate, MdFormatColorFill, MdBrush, MdClear, MdRemove, MdPalette, MdUpload, MdQrCode, MdCameraAlt, MdCamera, MdMic, MdMicOff, MdArrowUpward, MdArrowDownward, MdCollections, MdDragHandle, MdLock, MdSecurity, MdCheckCircle, MdInfo, MdLocalOffer, MdAssignment, MdContentCut, MdMenuBook, MdFileCopy, MdSlideshow, MdFullscreen, MdFullscreenExit, MdVisibility, MdVisibilityOff, MdPrint, MdDescription, MdNotes, MdTimer, MdTimerOff, MdPlayArrow, MdPause, MdStop } from 'react-icons/md';
import { QRCodeSVG } from 'qrcode.react';
// PDF.jsの型は動的インポートで取得

// ページ範囲文字列をパースする関数（例: "1-3, 5, 7-9" → [{start: 1, end: 3}, {start: 5, end: 5}, {start: 7, end: 9}]
function parsePageRanges(input: string, maxPages: number): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  if (!input.trim()) return ranges;
  
  // カンマで分割
  const parts = input.split(',').map(s => s.trim()).filter(s => s);
  
  for (const part of parts) {
    if (part.includes('-')) {
      // 範囲指定（例: "1-3"）
      const [startStr, endStr] = part.split('-').map(s => s.trim());
      const start = Math.max(1, Math.min(maxPages, parseInt(startStr) || 1));
      const end = Math.max(1, Math.min(maxPages, parseInt(endStr) || start));
      if (start <= end) {
        ranges.push({ start, end });
      }
    } else {
      // 単一ページ（例: "5"）
      const page = Math.max(1, Math.min(maxPages, parseInt(part) || 1));
      ranges.push({ start: page, end: page });
    }
  }
  
  return ranges;
}

export default function Home() {
  const { toast } = useToast();
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [docId, setDocId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [originalPdfBytes, setOriginalPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [isExporting, setIsExporting] = useState(false);
  const [originalFileName, setOriginalFileName] = useState<string | null>(null); // 元のファイル名を保持
  const [pageRotations, setPageRotations] = useState<Record<number, number>>({}); // ページごとの回転角度（0, 90, 180, 270）
  const [rotationMode, setRotationMode] = useState<'all' | 'current'>('all'); // 全ページ回転か現在のページのみか
  const [showWatermarkDialog, setShowWatermarkDialog] = useState(false);
  const [watermarkText, setWatermarkText] = useState('');
  const [watermarkHistory, setWatermarkHistory] = useState<string[]>([]);
  const [watermarkPattern, setWatermarkPattern] = useState<'center' | 'grid' | 'tile'>('center'); // 透かしの配置パターン
  const [watermarkDensity, setWatermarkDensity] = useState(3); // 透かしの密度（グリッド/タイルの場合の列数・行数）
  const [watermarkAngle, setWatermarkAngle] = useState(45); // 透かしの角度（度）
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.5); // 透かしの濃度（0-1、デフォルト0.5）
  const [showWatermarkPreview, setShowWatermarkPreview] = useState(false); // 透かしプレビューの表示状態
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [showThumbnailModal, setShowThumbnailModal] = useState(false); // 全画面サムネイルモーダルの表示状態
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [thumbnailsWithAnnotations, setThumbnailsWithAnnotations] = useState<Record<number, string>>({}); // 注釈付きサムネイル
  const [showThumbnailsWithAnnotations, setShowThumbnailsWithAnnotations] = useState(false); // 注釈付きサムネイルを表示するか
  const [pageOrder, setPageOrder] = useState<number[]>([]); // ページの表示順序
  const [draggedPage, setDraggedPage] = useState<number | null>(null); // ドラッグ中のページ番号
  const [dragOverPage, setDragOverPage] = useState<number | null>(null); // ドラッグオーバー中のページ番号
  const [expandedThumbnail, setExpandedThumbnail] = useState<number | null>(null); // 拡大表示中のサムネイル番号
  const [expandedThumbnailImage, setExpandedThumbnailImage] = useState<string | null>(null); // 拡大表示用の画像（大きなスケールでレンダリング）
  const [expandedThumbnailPosition, setExpandedThumbnailPosition] = useState<{ x: number; y: number } | null>(null); // 拡大表示モーダルの表示位置
  const [hasUnsavedPageOrder, setHasUnsavedPageOrder] = useState(false); // 未保存のページ順序変更があるかどうか
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showAnnotationList, setShowAnnotationList] = useState(false);
  const [isMobile, setIsMobile] = useState(false); // モバイルデバイスかどうか
  const [showQRCode, setShowQRCode] = useState(false); // QRコードモーダルの表示状態
  const [showCameraModal, setShowCameraModal] = useState(false); // カメラモーダルの表示状態
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [isRecording, setIsRecording] = useState(false); // カメラが起動中かどうか
  const [showVoiceInput, setShowVoiceInput] = useState(false); // 音声入力モーダルの表示状態
  const [isListening, setIsListening] = useState(false); // 音声認識中かどうか
  const [voiceLanguage, setVoiceLanguage] = useState<'ja-JP' | 'en-US'>('ja-JP'); // 音声認識の言語
  const recognitionRef = useRef<any>(null); // Web Speech APIの認識エンジン
  const [imageFiles, setImageFiles] = useState<File[]>([]); // 複数画像を保持
  const [showImageManager, setShowImageManager] = useState(false); // 画像管理モーダルの表示状態
  const [selectedPagesForDelete, setSelectedPagesForDelete] = useState<Set<number>>(new Set()); // 削除対象のページ番号
  const [showPageDeleteModal, setShowPageDeleteModal] = useState(false); // ページ削除モーダルの表示状態
  
  // Dialog用のstate
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTitle, setDialogTitle] = useState('');
  const [dialogMessage, setDialogMessage] = useState('');
  const [dialogType, setDialogType] = useState<'alert' | 'confirm' | 'prompt'>('alert');
  const [dialogInputValue, setDialogInputValue] = useState('');
  const [dialogCallback, setDialogCallback] = useState<((value?: string | boolean) => void) | null>(null);
  

  // Dialog/Toastヘルパー関数
  const showAlert = (message: string, title: string = '') => {
    setDialogTitle(title || '通知');
    setDialogMessage(message);
    setDialogType('alert');
    setDialogOpen(true);
    return new Promise<void>((resolve) => {
      setDialogCallback(() => () => {
        setDialogOpen(false);
        resolve();
      });
    });
  };
  
  const showConfirm = (message: string, title: string = ''): Promise<boolean> => {
    setDialogTitle(title || '確認');
    setDialogMessage(message);
    setDialogType('confirm');
    setDialogOpen(true);
    return new Promise((resolve) => {
      setDialogCallback((value?: string | boolean) => {
        setDialogOpen(false);
        resolve(value === true);
      });
    });
  };
  
  const showPrompt = (message: string, defaultValue: string = '', title: string = ''): Promise<string | null> => {
    return new Promise((resolve) => {
      const callback = (value?: string | boolean) => {
        setDialogOpen(false);
        setDialogCallback(null);
        resolve(typeof value === 'string' ? value : null);
      };
      setDialogTitle(title || '入力');
      setDialogMessage(message);
      setDialogType('prompt');
      setDialogInputValue(defaultValue);
      setDialogCallback(() => callback);
      setDialogOpen(true);
    });
  };

  // 描画関連
  const [tool, setTool] = useState<'pen' | 'eraser' | 'text' | 'line' | 'rectangle' | 'circle' | 'arrow' | 'highlight' | 'select' | 'stamp'>('pen');
  const [highlightMode, setHighlightMode] = useState<'auto' | 'manual'>('auto'); // ハイライトモード: 'auto' = 自動（クリックで文字列全体）、'manual' = 手動（ドラッグで範囲指定）
  
  // 選択関連
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<{
    strokes: string[];
    shapes: string[];
    texts: string[];
  }>({ strokes: [], shapes: [], texts: [] });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState('#000000');
  const [width, setWidth] = useState(3);
  const [fontSize, setFontSize] = useState(16);
  const [fillShape, setFillShape] = useState(false);
  const [smoothStrokeEnabled, setSmoothStrokeEnabled] = useState(true);
  const [snapToTextEnabled, setSnapToTextEnabled] = useState(true);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  
  // PDFテキスト検出
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  
  // テキスト注釈関連
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>([]);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const editingTextIdRef = useRef<string | null>(null);
  const [textInputValue, setTextInputValue] = useState('');
  const [textInputPosition, setTextInputPosition] = useState<{ x: number; y: number } | null>(null);

  // 図形注釈関連
  const [shapeAnnotations, setShapeAnnotations] = useState<ShapeAnnotation[]>([]);
  const [currentShape, setCurrentShape] = useState<ShapeAnnotation | null>(null);
  const [shapeStartPoint, setShapeStartPoint] = useState<{ x: number; y: number } | null>(null);

  // スタンプ関連
  const [selectedStampType, setSelectedStampType] = useState<'date' | 'approved' | 'rejected'>('date');

  // フォームフィールド関連
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [formFieldValues, setFormFieldValues] = useState<Record<string, string | boolean | string[]>>({});
  const [showFormFields, setShowFormFields] = useState(false); // フォームフィールドパネルの表示状態
  const [editingFormField, setEditingFormField] = useState<string | null>(null); // 編集中のフォームフィールドID

  // 電子署名・承認関連
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [showSignatureDialog, setShowSignatureDialog] = useState(false);
  const [signatureName, setSignatureName] = useState('');
  const [signatureEmail, setSignatureEmail] = useState('');
  const [signatureReason, setSignatureReason] = useState('');
  const [signatureLocation, setSignatureLocation] = useState('');
  const [signatureImage, setSignatureImage] = useState<string | null>(null); // Base64画像
  const [signatureText, setSignatureText] = useState(''); // テキスト署名
  const [signaturePosition, setSignaturePosition] = useState<'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'>('bottom-left'); // 署名位置
  const [showSplitDialog, setShowSplitDialog] = useState(false); // PDF分割ダイアログ
  const [showOCRDialog, setShowOCRDialog] = useState(false); // OCRダイアログ
  const [showTableOfContentsDialog, setShowTableOfContentsDialog] = useState(false); // 目次ダイアログ
  const [tableOfContents, setTableOfContents] = useState<TableOfContentsEntry[]>([]); // 目次データ
  const [isGeneratingTOC, setIsGeneratingTOC] = useState(false); // 目次生成中フラグ
  const [editingTOCIndex, setEditingTOCIndex] = useState<number | null>(null); // 編集中の目次エントリのインデックス
  const [editingTOCTitle, setEditingTOCTitle] = useState<string>(''); // 編集中の見出しタイトル
  const [textSelectionEnabled, setTextSelectionEnabled] = useState(false); // テキスト選択モード
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set([1, 2, 3, 4])); // 展開されている階層レベル
  const [ocrResults, setOcrResults] = useState<Record<number, OCRResult>>({}); // OCR結果（ページ番号をキーとする）
  const [isProcessingOCR, setIsProcessingOCR] = useState(false); // OCR処理中かどうか
  const [ocrProgress, setOcrProgress] = useState<{ current: number; total: number } | null>(null); // OCR進捗
  const [ocrLanguage, setOcrLanguage] = useState('jpn+eng'); // OCR言語
  const [ocrSearchQuery, setOcrSearchQuery] = useState(''); // OCR検索クエリ
  const [editingOcrPage, setEditingOcrPage] = useState<number | null>(null); // 編集中のOCRページ番号
  const [editingOcrText, setEditingOcrText] = useState(''); // 編集中のOCRテキスト
  const [currentOcrResultPage, setCurrentOcrResultPage] = useState(1); // 現在表示しているOCR結果のページ番号（検索結果内のインデックス）
  const [ocrThumbnailSize, setOcrThumbnailSize] = useState(200); // OCRサムネイルのサイズ（px）
  const [ocrPageRangeInput, setOcrPageRangeInput] = useState(''); // ページ指定入力（例: "1, 3, 5-7"）
  const [splitRangeInputs, setSplitRangeInputs] = useState<string[]>(['']); // PDF分割の範囲入力の配列（例: ["1-3, 5, 7-9", "11-13, 15, 17-19"]）
  const [showSplitDialogFromThumbnail, setShowSplitDialogFromThumbnail] = useState(false); // ページ管理モーダルから開いたPDF分割ダイアログ
  
  // プレゼンモード関連
  const [isPresentationMode, setIsPresentationMode] = useState(false); // スライドショーモード（全画面表示）
  const [showAnnotationsInPresentation, setShowAnnotationsInPresentation] = useState(true); // プレゼン中に注釈を表示するか
  const [showPageNumberInPresentation, setShowPageNumberInPresentation] = useState(true); // プレゼン中にページ番号を表示するか
  const [autoPageNumberEnabled, setAutoPageNumberEnabled] = useState(false); // 自動ページ番号表示
  const [autoPageNumberPosition, setAutoPageNumberPosition] = useState<'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'>('bottom-right'); // ページ番号の位置
  
  // プレゼンタイマー関連
  const [presentationTimer, setPresentationTimer] = useState<{ isRunning: boolean; elapsed: number; totalTime: number | null }>({
    isRunning: false,
    elapsed: 0,
    totalTime: null, // nullの場合は経過時間のみ表示
  });
  const [timerAlarms, setTimerAlarms] = useState<number[]>([]); // アラーム時間（秒）の配列
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // レーザーポインター関連
  const [laserPointerEnabled, setLaserPointerEnabled] = useState(false);
  const [laserPointerPosition, setLaserPointerPosition] = useState<{ x: number; y: number } | null>(null);
  const laserPointerTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // シナリオ関連
  const [scenarios, setScenarios] = useState<Record<number, string>>({}); // シナリオ（ページ番号をキーとする）
  const [showScenarioDialog, setShowScenarioDialog] = useState(false); // シナリオダイアログの表示状態
  const [editingScenarioPage, setEditingScenarioPage] = useState<number | null>(null); // 編集中のシナリオページ番号
  const [editingScenarioText, setEditingScenarioText] = useState(''); // 編集中のシナリオテキスト
  const [scenarioPrintPageBreak, setScenarioPrintPageBreak] = useState(false); // シナリオ印刷の改ページ設定
  
  // ダイアログが開いているときにbodyのpointer-eventsを有効化
  useEffect(() => {
    if (showSignatureDialog || showSplitDialog || showOCRDialog) {
      // ダイアログが開いているときはbodyのpointer-eventsをautoに設定
      document.body.style.pointerEvents = 'auto';
    } else {
      // ダイアログが閉じているときは元に戻す（必要に応じて）
      // document.body.style.pointerEvents = '';
    }
  }, [showSignatureDialog, showSplitDialog, showOCRDialog]);

  // Undo/Redo（strokes、shapes、textAnnotationsの全てを含む）
  type UndoState = {
    strokes: Stroke[];
    shapes: ShapeAnnotation[];
    texts: TextAnnotation[];
  };
  const [undoStack, setUndoStack] = useState<UndoState[]>([]);
  const [redoStack, setRedoStack] = useState<UndoState[]>([]);

  // Canvas refs
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const textCanvasRef = useRef<HTMLCanvasElement>(null);
  const shapeCanvasRef = useRef<HTMLCanvasElement>(null);
  const isFixingRotationRef = useRef<boolean>(false); // 回転修正中フラグ（無限ループ防止）
  const renderTaskRef = useRef<any>(null); // PDFレンダリングタスクの参照（キャンセル用）
  const textLayerRef = useRef<HTMLDivElement>(null); // テキストレイヤー用
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const isClearingRef = useRef(false); // クリア処理中かどうかを追跡

  // 選択ツールに切り替えたときに描画状態をリセット
  useEffect(() => {
    if (tool === 'select') {
      isDrawingRef.current = false;
      setCurrentStroke(null);
      setCurrentShape(null);
      setShapeStartPoint(null);
      // 選択ツールに切り替えたときに、inkCanvasRefをクリアして再描画（不要な描画を消すため）
      if (inkCanvasRef.current && pageSize) {
        const ctx = inkCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
          redrawStrokes(ctx, strokes, pageSize.width, pageSize.height);
        }
      }
    }
  }, [tool, strokes, pageSize]);

  // ダイアログ状態の監視（デバッグ用）
  useEffect(() => {
    console.log('showSignatureDialog changed:', showSignatureDialog);
  }, [showSignatureDialog]);

  useEffect(() => {
    console.log('showSplitDialog changed:', showSplitDialog);
  }, [showSplitDialog]);

  // OCR結果が更新されたら、最初のページを表示
  useEffect(() => {
    if (Object.keys(ocrResults).length > 0 && showOCRDialog) {
      setCurrentOcrResultPage(1);
    }
  }, [ocrResults, showOCRDialog]);

  // ocrThumbnailSizeが変更されたときに、既存のサムネイルを再生成（高解像度）
  useEffect(() => {
    if (!pdfDoc || !docId || Object.keys(ocrResults).length === 0) return;
    
    const regenerateThumbnails = async () => {
      if (!pdfDoc) return;
      
      const newThumbnails: Record<number, string> = {};
      
      for (const pageNumStr of Object.keys(ocrResults)) {
        const pageNum = parseInt(pageNumStr);
        try {
          // OCR処理では1ベースのページ番号を使用（データベースキー用）
          // PDF.jsは0ベースのインデックスを期待するので、getActualPageNumForPDFを使用
          const actualPageNumForPDF = getActualPageNumForPDF(pageNum);
          
          // 範囲チェック
          if (actualPageNumForPDF < 0 || actualPageNumForPDF >= pdfDoc.numPages) {
            console.warn(`サムネイル生成: 無効なページ番号 ${actualPageNumForPDF} (pageNum: ${pageNum}, totalPages: ${pdfDoc.numPages})`);
            continue;
          }
          
          const page = await pdfDoc.getPage(actualPageNumForPDF);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            const pageRotation = pageRotations[pageNum] || 0;
            const baseViewport = page.getViewport({ scale: 1.0, rotation: pageRotation });
            
            // ocrThumbnailSizeに応じたスケールを計算（高解像度を維持）
            const targetWidth = ocrThumbnailSize;
            const baseScale = targetWidth / baseViewport.width;
            
            // 高解像度を維持するため、デバイスピクセル比を考慮しつつ、最低でも2倍スケール
            const devicePixelRatio = window.devicePixelRatio || 1;
            const renderScale = Math.max(baseScale * 2.0, baseScale * devicePixelRatio, 2.0);
            
            const thumbnailViewport = page.getViewport({ scale: renderScale, rotation: pageRotation });
            
            // キャンバスサイズを高解像度で設定
            canvas.width = Math.floor(thumbnailViewport.width);
            canvas.height = Math.floor(thumbnailViewport.height);
            canvas.style.width = `${targetWidth}px`;
            canvas.style.height = `${(thumbnailViewport.height / thumbnailViewport.width) * targetWidth}px`;
            
            const renderContext = {
              canvasContext: ctx,
              viewport: thumbnailViewport,
              canvas: canvas,
            };
            
            await page.render(renderContext).promise;
            const thumbnailDataUrl = canvas.toDataURL('image/png', 1.0); // 最高品質でエクスポート
            
            newThumbnails[pageNum] = thumbnailDataUrl;
          }
        } catch (error) {
          console.warn(`ページ ${pageNum} のサムネイル再生成エラー:`, error);
        }
      }
      
      setThumbnails(prev => ({ ...prev, ...newThumbnails }));
    };
    
    // デバウンス処理（500ms待機してから再生成）
    const timeoutId = setTimeout(() => {
      regenerateThumbnails();
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [ocrThumbnailSize, pdfDoc, docId, ocrResults, pageRotations]);

  // シナリオを読み込む
  useEffect(() => {
    const loadScenarios = async () => {
      if (docId && pdfDoc) {
        const loadedScenarios = await getAllScenarios(docId, totalPages);
        setScenarios(loadedScenarios);
      }
    };
    loadScenarios();
  }, [docId, pdfDoc, totalPages]);

  // 検索クエリが変更されたら、最初のページを表示
  useEffect(() => {
    setCurrentOcrResultPage(1);
  }, [ocrSearchQuery]);


  // 自動オープン機能は無効化（手書きボタンのクリックでのみモーダルを開く）
  // テキスト入力フィールドにフォーカスしたときに自動的に手書きモーダルを開く機能は、
  // 無限ループの問題があるため削除

  // 複数ファイル（画像またはPDF）を1つのPDFに結合（既存のPDFがある場合はそれに追加）
  const combineImagesToPDF = async (files: File[], existingPdfBytes: ArrayBuffer | null = null): Promise<ArrayBuffer> => {
    const { PDFDocument } = await import('pdf-lib');
    
    let pdfDoc: any;
    let existingPageCount = 0;
    if (existingPdfBytes) {
      // 既存のPDFがある場合は、それにファイルを追加
      pdfDoc = await PDFDocument.load(existingPdfBytes);
      existingPageCount = pdfDoc.getPageCount();
      console.log('combineImagesToPDF: 既存のPDFを読み込み', {
        existingPageCount,
        existingPdfSize: existingPdfBytes.byteLength
      });
      
      // 既存のページが保持されているか確認
      if (existingPageCount === 0) {
        console.error('combineImagesToPDF: 警告 - 既存のPDFにページがありません！');
      } else {
        console.log('combineImagesToPDF: 既存のページを確認', {
          pageCount: existingPageCount,
          firstPageSize: pdfDoc.getPage(0).then ? '取得可能' : '取得不可'
        });
      }
    } else {
      // 既存のPDFがない場合は、新しいPDFを作成
      pdfDoc = await PDFDocument.create();
      console.log('combineImagesToPDF: 新しいPDFを作成');
    }
    
    // ファイルを追加する前のページ数を記録
    const beforeAddCount = pdfDoc.getPageCount();
    console.log('combineImagesToPDF: ファイル追加前のページ数', beforeAddCount);
    
    for (const file of files) {
      if (file.type === 'application/pdf') {
        // PDFファイルの場合は、すべてのページをコピー
        const pdfBytes = await file.arrayBuffer();
        const sourcePdf = await PDFDocument.load(pdfBytes);
        const pageCount = sourcePdf.getPageCount();
        const copiedPages = await pdfDoc.copyPages(sourcePdf, Array.from({ length: pageCount }, (_, i) => i));
        copiedPages.forEach((page: any) => pdfDoc.addPage(page));
        console.log('combineImagesToPDF: PDFファイルを追加', {
          fileName: file.name,
          pageCount: pageCount,
          currentTotalPages: pdfDoc.getPageCount()
        });
      } else if (file.type.startsWith('image/')) {
        // 画像ファイルの場合は、PDFに変換してから追加
        const imagePdfBytes = await convertImageToPDF(file, 0);
        const imagePdf = await PDFDocument.load(imagePdfBytes);
        const [imagePage] = await pdfDoc.copyPages(imagePdf, [0]);
        pdfDoc.addPage(imagePage);
        console.log('combineImagesToPDF: 画像を追加', {
          fileName: file.name,
          currentPageCount: pdfDoc.getPageCount()
        });
      } else {
        console.warn('combineImagesToPDF: サポートされていないファイルタイプ:', file.type, file.name);
      }
    }
    
    const finalPageCount = pdfDoc.getPageCount();
    console.log('combineImagesToPDF: ファイル追加完了', {
      existingPageCount,
      beforeAddCount,
      addedFiles: files.length,
      finalPageCount
    });
    
    const pdfBytes = await pdfDoc.save();
    return pdfBytes.buffer as ArrayBuffer;
  };

  // ファイル選択時の処理（画像またはPDF、PDF変換後に回転するため、プレビューは不要）
  const handleImageFileSelect = (file: File, addToCollection: boolean = false) => {
    console.log('handleImageFileSelect called:', file.name, 'addToCollection:', addToCollection, 'type:', file.type);
    if (addToCollection) {
      // 画像またはPDFをコレクションに追加（重複チェック）
      setImageFiles(prev => {
        // 既に同じファイルが存在するかチェック（名前とサイズで判定、lastModifiedはブラウザによって異なる場合があるため除外）
        const isDuplicate = prev.some(f => f.name === file.name && f.size === file.size);
        if (isDuplicate) {
          console.log('ファイルは既にコレクションに存在します:', file.name, 'サイズ:', file.size);
          return prev; // 重複している場合は追加しない
        }
        const newFiles = [...prev, file];
        console.log('ファイルをコレクションに追加:', file.name, '合計:', newFiles.length);
        console.log('新しいファイル配列:', newFiles.map(f => f.name));
        console.log('setImageFiles呼び出し: prev.length =', prev.length, 'newFiles.length =', newFiles.length);
        return newFiles;
      });
      // 状態更新後にモーダルを開く（useEffectで監視するため、ここでは開かない）
      console.log('handleImageFileSelect: addToCollection=trueのため、returnします');
      return;
    }

    // 既存の動作：単一画像を直接PDFに変換して読み込む
    const convertAndLoad = async () => {
      try {
        console.log('画像をPDFに変換します:', file.name, file.type, file.size);
        const arrayBuffer = await convertImageToPDF(file, 0);
        console.log('PDF変換完了:', arrayBuffer.byteLength, 'bytes');
        
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        const pdfFile = new File([blob], file.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });

        console.log('DocIdを生成します...');
        const id = await generateDocId(pdfFile);
        console.log('DocId生成完了:', id);
        setDocId(id);
        
        setOriginalPdfBytes(arrayBuffer);
        setOriginalFileName(pdfFile.name); // 変換後のPDFファイル名を保存
        
        console.log('PDFを読み込みます...');
        const doc = await loadPDF(pdfFile);
        console.log('PDF読み込み完了:', doc.numPages, 'pages');
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
        setScale(1.0);
        setPageRotations({}); // 初期回転は0度（空のオブジェクト）
        setStrokes([]);
        setUndoStack([]);
        setRedoStack([]);
        setPageSizes({});
        setTextItems([]);
        setTextInputValue('');
        setTextInputPosition(null);
        setEditingTextId(null);
        setShapeAnnotations([]);
        setTextAnnotations([]);
      } catch (error) {
        console.error('画像変換エラー:', error);
        toast({
          title: "エラー",
          description: '画像の変換に失敗しました: ' + (error instanceof Error ? error.message : String(error)),
          variant: "destructive",
        });
      }
    };
    
    convertAndLoad();
  };

  // 複数画像をPDFに結合して読み込む（既存のPDFがある場合はそれに追加）
  const loadCombinedImages = async () => {
    console.log('loadCombinedImages: 関数が呼ばれました', {
      imageFilesCount: imageFiles.length,
      hasOriginalPdf: !!originalPdfBytes,
      currentDocId: docId,
      currentTotalPages: totalPages,
      currentPage: currentPage
    });
    
    if (imageFiles.length === 0) {
      console.log('loadCombinedImages: 画像ファイルがありません');
      return;
    }
    
    try {
      // 既存のPDFがある場合はそれに追加、ない場合は新しいPDFを作成
      const existingPdfBytes = originalPdfBytes;
      const existingDocId = docId; // 既存のdocIdを保持
      const existingTotalPages = totalPages; // 既存のページ数を保持
      const existingCurrentPage = currentPage; // 既存の現在のページを保持
      
      console.log('loadCombinedImages: 既存のPDF情報', {
        hasExistingPdf: !!existingPdfBytes,
        existingDocId,
        existingTotalPages,
        existingCurrentPage,
        imageFilesCount: imageFiles.length
      });
      
      // 既存の注釈データを保存（既存のPDFがある場合）
      let existingAnnotations: Record<number, Stroke[]> = {};
      let existingTextAnnotations: Record<number, TextAnnotation[]> = {};
      let existingShapeAnnotations: Record<number, ShapeAnnotation[]> = {};
      
      if (existingPdfBytes && existingDocId) {
        existingAnnotations = await getAllAnnotations(existingDocId, existingTotalPages);
        existingTextAnnotations = await getAllTextAnnotations(existingDocId, existingTotalPages);
        existingShapeAnnotations = await getAllShapeAnnotations(existingDocId, existingTotalPages);
      }
      
      const arrayBuffer = await combineImagesToPDF(imageFiles, existingPdfBytes);
      console.log('loadCombinedImages: PDF結合完了', {
        hasExistingPdf: !!existingPdfBytes,
        combinedSize: arrayBuffer.byteLength
      });
      
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      
      // ファイル名を決定（既存のPDFがある場合は元のファイル名を使用、ない場合は新しい名前）
      const fileName = originalFileName 
        ? originalFileName.replace(/\.pdf$/i, '') + '_with_images.pdf'
        : `combined_${Date.now()}.pdf`;
      const pdfFile = new File([blob], fileName, { type: 'application/pdf' });
      
      console.log('loadCombinedImages: PDFファイル作成完了', {
        fileName,
        fileSize: pdfFile.size
      });

      // 既存のPDFがある場合はdocIdを保持、ない場合は新しいIDを生成
      // 注意: 既存のPDFに画像を追加するとファイル内容が変わるため、
      // generateDocIdは新しいIDを生成するが、既存のdocIdを保持する必要がある
      const finalDocId = existingDocId || await generateDocId(pdfFile);
      if (existingDocId) {
        // 既存のPDFがある場合は、docIdを変更しない（注釈データを保持するため）
        // setDocIdは呼ばない（既存のdocIdを保持）
      } else {
        // 新しいPDFの場合は新しいIDを設定
        setDocId(finalDocId);
      }
      
      setOriginalPdfBytes(arrayBuffer);
      setOriginalFileName(pdfFile.name);
      
      const doc = await loadPDF(pdfFile);
      const newTotalPages = doc.numPages;
      
      console.log('loadCombinedImages: PDF読み込み完了', {
        hasExistingPdf: !!existingPdfBytes,
        existingTotalPages,
        newTotalPages,
        existingCurrentPage
      });
      
      // 既存のPDFがある場合は現在のページを維持、ない場合は1ページ目に
      if (!existingPdfBytes) {
        setCurrentPage(1);
      }
      // 既存のPDFがある場合は、currentPageは変更しない（現在のページを維持）
      
      // 状態を一度に更新（Reactのバッチ更新を考慮）
      setPdfDoc(doc);
      setTotalPages(newTotalPages);
      
      // 既存のPDFがある場合は、既存のdocIdを使用して注釈データを保持
      // 注釈データは既にIndexedDBに保存されているため、追加の処理は不要
      // ページ番号は変わらないため、既存の注釈データはそのまま有効
      
      setPageSizes({}); // ページサイズは再計算が必要
      setTextItems([]); // テキスト検出は再実行が必要
      setImageFiles([]);
      setShowImageManager(false);
      
      // 現在のページの注釈を再読み込み
      if (existingPdfBytes && existingDocId) {
        // 既存のPDFがある場合は、既存のdocIdを使用して注釈を読み込み
        const currentPageNum = existingCurrentPage;
        const savedStrokes = await loadAnnotations(existingDocId, currentPageNum);
        const strokesWithIds = savedStrokes.map(stroke => ({
          ...stroke,
          id: stroke.id || `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        }));
        setStrokes(strokesWithIds);
        
        const savedTexts = await loadTextAnnotations(existingDocId, currentPageNum);
        setTextAnnotations(savedTexts);
        
        const savedShapes = await loadShapeAnnotations(existingDocId, currentPageNum);
        setShapeAnnotations(savedShapes);
      } else {
        // 新しいPDFの場合は注釈をクリア
        setStrokes([]);
        setTextAnnotations([]);
        setShapeAnnotations([]);
      }
      
      setUndoStack([]);
      setRedoStack([]);
      
      toast({
        title: "成功",
        description: existingPdfBytes 
          ? `元のPDFに${imageFiles.length}枚の画像を追加しました`
          : `${imageFiles.length}枚の画像を結合しました`,
        variant: "success",
      });
    } catch (error) {
      console.error('画像結合エラー:', error);
      toast({
        title: "エラー",
        description: '画像の結合に失敗しました: ' + (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    }
  };

  // 画像の順番を変更
  const moveImage = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === imageFiles.length - 1) return;
    
    const newFiles = [...imageFiles];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    [newFiles[index], newFiles[targetIndex]] = [newFiles[targetIndex], newFiles[index]];
    setImageFiles(newFiles);
  };

  // 画像を削除
  const removeImage = (index: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== index));
  };

  // カメラで写真を撮影
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } // 背面カメラを優先
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsRecording(true);
      }
    } catch (error) {
      console.error('カメラ起動エラー:', error);
      toast({
        title: "エラー",
        description: 'カメラへのアクセスに失敗しました。カメラの権限を確認してください。',
        variant: "destructive",
      });
    }
  };

  // カメラを停止
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsRecording(false);
  };

  // 写真を撮影
  const capturePhoto = (addToCollection: boolean = false) => {
    if (!videoRef.current || !cameraCanvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = cameraCanvasRef.current;
    const context = canvas.getContext('2d');
    
    if (!context) return;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);
    
    // CanvasからBlobに変換
    canvas.toBlob((blob) => {
      if (!blob) return;
      
      const file = new File([blob], `camera_${Date.now()}.jpg`, { type: 'image/jpeg' });
      handleImageFileSelect(file, addToCollection);
      stopCamera();
      setShowCameraModal(false);
    }, 'image/jpeg', 0.95);
  };

  // 音声入力の開始
  const startVoiceInput = () => {
    console.log('startVoiceInput called');
    console.log('SpeechRecognition available:', 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
    
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      console.error('音声認識APIが利用できません');
      toast({
        title: "エラー",
        description: 'お使いのブラウザは音声認識に対応していません。ChromeまたはEdgeをご使用ください。',
        variant: "destructive",
      });
      return;
    }

    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      console.log('SpeechRecognition class:', SpeechRecognition);
      
      if (!SpeechRecognition) {
        console.error('SpeechRecognition class not found');
        toast({
          title: "エラー",
          description: '音声認識APIが利用できません。',
          variant: "destructive",
        });
        return;
      }

      console.log('Creating SpeechRecognition instance...');
      const recognition = new SpeechRecognition();
      recognition.lang = voiceLanguage; // 選択された言語を使用
      recognition.continuous = true; // 連続認識モードに変更（手動で停止するまで続く）
      recognition.interimResults = true; // 中間結果も取得

      recognition.onstart = () => {
        console.log('音声認識を開始しました');
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        // 連続認識モードでは、すべての結果を取得
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript + ' ';
          } else {
            interimTranscript += transcript;
          }
        }
        
        // 確定した結果をテキスト入力フィールドに追加
        if (finalTranscript.trim() && textInputPosition) {
          setTextInputValue(prev => prev + finalTranscript);
          console.log('音声認識結果（確定）:', finalTranscript);
        }
        
        // 中間結果は表示のみ（テキスト入力フィールドには追加しない）
        if (interimTranscript) {
          console.log('音声認識結果（中間）:', interimTranscript);
        }
        
        // 連続認識モードでは自動終了しない（手動で停止するまで続く）
      };

      recognition.onerror = (event: any) => {
        console.error('音声認識エラー:', event.error);
        let errorMessage = '音声認識に失敗しました';
        if (event.error === 'no-speech') {
          errorMessage = '音声が検出されませんでした。もう一度お試しください。';
        } else if (event.error === 'not-allowed') {
          errorMessage = 'マイクへのアクセスが許可されていません。ブラウザの設定を確認してください。';
        } else if (event.error === 'network') {
          errorMessage = 'ネットワークエラーが発生しました。';
        } else {
          errorMessage = `音声認識に失敗しました: ${event.error}`;
        }
        toast({
          title: "エラー",
          description: errorMessage,
          variant: "destructive",
        });
        setIsListening(false);
      };

      recognition.onend = () => {
        console.log('音声認識が終了しました');
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      console.log('Starting recognition...');
      recognition.start();
      console.log('Recognition started');
    } catch (error) {
      console.error('音声認識の初期化エラー:', error);
      toast({
        title: "エラー",
        description: '音声認識の初期化に失敗しました: ' + (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    }
  };

  // 音声入力の停止
  const stopVoiceInput = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setShowVoiceInput(false);
  };

  // ファイル（画像またはPDF）が追加されたときにモーダルを開く
  useEffect(() => {
    const length = imageFiles.length;
    console.log('useEffect: imageFiles changed, length:', length, 'imageFiles:', imageFiles.map(f => f.name));
    if (length > 0) {
      console.log('ファイル管理モーダルを開きます - showImageManagerをtrueに設定します');
      // 少し遅延させてからモーダルを開く（状態更新を確実にするため）
      const timer = setTimeout(() => {
        console.log('setShowImageManager(true)を実行します');
        setShowImageManager(true);
        console.log('setShowImageManager(true)を実行しました');
        const imageCount = imageFiles.filter(f => f.type.startsWith('image/')).length;
        const pdfCount = imageFiles.filter(f => f.type === 'application/pdf').length;
        toast({
          title: "成功",
          description: `ファイルをコレクションに追加しました（画像: ${imageCount}枚、PDF: ${pdfCount}件、合計: ${length}件）`,
          variant: "success",
        });
      }, 100);
      return () => clearTimeout(timer);
    } else {
      // ファイルが0件になったらモーダルを閉じる
      console.log('useEffect: imageFiles.lengthが0になったため、モーダルを閉じます');
      setShowImageManager(false);
    }
  }, [imageFiles.length]); // imageFiles.lengthが変更されたときのみ実行

  // showImageManagerの状態を監視
  useEffect(() => {
    console.log('showImageManager changed:', showImageManager);
  }, [showImageManager]);

  // showVoiceInputの状態を監視
  useEffect(() => {
    console.log('showVoiceInput changed:', showVoiceInput);
  }, [showVoiceInput]);

  // 音声入力モーダルが開いたときに自動的に起動（オプション）
  useEffect(() => {
    // 自動起動はしない（ユーザーがボタンをクリックしてから起動）
    // 必要に応じて以下のコメントを外す
    // if (showVoiceInput && !isListening && !recognitionRef.current) {
    //   startVoiceInput();
    // }
  }, [showVoiceInput]);

  // カメラモーダルが開かれたときにカメラを起動
  useEffect(() => {
    if (showCameraModal) {
      startCamera();
    } else {
      stopCamera();
    }
    
    return () => {
      stopCamera();
    };
  }, [showCameraModal]);

  // ファイル選択（PDFまたは画像）
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, addToCollection: boolean = false) => {
    console.log('handleFileSelect called', { files: e.target.files, addToCollection });
    const files = e.target.files;
    if (!files || files.length === 0) {
      console.log('handleFileSelect: ファイルが選択されていません');
      return;
    }

    // 複数ファイルが選択された場合、すべてをコレクションに追加（重複チェック）
    if (files.length > 1) {
      const validFiles = Array.from(files).filter(f => 
        f.type.startsWith('image/') || f.type === 'application/pdf'
      );
      if (validFiles.length > 0) {
        setImageFiles(prev => {
          // 重複を除外（名前とサイズで判定、lastModifiedはブラウザによって異なる場合があるため除外）
          const newFiles = validFiles.filter(newFile => 
            !prev.some(existingFile => 
              existingFile.name === newFile.name && 
              existingFile.size === newFile.size
            )
          );
          return [...prev, ...newFiles];
        });
        setShowImageManager(true);
        // inputをリセット
        e.target.value = '';
        return;
      }
    }

    const file = files[0];

    // 画像ファイルまたはPDFファイルの場合
    if (file.type.startsWith('image/') || file.type === 'application/pdf') {
      if (addToCollection) {
        // コレクションに追加
        handleImageFileSelect(file, true);
      } else if (file.type.startsWith('image/')) {
        // 画像ファイルの場合は既存の処理
        handleImageFileSelect(file, false);
      } else {
        // PDFファイルの場合は直接読み込む
        try {
          console.log('PDFファイルを読み込みます:', file.name, file.type, file.size);
          const arrayBuffer = await file.arrayBuffer();
          console.log('ファイルをArrayBufferに変換しました:', arrayBuffer.byteLength, 'bytes');
          const id = await generateDocId(file);
          console.log('DocIdを生成しました:', id);
          setDocId(id);
          
          setOriginalPdfBytes(arrayBuffer);
          setOriginalFileName(file.name); // 元のファイル名を保存
          
          console.log('PDF.jsでPDFを読み込みます...');
          const doc = await loadPDF(file);
          console.log('PDFを読み込みました:', doc.numPages, 'pages');
          setPdfDoc(doc);
          setTotalPages(doc.numPages);
          setCurrentPage(1);
          setScale(1.0);
          setStrokes([]);
          setUndoStack([]);
          setRedoStack([]);
          setPageSizes({});
          setTextItems([]);
          setTextInputValue('');
          setTextInputPosition(null);
          setEditingTextId(null);
          setShapeAnnotations([]);
          setTextAnnotations([]);
          
          // フォームフィールドを抽出
          try {
            const { PDFDocument } = await import('pdf-lib');
            const pdfDoc = await PDFDocument.load(arrayBuffer);
            const fields = await extractFormFields(pdfDoc);
            const fieldsWithCalculations = setupCommonCalculations(fields);
            setFormFields(fieldsWithCalculations);
            
            // 初期値を設定
            const initialValues: Record<string, string | boolean | string[]> = {};
            fieldsWithCalculations.forEach(field => {
              initialValues[field.name] = field.value;
            });
            setFormFieldValues(initialValues);
            
            if (fieldsWithCalculations.length > 0) {
              toast({
                title: "フォーム検出",
                description: `${fieldsWithCalculations.length}個のフォームフィールドを検出しました`,
              });
            }
          } catch (formError) {
            console.warn('フォームフィールドの抽出に失敗:', formError);
            // フォームフィールドがない場合はエラーを無視
            setFormFields([]);
            setFormFieldValues({});
          }
          
          // 署名を読み込む
          if (id) {
            try {
              const loadedSignatures = await getAllSignatures(id);
              setSignatures(loadedSignatures);
              
              // OCR結果を読み込む
              const loadedOcrResults = await getAllOCRResults(id, doc.numPages);
              // 既存のOCR結果にも不要なスペース削除を適用
              const cleanedOcrResults: Record<number, OCRResult> = {};
              for (const [pageNum, result] of Object.entries(loadedOcrResults)) {
                cleanedOcrResults[parseInt(pageNum)] = {
                  ...result,
                  text: removeUnnecessarySpaces(result.text),
                };
              }
              setOcrResults(cleanedOcrResults);
            } catch (error) {
              console.warn('署名・ワークフロー・OCR結果の読み込みに失敗:', error);
            }
          }
        } catch (error) {
          console.error('ファイル読み込みエラー:', error);
          console.error('エラーの詳細:', {
            name: error instanceof Error ? error.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          toast({
            title: "エラー",
            description: 'ファイルの読み込みに失敗しました: ' + (error instanceof Error ? error.message : String(error)),
            variant: "destructive",
          });
        }
      }
      // inputをリセット
      e.target.value = '';
      return;
    } else {
      toast({
        title: "通知",
        description: "PDFファイルまたは画像ファイル（PNG、JPEG、WebPなど）を選択してください",
      });
    }
  };

  // 透かしをCanvasに描画する関数
  const drawWatermarkOnCanvas = useCallback((ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number) => {
    if (!watermarkText || !watermarkText.trim() || !showWatermarkPreview) return;
    
    const pattern = watermarkPattern || 'center';
    const density = watermarkDensity || 3;
    const angle = watermarkAngle ?? 45; // 0度も有効な値として扱うため、??を使用
    const opacity = watermarkOpacity ?? 0.5; // 濃度（0-1）
    
    const fontSize = Math.min(canvasWidth, canvasHeight) * 0.1;
    ctx.font = `${fontSize}px Arial, sans-serif`;
    const textMetrics = ctx.measureText(watermarkText);
    const textWidth = textMetrics.width;
    const textHeight = fontSize * 1.2;
    
    ctx.save();
    ctx.globalAlpha = opacity; // 濃度を適用
    ctx.fillStyle = `rgba(128, 128, 128, ${opacity})`; // 濃度を適用
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (pattern === 'center') {
      // 中央1箇所
      ctx.save();
      ctx.translate(canvasWidth / 2, canvasHeight / 2);
      if (angle !== 0) {
        ctx.rotate(angle * Math.PI / 180);
      }
      ctx.fillText(watermarkText, 0, 0);
      ctx.restore();
    } else if (pattern === 'grid') {
      // グリッド状
      const cols = density;
      const rows = density;
      const spacingX = canvasWidth / (cols + 1);
      const spacingY = canvasHeight / (rows + 1);
      
      for (let row = 1; row <= rows; row++) {
        for (let col = 1; col <= cols; col++) {
          const x = col * spacingX;
          const y = row * spacingY;
          ctx.save();
          ctx.translate(x, y);
          if (angle !== 0) {
            ctx.rotate(angle * Math.PI / 180);
          }
          ctx.fillText(watermarkText, 0, 0);
          ctx.restore();
        }
      }
    } else if (pattern === 'tile') {
      // タイル状
      const spacingX = canvasWidth / density;
      const spacingY = canvasHeight / density;
      
      for (let y = spacingY / 2; y < canvasHeight; y += spacingY) {
        for (let x = spacingX / 2; x < canvasWidth; x += spacingX) {
          ctx.save();
          ctx.translate(x, y);
          if (angle !== 0) {
            ctx.rotate(angle * Math.PI / 180);
          }
          ctx.fillText(watermarkText, 0, 0);
          ctx.restore();
        }
      }
    }
    
    ctx.restore();
  }, [watermarkText, showWatermarkPreview, watermarkPattern, watermarkDensity, watermarkAngle, watermarkOpacity]);

  // スライドショーモードが変更されたときに再レンダリング
  useEffect(() => {
    if (isPresentationMode && pdfDoc) {
      // プレゼンモード開始時に状態をリセット
      setPresentationTimer({ isRunning: false, elapsed: 0, totalTime: null });
      setLaserPointerEnabled(false);
      setLaserPointerPosition(null);
      renderCurrentPage();
    } else if (!isPresentationMode) {
      // プレゼンモード終了時にタイマーを停止
      setPresentationTimer(prev => ({ ...prev, isRunning: false }));
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      if (laserPointerTimeoutRef.current) {
        clearTimeout(laserPointerTimeoutRef.current);
        laserPointerTimeoutRef.current = null;
      }
    }
  }, [isPresentationMode]);

  // プレゼンタイマーの処理
  useEffect(() => {
    console.log('タイマーuseEffect実行:', { isRunning: presentationTimer.isRunning, isPresentationMode, elapsed: presentationTimer.elapsed });
    
    if (presentationTimer.isRunning && isPresentationMode) {
      console.log('タイマー開始');
      timerIntervalRef.current = setInterval(() => {
        setPresentationTimer(prev => {
          const newElapsed = prev.elapsed + 1;
          console.log('タイマー更新:', newElapsed);
          // アラームチェック
          timerAlarms.forEach(alarmTime => {
            if (newElapsed === alarmTime) {
              toast({
                title: "タイマーアラーム",
                description: `${Math.floor(alarmTime / 60)}分経過しました`,
                variant: "default",
              });
            }
          });
          return { ...prev, elapsed: newElapsed };
        });
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        console.log('タイマー停止');
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [presentationTimer.isRunning, isPresentationMode, timerAlarms]);

  // ページレンダリング
  const renderCurrentPage = async () => {
    if (!pdfDoc || !pdfCanvasRef.current || !inkCanvasRef.current) return;

    try {
      // pageOrderが設定されている場合は、表示順序から実際のページ番号に変換
      const actualPageNum = getActualPageNum(currentPage);
      console.log('renderCurrentPage:', { currentPage, actualPageNum, totalPages: pdfDoc.numPages });
      const page = await pdfDoc.getPage(actualPageNum);
      const pdfCanvas = pdfCanvasRef.current;
      const inkCanvas = inkCanvasRef.current;

      // スライドショーモードの場合は、画面に収まるようにスケールを計算
      let renderScale = scale;
      if (isPresentationMode) {
        // actualPageNumは1ベースの実際のページ番号なので、そのままpageRotationsを参照
        const viewport = page.getViewport({ scale: 1.0, rotation: pageRotations[actualPageNum] || 0 });
        const maxWidth = window.innerWidth * 0.95; // 表示領域を最大限活用
        const maxHeight = (window.innerHeight - 68) * 0.95; // コントロールバーの高さを考慮（さらにコンパクト化）
        const scaleX = maxWidth / viewport.width;
        const scaleY = maxHeight / viewport.height;
        renderScale = Math.min(scaleX, scaleY, 2.0); // 最大2倍まで
      }

      // 前のレンダリングタスクを確実にキャンセルして完了を待つ（根本的な解決）
      const previousTask = renderTaskRef.current;
      if (previousTask) {
        try {
          // タスクが存在し、まだ実行中の場合のみキャンセル
          if (previousTask && typeof previousTask.cancel === 'function') {
            // キャンセル前にタスクの状態を確認
            const taskState = (previousTask as any)._internalRenderTask?.cancelled;
            if (!taskState) {
              previousTask.cancel();
              // タスクのpromiseが完了またはキャンセルされるまで待機
              // エラーでも成功でも完了を待つ
              try {
                await Promise.race([
                  previousTask.promise,
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
                ]).catch((error) => {
                  // キャンセルエラーやタイムアウトは無視
                });
              } catch (error) {
                // エラーは無視（キャンセルエラーは正常）
              }
              // さらに少し待機して確実に完了させる
              await new Promise(resolve => setTimeout(resolve, 500));
              console.log('レンダリングタスクが完全にキャンセルされました');
            }
          }
        } catch (error) {
          console.log('レンダリングタスクのキャンセル中にエラー:', error);
        }
        // 確実にnullに設定
        renderTaskRef.current = null;
      }

      // キャンバスを完全にリセット（前のレンダリングタスクがキャンバスを使用できなくする）
      // 新しいキャンバスコンテキストを取得するために、一度サイズを0にリセット
      const oldWidth = pdfCanvas.width;
      const oldHeight = pdfCanvas.height;
      pdfCanvas.width = 0;
      pdfCanvas.height = 0;
      // キャンバスが完全にリセットされるまで待機
      await new Promise(resolve => setTimeout(resolve, 200));

      // PDFをレンダリング（プレゼンモードでは回転を0に固定してそのまま表示）
      // 回転処理を無視して、PDFの元の向きのまま表示する
      // actualPageNumは1ベースの実際のページ番号なので、そのままpageRotationsを参照
      const currentRotation = isPresentationMode ? 0 : (pageRotations[actualPageNum] || 0);
      
      // 新しいレンダリングタスクを開始（前のタスクは既にキャンセル済みなのでnullを渡す）
      const result = await renderPage(page, pdfCanvas, renderScale, currentRotation, null);
      renderTaskRef.current = result.task; // レンダリングタスクを保存
      const size = { width: result.width, height: result.height };
      setPageSize(size);

      // プレゼンモードで逆さ表示が発生する場合の自動修正：レンダリングを2回実行
      // 無限ループを防ぐためにフラグで制御し、直接レンダリングを再実行
      if (isPresentationMode && !isFixingRotationRef.current && pdfDoc && pdfCanvas) {
        isFixingRotationRef.current = true;
        // 一度レンダリングを完了させてから、再度レンダリングを実行
        await new Promise(resolve => setTimeout(resolve, 300));
        // 同じページを再度レンダリング（これにより逆さ表示が修正される）
        try {
          const samePage = await pdfDoc.getPage(actualPageNum);
          const fixResult = await renderPage(samePage, pdfCanvas, renderScale, 0, renderTaskRef.current);
          renderTaskRef.current = fixResult.task;
        } catch (error) {
          console.log('回転修正レンダリングエラー:', error);
        }
        // フラグをリセット
        setTimeout(() => {
          isFixingRotationRef.current = false;
        }, 1000);
      }

      // テキストレイヤーを生成（テキスト選択可能にする）
      if (textLayerRef.current) {
        const viewport = page.getViewport({ scale, rotation: currentRotation });
        await renderTextLayer(page, textLayerRef.current, viewport);
      }
      
      // ページサイズを記録（エクスポート用、scale=1.0でのサイズ）
      if (scale === 1.0) {
        // pageOrderが設定されている場合は、実際のページ番号で記録
        const actualPageNum = getActualPageNum(currentPage);
        setPageSizes(prev => ({ ...prev, [actualPageNum]: size }));
      }

      // テキストを抽出（スナップ機能用、またはテキスト選択モード用）
      if (snapToTextEnabled || textSelectionEnabled) {
        try {
          const items = await extractTextItems(page, scale);
          setTextItems(items);
          console.log('テキスト抽出成功:', items.length, '個のテキストアイテム');
        } catch (error) {
          console.error('テキスト抽出に失敗しました:', error);
          console.error('エラー詳細:', {
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          setTextItems([]);
        }
      } else {
        setTextItems([]);
      }

      // inkCanvasのサイズをPDF canvasと同じに設定（devicePixelRatioも考慮）
      const devicePixelRatio = window.devicePixelRatio || 1;
      inkCanvas.width = pdfCanvas.width;
      inkCanvas.height = pdfCanvas.height;
      inkCanvas.style.width = pdfCanvas.style.width;
      inkCanvas.style.height = pdfCanvas.style.height;

      // textCanvasのサイズも同じに設定
      if (textCanvasRef.current) {
        const textCanvas = textCanvasRef.current;
        textCanvas.width = pdfCanvas.width;
        textCanvas.height = pdfCanvas.height;
        textCanvas.style.width = pdfCanvas.style.width;
        textCanvas.style.height = pdfCanvas.style.height;
      }

      // shapeCanvasのサイズも同じに設定
      if (shapeCanvasRef.current) {
        const shapeCanvas = shapeCanvasRef.current;
        shapeCanvas.width = pdfCanvas.width;
        shapeCanvas.height = pdfCanvas.height;
        shapeCanvas.style.width = pdfCanvas.style.width;
        shapeCanvas.style.height = pdfCanvas.style.height;
      }

      // 注釈を読み込み
      if (docId && !isClearingRef.current) {
        // pageOrderが設定されている場合は、表示順序から実際のページ番号に変換
        const actualPageNum = getActualPageNum(currentPage);
        const savedStrokes = await loadAnnotations(docId, actualPageNum);
        console.log('renderCurrentPage: データベースから読み込み', { actualPageNum, savedStrokesCount: savedStrokes.length });
        // 既存のストロークにIDがない場合は生成
        const strokesWithIds = savedStrokes.map(stroke => ({
          ...stroke,
          id: stroke.id || `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        }));
        setStrokes(strokesWithIds);
        setUndoStack([]);
        setRedoStack([]);

        // テキスト注釈を読み込み
        const savedTexts = await loadTextAnnotations(docId, actualPageNum);
        setTextAnnotations(savedTexts);

        // 図形注釈を読み込み
        const savedShapes = await loadShapeAnnotations(docId, actualPageNum);
        setShapeAnnotations(savedShapes);

        // テキスト入力モーダルをクリア（編集中のテキストをリセット）
        setTextInputValue('');
        setTextInputPosition(null);
        setEditingTextId(null);

        // 注釈を再描画（表示サイズで描画）
        const inkCtx = inkCanvas.getContext('2d');
        if (inkCtx) {
          // devicePixelRatioを考慮してスケールを設定
          inkCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          redrawStrokes(inkCtx, savedStrokes, size.width, size.height);
        }

        // テキスト注釈を再描画
        if (textCanvasRef.current) {
          const textCtx = textCanvasRef.current.getContext('2d');
          if (textCtx) {
            textCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            redrawTextAnnotations(textCtx, savedTexts, size.width, size.height);
          }
        }

        // 図形注釈を再描画
        if (shapeCanvasRef.current) {
          const shapeCtx = shapeCanvasRef.current.getContext('2d');
          if (shapeCtx) {
            shapeCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            redrawShapeAnnotations(shapeCtx, savedShapes, size.width, size.height).catch(console.error);
          }
        }

        // 透かしプレビューを描画
        if (showWatermarkPreview && watermarkText && watermarkText.trim()) {
          const inkCtx = inkCanvas.getContext('2d');
          if (inkCtx) {
            inkCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            drawWatermarkOnCanvas(inkCtx, size.width, size.height);
          }
        }
      } else {
        // 新規PDF読み込み時もinkCanvasを初期化
        const inkCtx = inkCanvas.getContext('2d');
        if (inkCtx) {
          inkCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        }
        if (textCanvasRef.current) {
          const textCtx = textCanvasRef.current.getContext('2d');
          if (textCtx) {
            textCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          }
        }
        if (shapeCanvasRef.current) {
          const shapeCtx = shapeCanvasRef.current.getContext('2d');
          if (shapeCtx) {
            shapeCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          }
        }
      }
    } catch (error) {
      console.error('ページレンダリングエラー:', error);
    }
  };

  // ページ変更時に再レンダリング
  // pageOrderはgetActualPageNum内で参照されるため、依存配列から除外
  // （pageOrderが変更されても、currentPageが変わらない限り再レンダリングしない）
  useEffect(() => {
    // pdfDocが有効な場合のみレンダリング
    if (pdfDoc && pdfDoc.numPages > 0) {
      renderCurrentPage();
    }
      }, [pdfDoc, currentPage, scale, docId, pageRotations, showWatermarkPreview, watermarkText, watermarkPattern, watermarkDensity, watermarkAngle, watermarkOpacity, drawWatermarkOnCanvas, snapToTextEnabled, textSelectionEnabled, isPresentationMode]);

  // strokesの状態変更時に再描画（ハイライトなどが追加/削除されたとき）
  useEffect(() => {
    if (inkCanvasRef.current && pageSize) {
      const ctx = inkCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        // strokesが空の配列の場合は、キャンバスをクリアしてから再描画
        if (strokes.length === 0) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
          ctx.restore();
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        }
        redrawStrokes(ctx, strokes, pageSize.width, pageSize.height);
        // 透かしプレビューを描画
        if (showWatermarkPreview && watermarkText && watermarkText.trim()) {
          drawWatermarkOnCanvas(ctx, pageSize.width, pageSize.height);
        }
      }
    }
  }, [strokes, pageSize, showWatermarkPreview, watermarkText, watermarkPattern, watermarkDensity, watermarkAngle, watermarkOpacity, drawWatermarkOnCanvas]);

  // サムネイル生成（注釈なし）
  const generateThumbnails = async () => {
    if (!pdfDoc) return;

    const newThumbnails: Record<number, string> = {};
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        console.log('generateThumbnails:', { pageNum, totalPages });
        const page = await pdfDoc.getPage(pageNum);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) continue;

        // サムネイルサイズ（ページ管理用：幅120px、高さはアスペクト比を保持）
        const pageRotation = pageRotations[pageNum] || 0;
        const viewport = page.getViewport({ scale: 1.0, rotation: pageRotation });
        const thumbnailScale = 120 / viewport.width;
        const thumbnailViewport = page.getViewport({ scale: thumbnailScale, rotation: pageRotation });
        
        // デバイスピクセル比を考慮して高解像度で生成（ページ管理用は控えめに）
        const devicePixelRatio = window.devicePixelRatio || 1;
        const outputScale = devicePixelRatio; // ページ管理用は1倍で十分
        
        canvas.width = Math.floor(thumbnailViewport.width * outputScale);
        canvas.height = Math.floor(thumbnailViewport.height * outputScale);
        canvas.style.width = `${thumbnailViewport.width}px`;
        canvas.style.height = `${thumbnailViewport.height}px`;
        
        ctx.scale(outputScale, outputScale);

        const renderContext = {
          canvasContext: ctx,
          viewport: thumbnailViewport,
          canvas: canvas,
        };

        await page.render(renderContext).promise;
        newThumbnails[pageNum] = canvas.toDataURL('image/png');
      } catch (error) {
        console.error(`ページ ${pageNum} のサムネイル生成エラー:`, error);
      }
    }

    setThumbnails(newThumbnails);
  };

  // 注釈付きサムネイル生成
  const generateThumbnailsWithAnnotations = async () => {
    if (!pdfDoc || !docId) return;

    const newThumbnails: Record<number, string> = {};
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        console.log('generateThumbnailsWithAnnotations:', { pageNum, totalPages });
        const page = await pdfDoc.getPage(pageNum);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) continue;

        // サムネイルサイズ（ページ管理用：幅120px、高さはアスペクト比を保持）
        const pageRotation = pageRotations[pageNum] || 0;
        const viewport = page.getViewport({ scale: 1.0, rotation: pageRotation });
        const thumbnailScale = 120 / viewport.width;
        const thumbnailViewport = page.getViewport({ scale: thumbnailScale, rotation: pageRotation });
        
        // デバイスピクセル比を考慮して高解像度で生成（ページ管理用は控えめに）
        const devicePixelRatio = window.devicePixelRatio || 1;
        const outputScale = devicePixelRatio; // ページ管理用は1倍で十分
        
        canvas.width = Math.floor(thumbnailViewport.width * outputScale);
        canvas.height = Math.floor(thumbnailViewport.height * outputScale);
        canvas.style.width = `${thumbnailViewport.width}px`;
        canvas.style.height = `${thumbnailViewport.height}px`;
        
        ctx.scale(outputScale, outputScale);

        // PDFをレンダリング
        const renderContext = {
          canvasContext: ctx,
          viewport: thumbnailViewport,
          canvas: canvas,
        };

        await page.render(renderContext).promise;

        // 注釈を描画
        const actualPageNum = getActualPageNum(pageNum);
        const savedStrokes = await loadAnnotations(docId, actualPageNum);
        const savedTexts = await loadTextAnnotations(docId, actualPageNum);
        const savedShapes = await loadShapeAnnotations(docId, actualPageNum);

        // ストロークを描画（PDFの上に重ねるため、クリアしない）
        if (savedStrokes.length > 0) {
          redrawStrokes(ctx, savedStrokes, thumbnailViewport.width, thumbnailViewport.height, false);
        }

        // テキスト注釈を描画（サムネイル用にフォントサイズをスケール）
        if (savedTexts.length > 0) {
          redrawTextAnnotations(ctx, savedTexts, thumbnailViewport.width, thumbnailViewport.height, thumbnailScale);
        }

        // 図形注釈を描画
        if (savedShapes.length > 0) {
          await redrawShapeAnnotations(ctx, savedShapes, thumbnailViewport.width, thumbnailViewport.height);
        }

        newThumbnails[pageNum] = canvas.toDataURL('image/png');
      } catch (error) {
        console.error(`ページ ${pageNum} の注釈付きサムネイル生成エラー:`, error);
      }
    }

    setThumbnailsWithAnnotations(newThumbnails);
  };

  // 透かし履歴を読み込む
  useEffect(() => {
    const loadWatermarkHistory = async () => {
      try {
        const history = await getAllWatermarkHistory();
        setWatermarkHistory(history);
      } catch (error) {
        console.error('透かし履歴の読み込みに失敗:', error);
      }
    };
    loadWatermarkHistory();
  }, []);

  // PDF読み込み時にサムネイルを生成
  useEffect(() => {
    if (pdfDoc && totalPages > 0) {
      generateThumbnails();
      generateThumbnailsWithAnnotations();
    }
  }, [pdfDoc, totalPages, docId, pageRotations]);

  // 注釈が変更されたときに注釈付きサムネイルを再生成
  useEffect(() => {
    if (pdfDoc && totalPages > 0 && docId && showThumbnailsWithAnnotations) {
      generateThumbnailsWithAnnotations();
    }
  }, [strokes, textAnnotations, shapeAnnotations]);

  // ページ順序を初期化
  useEffect(() => {
    if (totalPages > 0) {
      setPageOrder(Array.from({ length: totalPages }, (_, i) => i + 1));
      setHasUnsavedPageOrder(false);
    }
  }, [totalPages]);

  // モバイルデバイス検出
  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || 
                            (window.innerWidth <= 768 && 'ontouchstart' in window);
      setIsMobile(isMobileDevice);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 自動保存機能（30秒ごと）
  useEffect(() => {
    if (!docId || !pdfDoc) return;

    const autoSaveInterval = setInterval(async () => {
      if (isSaving) return; // 既に保存中の場合はスキップ

    try {
      setIsSaving(true);
        // pageOrderが設定されている場合は、表示順序から実際のページ番号に変換
        const actualPageNum = getActualPageNum(currentPage);
        await saveAnnotations(docId, actualPageNum, strokes);
        await saveShapeAnnotations(docId, actualPageNum, shapeAnnotations);
        await saveTextAnnotations(docId, actualPageNum, textAnnotations);
      setLastSaved(new Date());
    } catch (error) {
        console.error('自動保存エラー:', error);
    } finally {
      setIsSaving(false);
    }
    }, 30000); // 30秒ごと

    return () => clearInterval(autoSaveInterval);
  }, [docId, currentPage, strokes, shapeAnnotations, textAnnotations, pdfDoc, isSaving]);

  // キーボードショートカット
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmdキーが押されている場合
      const isCtrl = e.ctrlKey || e.metaKey;
      
      // スライドショーモード中のキーボードショートカット（優先処理）
      if (isPresentationMode) {
        // Esc: スライドショーモードを終了
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setIsPresentationMode(false);
          return;
        }

        // ←: 前のページ
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          goToPrevPage();
          return;
        }

        // →: 次のページ
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          goToNextPage();
          return;
        }

        // スペース: 次のページ
        if (e.key === ' ' && !isCtrl) {
          e.preventDefault();
          e.stopPropagation();
          goToNextPage();
          return;
        }

        // L: レーザーポインターの切り替え
        if (e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          e.stopPropagation();
          setLaserPointerEnabled(prev => !prev);
          return;
        }
      }
      
      // 入力フィールドにフォーカスがある場合は無視（スライドショーモード以外）
      if (
        !isPresentationMode && (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target instanceof HTMLButtonElement && e.target.type !== 'button')
        )
      ) {
        return;
      }

      // Ctrl+Z: Undo
      if (isCtrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl+Y または Ctrl+Shift+Z: Redo
      if (isCtrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Ctrl+S: エクスポート（PDF）
      if (isCtrl && e.key === 's') {
        e.preventDefault();
        if (pdfDoc && !isExporting) {
          handleExport();
        }
        return;
      }

      // Delete: 選択した注釈の削除
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedAnnotationIds.strokes.length > 0 || selectedAnnotationIds.shapes.length > 0 || selectedAnnotationIds.texts.length > 0) {
          handleDeleteSelected();
        }
        return;
      }

      // ←: 前のページ（通常モード）
      if (e.key === 'ArrowLeft' && !isCtrl && !isPresentationMode) {
        e.preventDefault();
        goToPrevPage();
        return;
      }

      // →: 次のページ（通常モード）
      if (e.key === 'ArrowRight' && !isCtrl && !isPresentationMode) {
        e.preventDefault();
        goToNextPage();
        return;
      }

      // F11またはF5: スライドショーモードの切り替え
      if ((e.key === 'F11' || e.key === 'F5') && !isCtrl) {
        e.preventDefault();
        if (pdfDoc) {
          setIsPresentationMode(prev => !prev);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [undoStack, redoStack, pdfDoc, isExporting, currentPage, totalPages, isPresentationMode]);

  // 描画開始
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    console.log('handlePointerDown: 呼び出されました', { textSelectionEnabled, tool, pageSize: !!pageSize });
    
    if (!pageSize) {
      console.log('handlePointerDown: pageSizeがありません');
      return;
    }

    // テキスト選択モードが有効な場合、シングルクリックでテキスト範囲を検出してコピー
    if (textSelectionEnabled) {
      console.log('テキスト選択: 処理開始');
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      console.log('テキスト選択: クリック検出', { x, y, textItemsCount: textItems.length, textSelectionEnabled });
      
      if (textItems.length > 0) {
        const boundingBox = findTextBoundingBox(textItems, x, y, 30);
        console.log('テキスト選択: バウンディングボックス', boundingBox);
        
        if (boundingBox) {
          // テキスト範囲内のすべてのテキストアイテムを取得
          const selectedTextItems = textItems.filter(item => {
            return item.x >= boundingBox.x - 5 &&
                   item.x + item.width <= boundingBox.x + boundingBox.width + 5 &&
                   item.y >= boundingBox.y - 5 &&
                   item.y + item.height <= boundingBox.y + boundingBox.height + 5;
          });
          
          console.log('テキスト選択: 選択されたアイテム数', selectedTextItems.length);
          
          // テキストを結合（行ごとに整理）
          const selectedText = selectedTextItems
            .sort((a, b) => {
              // Y座標でソート（上から下へ）
              if (Math.abs(a.y - b.y) > 5) return a.y - b.y;
              // 同じ行ならX座標でソート（左から右へ）
              return a.x - b.x;
            })
            .map(item => item.str)
            .join('');
          
          console.log('テキスト選択: 抽出されたテキスト', selectedText);
          
          if (selectedText) {
            // クリップボードにコピー
            navigator.clipboard.writeText(selectedText).then(() => {
              console.log('テキスト選択: クリップボードにコピー成功');
              toast({
                title: `テキストをコピーしました`,
                description: `"${selectedText.replace(/^1\.\s*/, '').substring(0, 50)}${selectedText.length > 50 ? '...' : ''}"`,
                variant: "success",
              });
            }).catch(err => {
              console.error('クリップボードへのコピーに失敗:', err);
              toast({
                title: "エラー",
                description: "テキストのコピーに失敗しました",
                variant: "destructive",
              });
            });
            
            // 目次編集中の場合は、自動的に入力フィールドに設定
            if (editingTOCIndex !== null) {
              setEditingTOCTitle(selectedText);
            }
          } else {
            console.log('テキスト選択: 抽出されたテキストが空です');
          }
        } else {
          console.log('テキスト選択: バウンディングボックスが見つかりませんでした');
        }
      } else {
        console.log('テキスト選択: textItemsが空です');
      }
      e.preventDefault();
      e.stopPropagation();
      return; // テキスト選択処理後は他の処理をスキップ
    }

    // 選択ツールの場合は最初に処理（他のツールの描画を防ぐため）
    // 重要: 選択ツールの場合は絶対に描画状態を設定しない
    if (tool === 'select') {
      // 描画状態を強制的にリセット
      isDrawingRef.current = false;
      setCurrentStroke(null);
      setCurrentShape(null);
      setShapeStartPoint(null);
      // 描画状態をリセット（重要：描画処理を防ぐため）
      isDrawingRef.current = false;
      setCurrentStroke(null);
      
      // テキスト入力フィールドが開いている場合は閉じる
      if (textInputPosition) {
        setTextInputPosition(null);
        setTextInputValue('');
        setEditingTextId(null);
      }
      
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      if (!pageSize) return;
      
      // クリック位置にある注釈を検出
      const clickedStrokes: string[] = [];
      const clickedShapes: string[] = [];
      const clickedTexts: string[] = [];
      
      // ストロークの検出（簡易版：最初の点との距離で判定）
      for (const stroke of strokes) {
        if (stroke.points.length > 0 && stroke.id) {
          const firstPoint = stroke.points[0];
          const strokeX = firstPoint.x * pageSize.width;
          const strokeY = firstPoint.y * pageSize.height;
          const distance = Math.sqrt(Math.pow(x - strokeX, 2) + Math.pow(y - strokeY, 2));
          if (distance < 20) {
            clickedStrokes.push(stroke.id);
          }
        }
      }
      
      // 図形の検出
      for (const shape of shapeAnnotations) {
        const x1 = shape.x1 * pageSize.width;
        const y1 = shape.y1 * pageSize.height;
        const x2 = shape.x2 * pageSize.width;
        const y2 = shape.y2 * pageSize.height;
        const minX = Math.min(x1, x2);
        const maxX = Math.max(x1, x2);
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        
        if (x >= minX - 10 && x <= maxX + 10 && y >= minY - 10 && y <= maxY + 10) {
          clickedShapes.push(shape.id);
        }
      }
      
      // テキストの検出
      for (const text of textAnnotations) {
        const textX = text.x * pageSize.width;
        const textY = text.y * pageSize.height;
        const textWidth = text.text.length * text.fontSize * 0.6;
        const textHeight = text.fontSize * 1.2;
        
        if (x >= textX - 10 && x <= textX + textWidth + 10 && y >= textY - 10 && y <= textY + textHeight + 10) {
          clickedTexts.push(text.id);
        }
      }
      
      // Ctrlキーが押されている場合は追加選択、そうでなければ置き換え
      if (e.ctrlKey || e.metaKey) {
        setSelectedAnnotationIds(prev => ({
          strokes: [...prev.strokes, ...clickedStrokes],
          shapes: [...prev.shapes, ...clickedShapes],
          texts: [...prev.texts, ...clickedTexts],
        }));
      } else {
        setSelectedAnnotationIds({
          strokes: clickedStrokes,
          shapes: clickedShapes,
          texts: clickedTexts,
        });
      }
      
      // ドラッグ開始位置を記録
      setDragStart({ x, y });
      setIsDragging(false);
      
      e.preventDefault();
      e.stopPropagation(); // イベントの伝播を停止
      return;
    }

    // テキストツールの場合はテキスト入力フィールドを表示
    if (tool === 'text') {
      // 既にテキスト入力フィールドが開いている場合は何もしない（タッチイベントで閉じないようにする）
      if (textInputPosition) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setTextInputPosition({ x, y });
      setTextInputValue('');
      setEditingTextId(null);
      return;
    }

    // スタンプツールの場合
    if (tool === 'stamp') {
      if (!shapeCanvasRef.current || !pageSize) {
        return;
      }
      
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const normalizedX = x / pageSize.width;
      const normalizedY = y / pageSize.height;
      
      // スタンプのサイズ（デフォルト: 100x100px相当）
      const stampSize = 100 / Math.max(pageSize.width, pageSize.height);
      
      // 選択されたスタンプタイプに応じてスタンプを作成
      let stampText = '';
      let stampColor = '#3b82f6';
      
      if (selectedStampType === 'date') {
        stampText = new Date().toLocaleDateString('ja-JP');
        stampColor = '#3b82f6';
      } else if (selectedStampType === 'approved') {
        stampText = '承認';
        stampColor = '#10b981';
      } else if (selectedStampType === 'rejected') {
        stampText = '却下';
        stampColor = '#ef4444';
      }
      
      const newStamp: ShapeAnnotation = {
        id: generateShapeId(),
        type: 'stamp',
        x1: normalizedX,
        y1: normalizedY,
        x2: normalizedX + stampSize,
        y2: normalizedY + stampSize,
        color: stampColor,
        width: 2,
        stampType: selectedStampType,
        stampText: stampText,
      };
      
      const newShapes = [...shapeAnnotations, newStamp];
      setShapeAnnotations(newShapes);
      
      // Undoスタックに追加（関数形式で最新の状態を取得）
      setUndoStack(prev => [...prev, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
      setRedoStack([]);
      
      // 保存
      if (docId) {
        const actualPageNum = getActualPageNum(currentPage);
        saveShapeAnnotations(docId, actualPageNum, newShapes);
      }
      
      // 再描画
      if (shapeCanvasRef.current && pageSize) {
        const ctx = shapeCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          redrawShapeAnnotations(ctx, newShapes, pageSize.width, pageSize.height).catch(console.error);
        }
      }
      
      e.preventDefault();
      return;
    }

    // 図形ツールの場合（ここに到達する時点で、shapeCanvasRefからのイベントであることは確認済み）
    if (tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow') {
      if (!shapeCanvasRef.current || !pageSize) {
        return;
      }
      
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const normalizedX = x / pageSize.width;
      const normalizedY = y / pageSize.height;
      
      const canvas = shapeCanvasRef.current;
      
      setShapeStartPoint({ x: normalizedX, y: normalizedY });
      setCurrentShape({
        id: generateShapeId(),
        type: tool,
        x1: normalizedX,
        y1: normalizedY,
        x2: normalizedX,
        y2: normalizedY,
        color,
        width,
        fill: fillShape,
      });
      isDrawingRef.current = true;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // ペン/消しゴム/ハイライトツールの場合
    if (!inkCanvasRef.current) return;

    const canvas = inkCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // テキスト選択モードが有効な場合、シングルクリックでテキスト範囲を検出してコピー
    if (textSelectionEnabled && !tool) {
      console.log('テキスト選択: クリック検出', { x, y, textItemsCount: textItems.length });
      
      if (textItems.length > 0) {
        const boundingBox = findTextBoundingBox(textItems, x, y, 30);
        console.log('テキスト選択: バウンディングボックス', boundingBox);
        
        if (boundingBox) {
          // テキスト範囲内のすべてのテキストアイテムを取得
          const selectedTextItems = textItems.filter(item => {
            return item.x >= boundingBox.x - 5 &&
                   item.x + item.width <= boundingBox.x + boundingBox.width + 5 &&
                   item.y >= boundingBox.y - 5 &&
                   item.y + item.height <= boundingBox.y + boundingBox.height + 5;
          });
          
          console.log('テキスト選択: 選択されたアイテム数', selectedTextItems.length);
          
          // テキストを結合（行ごとに整理）
          const selectedText = selectedTextItems
            .sort((a, b) => {
              // Y座標でソート（上から下へ）
              if (Math.abs(a.y - b.y) > 5) return a.y - b.y;
              // 同じ行ならX座標でソート（左から右へ）
              return a.x - b.x;
            })
            .map(item => item.str)
            .join('');
          
          console.log('テキスト選択: 抽出されたテキスト', selectedText);
          
          if (selectedText) {
            // クリップボードにコピー
            navigator.clipboard.writeText(selectedText).then(() => {
              console.log('テキスト選択: クリップボードにコピー成功');
              toast({
                title: `テキストをコピーしました`,
                description: `"${selectedText.replace(/^1\.\s*/, '').substring(0, 50)}${selectedText.length > 50 ? '...' : ''}"`,
                variant: "success",
              });
            }).catch(err => {
              console.error('クリップボードへのコピーに失敗:', err);
              toast({
                title: "エラー",
                description: "テキストのコピーに失敗しました",
                variant: "destructive",
              });
            });
            
            // 目次編集中の場合は、自動的に入力フィールドに設定
            if (editingTOCIndex !== null) {
              setEditingTOCTitle(selectedText);
            }
          } else {
            console.log('テキスト選択: 抽出されたテキストが空です');
          }
        } else {
          console.log('テキスト選択: バウンディングボックスが見つかりませんでした');
        }
      } else {
        console.log('テキスト選択: textItemsが空です');
      }
      return; // テキスト選択処理後は他の処理をスキップ
    }

    // ハイライトツールの場合
    if (tool === 'highlight') {
      // 自動モード：テキスト全体を検出してハイライト
      if (highlightMode === 'auto') {
        if (textItems.length === 0) {
          console.warn('ハイライト: テキストアイテムがありません。テキスト抽出が失敗している可能性があります。');
            return;
          }
        const boundingBox = findTextBoundingBox(textItems, x, y, 30);
        if (boundingBox) {
          console.log('ハイライト: バウンディングボックスを検出', boundingBox);
        // テキスト全体のバウンディングボックスをハイライトとして描画
        // 矩形の4つの角をpointsとして追加
        // ハイライト範囲が少し上にはみ出さないように、y座標を少し下に調整
        // ディセンダー（「り」などの下にはみ出す部分）を含めるため、heightを少し大きくする
        const yOffset = boundingBox.height * 0.05; // heightの5%分下げる（上方向の調整）
        const heightAdjustment = boundingBox.height * 0.15; // heightの15%分増やす（下方向の調整、ディセンダー対応）
        const normalizedX1 = boundingBox.x / pageSize.width;
        const normalizedY1 = (boundingBox.y + yOffset) / pageSize.height;
        const normalizedX2 = (boundingBox.x + boundingBox.width) / pageSize.width;
        const normalizedY2 = (boundingBox.y + boundingBox.height + heightAdjustment) / pageSize.height;

        const stroke: Stroke = {
          id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          tool: 'highlight',
          color: color,
          width: boundingBox.height * 1.2, // テキストの高さに合わせて調整
          points: [
            { x: normalizedX1, y: normalizedY1 },
            { x: normalizedX2, y: normalizedY1 },
            { x: normalizedX2, y: normalizedY2 },
            { x: normalizedX1, y: normalizedY2 },
          ],
        };

        // ストロークを即座に確定
        const newStrokes = [...strokes, stroke];
        setStrokes(newStrokes);
        if (docId) {
          const actualPageNum = getActualPageNum(currentPage);
          saveAnnotations(docId, actualPageNum, newStrokes);
        }
        
        // 再描画
        if (inkCanvasRef.current && pageSize) {
          const ctx = inkCanvasRef.current.getContext('2d');
          if (ctx) {
            const devicePixelRatio = window.devicePixelRatio || 1;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            redrawStrokes(ctx, newStrokes, pageSize.width, pageSize.height);
          }
        }

        e.preventDefault();
        return;
        }
      }
      
      // 手動モード：ドラッグで範囲を指定
      if (highlightMode === 'manual') {
        const normalizedX = x / pageSize.width;
        const normalizedY = y / pageSize.height;
        
        // ドラッグ開始位置を記録
        setDragStart({ x, y });
        setIsDragging(true);
        
        // ハイライト矩形の開始位置を記録
        const stroke: Stroke = {
          id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          tool: 'highlight',
          color: color,
          width: 0, // 手動モードでは使用しない
          points: [
            { x: normalizedX, y: normalizedY }, // 開始位置
            { x: normalizedX, y: normalizedY }, // 終了位置（後で更新）
            { x: normalizedX, y: normalizedY }, // 終了位置（後で更新）
            { x: normalizedX, y: normalizedY }, // 終了位置（後で更新）
          ],
        };
        
        setCurrentStroke(stroke);
        isDrawingRef.current = true;
        canvas.setPointerCapture(e.pointerId);
        
        e.preventDefault();
        return;
      }
    }

    // ペン/消しゴムツールの場合
    let normalizedX = x / pageSize.width;
    let normalizedY = y / pageSize.height;

    // テキストスナップ機能（ペンツールのみ）
    if (snapToTextEnabled && tool === 'pen' && textItems.length > 0) {
      const nearestLine = findNearestTextLine(textItems, x, y, 15);
      if (nearestLine) {
        normalizedY = nearestLine.y / pageSize.height;
      }
    }

    const point = normalizePoint(normalizedX * pageSize.width, normalizedY * pageSize.height, pageSize.width, pageSize.height);
    const stroke: Stroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      tool: tool === 'pen' || tool === 'eraser' ? tool : 'pen',
      color: color,
      width: width,
      points: [point],
    };

    setCurrentStroke(stroke);
    isDrawingRef.current = true;
    canvas.setPointerCapture(e.pointerId);

    e.preventDefault();
  };

  // 描画中
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // テキスト編集モード中はドラッグ処理を無効化
    if (editingTextId) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    // 選択ツールの場合は最初に処理（他のツールの描画を防ぐため）
    if (tool === 'select') {
      // 描画状態をリセット（重要：描画処理を防ぐため）
      isDrawingRef.current = false;
      setCurrentStroke(null);
      
      // inkCanvasRefからのイベントの場合は無視（textCanvasRefまたはshapeCanvasRefからのイベントのみ処理）
      if (e.currentTarget === inkCanvasRef.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // 選択ツールでドラッグ中の場合は移動処理
      if (dragStart && selectedAnnotationIds.strokes.length + selectedAnnotationIds.shapes.length + selectedAnnotationIds.texts.length > 0) {
        const target = e.currentTarget;
        const rect = target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        if (!pageSize) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        
        const deltaX = (x - dragStart.x) / pageSize.width;
        const deltaY = (y - dragStart.y) / pageSize.height;
        
        // ストロークを移動
        const movedStrokes = strokes.map(stroke => {
          if (stroke.id && selectedAnnotationIds.strokes.includes(stroke.id)) {
            return {
              ...stroke,
              points: stroke.points.map(p => ({
                ...p,
                x: Math.max(0, Math.min(1, p.x + deltaX)),
                y: Math.max(0, Math.min(1, p.y + deltaY)),
              })),
            };
          }
          return stroke;
        });
        
        // 図形を移動
        const movedShapes = shapeAnnotations.map(shape => {
          if (selectedAnnotationIds.shapes.includes(shape.id)) {
            return {
              ...shape,
              x1: Math.max(0, Math.min(1, shape.x1 + deltaX)),
              y1: Math.max(0, Math.min(1, shape.y1 + deltaY)),
              x2: Math.max(0, Math.min(1, shape.x2 + deltaX)),
              y2: Math.max(0, Math.min(1, shape.y2 + deltaY)),
            };
          }
          return shape;
        });
        
        // テキストを移動
        const movedTexts = textAnnotations.map(text => {
          if (selectedAnnotationIds.texts.includes(text.id)) {
            return {
              ...text,
              x: Math.max(0, Math.min(1, text.x + deltaX)),
              y: Math.max(0, Math.min(1, text.y + deltaY)),
            };
          }
          return text;
        });
        
        setStrokes(movedStrokes);
        setShapeAnnotations(movedShapes);
        setTextAnnotations(movedTexts);
        
      // 再描画（すべてのキャンバスをクリアしてから再描画）
      if (inkCanvasRef.current && pageSize) {
        const ctx = inkCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          // キャンバスをクリアしてから再描画（不要な描画を消すため）
          ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
          redrawStrokes(ctx, movedStrokes, pageSize.width, pageSize.height);
        }
      }
      if (shapeCanvasRef.current && pageSize) {
        const ctx = shapeCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          // キャンバスをクリアしてから再描画（不要な描画を消すため）
          ctx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
          redrawShapeAnnotations(ctx, movedShapes, pageSize.width, pageSize.height).catch(console.error);
        }
      }
      if (textCanvasRef.current && pageSize) {
        const ctx = textCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          // キャンバスをクリアしてから再描画（不要な描画を消すため）
          ctx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
          redrawTextAnnotations(ctx, movedTexts, pageSize.width, pageSize.height);
        }
      }
      
        setDragStart({ x, y });
        setIsDragging(true);
        // 描画状態を確実にリセット（移動中も描画されないように）
        isDrawingRef.current = false;
        setCurrentStroke(null);
        setCurrentShape(null);
        e.preventDefault();
        e.stopPropagation(); // イベントの伝播を停止
        return;
      }
      // 選択ツールだがドラッグ中でない場合は何もしない
      e.preventDefault();
      e.stopPropagation(); // イベントの伝播を停止
      return;
    }
    
    // テキスト入力フィールドが開いている場合は処理をスキップ
    if (textInputPosition) {
      return;
    }
    
    if (!isDrawingRef.current || !pageSize) return;

    // 図形ツールの場合（スタンプは除く）
    if (currentShape && (tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow')) {
      // shapeCanvasRefからのイベントであることを確認
      if (e.currentTarget !== shapeCanvasRef.current) {
        return;
      }
      
      if (!shapeCanvasRef.current || !pageSize) return;
      
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const normalizedX = x / pageSize.width;
      const normalizedY = y / pageSize.height;
      
      const canvas = shapeCanvasRef.current;
      
      const updatedShape = {
        ...currentShape,
        x2: normalizedX,
        y2: normalizedY,
      };
      setCurrentShape(updatedShape);

      // リアルタイム描画
      if (shapeCanvasRef.current) {
        const ctx = shapeCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          ctx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
          // 既存の図形を再描画
          redrawShapeAnnotations(ctx, shapeAnnotations, pageSize.width, pageSize.height).catch(console.error);
          // 現在描画中の図形を描画
          drawShapeAnnotation(ctx, updatedShape, pageSize.width, pageSize.height);
        }
      }
      e.preventDefault();
      return;
    }
    
    // ペン/消しゴム/ハイライトツールの場合
    if (!inkCanvasRef.current) return;
    
    const canvas = inkCanvasRef.current;
    
    // currentStrokeがない場合は描画しない
    if (!currentStroke) return;

    // ハイライトツール（自動モード）の場合はストローク描画をスキップ（矩形として既に描画済み）
    if (tool === 'highlight' && highlightMode === 'auto') {
      e.preventDefault();
      return;
    }
    
    // ハイライトツール（手動モード）の場合は矩形をリアルタイム描画
    if (tool === 'highlight' && highlightMode === 'manual' && dragStart) {
      const rect = canvas.getBoundingClientRect();
      const currentX = e.clientX - rect.left;
      const currentY = e.clientY - rect.top;
      
      const normalizedX1 = dragStart.x / pageSize.width;
      const normalizedY1 = dragStart.y / pageSize.height;
      const normalizedX2 = currentX / pageSize.width;
      const normalizedY2 = currentY / pageSize.height;
      
      // 矩形の4つの角を更新
      const updatedStroke = {
        ...currentStroke,
        points: [
          { x: normalizedX1, y: normalizedY1 },
          { x: normalizedX2, y: normalizedY1 },
          { x: normalizedX2, y: normalizedY2 },
          { x: normalizedX1, y: normalizedY2 },
        ],
      };
      
      setCurrentStroke(updatedStroke);
      
      // リアルタイム描画
      if (inkCanvasRef.current && pageSize) {
        const ctx = inkCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          // 既存のストロークを再描画
          redrawStrokes(ctx, strokes, pageSize.width, pageSize.height);
          // 現在描画中のハイライトを描画
          drawStroke(ctx, updatedStroke, pageSize.width, pageSize.height);
        }
      }
      
      e.preventDefault();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // テキストスナップ機能（ペンツールのみ）
    if (snapToTextEnabled && tool === 'pen' && textItems.length > 0) {
      const nearestLine = findNearestTextLine(textItems, x, y, 15);
      if (nearestLine) {
        y = nearestLine.y;
      }
    }

    const point = normalizePoint(x, y, pageSize.width, pageSize.height);
    
    // ストローク平滑化
    let pointsToAdd = [point];
    if (smoothStrokeEnabled && currentStroke.points.length >= 2) {
      const lastPoints = [...currentStroke.points.slice(-2), point];
      const smoothed = smoothStroke(lastPoints);
      pointsToAdd = smoothed.slice(1); // 最初の点は既に含まれているので除外
    }

    const updatedStroke = {
      ...currentStroke,
      points: [...currentStroke.points, ...pointsToAdd],
    };

    setCurrentStroke(updatedStroke);

    // リアルタイム描画
    const ctx = canvas.getContext('2d');
    if (ctx && updatedStroke.points.length >= 2) {
      const lastPoint = updatedStroke.points[updatedStroke.points.length - 2];
      const currentPoint = updatedStroke.points[updatedStroke.points.length - 1];
      
      ctx.save();
      if (updatedStroke.tool === 'pen') {
        ctx.strokeStyle = updatedStroke.color;
        ctx.lineWidth = updatedStroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      } else if (updatedStroke.tool === 'highlight') {
        // ハイライトの場合は半透明で描画
        ctx.globalAlpha = 0.5;
        ctx.globalCompositeOperation = 'multiply'; // 下のPDFと乗算
        ctx.strokeStyle = updatedStroke.color;
        ctx.fillStyle = updatedStroke.color;
        ctx.lineWidth = updatedStroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      } else {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = updatedStroke.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
      ctx.beginPath();
      // 表示サイズに対して描画（devicePixelRatioは既にsetTransformで設定済み）
      ctx.moveTo(lastPoint.x * pageSize.width, lastPoint.y * pageSize.height);
      ctx.lineTo(currentPoint.x * pageSize.width, currentPoint.y * pageSize.height);
      
      // ハイライトの場合は塗りつぶしも行う
      if (updatedStroke.tool === 'highlight') {
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
    }

    e.preventDefault();
  };

  // 描画終了
  const handlePointerUp = async (e: React.PointerEvent<HTMLCanvasElement>) => {
    // テキスト編集モード中はドラッグ処理を無効化
    if (editingTextId) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // 選択ツールの場合は最初に処理（他のツールの描画を防ぐため）
    if (tool === 'select') {
      // 描画状態をリセット（重要：描画処理を防ぐため）
      isDrawingRef.current = false;
      setCurrentStroke(null);
      
      // 選択ツールでドラッグ終了時の処理
      if (dragStart && isDragging) {
      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      if (!pageSize || !docId) {
        setDragStart(null);
        setIsDragging(false);
        return;
      }
      
      const deltaX = (x - dragStart.x) / pageSize.width;
      const deltaY = (y - dragStart.y) / pageSize.height;
      
      // 最終的な位置を保存
      if (selectedAnnotationIds.strokes.length + selectedAnnotationIds.shapes.length + selectedAnnotationIds.texts.length > 0) {
        // Undoスタックに追加
        setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
        setRedoStack([]);
        
        // ストロークを移動
        const movedStrokes = strokes.map(stroke => {
          if (stroke.id && selectedAnnotationIds.strokes.includes(stroke.id)) {
            return {
              ...stroke,
              points: stroke.points.map(p => ({
                ...p,
                x: Math.max(0, Math.min(1, p.x + deltaX)),
                y: Math.max(0, Math.min(1, p.y + deltaY)),
              })),
            };
          }
          return stroke;
        });
        
        // 図形を移動
        const movedShapes = shapeAnnotations.map(shape => {
          if (selectedAnnotationIds.shapes.includes(shape.id)) {
            return {
              ...shape,
              x1: Math.max(0, Math.min(1, shape.x1 + deltaX)),
              y1: Math.max(0, Math.min(1, shape.y1 + deltaY)),
              x2: Math.max(0, Math.min(1, shape.x2 + deltaX)),
              y2: Math.max(0, Math.min(1, shape.y2 + deltaY)),
            };
          }
          return shape;
        });
        
        // テキストを移動
        const movedTexts = textAnnotations.map(text => {
          if (selectedAnnotationIds.texts.includes(text.id)) {
            return {
              ...text,
              x: Math.max(0, Math.min(1, text.x + deltaX)),
              y: Math.max(0, Math.min(1, text.y + deltaY)),
            };
          }
          return text;
        });
        
        setStrokes(movedStrokes);
        setShapeAnnotations(movedShapes);
        setTextAnnotations(movedTexts);
        
        // 保存
        const actualPageNum = getActualPageNum(currentPage);
        await saveAnnotations(docId, actualPageNum, movedStrokes);
        await saveShapeAnnotations(docId, actualPageNum, movedShapes);
        await saveTextAnnotations(docId, actualPageNum, movedTexts);
        
        // 再描画（inkCanvasRefをクリアしてから再描画 - 移動終了時に不要な描画を消すため）
        if (inkCanvasRef.current && pageSize) {
          const ctx = inkCanvasRef.current.getContext('2d');
          if (ctx) {
            const devicePixelRatio = window.devicePixelRatio || 1;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            // キャンバスをクリアしてから再描画（不要な描画を消すため）
            ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
            redrawStrokes(ctx, movedStrokes, pageSize.width, pageSize.height);
          }
        }
        if (shapeCanvasRef.current && pageSize) {
          const ctx = shapeCanvasRef.current.getContext('2d');
          if (ctx) {
            const devicePixelRatio = window.devicePixelRatio || 1;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            redrawShapeAnnotations(ctx, movedShapes, pageSize.width, pageSize.height).catch(console.error);
          }
        }
        if (textCanvasRef.current && pageSize) {
          const ctx = textCanvasRef.current.getContext('2d');
          if (ctx) {
            const devicePixelRatio = window.devicePixelRatio || 1;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            redrawTextAnnotations(ctx, movedTexts, pageSize.width, pageSize.height);
          }
        }
      }
      
        setDragStart(null);
        setIsDragging(false);
        // 描画状態を確実にリセット
        isDrawingRef.current = false;
        setCurrentStroke(null);
        setCurrentShape(null);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // 選択ツールだがドラッグ終了でない場合
      isDrawingRef.current = false;
      setCurrentStroke(null);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    if (!isDrawingRef.current || !docId) return;

    // 図形ツールの場合（スタンプは除く）
    if (currentShape && (tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow')) {
      // shapeCanvasRefからのイベントであることを確認
      if (e.currentTarget !== shapeCanvasRef.current) {
        return;
      }
      
      if (shapeCanvasRef.current) {
        shapeCanvasRef.current.releasePointerCapture(e.pointerId);
      }
      
      if (!pageSize) return;
      
      // 最小サイズチェック（小さすぎる図形は無視）
      const minSize = 5 / Math.max(pageSize.width, pageSize.height);
      if (Math.abs(currentShape.x2 - currentShape.x1) < minSize && Math.abs(currentShape.y2 - currentShape.y1) < minSize) {
        setCurrentShape(null);
        setShapeStartPoint(null);
        isDrawingRef.current = false;
        // キャンバスをクリア
        if (shapeCanvasRef.current && pageSize) {
          const ctx = shapeCanvasRef.current.getContext('2d');
          if (ctx) {
            const devicePixelRatio = window.devicePixelRatio || 1;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            ctx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
            redrawShapeAnnotations(ctx, shapeAnnotations, pageSize.width, pageSize.height).catch(console.error);
          }
        }
        e.preventDefault();
        return;
      }

      const newShapes = [...shapeAnnotations, currentShape];
      setShapeAnnotations(newShapes);
      
      // Undoスタックに追加（関数形式で最新の状態を取得）
      setUndoStack(prev => [...prev, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
      setRedoStack([]);
      
      setCurrentShape(null);
      setShapeStartPoint(null);
      isDrawingRef.current = false;

      // 保存
      const actualPageNum = getActualPageNum(currentPage);
      await saveShapeAnnotations(docId, actualPageNum, newShapes);

      // 再描画（確定版）
      if (shapeCanvasRef.current && pageSize) {
        const ctx = shapeCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          ctx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
          redrawShapeAnnotations(ctx, newShapes, pageSize.width, pageSize.height).catch(console.error);
        }
      }
      
      e.preventDefault();
      return;
    }
    
    // ペン/消しゴムツールの場合
    const canvas = inkCanvasRef.current;
    if (!canvas) return;
    
    canvas.releasePointerCapture(e.pointerId);
    
    if (!currentStroke) return;

    // ストロークを確定
    // 現在の状態をUndoスタックに追加（currentStrokeを追加する前の状態）
    setUndoStack(prev => [...prev, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    setRedoStack([]);
    
    const newStrokes = [...strokes, currentStroke];
    setStrokes(newStrokes);
    setCurrentStroke(null);
    isDrawingRef.current = false;

    // 保存
    const actualPageNum = getActualPageNum(currentPage);
    await saveAnnotations(docId, actualPageNum, newStrokes);

    e.preventDefault();
  };

  // 前のページ
  const goToPrevPage = async () => {
    if (currentPage > 1) {
      const newPage = currentPage - 1;
      setCurrentPage(newPage);
      // useEffectで自動的にrenderCurrentPage()が呼ばれるが、プレゼンモードでは確実に反映させるため明示的に呼ぶ
      if (isPresentationMode && pdfDoc) {
        // 少し待ってからレンダリング（状態更新を待つ）
        setTimeout(async () => {
          await renderCurrentPage();
        }, 0);
      }
    }
  };

  // 次のページ
  const goToNextPage = async () => {
    if (pdfDoc && currentPage < totalPages) {
      const newPage = currentPage + 1;
      setCurrentPage(newPage);
      // useEffectで自動的にrenderCurrentPage()が呼ばれるが、プレゼンモードでは確実に反映させるため明示的に呼ぶ
      if (isPresentationMode && pdfDoc) {
        // 少し待ってからレンダリング（状態更新を待つ）
        setTimeout(async () => {
          await renderCurrentPage();
        }, 0);
      }
    }
  };

  // 表示順序のインデックスから実際のページ番号に変換するヘルパー関数（1ベース）
  // displayIndexは1ベース、返り値も1ベース（データベースキー用）
  const getActualPageNum = (displayIndex: number): number => {
    if (pageOrder.length > 0 && displayIndex > 0 && displayIndex <= pageOrder.length) {
      // pageOrderは1ベースのページ番号の配列
      return pageOrder[displayIndex - 1];
    }
    // pageOrderが空の場合は、displayIndexをそのまま返す（1ベース）
    return displayIndex;
  };

  // PDF.js用のページ番号取得（0ベース）
  const getActualPageNumForPDF = (displayIndex: number): number => {
    const actualPageNum1Based = getActualPageNum(displayIndex);
    // 1ベースから0ベースに変換（最小値は0）
    const result = Math.max(0, actualPageNum1Based - 1);
    console.log('getActualPageNumForPDF:', { displayIndex, actualPageNum1Based, result, pageOrderLength: pageOrder.length });
    return result;
  };

  // ページ削除（指定したページを削除）
  const deletePages = async (pageNumbers: number[]) => {
    if (!pdfDoc || !originalPdfBytes || !docId || pageNumbers.length === 0) {
      return;
    }

    try {
      const { PDFDocument } = await import('pdf-lib');
      
      // 既存のPDFを読み込み
      const pdfDocLib = await PDFDocument.load(originalPdfBytes);
      const currentPageCount = pdfDocLib.getPageCount();
      
      // 削除するページ番号を降順にソート（後ろから削除することでインデックスがずれないようにする）
      const sortedPages = [...pageNumbers].sort((a, b) => b - a);
      
      // 削除するページが存在するか確認
      for (const pageNum of sortedPages) {
        if (pageNum < 1 || pageNum > currentPageCount) {
          toast({
            title: "エラー",
            description: `ページ ${pageNum} は存在しません`,
            variant: "destructive",
          });
          return;
        }
      }

      // ページを削除（後ろから削除）
      for (const pageNum of sortedPages) {
        pdfDocLib.removePage(pageNum - 1); // pdf-libは0ベースインデックス
      }

      // 削除後のページ数を取得
      const newPageCount = pdfDocLib.getPageCount();
      
      if (newPageCount === 0) {
        toast({
          title: "エラー",
          description: "すべてのページを削除することはできません",
          variant: "destructive",
        });
        return;
      }

      // 削除されたページの注釈を削除
      for (const pageNum of pageNumbers) {
        await deleteAnnotations(docId, pageNum);
        await deleteTextAnnotations(docId, pageNum);
        await deleteShapeAnnotations(docId, pageNum);
      }

      // 残りのページの注釈を再マッピング（ページ番号がずれるため）
      const remainingPages = Array.from({ length: currentPageCount }, (_, i) => i + 1)
        .filter(pageNum => !pageNumbers.includes(pageNum))
        .sort((a, b) => a - b);

      // 新しいページ番号に合わせて注釈を再保存
      for (let i = 0; i < remainingPages.length; i++) {
        const oldPageNum = remainingPages[i];
        const newPageNum = i + 1;
        
        if (oldPageNum !== newPageNum) {
          // 注釈を読み込んで新しいページ番号で保存
          const strokes = await loadAnnotations(docId, oldPageNum);
          const texts = await loadTextAnnotations(docId, oldPageNum);
          const shapes = await loadShapeAnnotations(docId, oldPageNum);
          
          // 新しいページ番号で保存
          await saveAnnotations(docId, newPageNum, strokes);
          await saveTextAnnotations(docId, newPageNum, texts);
          await saveShapeAnnotations(docId, newPageNum, shapes);
          
          // 古いページ番号の注釈を削除
          await deleteAnnotations(docId, oldPageNum);
          await deleteTextAnnotations(docId, oldPageNum);
          await deleteShapeAnnotations(docId, oldPageNum);
        }
      }

      // 新しいPDFを保存
      const pdfBytes = await pdfDocLib.save();
      const arrayBuffer = pdfBytes.buffer as ArrayBuffer;
      
      // 新しいPDFファイルを作成
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      const pdfFile = new File([blob], originalFileName || 'edited.pdf', { type: 'application/pdf' });

      // PDFを再読み込み
      const newDoc = await loadPDF(pdfFile);
      setPdfDoc(newDoc);
      setTotalPages(newPageCount);
      setOriginalPdfBytes(arrayBuffer);

      // 現在のページを調整（削除されたページにいる場合は、適切なページに移動）
      let newCurrentPage = currentPage;
      const deletedCount = pageNumbers.filter(p => p <= currentPage).length;
      newCurrentPage = Math.max(1, Math.min(newCurrentPage - deletedCount, newPageCount));
      setCurrentPage(newCurrentPage);

      // ページサイズをクリア
      setPageSizes({});
      setTextItems([]);

      // サムネイルを再生成
      setThumbnails({});

      toast({
        title: "成功",
        description: `${pageNumbers.length}ページを削除しました`,
        variant: "success",
      });

      setSelectedPagesForDelete(new Set());
      setShowPageDeleteModal(false);
    } catch (error) {
      console.error('ページ削除エラー:', error);
      toast({
        title: "エラー",
        description: 'ページの削除に失敗しました: ' + (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    }
  };

  // 現在のページを削除
  const deleteCurrentPage = async () => {
    if (!pdfDoc || totalPages <= 1) {
      toast({
        title: "エラー",
        description: "最後の1ページは削除できません",
        variant: "destructive",
      });
      return;
    }
    
    await deletePages([currentPage]);
  };

  // 選択したページを一括削除
  const deleteSelectedPages = async () => {
    if (selectedPagesForDelete.size === 0) {
      toast({
        title: "通知",
        description: "削除するページを選択してください",
      });
      return;
    }

    if (totalPages - selectedPagesForDelete.size <= 0) {
      toast({
        title: "エラー",
        description: "すべてのページを削除することはできません",
        variant: "destructive",
      });
      return;
    }

    const pagesToDelete = Array.from(selectedPagesForDelete);
    await deletePages(pagesToDelete);
  };

  // 選択したページをコピー（現在のPDFに追加）
  const copySelectedPages = async () => {
    if (selectedPagesForDelete.size === 0) {
      toast({
        title: "通知",
        description: "コピーするページを選択してください",
      });
      return;
    }

    if (!pdfDoc || !originalPdfBytes || !docId) {
      toast({
        title: "エラー",
        description: "PDFが読み込まれていません",
        variant: "destructive",
      });
      return;
    }

    try {
      const { PDFDocument } = await import('pdf-lib');
      
      // 既存のPDFを読み込み
      const pdfDocLib = await PDFDocument.load(originalPdfBytes);
      const currentPageCount = pdfDocLib.getPageCount();
      
      // 選択したページをソート
      const selectedPages = Array.from(selectedPagesForDelete).sort((a, b) => a - b);
      
      // 選択したページが存在するか確認
      for (const pageNum of selectedPages) {
        if (pageNum < 1 || pageNum > currentPageCount) {
          toast({
            title: "エラー",
            description: `ページ ${pageNum} は存在しません`,
            variant: "destructive",
          });
          return;
        }
      }

      // 選択したページの最大ページ番号を取得（次のページに挿入するため）
      const maxSelectedPage = Math.max(...selectedPages);
      const insertAfterPage = maxSelectedPage; // このページの後に挿入

      // 選択したページをコピー
      const pagesToCopy = selectedPages.map(pageNum => pageNum - 1); // pdf-libは0ベース
      const copiedPages = await pdfDocLib.copyPages(pdfDocLib, pagesToCopy);

      // 挿入位置を決定（最大選択ページの次、0ベース）
      // insertPageは指定したインデックスの位置に挿入するので、insertAfterPage（0ベース）を指定すればその位置に挿入される
      // 複数ページを挿入する場合は、順番に挿入し、インデックスを増やしていく
      let insertIndex = insertAfterPage; // 0ベースで、insertAfterPageの次に挿入

      // ページを順番に挿入（インデックスを増やしながら）
      for (let i = 0; i < copiedPages.length; i++) {
        pdfDocLib.insertPage(insertIndex, copiedPages[i]);
        insertIndex++; // 次のページは1つ後ろに挿入
      }

      // 新しいページ数を取得
      const newPageCount = pdfDocLib.getPageCount();

      // コピーしたページの注釈もコピー
      const newPageNumbers: number[] = [];
      for (let i = 0; i < selectedPages.length; i++) {
        const originalPageNum = selectedPages[i];
        const newPageNum = insertAfterPage + i + 1; // 挿入後の新しいページ番号
        newPageNumbers.push(newPageNum);

        // 元のページの注釈を読み込んで新しいページ番号で保存
        const strokes = await loadAnnotations(docId, originalPageNum);
        const texts = await loadTextAnnotations(docId, originalPageNum);
        const shapes = await loadShapeAnnotations(docId, originalPageNum);

        // 新しいページ番号で保存
        await saveAnnotations(docId, newPageNum, strokes);
        await saveTextAnnotations(docId, newPageNum, texts);
        await saveShapeAnnotations(docId, newPageNum, shapes);
      }

      // 挿入位置より後のページの注釈を再マッピング（ページ番号がずれるため）
      for (let oldPageNum = insertAfterPage + 1; oldPageNum <= currentPageCount; oldPageNum++) {
        const newPageNum = oldPageNum + selectedPages.length;
        
        // 注釈を読み込んで新しいページ番号で保存
        const strokes = await loadAnnotations(docId, oldPageNum);
        const texts = await loadTextAnnotations(docId, oldPageNum);
        const shapes = await loadShapeAnnotations(docId, oldPageNum);
        
        // 新しいページ番号で保存
        await saveAnnotations(docId, newPageNum, strokes);
        await saveTextAnnotations(docId, newPageNum, texts);
        await saveShapeAnnotations(docId, newPageNum, shapes);
        
        // 古いページ番号の注釈を削除
        await deleteAnnotations(docId, oldPageNum);
        await deleteTextAnnotations(docId, oldPageNum);
        await deleteShapeAnnotations(docId, oldPageNum);
      }

      // 新しいPDFを保存
      const pdfBytes = await pdfDocLib.save();
      const arrayBuffer = pdfBytes.buffer as ArrayBuffer;
      
      // 新しいPDFファイルを作成
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      const pdfFile = new File([blob], originalFileName || 'edited.pdf', { type: 'application/pdf' });

      // PDFを再読み込み
      const newDoc = await loadPDF(pdfFile);
      setPdfDoc(newDoc);
      setTotalPages(newPageCount);
      setOriginalPdfBytes(arrayBuffer);

      // 現在のページを調整（必要に応じて）
      // コピーされた最初のページに移動
      setCurrentPage(insertAfterPage + 1);

      // ページサイズをクリア
      setPageSizes({});
      setTextItems([]);

      // サムネイルを再生成
      setThumbnails({});

      toast({
        title: "成功",
        description: `${selectedPages.length}ページをコピーしました`,
        variant: "success",
      });

      setSelectedPagesForDelete(new Set());
    } catch (error) {
      console.error('ページコピーエラー:', error);
      toast({
        title: "エラー",
        description: 'ページのコピーに失敗しました: ' + (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    }
  };

  // ページ順序を変更（ドラッグ&ドロップで使用）
  const reorderPages = async (newOrder: number[]) => {
    if (!pdfDoc || !originalPdfBytes || !docId || newOrder.length !== totalPages) {
      return;
    }

    try {
      const { PDFDocument } = await import('pdf-lib');
      
      // 既存のPDFを読み込み
      const pdfDocLib = await PDFDocument.load(originalPdfBytes);
      const currentPageCount = pdfDocLib.getPageCount();
      
      // 新しいPDFを作成
      const newPdfDoc = await PDFDocument.create();
      
      // 新しい順序でページをコピー
      for (const pageNum of newOrder) {
        if (pageNum < 1 || pageNum > currentPageCount) {
          toast({
            title: "エラー",
            description: `ページ ${pageNum} は存在しません`,
            variant: "destructive",
          });
          return;
        }
        const [copiedPage] = await newPdfDoc.copyPages(pdfDocLib, [pageNum - 1]); // pdf-libは0ベースインデックス
        newPdfDoc.addPage(copiedPage);
      }

      // 注釈を再マッピング
      for (let i = 0; i < newOrder.length; i++) {
        const oldPageNum = newOrder[i];
        const newPageNum = i + 1;
        
        if (oldPageNum !== newPageNum) {
          // 注釈を読み込んで新しいページ番号で保存
          const strokes = await loadAnnotations(docId, oldPageNum);
          const texts = await loadTextAnnotations(docId, oldPageNum);
          const shapes = await loadShapeAnnotations(docId, oldPageNum);
          
          // 新しいページ番号で保存
          await saveAnnotations(docId, newPageNum, strokes);
          await saveTextAnnotations(docId, newPageNum, texts);
          await saveShapeAnnotations(docId, newPageNum, shapes);
          
          // 古いページ番号の注釈を削除
          await deleteAnnotations(docId, oldPageNum);
          await deleteTextAnnotations(docId, oldPageNum);
          await deleteShapeAnnotations(docId, oldPageNum);
        }
      }

      // 新しいPDFを保存
      const pdfBytes = await newPdfDoc.save();
      const arrayBuffer = pdfBytes.buffer as ArrayBuffer;
      
      // 新しいPDFファイルを作成
      const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
      const pdfFile = new File([blob], originalFileName || 'edited.pdf', { type: 'application/pdf' });

      // PDFを再読み込み
      const newDoc = await loadPDF(pdfFile);
      setPdfDoc(newDoc);
      setTotalPages(currentPageCount);
      setOriginalPdfBytes(arrayBuffer);
      setPageOrder(newOrder);

      // 現在のページを新しい順序に合わせて調整
      const newCurrentPageIndex = newOrder.indexOf(currentPage);
      if (newCurrentPageIndex >= 0) {
        setCurrentPage(newCurrentPageIndex + 1);
      } else {
        setCurrentPage(1);
      }

      // ページサイズをクリア
      setPageSizes({});
      setTextItems([]);

      // サムネイルを再生成
      setThumbnails({});

      setHasUnsavedPageOrder(false);
      toast({
        title: "成功",
        description: "ページの順序を適用しました",
        variant: "success",
      });
    } catch (error) {
      console.error('ページ順序変更エラー:', error);
      toast({
        title: "エラー",
        description: 'ページの順序変更に失敗しました: ' + (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    }
  };

  // OCR処理を実行
  const handleOCR = async (pageNumbers: number[] = []) => {
    if (!pdfDoc || !originalPdfBytes) {
      toast({
        title: "エラー",
        description: "PDFが読み込まれていません",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsProcessingOCR(true);
      setOcrProgress({ current: 0, total: pageNumbers.length || totalPages });

      // 処理対象のページを決定
      const pagesToProcess = pageNumbers.length > 0 ? pageNumbers : Array.from({ length: totalPages }, (_, i) => i + 1);
      
      const newResults: Record<number, OCRResult> = { ...ocrResults };

      // 既存のpdfDocを直接使用（既に読み込まれていて動作している）
      const pdfDocJs = pdfDoc;
      const actualTotalPages = pdfDocJs.numPages;
      
      // ページ数が0の場合はエラー
      if (actualTotalPages === 0) {
        throw new Error('PDFにページがありません');
      }

      for (let i = 0; i < pagesToProcess.length; i++) {
        const pageNum = pagesToProcess[i];
        setOcrProgress({ current: i + 1, total: pagesToProcess.length });

        // ページ番号の検証
        if (pageNum < 1 || pageNum > actualTotalPages) {
          console.warn(`無効なページ番号: ${pageNum} (総ページ数: ${actualTotalPages})`);
          continue;
        }

        try {
          // renderCurrentPageと同じ方法でページを取得
          // PDF.jsは0ベースのインデックスを期待するので、getActualPageNumForPDFを使用
          const actualPageNum = getActualPageNumForPDF(pageNum);
          const page = await pdfDocJs.getPage(actualPageNum);
          
          // OCR処理を実行
          const result = await performOCROnPDFPage(page, 2.0, ocrLanguage);
          
          // 不要なスペースを削除
          const cleanedText = removeUnnecessarySpaces(result.text);
          const cleanedResult = {
            ...result,
            text: cleanedText,
          };
          
          newResults[pageNum] = cleanedResult;
          
          // OCR結果をIndexedDBに保存
          if (docId) {
            await saveOCRResult(docId, pageNum, cleanedResult);
          }
          
          // OCR処理後にサムネイルを生成（高解像度、ocrThumbnailSizeに応じて動的に調整）
          try {
            const thumbPage = await pdfDocJs.getPage(actualPageNum);
            const thumbCanvas = document.createElement('canvas');
            const thumbCtx = thumbCanvas.getContext('2d');
            
            if (thumbCtx) {
              const pageRotation = pageRotations[pageNum] || 0;
              const baseViewport = thumbPage.getViewport({ scale: 1.0, rotation: pageRotation });
              
              // ocrThumbnailSizeに応じたスケールを計算（高解像度を維持）
              // 表示サイズが大きいほど、より高解像度で生成
              const targetWidth = ocrThumbnailSize;
              const baseScale = targetWidth / baseViewport.width;
              
              // 高解像度を維持するため、デバイスピクセル比を考慮しつつ、最低でも2倍スケール
              const devicePixelRatio = window.devicePixelRatio || 1;
              const renderScale = Math.max(baseScale * 2.0, baseScale * devicePixelRatio, 2.0); // 最低2倍、表示サイズに応じて調整
              
              const thumbnailViewport = thumbPage.getViewport({ scale: renderScale, rotation: pageRotation });
              
              // キャンバスサイズを高解像度で設定
              thumbCanvas.width = Math.floor(thumbnailViewport.width);
              thumbCanvas.height = Math.floor(thumbnailViewport.height);
              thumbCanvas.style.width = `${targetWidth}px`;
              thumbCanvas.style.height = `${(thumbnailViewport.height / thumbnailViewport.width) * targetWidth}px`;
              
              const renderContext = {
                canvasContext: thumbCtx,
                viewport: thumbnailViewport,
                canvas: thumbCanvas,
              };
              
              await thumbPage.render(renderContext).promise;
              const thumbnailDataUrl = thumbCanvas.toDataURL('image/png', 1.0); // 最高品質でエクスポート
              
              // サムネイルを更新
              setThumbnails(prev => ({
                ...prev,
                [pageNum]: thumbnailDataUrl
              }));
            }
          } catch (thumbError) {
            console.warn(`ページ ${pageNum} のサムネイル生成エラー:`, thumbError);
            // サムネイル生成エラーは無視して続行
          }
          
          setOcrResults(newResults);
        } catch (pageError) {
          console.error(`ページ ${pageNum} のOCR処理エラー:`, pageError);
          toast({
            title: "警告",
            description: `ページ ${pageNum} のOCR処理に失敗しました: ${pageError instanceof Error ? pageError.message : 'Unknown error'}`,
            variant: "destructive",
          });
          // エラーが発生したページはスキップして続行
          continue;
        }
      }

      toast({
        title: "成功",
        description: `${pagesToProcess.length}ページのOCR処理が完了しました`,
        variant: "success",
      });

      // OCR結果が読み込まれたら、最初のページを表示
      setCurrentOcrResultPage(1);
    } catch (error) {
      console.error('OCR処理エラー:', error);
      toast({
        title: "エラー",
        description: `OCR処理に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    } finally {
      setIsProcessingOCR(false);
      setOcrProgress(null);
    }
  };

  // 現在のページのOCR処理
  const handleOCRCurrentPage = () => {
    handleOCR([currentPage]);
  };

  // 全ページのOCR処理
  const handleOCRAllPages = () => {
    handleOCR([]);
  };

  // 指定ページのOCR処理
  // 目次生成
  const handleGenerateTableOfContents = async () => {
    if (!pdfDoc || !docId) {
      toast({
        title: "エラー",
        description: "PDFが読み込まれていません",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsGeneratingTOC(true);
      const entries = await generateTableOfContents(pdfDoc);
      setTableOfContents(entries);
      if (docId) {
        await saveTableOfContents(docId, entries);
      }
      
      toast({
        title: "成功",
        description: `${entries.length}個の見出しを検出しました`,
        variant: "success",
      });
    } catch (error) {
      console.error('目次生成エラー:', error);
      toast({
        title: "エラー",
        description: `目次生成に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingTOC(false);
    }
  };

  // 目次からページにジャンプ
  const handleJumpToPage = (page: number) => {
    console.log('目次ジャンプ デバッグ: ページ番号', page, 'pageOrder', pageOrder);
    // pageOrderが設定されている場合、実際のページ番号から表示順序のインデックスに変換
    if (pageOrder.length > 0) {
      const displayIndex = pageOrder.indexOf(page) + 1;
      console.log('目次ジャンプ デバッグ: displayIndex', displayIndex);
      if (displayIndex > 0) {
        setCurrentPage(displayIndex);
        console.log('目次ジャンプ デバッグ: currentPageを', displayIndex, 'に設定');
      } else {
        // pageOrderに含まれていない場合は、そのまま使用
        setCurrentPage(page);
        console.log('目次ジャンプ デバッグ: currentPageを', page, 'に設定（pageOrderに含まれていない）');
      }
    } else {
      setCurrentPage(page);
      console.log('目次ジャンプ デバッグ: currentPageを', page, 'に設定（pageOrderなし）');
    }
    setShowTableOfContentsDialog(false);
    console.log('目次ジャンプ デバッグ: ダイアログを閉じました');
  };

  // 目次見出しの編集を開始
  const handleStartEditTOC = (index: number) => {
    setEditingTOCIndex(index);
    setEditingTOCTitle(tableOfContents[index].title);
  };

  // 目次見出しの編集を保存
  const handleSaveEditTOC = async () => {
    if (editingTOCIndex === null) return;
    
    const updatedTOC = [...tableOfContents];
    updatedTOC[editingTOCIndex] = {
      ...updatedTOC[editingTOCIndex],
      title: editingTOCTitle.trim() || '（見出しなし）',
    };
    
    setTableOfContents(updatedTOC);
    
    // IndexedDBに保存
    try {
      if (docId) {
        await saveTableOfContents(docId, updatedTOC);
      }
    } catch (error) {
      console.error('目次の保存に失敗:', error);
      toast({
        title: "エラー",
        description: "目次の保存に失敗しました",
        variant: "destructive",
      });
    }
    
    setEditingTOCIndex(null);
    setEditingTOCTitle('');
  };

  // 目次見出しの編集をキャンセル
  const handleCancelEditTOC = () => {
    setEditingTOCIndex(null);
    setEditingTOCTitle('');
  };

  const handleOCRSpecifiedPages = () => {
    if (!ocrPageRangeInput.trim()) {
      toast({
        title: "エラー",
        description: "ページ範囲を入力してください（例: 1, 3, 5-7）",
        variant: "destructive",
      });
      return;
    }

    try {
      const pageRanges = parsePageRanges(ocrPageRangeInput, totalPages);
      if (pageRanges.length === 0) {
        toast({
          title: "エラー",
          description: "有効なページ範囲を入力してください（例: 1, 3, 5-7）",
          variant: "destructive",
        });
        return;
      }

      // ページ範囲をページ番号の配列に変換
      const pageNumbers: number[] = [];
      for (const range of pageRanges) {
        for (let page = range.start; page <= range.end; page++) {
          if (page >= 1 && page <= totalPages && !pageNumbers.includes(page)) {
            pageNumbers.push(page);
          }
        }
      }

      if (pageNumbers.length === 0) {
        toast({
          title: "エラー",
          description: "有効なページ番号が見つかりませんでした",
          variant: "destructive",
        });
        return;
      }

      // ページ番号をソート
      pageNumbers.sort((a, b) => a - b);

      handleOCR(pageNumbers);
    } catch (error) {
      toast({
        title: "エラー",
        description: `ページ範囲の解析に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      });
    }
  };

  // ドラッグ開始
  const handleDragStart = (pageNum: number) => {
    setDraggedPage(pageNum);
  };

  // ドラッグオーバー
  const handleDragOver = (e: React.DragEvent, pageNum: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggedPage !== null && draggedPage !== pageNum) {
      setDragOverPage(pageNum);
    }
  };

  // ドラッグ終了
  const handleDragEnd = () => {
    setDraggedPage(null);
    setDragOverPage(null);
  };

  // ドロップ
  const handleDrop = (e: React.DragEvent, targetPageNum: number) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedPage === null || draggedPage === targetPageNum) {
      setDraggedPage(null);
      setDragOverPage(null);
      return;
    }

    const newOrder = [...pageOrder];
    const draggedIndex = newOrder.indexOf(draggedPage);
    const targetIndex = newOrder.indexOf(targetPageNum);
    
    // 順序を変更
    newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedPage);
    
    // UIを即座に更新（PDF再構築は行わない）
    setPageOrder(newOrder);
    setDraggedPage(null);
    setDragOverPage(null);
    setHasUnsavedPageOrder(true); // 未保存の変更があることを記録
  };

  // ページ順序を適用（PDF再構築を実行）
  const applyPageOrder = async () => {
    if (!hasUnsavedPageOrder || pageOrder.length === 0) {
      return;
    }
    
    await reorderPages(pageOrder);
    setHasUnsavedPageOrder(false);
  };

  // Undo
  const handleUndo = async () => {
    if (undoStack.length === 0 || !docId || !pageSize) return;

    // 現在の状態をRedoスタックに追加（関数形式で最新の状態を取得）
    setRedoStack(prev => [...prev, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    
    // Undoスタックから最後の要素を取得して削除（関数形式で最新の状態を取得）
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const previousState = prev[prev.length - 1];
    
    // 状態を更新（同期的に）
    setStrokes(previousState.strokes);
    setShapeAnnotations(previousState.shapes);
    setTextAnnotations(previousState.texts);

      // 保存
      const actualPageNum = getActualPageNum(currentPage);
      saveAnnotations(docId, actualPageNum, previousState.strokes);
      saveShapeAnnotations(docId, actualPageNum, previousState.shapes);
      saveTextAnnotations(docId, actualPageNum, previousState.texts);

      // 再描画（状態更新後に確実に実行するため、setTimeoutを使用）
      setTimeout(() => {
      if (inkCanvasRef.current && pageSize) {
        const ctx = inkCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
          redrawStrokes(ctx, previousState.strokes, pageSize.width, pageSize.height);
        }
      }
      if (shapeCanvasRef.current && pageSize) {
        const ctx = shapeCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          ctx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
            redrawShapeAnnotations(ctx, previousState.shapes, pageSize.width, pageSize.height).catch(console.error);
        }
      }
      if (textCanvasRef.current && pageSize) {
        const ctx = textCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          ctx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
          redrawTextAnnotations(ctx, previousState.texts, pageSize.width, pageSize.height);
        }
      }
      }, 0);
      
      // 最後の要素を削除
      return prev.slice(0, -1);
    });
  };

  // Redo
  const handleRedo = async () => {
    if (redoStack.length === 0 || !docId) return;

    // 現在の状態をUndoスタックに追加（関数形式で最新の状態を取得）
    setUndoStack(prev => [...prev, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    
    // Redoスタックから最後の要素を取得して削除（関数形式で最新の状態を取得）
    setRedoStack(prev => {
      if (prev.length === 0) return prev;
      const nextState = prev[prev.length - 1];
    
    // 状態を更新（同期的に）
    setStrokes(nextState.strokes);
    setShapeAnnotations(nextState.shapes);
    setTextAnnotations(nextState.texts);

      // 保存
      const actualPageNum = getActualPageNum(currentPage);
      saveAnnotations(docId, actualPageNum, nextState.strokes);
      saveShapeAnnotations(docId, actualPageNum, nextState.shapes);
      saveTextAnnotations(docId, actualPageNum, nextState.texts);

      // 再描画（状態更新後に実行）
      // requestAnimationFrameを使用して、状態更新が完了した後に再描画
      requestAnimationFrame(() => {
    if (inkCanvasRef.current && pageSize) {
      const ctx = inkCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
        redrawStrokes(ctx, nextState.strokes, pageSize.width, pageSize.height);
      }
    }
    if (shapeCanvasRef.current && pageSize) {
      const ctx = shapeCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
        redrawShapeAnnotations(ctx, nextState.shapes, pageSize.width, pageSize.height);
      }
    }
    if (textCanvasRef.current && pageSize) {
      const ctx = textCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
        redrawTextAnnotations(ctx, nextState.texts, pageSize.width, pageSize.height);
      }
    }
      });
      
      // 最後の要素を削除
      return prev.slice(0, -1);
    });
  };

  // 選択した注釈を削除
  const handleDeleteSelected = async () => {
    if (!docId || !pageSize) return;

    // Undoスタックに追加
    setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    setRedoStack([]);

    // 選択されたストロークを削除
    const newStrokes = strokes.filter(stroke => !stroke.id || !selectedAnnotationIds.strokes.includes(stroke.id));
    const newShapes = shapeAnnotations.filter(shape => !selectedAnnotationIds.shapes.includes(shape.id));
    const newTexts = textAnnotations.filter(text => !selectedAnnotationIds.texts.includes(text.id));

    // 状態を同期的に更新（注釈一覧の表示を即座に更新するため）
    setStrokes(newStrokes);
    setShapeAnnotations(newShapes);
    setTextAnnotations(newTexts);
    // 選択をクリア（状態更新を確実にするため、再描画の前に実行）
    setSelectedAnnotationIds({ strokes: [], shapes: [], texts: [] });

    // 保存
    const actualPageNum = getActualPageNum(currentPage);
    await saveAnnotations(docId, actualPageNum, newStrokes);
    await saveShapeAnnotations(docId, actualPageNum, newShapes);
    await saveTextAnnotations(docId, actualPageNum, newTexts);

    // 再描画（状態更新後に確実に実行するため、setTimeoutを使用）
    setTimeout(() => {
    if (inkCanvasRef.current && pageSize) {
      const ctx = inkCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
        redrawStrokes(ctx, newStrokes, pageSize.width, pageSize.height);
      }
    }
    if (shapeCanvasRef.current && pageSize) {
      const ctx = shapeCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
          redrawShapeAnnotations(ctx, newShapes, pageSize.width, pageSize.height).catch(console.error);
      }
    }
    if (textCanvasRef.current && pageSize) {
      const ctx = textCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
        redrawTextAnnotations(ctx, newTexts, pageSize.width, pageSize.height);
      }
    }
    }, 0);
  };

  // Clear
  const handleClear = async () => {
    if (!docId || !inkCanvasRef.current || !pageSize) return;

    console.log('handleClear: 開始', { docId, currentPage, pageSize });

    // クリア処理中フラグを設定
    isClearingRef.current = true;

    setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    setRedoStack([]);
    
    const actualPageNum = getActualPageNum(currentPage);
    console.log('handleClear: データベースから削除開始', { actualPageNum });
    
    // データベースから削除（完了を待つ）
    await deleteAnnotations(docId, actualPageNum);
    await deleteTextAnnotations(docId, actualPageNum);
    await deleteShapeAnnotations(docId, actualPageNum);
    
    console.log('handleClear: データベース削除完了');
    
    // データベースが空であることを確認
    const verifyStrokes = await loadAnnotations(docId, actualPageNum);
    console.log('handleClear: 削除確認', { verifyStrokes: verifyStrokes.length });
    
    // 状態をクリア（データベース削除後に実行）
    // 状態をクリアする前に、キャンバスをクリアしてから状態を更新
    if (inkCanvasRef.current && pageSize) {
    const ctx = inkCanvasRef.current.getContext('2d');
    if (ctx) {
      const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
        ctx.restore();
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        // 空の配列で再描画
        redrawStrokes(ctx, [], pageSize.width, pageSize.height);
        console.log('handleClear: inkCanvasをクリア');
    }
    }
    if (textCanvasRef.current && pageSize) {
      const textCtx = textCanvasRef.current.getContext('2d');
      if (textCtx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        textCtx.save();
        textCtx.setTransform(1, 0, 0, 1, 0, 0);
        textCtx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
        textCtx.restore();
        textCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        redrawTextAnnotations(textCtx, [], pageSize.width, pageSize.height);
        console.log('handleClear: textCanvasをクリア');
      }
    }
    if (shapeCanvasRef.current && pageSize) {
      const shapeCtx = shapeCanvasRef.current.getContext('2d');
      if (shapeCtx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        shapeCtx.save();
        shapeCtx.setTransform(1, 0, 0, 1, 0, 0);
        shapeCtx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
        shapeCtx.restore();
        shapeCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        redrawShapeAnnotations(shapeCtx, [], pageSize.width, pageSize.height);
        console.log('handleClear: shapeCanvasをクリア');
      }
    }
    
    // 状態をクリア（キャンバスをクリアした後に実行）
    setStrokes([]);
    setTextAnnotations([]);
    setShapeAnnotations([]);
    
    // クリア処理完了後、フラグをリセット
    isClearingRef.current = false;
    console.log('handleClear: 状態をクリア完了');
    
    // ページを再レンダリングして、空の状態を反映
    try {
      await renderCurrentPage();
    } catch (error) {
      console.error('handleClear: ページ再レンダリングエラー', error);
      // エラーが発生しても状態はクリア済みなので、useEffectで再レンダリングされる
    }
    
    console.log('handleClear: 完了');
  };

  // テキスト入力確定
  const handleTextSubmit = async () => {
    if (!docId || !pageSize || !textInputPosition) {
      // 編集モードの場合は編集をキャンセル
      if (editingTextId) {
        setEditingTextId(null);
        setTextInputValue('');
        setTextInputPosition(null);
      }
      return;
    }
    // 空のテキストの場合は編集をキャンセル（新規追加時のみ）
    if (!editingTextId && !textInputValue.trim()) {
      setTextInputPosition(null);
      setTextInputValue('');
      return;
    }
    // 編集モードで空のテキストの場合は削除
    if (editingTextId && !textInputValue.trim()) {
      const newTexts = textAnnotations.filter(t => t.id !== editingTextId);
      setTextAnnotations(newTexts);
      const actualPageNum = getActualPageNum(currentPage);
      await saveTextAnnotations(docId, actualPageNum, newTexts);
      setEditingTextId(null);
      setTextInputValue('');
      setTextInputPosition(null);
      // 再描画
      if (textCanvasRef.current && pageSize) {
        const ctx = textCanvasRef.current.getContext('2d');
        if (ctx) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
          ctx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
          redrawTextAnnotations(ctx, newTexts, pageSize.width, pageSize.height);
        }
      }
      return;
    }

    const normalizedX = textInputPosition.x / pageSize.width;
    const normalizedY = textInputPosition.y / pageSize.height;
    
    // テキスト入力フィールドの幅を取得（デフォルトは200px、または実際の幅）
    const textInputWidth = textInputRef.current 
      ? textInputRef.current.offsetWidth 
      : 200;
    const normalizedWidth = textInputWidth / pageSize.width;

    const newText: TextAnnotation = {
      id: editingTextId || generateTextId(),
      x: Math.max(0, Math.min(1, normalizedX)),
      y: Math.max(0, Math.min(1, normalizedY)),
      text: textInputValue,
      fontSize,
      color,
      width: Math.max(0.1, Math.min(1, normalizedWidth)), // 最小10%、最大100%
    };

    let updatedTexts: TextAnnotation[];
    if (editingTextId) {
      // 編集モード
      updatedTexts = textAnnotations.map(t => t.id === editingTextId ? newText : t);
    } else {
      // 新規追加
      updatedTexts = [...textAnnotations, newText];
    }

    // Undoスタックに追加
    setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    setRedoStack([]);

    setTextAnnotations(updatedTexts);
    const actualPageNum = getActualPageNum(currentPage);
    await saveTextAnnotations(docId, actualPageNum, updatedTexts);

    // 再描画
    if (textCanvasRef.current && pageSize) {
      const ctx = textCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
        redrawTextAnnotations(ctx, updatedTexts, pageSize.width, pageSize.height);
      }
    }

    setTextInputPosition(null);
    setTextInputValue('');
    setEditingTextId(null);
    
    // テキスト確定後、追加されたテキストを自動選択して選択ツールに切り替え
    if (!editingTextId) {
      setSelectedAnnotationIds({
        strokes: [],
        shapes: [],
        texts: [newText.id],
      });
      setTool('select');
    }
  };

  // テキスト注釈をクリックして編集（マウスでも動作）
  const handleTextCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // 編集モード中は処理をスキップ
    if (editingTextId) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // テキストツールまたは選択ツールの場合のみ処理
    if ((tool !== 'text' && tool !== 'select') || !textCanvasRef.current || !pageSize) return;

    const canvas = textCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // テキストツールの場合のみ新しいテキストを追加
    if (tool === 'text') {
      // クリック位置にあるテキスト注釈を検索
      const clickedText = textAnnotations.find(text => {
        const textX = text.x * pageSize.width;
        const textY = text.y * pageSize.height;
        const textWidth = text.text.length * text.fontSize * 0.6; // 概算幅
        const textHeight = text.fontSize * 1.2;

  return (
          x >= textX - 10 &&
          x <= textX + textWidth + 10 &&
          y >= textY - 10 &&
          y <= textY + textHeight + 10
        );
      });

      // 既存のテキストがクリックされなかった場合は、新しいテキストを追加
      if (!clickedText) {
        setTextInputPosition({ x, y });
        setTextInputValue('');
        setEditingTextId(null);
        return;
      }

      // 既存のテキストがクリックされた場合は編集
      if (clickedText) {
        setEditingTextId(clickedText.id);
        setTextInputValue(clickedText.text);
        setTextInputPosition({ x: clickedText.x * pageSize.width, y: clickedText.y * pageSize.height });
        setFontSize(clickedText.fontSize);
        setColor(clickedText.color);
      }
    }
  };

  // テキスト注釈を削除
  const handleDeleteText = async (textId: string) => {
    if (!docId) return;

    const updatedTexts = textAnnotations.filter(t => t.id !== textId);
    setTextAnnotations(updatedTexts);
    const actualPageNum = getActualPageNum(currentPage);
    await saveTextAnnotations(docId, actualPageNum, updatedTexts);

    // 再描画
    if (textCanvasRef.current && pageSize) {
      const ctx = textCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        ctx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
        redrawTextAnnotations(ctx, updatedTexts, pageSize.width, pageSize.height);
      }
    }
  };

  // 注釈付きPDFを生成（共通処理）
  const generateAnnotatedPDF = async (): Promise<Uint8Array | null> => {
    if (!docId || !originalPdfBytes || !pdfDoc) {
      toast({
        title: "エラー",
        description: "PDFが読み込まれていません",
        variant: "destructive",
      });
      return null;
    }

    try {
      // 全ページの注釈を取得
      const annotations = await getAllAnnotations(docId, totalPages);
      const textAnnotations = await getAllTextAnnotations(docId, totalPages);
      const shapeAnnotations = await getAllShapeAnnotations(docId, totalPages);
      
      // 全ページのサイズを取得（scale=1.0で）
      const allPageSizes: Record<number, { width: number; height: number }> = {};
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        if (pageSizes[pageNum]) {
          allPageSizes[pageNum] = pageSizes[pageNum];
        } else {
          // サイズが記録されていない場合は取得
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.0 });
          allPageSizes[pageNum] = {
            width: viewport.width,
            height: viewport.height,
          };
        }
      }

      // 署名を読み込む
      const allSignatures = docId ? await getAllSignatures(docId) : [];
      
      // 注釈をPDFに焼き込む（フォームフィールドの値と署名、透かし、ページ回転も含む）
      const pdfBytes = await exportAnnotatedPDFV2(
        originalPdfBytes,
        annotations,
        allPageSizes,
        textAnnotations,
        shapeAnnotations,
        formFields,
        formFieldValues,
        allSignatures,
        watermarkText || undefined,
        pageRotations,
        watermarkPattern,
        watermarkDensity,
        watermarkAngle,
        watermarkOpacity
      );

      return pdfBytes;
    } catch (error) {
      console.error('PDF生成エラー:', error);
      toast({
        title: "エラー",
        description: 'PDFの生成に失敗しました: ' + (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
      return null;
    }
  };

  // 上書き保存（元のファイル名で保存）
  const handleSave = async () => {
    if (!originalFileName) {
      toast({
        title: "通知",
        description: "元のファイル名が不明です。名前を付けて保存を使用してください。",
      });
      return;
    }

    setIsExporting(true);
    try {
      const pdfBytes = await generateAnnotatedPDF();
      if (!pdfBytes) return;

      // ダウンロード（元のファイル名で）
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = originalFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "成功",
        description: "保存しました",
        variant: "success",
      });
    } catch (error) {
      console.error('保存エラー:', error);
      toast({
        title: "エラー",
        description: "保存に失敗しました",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // 名前を付けて保存
  const handleSaveAs = async () => {
    if (!pdfDoc) {
      toast({
        title: "エラー",
        description: "PDFが読み込まれていません",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      const pdfBytes = await generateAnnotatedPDF();
      if (!pdfBytes) {
        setIsExporting(false);
        return;
      }

      // File System Access APIを使用（サポートされている場合）
      if ('showSaveFilePicker' in window) {
        try {
          const defaultFileName = originalFileName || 'annotated.pdf';
          const fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: defaultFileName,
            types: [{
              description: 'PDF files',
              accept: { 'application/pdf': ['.pdf'] },
            }],
          });

          const writable = await fileHandle.createWritable();
          await writable.write(pdfBytes);
          await writable.close();

          toast({
            title: "成功",
            description: "PDFを保存しました",
            variant: "success",
          });
          setIsExporting(false);
          return;
        } catch (error: any) {
          // ユーザーがキャンセルした場合はエラーを無視
          if (error.name === 'AbortError' || error.name === 'NotAllowedError') {
            setIsExporting(false);
            return;
          }
          // その他のエラーはフォールバック処理に進む
          console.error('File System Access API エラー:', error);
        }
      }

      // フォールバック: ダウンロード方式（File System Access APIがサポートされていない場合）
      const defaultFileName = originalFileName || 'annotated.pdf';
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "成功",
        description: "PDFをエクスポートしました",
        variant: "success",
      });
    } catch (error) {
      console.error('エクスポートエラー:', error);
      toast({
        title: "エラー",
        description: 'エクスポートに失敗しました: ' + (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // 既存のhandleSaveAs関数（後方互換性のため残す）
  const handleSaveAsDirect = async () => {
    if (!pdfDoc) return;

    setIsExporting(true);
    try {
      const pdfBytes = await generateAnnotatedPDF();
      if (!pdfBytes) return;

      // File System Access APIを使用（サポートされている場合）
      if ('showSaveFilePicker' in window) {
        try {
          const defaultFileName = originalFileName || 'annotated.pdf';
          const fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: defaultFileName,
            types: [{
              description: 'PDF files',
              accept: { 'application/pdf': ['.pdf'] },
            }],
          });

          const writable = await fileHandle.createWritable();
          await writable.write(pdfBytes);
          await writable.close();

          toast({
            title: "成功",
            description: "保存しました",
            variant: "success",
          });
          return;
        } catch (error: any) {
          // ユーザーがキャンセルした場合はエラーを無視
          if (error.name === 'AbortError') {
            return;
          }
          // その他のエラーはフォールバック処理に進む
        }
      }

      // フォールバック: ダウンロード方式
      const defaultFileName = originalFileName || 'annotated.pdf';
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "成功",
        description: "保存しました",
        variant: "success",
      });
    } catch (error) {
      console.error('保存エラー:', error);
      toast({
        title: "エラー",
        description: "保存に失敗しました",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  // 既存のエクスポート関数（後方互換性のため残す）
  const handleExport = async () => {
    // 名前を付けて保存を実行
    handleSaveAs();
  };


  // 注釈をJSON形式でエクスポート
  const handleExportJSON = async () => {
    if (!docId || !totalPages) {
      toast({
        title: "エラー",
        description: "PDFが読み込まれていません",
        variant: "destructive",
      });
      return;
    }

    try {
      const annotations = await getAllAnnotations(docId, totalPages);
      const textAnnotations = await getAllTextAnnotations(docId, totalPages);
      const shapeAnnotations = await getAllShapeAnnotations(docId, totalPages);
      const jsonString = await exportAnnotationsToJSON(docId, totalPages, annotations, textAnnotations, shapeAnnotations);
      
      // ダウンロード
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annotations_${docId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "成功",
        description: "注釈をJSON形式でエクスポートしました",
        variant: "success",
      });
    } catch (error) {
      console.error('JSONエクスポートエラー:', error);
      toast({
        title: "エラー",
        description: 'エクスポートに失敗しました: ' + (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    }
  };

  // 注釈をJSON形式でインポート
  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== 'application/json') {
      toast({
        title: "通知",
        description: "JSONファイルを選択してください",
      });
      return;
    }

    try {
      const text = await file.text();
      const importData = importAnnotationsFromJSON(text);

      // 現在のPDFと一致するか確認
      if (importData.docId !== docId) {
        const confirmImport = await showConfirm(
          `インポートする注釈は別のPDF（ID: ${importData.docId}）のものです。\n現在のPDF（ID: ${docId}）に上書きしますか？`,
          '確認'
        );
        if (!confirmImport) {
          return;
        }
      }

      // 各ページの注釈をインポート
      if (!docId) return;
      
      let importedCount = 0;
      for (const [pageNumStr, strokes] of Object.entries(importData.annotations)) {
        const pageNum = parseInt(pageNumStr, 10);
        if (pageNum >= 1 && pageNum <= totalPages && strokes.length > 0) {
          await saveAnnotations(docId, pageNum, strokes);
          importedCount++;
        }
      }

      // テキスト注釈をインポート
      if (importData.textAnnotations) {
        for (const [pageNumStr, texts] of Object.entries(importData.textAnnotations)) {
          const pageNum = parseInt(pageNumStr, 10);
          if (pageNum >= 1 && pageNum <= totalPages && texts.length > 0) {
            await saveTextAnnotations(docId, pageNum, texts);
          }
        }
      }

      // 現在のページを再読み込み
      if (importData.annotations[currentPage] || importData.textAnnotations?.[currentPage]) {
        const savedStrokes = await loadAnnotations(docId, currentPage);
        // 既存のストロークにIDがない場合は生成
        const strokesWithIds = savedStrokes.map(stroke => ({
          ...stroke,
          id: stroke.id || `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        }));
        setStrokes(strokesWithIds);
        setUndoStack([]);
        setRedoStack([]);

        const savedTexts = await loadTextAnnotations(docId, currentPage);
        setTextAnnotations(savedTexts);

        // 再描画
        if (inkCanvasRef.current && pageSize) {
          const ctx = inkCanvasRef.current.getContext('2d');
          if (ctx) {
            const devicePixelRatio = window.devicePixelRatio || 1;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            redrawStrokes(ctx, savedStrokes, pageSize.width, pageSize.height);
          }
        }

        if (textCanvasRef.current && pageSize) {
          const ctx = textCanvasRef.current.getContext('2d');
          if (ctx) {
            const devicePixelRatio = window.devicePixelRatio || 1;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            redrawTextAnnotations(ctx, savedTexts, pageSize.width, pageSize.height);
          }
        }
      }

      toast({
        title: "成功",
        description: `${importedCount}ページの注釈をインポートしました`,
        variant: "success",
      });
    } catch (error) {
      console.error('JSONインポートエラー:', error);
      toast({
        title: "エラー",
        description: 'インポートに失敗しました: ' + (error instanceof Error ? error.message : String(error)),
        variant: "destructive",
      });
    } finally {
      // ファイル入力をリセット
      e.target.value = '';
    }
  };

  // サイトのURLを取得
  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <>
      <style>{`
        @keyframes gradientShift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animated-gradient {
          background: linear-gradient(135deg, #e0f2fe 0%, #bae6fd 25%, #7dd3fc 50%, #38bdf8 75%, #0ea5e9 100%);
          background-size: 400% 400%;
          animation: gradientShift 15s ease infinite;
        }
      `}</style>
      <div className="h-screen relative overflow-hidden animated-gradient" style={{ 
        height: '100vh', 
        overflow: 'hidden',
      }}>
        {/* 装飾的な円形要素 */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-blue-100/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 animate-pulse"></div>
        <div className="absolute top-1/4 right-0 w-80 h-80 bg-cyan-100/20 rounded-full blur-3xl translate-x-1/2 animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute bottom-0 left-1/3 w-72 h-72 bg-teal-100/20 rounded-full blur-3xl -translate-y-1/2 animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 right-1/4 w-64 h-64 bg-emerald-100/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.5s' }}></div>
        <div className="absolute bottom-1/4 left-1/2 w-56 h-56 bg-sky-100/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }}></div>
      
      <div className="h-full max-w-[1800px] mx-auto p-4 md:p-6 lg:p-8 transition-all duration-300 relative z-10" style={{ 
        marginLeft: showThumbnails ? '13rem' : 'auto',
        marginRight: showAnnotationList ? '16.5rem' : 'auto',
        height: '100%',
        overflowY: 'auto',
        overflowX: showAnnotationList ? 'auto' : 'hidden', // 注釈一覧表示時は横スクロールを有効化
        scrollbarWidth: 'thin', /* Firefox */
        msOverflowStyle: 'auto', /* IE and Edge */
      }}>
        <div className="relative flex items-center justify-between mb-6 md:mb-8">
          <h1 className="text-3xl md:text-4xl font-bold drop-shadow-sm relative inline-block">
            <span className="animate-gradient">
              Snap-illustrator
            </span>
          </h1>
          {/* QRコードアイコン */}
          <button
            onClick={() => setShowQRCode(true)}
            className="p-2 rounded-lg bg-white/80 hover:bg-white shadow-md hover:shadow-lg transition-all hover:scale-110 active:scale-95"
            title="このサイトのQRコードを表示"
            style={{ zIndex: 100 }}
          >
            <MdQrCode className="text-2xl text-slate-700" />
          </button>
        </div>

      {/* ファイル選択 */}
      <div
        className="mb-6 p-6 border-2 border-dashed rounded-xl bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 hover:from-blue-100 hover:via-purple-100 hover:to-pink-100 transition-all duration-300 text-center hover:scale-[1.02] hover:shadow-lg border-blue-300 hover:border-purple-400 relative overflow-hidden"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.classList.add('ring-4', 'ring-blue-400', 'ring-opacity-50');
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.classList.remove('ring-4', 'ring-blue-400', 'ring-opacity-50');
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.classList.add('ring-4', 'ring-blue-400', 'ring-opacity-50');
        }}
        onDrop={async (e) => {
          e.currentTarget.classList.remove('ring-4', 'ring-blue-400', 'ring-opacity-50');
          e.preventDefault();
          e.stopPropagation();
          const files = e.dataTransfer.files;
          if (files.length > 0) {
            // 複数ファイルがドロップされた場合、画像ファイルとPDFファイルをコレクションに追加
            if (files.length > 1) {
              const validFiles = Array.from(files).filter(f => 
                f.type.startsWith('image/') || f.type === 'application/pdf'
              );
              if (validFiles.length > 0) {
                setImageFiles(prev => [...prev, ...validFiles]);
                setShowImageManager(true);
                return;
              }
            }

            const file = files[0];
            if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
              // handleFileSelectと同じ処理を実行
              if (file.type.startsWith('image/')) {
                handleImageFileSelect(file, false);
              } else {
                // PDFファイルの場合
                try {
                  const newDocId = await generateDocId(file);
                  setDocId(newDocId);
                  const loadedDoc = await loadPDF(file);
                  setPdfDoc(loadedDoc);
                  setTotalPages(loadedDoc.numPages);
                  setCurrentPage(1);
                  setScale(1.0);
                  setStrokes([]);
                  setShapeAnnotations([]);
                  setTextAnnotations([]);
                  setUndoStack([]);
                  setRedoStack([]);
                  setPageSizes({});
                  setTextItems([]);
                  setTextInputValue('');
                  setTextInputPosition(null);
                  setEditingTextId(null);
                  
                  // 元のPDFバイトを保存（エクスポート用）
                  const arrayBuffer = await file.arrayBuffer();
                  setOriginalPdfBytes(arrayBuffer);
                  setOriginalFileName(file.name); // 元のファイル名を保存
                } catch (error) {
                  console.error('ファイル読み込みエラー:', error);
                  toast({
                    title: "エラー",
                    description: 'ファイルの読み込みに失敗しました: ' + (error instanceof Error ? error.message : String(error)),
                    variant: "destructive",
                  });
                }
              }
            } else {
              toast({
                title: "通知",
                description: "PDFファイルまたは画像ファイルを選択してください",
              });
            }
          }
        }}
      >
        <div className="flex gap-3">
          <label 
            className="inline-block flex-1"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.add('ring-4', 'ring-blue-400', 'ring-opacity-50');
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.remove('ring-4', 'ring-blue-400', 'ring-opacity-50');
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.add('ring-4', 'ring-blue-400', 'ring-opacity-50');
            }}
            onDrop={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.remove('ring-4', 'ring-blue-400', 'ring-opacity-50');
              const files = e.dataTransfer.files;
              if (files.length > 0) {
                const file = files[0];
                if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
                  if (file.type.startsWith('image/')) {
                    handleImageFileSelect(file, false);
                  } else {
                    // PDFファイルの場合、直接処理
                    try {
                      const arrayBuffer = await file.arrayBuffer();
                      const id = await generateDocId(file);
                      setDocId(id);
                      setOriginalPdfBytes(arrayBuffer);
                      setOriginalFileName(file.name);
                      const doc = await loadPDF(file);
                      setPdfDoc(doc);
                      setTotalPages(doc.numPages);
                      setCurrentPage(1);
                      setScale(1.0);
                      setStrokes([]);
                      setUndoStack([]);
                      setRedoStack([]);
                      setPageSizes({});
                      setTextItems([]);
                      setTextInputValue('');
                      setTextInputPosition(null);
                      setEditingTextId(null);
                      setShapeAnnotations([]);
                      setTextAnnotations([]);
                      
                      // フォームフィールドを抽出
                      try {
                        const { PDFDocument } = await import('pdf-lib');
                        const pdfDoc = await PDFDocument.load(arrayBuffer);
                        const fields = await extractFormFields(pdfDoc);
                        const fieldsWithCalculations = setupCommonCalculations(fields);
                        setFormFields(fieldsWithCalculations);
                        const initialValues: Record<string, string | boolean | string[]> = {};
                        fieldsWithCalculations.forEach(field => {
                          initialValues[field.name] = field.value;
                        });
                        setFormFieldValues(initialValues);
                      } catch (formError) {
                        console.warn('フォームフィールドの抽出に失敗:', formError);
                        setFormFields([]);
                        setFormFieldValues({});
                      }
                      
                      // 署名を読み込む
                      if (id) {
                        try {
                          const loadedSignatures = await getAllSignatures(id);
                          setSignatures(loadedSignatures);
                        } catch (error) {
                          console.warn('署名・ワークフローの読み込みに失敗:', error);
                        }
                      }
                    } catch (error) {
                      console.error('ファイル読み込みエラー:', error);
                      toast({
                        title: "エラー",
                        description: 'ファイルの読み込みに失敗しました: ' + (error instanceof Error ? error.message : String(error)),
                        variant: "destructive",
                      });
                    }
                  }
                }
              }
            }}
          >
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif"
              onChange={(e) => handleFileSelect(e, false)}
              className="hidden"
            />
            <div className="px-6 py-4 border-2 border-dashed rounded-xl bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 hover:from-blue-100 hover:via-purple-100 hover:to-pink-100 cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-lg border-blue-300 hover:border-purple-400">
              <div className="flex items-center justify-center gap-3">
                <MdInsertDriveFile className="text-3xl text-blue-600" />
                <span className="text-base font-semibold bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
                  {originalFileName || 'ファイルを選択'}
                </span>
              </div>
              {originalFileName && (
                <div className="mt-2 text-xs text-slate-500 text-center">
                  選択中: {originalFileName}
                </div>
              )}
            </div>
          </label>
          <label 
            className="inline-block"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.add('ring-4', 'ring-purple-400', 'ring-opacity-50');
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.remove('ring-4', 'ring-purple-400', 'ring-opacity-50');
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.add('ring-4', 'ring-purple-400', 'ring-opacity-50');
            }}
            onDrop={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.remove('ring-4', 'ring-purple-400', 'ring-opacity-50');
              const files = e.dataTransfer.files;
              if (files.length > 0) {
                const validFiles = Array.from(files).filter(f => 
                  f.type.startsWith('image/') || f.type === 'application/pdf'
                );
                if (validFiles.length > 0) {
                  setImageFiles(prev => [...prev, ...validFiles]);
                  setShowImageManager(true);
                }
              }
            }}
          >
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif"
              onChange={(e) => handleFileSelect(e, true)}
              className="hidden"
              multiple
            />
            <div className="px-4 py-2 border border-slate-300 rounded-lg bg-white/80 backdrop-blur-sm hover:bg-white cursor-pointer transition-all duration-200 hover:shadow-md">
              <div className="flex items-center justify-center gap-2">
                <MdCollections className="text-lg text-slate-600" />
                <span className="text-xs text-slate-600 font-medium">
                  コレクションに追加
                </span>
              </div>
            </div>
          </label>
        </div>
        <div className="mt-4 px-5 py-4 bg-white/90 backdrop-blur-sm border-3 border-blue-500 rounded-xl shadow-xl" style={{ borderWidth: '3px', borderStyle: 'solid', borderColor: '#3b82f6' }}>
          <div className="text-base text-slate-900 font-bold mb-3 flex items-center gap-2">
            <MdInsertDriveFile className="text-blue-600 text-xl" />
            PDFファイルまたは画像ファイル（PNG、JPEG、WebP、GIF）を選択できます
          </div>
          <div className="text-sm text-slate-800 pl-8 space-y-1.5 font-medium">
            <div>• 画像ファイルは自動的にPDFに変換されます</div>
            <div>• または、ファイルをここにドラッグ&ドロップしてください</div>
          </div>
        </div>
      </div>

      {/* 保存ボタン（画面上部右側） */}
      {pdfDoc && (
        <div className="mb-6 flex justify-end items-center gap-3 flex-wrap">
          <button
            onClick={handleSave}
            disabled={isExporting || !pdfDoc || !originalFileName}
            className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-green-500 hover:scale-105 active:scale-95 ${
              isExporting || !pdfDoc || !originalFileName ? 'cursor-not-allowed' : 'shadow-md'
            }`}
            style={{
              background: isExporting || !pdfDoc || !originalFileName
                ? '#cbd5e1'
                : 'linear-gradient(to right, #22c55e, #10b981)',
              color: isExporting || !pdfDoc || !originalFileName ? '#64748b' : 'white',
            }}
            onMouseEnter={(e) => {
              if (!isExporting && pdfDoc && originalFileName) {
                e.currentTarget.style.background = 'linear-gradient(to right, #16a34a, #059669)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isExporting && pdfDoc && originalFileName) {
                e.currentTarget.style.background = 'linear-gradient(to right, #22c55e, #10b981)';
              }
            }}
            title="上書き保存（元のファイル名で保存）"
          >
            <MdSave className={`text-base ${isExporting || !pdfDoc || !originalFileName ? 'text-slate-500' : 'text-white'}`} />
            {isExporting ? '保存中...' : '上書き保存'}
          </button>
          <button
            type="button"
            onClick={handleSaveAs}
            disabled={isExporting || !pdfDoc}
            className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-cyan-500 hover:scale-105 active:scale-95 ${
              isExporting || !pdfDoc ? 'cursor-not-allowed' : 'shadow-md'
            }`}
            style={{
              background: isExporting || !pdfDoc
                ? '#cbd5e1'
                : 'linear-gradient(to right, #06b6d4, #3b82f6)',
              color: isExporting || !pdfDoc ? '#64748b' : 'white',
            }}
            onMouseEnter={(e) => {
              if (!isExporting && pdfDoc) {
                e.currentTarget.style.background = 'linear-gradient(to right, #0891b2, #2563eb)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isExporting && pdfDoc) {
                e.currentTarget.style.background = 'linear-gradient(to right, #06b6d4, #3b82f6)';
              }
            }}
            title="名前を付けて保存"
          >
            <MdFileDownload className={`text-base ${isExporting || !pdfDoc ? 'text-slate-500' : 'text-white'}`} />
            {isExporting ? '保存中...' : '名前を付けて保存'}
          </button>
        </div>
      )}

      {/* スライドショーモード（全画面表示） */}
      {pdfDoc && isPresentationMode && (
        <div 
          className="fixed inset-0 bg-black z-[10005] flex items-center justify-center"
          style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#000000',
            zIndex: 10005,
          }}
          onClick={(e) => {
            // 背景をクリックした場合は次のページ
            if (e.target === e.currentTarget) {
              goToNextPage();
            }
          }}
        >
          {/* コントロールバー（上部） */}
          <div 
            className="absolute top-0 left-0 right-0 bg-black/70 text-white flex items-center z-10"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.85)', // 背景を少し濃くして視認性向上
              padding: '0.4rem 0.5rem', // パディングをさらに減らす
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start', // 左から順に配置
              zIndex: 10000, // z-indexを上げて確実に前面に表示
              minHeight: '44px', // 最小高さをさらに減らす
              maxHeight: '44px', // 最大高さも設定して縦に広がらないようにする
              overflowX: 'auto', // 横スクロール可能にする（画面幅が狭い場合）
              overflowY: 'hidden', // 縦スクロールは禁止
              flexWrap: 'nowrap', // 折り返しを禁止
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)', // 影を追加して視認性向上
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1 flex-nowrap" style={{ flexWrap: 'nowrap', overflow: 'visible', justifyContent: 'flex-start', display: 'flex', flexShrink: 0 }}> {/* 左から順に一列で配置 */}
              {/* 注釈表示切り替え */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAnnotationsInPresentation(!showAnnotationsInPresentation);
                }}
                className="px-1.5 py-0.5 bg-white/20 hover:bg-white/30 rounded transition-colors flex items-center gap-0.5 flex-shrink-0"
                title="注釈の表示/非表示"
                style={{ fontSize: '0.7rem' }}
              >
                {showAnnotationsInPresentation ? (
                  <MdVisibility className="text-xs" />
                ) : (
                  <MdVisibilityOff className="text-xs" />
                )}
                <span className="text-xs whitespace-nowrap">注釈</span>
              </button>
              
              {/* 自動ページ番号付与 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAutoPageNumberEnabled(!autoPageNumberEnabled);
                }}
                className={`px-1.5 py-0.5 rounded transition-colors flex items-center gap-0.5 flex-shrink-0 ${
                  autoPageNumberEnabled 
                    ? 'bg-green-600 hover:bg-green-700' 
                    : 'bg-white/20 hover:bg-white/30'
                }`}
                title="自動ページ番号付与"
                style={{ fontSize: '0.7rem' }}
              >
                <span className="text-xs whitespace-nowrap">自動番号</span>
              </button>
              
              {/* 自動ページ番号の表示位置選択 */}
              {autoPageNumberEnabled && (
                <select
                  value={autoPageNumberPosition}
                  onChange={(e) => setAutoPageNumberPosition(e.target.value as any)}
                  className="px-1.5 py-0.5 text-xs bg-white/20 hover:bg-white/30 rounded border border-white/30 text-white flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: '0.7rem', height: '24px' }}
                >
                  <option value="top-right" className="text-black">右上</option>
                  <option value="top-left" className="text-black">左上</option>
                  <option value="bottom-right" className="text-black">右下</option>
                  <option value="bottom-left" className="text-black">左下</option>
                </select>
              )}
              
              {/* ページ送りボタン（前へ） */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goToPrevPage();
                }}
                disabled={currentPage === 1}
                className={`px-1.5 py-0.5 rounded transition-colors flex items-center flex-shrink-0 ${
                  currentPage === 1 
                    ? 'bg-gray-600 cursor-not-allowed opacity-50' 
                    : 'bg-white/20 hover:bg-white/30'
                }`}
                title="前のページ (←)"
                style={{ fontSize: '0.7rem' }}
              >
                <MdNavigateBefore className="text-base" />
              </button>
              
              {/* ページ送りボタン（次へ） */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goToNextPage();
                }}
                disabled={currentPage >= totalPages}
                className={`px-1.5 py-0.5 rounded transition-colors flex items-center flex-shrink-0 ${
                  currentPage >= totalPages 
                    ? 'bg-gray-600 cursor-not-allowed opacity-50' 
                    : 'bg-white/20 hover:bg-white/30'
                }`}
                title="次のページ (→ または スペース)"
                style={{ fontSize: '0.7rem' }}
              >
                <MdNavigateNext className="text-base" />
              </button>
              
              {/* タイマー */}
              <div 
                className="flex items-center gap-1 px-1.5 py-0.5 bg-black/70 border border-white/40 rounded flex-shrink-0"
                style={{
                  minWidth: 'auto',
                  backgroundColor: 'rgba(0, 0, 0, 0.8)',
                  flexWrap: 'nowrap',
                  overflow: 'visible',
                }}
              >
                <MdTimer className="text-sm text-white" style={{ flexShrink: 0 }} />
                <div className="flex items-center min-w-[50px]">
                  <span 
                    className="text-xs font-mono font-bold text-white"
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      color: '#ffffff',
                    }}
                  >
                    {String(Math.floor(presentationTimer.elapsed / 60)).padStart(2, '0')}:{String(presentationTimer.elapsed % 60).padStart(2, '0')}
                  </span>
                  {presentationTimer.totalTime !== null && (
                    <span 
                      className="text-xs text-white/70 ml-0.5"
                      style={{
                        fontSize: '9px',
                        color: 'rgba(255, 255, 255, 0.7)',
                      }}
                    >
                      / {String(Math.floor(presentationTimer.totalTime / 60)).padStart(2, '0')}:{String(presentationTimer.totalTime % 60).padStart(2, '0')}
                    </span>
                  )}
                </div>
                <div className="flex gap-0.5 ml-1 border-l border-white/40 pl-1">
                  {!presentationTimer.isRunning ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPresentationTimer(prev => ({ ...prev, isRunning: true }));
                      }}
                      className="p-1 hover:bg-white/30 rounded transition-colors bg-white/20"
                      title="タイマー開始"
                      style={{ flexShrink: 0 }}
                    >
                      <MdPlayArrow className="text-sm text-white" />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPresentationTimer(prev => ({ ...prev, isRunning: false }));
                      }}
                      className="p-1 hover:bg-white/30 rounded transition-colors bg-white/20"
                      title="タイマー一時停止"
                      style={{ flexShrink: 0 }}
                    >
                      <MdPause className="text-sm text-white" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPresentationTimer({ isRunning: false, elapsed: 0, totalTime: null });
                    }}
                    className="p-1 hover:bg-white/30 rounded transition-colors bg-white/20"
                    title="タイマーリセット"
                    style={{ flexShrink: 0 }}
                  >
                    <MdStop className="text-sm text-white" />
                  </button>
                </div>
              </div>
              
              {/* 終了ボタン */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPresentationMode(false);
                }}
                className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded transition-colors flex items-center gap-1 flex-shrink-0"
                title="スライドショーを終了 (Esc)"
                style={{ fontSize: '0.7rem' }}
              >
                <MdFullscreenExit className="text-sm" />
                <span className="text-xs whitespace-nowrap">終了</span>
              </button>
            </div>
          </div>

          {/* PDF表示エリア */}
          <div 
            className="flex items-center justify-center w-full h-full"
            style={{
              display: 'flex',
              alignItems: 'center', // 中央揃え
              justifyContent: 'center',
              width: '100%',
              height: '100%',
              paddingTop: '48px', // コントロールバーの高さ分（さらにコンパクト化）
              paddingBottom: '20px', // 下部の余白（影を表示するスペースを確保）
            }}
            onClick={(e) => {
              // レーザーポインターが有効な場合は、クリック位置にレーザーを表示
              if (laserPointerEnabled) {
                setLaserPointerPosition({
                  x: e.clientX,
                  y: e.clientY,
                });
                // 3秒後に自動的に非表示
                if (laserPointerTimeoutRef.current) {
                  clearTimeout(laserPointerTimeoutRef.current);
                }
                laserPointerTimeoutRef.current = setTimeout(() => {
                  setLaserPointerPosition(null);
                }, 3000);
              } else {
                // 中央をクリックした場合は次のページ
                if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'DIV') {
                  goToNextPage();
                }
              }
            }}
            onMouseMove={(e) => {
              // レーザーポインターが有効な場合は、マウス位置にレーザーを表示
              if (laserPointerEnabled) {
                setLaserPointerPosition({
                  x: e.clientX,
                  y: e.clientY,
                });
                // マウス移動時にタイムアウトをリセット
                if (laserPointerTimeoutRef.current) {
                  clearTimeout(laserPointerTimeoutRef.current);
                }
                laserPointerTimeoutRef.current = setTimeout(() => {
                  setLaserPointerPosition(null);
                }, 1000); // 1秒後に非表示
              }
            }}
            onMouseLeave={() => {
              // マウスが領域外に出た場合はレーザーを非表示
              if (laserPointerEnabled) {
                setLaserPointerPosition(null);
                if (laserPointerTimeoutRef.current) {
                  clearTimeout(laserPointerTimeoutRef.current);
                  laserPointerTimeoutRef.current = null;
                }
              }
            }}
          >
            <div
              className="relative"
              style={{
                position: 'relative',
                maxWidth: '100%',
                maxHeight: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* PDFキャンバス */}
              <canvas
                ref={pdfCanvasRef}
                style={{ 
                  display: 'block', 
                  maxWidth: '95%', // 少し小さくする（最後の手段）
                  maxHeight: 'calc(100vh - 68px)', // 上下の余白を考慮（paddingTop + paddingBottom）
                  objectFit: 'contain',
                }}
              />
              {/* 注釈キャンバス（表示/非表示切り替え可能） */}
              {showAnnotationsInPresentation && (
                <>
                  <canvas
                    ref={inkCanvasRef}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      maxWidth: '95%', // PDFキャンバスと同じサイズに合わせる
                      maxHeight: 'calc(100vh - 68px)', // 上下の余白を考慮
                      pointerEvents: 'none',
                    }}
                  />
                  <canvas
                    ref={textCanvasRef}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      maxWidth: '95%', // PDFキャンバスと同じサイズに合わせる
                      maxHeight: 'calc(100vh - 68px)', // 上下の余白を考慮
                      pointerEvents: 'none',
                    }}
                  />
                  <canvas
                    ref={shapeCanvasRef}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      maxWidth: '95%', // PDFキャンバスと同じサイズに合わせる
                      maxHeight: 'calc(100vh - 68px)', // 上下の余白を考慮
                      pointerEvents: 'none',
                    }}
                  />
                </>
              )}
              {/* レーザーポインター */}
              {laserPointerEnabled && laserPointerPosition && (
                <div
                  style={{
                    position: 'fixed',
                    left: `${laserPointerPosition.x}px`,
                    top: `${laserPointerPosition.y}px`,
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: '#ef4444',
                    boxShadow: '0 0 15px #ef4444, 0 0 30px #ef4444, 0 0 45px rgba(239, 68, 68, 0.5)',
                    pointerEvents: 'none',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 10006,
                    transition: 'all 0.05s linear',
                  }}
                />
              )}
              {/* 自動ページ番号付与 */}
              {autoPageNumberEnabled && (
                <div
                  style={{
                    position: 'absolute',
                    ...(autoPageNumberPosition === 'top-right' ? { top: '20px', right: '20px' } :
                        autoPageNumberPosition === 'top-left' ? { top: '20px', left: '20px' } :
                        autoPageNumberPosition === 'bottom-right' ? { bottom: '20px', right: '20px' } :
                        { bottom: '20px', left: '20px' }),
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    zIndex: 10005,
                    pointerEvents: 'none',
                    fontFamily: 'Arial, sans-serif',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                  }}
                >
                  {currentPage} / {totalPages}
                </div>
              )}
            </div>
          </div>

          {/* 下部ナビゲーションバーは削除（全て上部に統合） */}
        </div>
      )}

      {/* 全画面サムネイルモーダル */}
      {pdfDoc && showThumbnailModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[10003] p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowThumbnailModal(false);
            }
          }}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl w-full h-full max-w-[95vw] max-h-[95vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <div className="flex justify-between items-center p-4 border-b border-slate-200">
              <h2 className="text-2xl font-bold text-slate-800">ページ管理 ({totalPages}ページ)</h2>
              <button
                onClick={() => {
                  if (hasUnsavedPageOrder) {
                    if (window.confirm('ページ順序が変更されています。変更を破棄して閉じますか？')) {
                      // ページ順序を元に戻す
                      setPageOrder(Array.from({ length: totalPages }, (_, i) => i + 1));
                      setHasUnsavedPageOrder(false);
                      setShowThumbnailModal(false);
                    }
                  } else {
                    setShowThumbnailModal(false);
                  }
                }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title="閉じる"
              >
                <MdClose className="text-2xl text-slate-600" />
              </button>
            </div>
            
            {/* ツールバー */}
            <div className="p-4 border-b border-slate-200 flex gap-2 flex-wrap items-center">
              {/* 注釈表示切り替え */}
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showThumbnailsWithAnnotations}
                  onChange={(e) => {
                    setShowThumbnailsWithAnnotations(e.target.checked);
                    if (e.target.checked && Object.keys(thumbnailsWithAnnotations).length === 0) {
                      generateThumbnailsWithAnnotations();
                    }
                  }}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="font-medium">注釈を表示</span>
              </label>
              <div className="w-px h-6 bg-slate-300"></div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectedPagesForDelete.size > 0) {
                    deleteSelectedPages();
                    setShowThumbnailModal(false);
                  } else {
                    deleteCurrentPage();
                    setShowThumbnailModal(false);
                  }
                }}
                disabled={totalPages <= 1}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-semibold"
                title={selectedPagesForDelete.size > 0 ? `${selectedPagesForDelete.size}ページを削除` : '現在のページを削除'}
              >
                <MdDelete className="text-lg" />
                {selectedPagesForDelete.size > 0 ? `削除(${selectedPagesForDelete.size})` : '削除'}
              </button>
              {selectedPagesForDelete.size > 0 && (
                <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPagesForDelete(new Set());
                  }}
                  className="px-4 py-2 bg-slate-400 hover:bg-slate-500 text-white rounded-lg"
                  title="選択を解除"
                >
                  選択解除
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    copySelectedPages();
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
                  title="選択したページをコピー"
                >
                  <MdFileCopy className="text-lg" />
                  コピー ({selectedPagesForDelete.size}ページ)
                </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // 選択したページを範囲として設定
                      const selectedPages = Array.from(selectedPagesForDelete).sort((a, b) => a - b);
                      if (selectedPages.length > 0) {
                        // 連続するページを範囲にまとめる
                        const ranges: string[] = [];
                        let start = selectedPages[0];
                        let end = selectedPages[0];
                        
                        for (let i = 1; i < selectedPages.length; i++) {
                          if (selectedPages[i] === end + 1) {
                            end = selectedPages[i];
                          } else {
                            if (start === end) {
                              ranges.push(`${start}`);
                            } else {
                              ranges.push(`${start}-${end}`);
                            }
                            start = selectedPages[i];
                            end = selectedPages[i];
                          }
                        }
                        if (start === end) {
                          ranges.push(`${start}`);
                        } else {
                          ranges.push(`${start}-${end}`);
                        }
                        
                        setSplitRangeInputs([ranges.join(', ')]);
                        setShowSplitDialogFromThumbnail(true);
                        setShowThumbnailModal(false);
                      }
                    }}
                    className="px-4 py-2 bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-700 hover:to-orange-600 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
                    title="選択したページでPDF分割"
                  >
                    <MdContentCut className="text-lg" />
                    PDF分割 ({selectedPagesForDelete.size}ページ)
                  </button>
                </>
              )}
              {hasUnsavedPageOrder && (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm text-amber-600 font-semibold">⚠️ 順序が変更されています</span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await applyPageOrder();
                    }}
                    className="px-4 py-2 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-700 hover:via-purple-700 hover:to-pink-700 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2"
                    title="ページ順序を適用"
                  >
                    <MdSave className="text-lg" />
                    順序を適用
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // ページ順序を元に戻す
                      setPageOrder(Array.from({ length: totalPages }, (_, i) => i + 1));
                      setHasUnsavedPageOrder(false);
                    }}
                    className="px-4 py-2 bg-slate-400 hover:bg-slate-500 text-white rounded-lg"
                    title="変更をキャンセル"
                  >
                    キャンセル
                  </button>
                </div>
              )}
            </div>
            
            {/* サムネイルグリッド */}
            <div className="flex-1 overflow-y-auto p-6">
              <div 
                style={{ 
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 120px))',
                  gap: '1rem',
                }}
              >
                {(pageOrder.length > 0 ? pageOrder : Array.from({ length: totalPages }, (_, i) => i + 1)).map((pageNum, index) => (
                  <div
                    key={pageNum}
                    draggable
                    onDragStart={() => handleDragStart(pageNum)}
                    onDragOver={(e) => handleDragOver(e, pageNum)}
                    onDragEnd={handleDragEnd}
                    onDrop={(e) => handleDrop(e, pageNum)}
                    className={`relative p-3 rounded-lg transition-all cursor-move ${
                      (pageOrder.length > 0 && currentPage > 0 && currentPage <= pageOrder.length && pageOrder[currentPage - 1] === pageNum) || 
                      (pageOrder.length === 0 && currentPage === pageNum)
                        ? 'bg-primary/20 border-2 border-primary shadow-lg'
                        : 'bg-white border border-slate-200 hover:border-primary/50 hover:shadow-md'
                    } ${selectedPagesForDelete.has(pageNum) ? 'ring-2 ring-red-500' : ''} ${
                      draggedPage === pageNum ? 'opacity-50' : ''
                    } ${dragOverPage === pageNum ? 'border-blue-500 border-2' : ''}`}
                  >
                    {/* チェックボックス */}
                    <div className="absolute top-2 left-2 z-10">
                      <input
                        type="checkbox"
                        checked={selectedPagesForDelete.has(pageNum)}
                        onChange={(e) => {
                          e.stopPropagation();
                          const newSelected = new Set(selectedPagesForDelete);
                          if (e.target.checked) {
                            newSelected.add(pageNum);
                          } else {
                            newSelected.delete(pageNum);
                          }
                          setSelectedPagesForDelete(newSelected);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-5 h-5 text-red-600 border-gray-300 rounded focus:ring-red-500 cursor-pointer"
                      />
                    </div>
                    
                    {/* ドラッグハンドル */}
                    <div className="absolute top-2 right-2 z-10">
                      <MdDragHandle 
                        className="text-slate-400 cursor-move text-xl" 
                        title="ドラッグして順序を変更"
                      />
                    </div>
                    
                    {/* サムネイル画像 */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        // 1クリックでメイン画面のスライドを指定（サムネイルは閉じない）
                        if (pageOrder.length > 0) {
                          const displayIndex = pageOrder.indexOf(pageNum);
                          if (displayIndex >= 0) {
                            setCurrentPage(displayIndex + 1);
                          } else {
                            setCurrentPage(pageNum);
                          }
                        } else {
                          setCurrentPage(pageNum);
                        }
                        // サムネイルモーダルは閉じない
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        // ダブルクリックでメイン画面のスライドを指定してサムネイルを閉じる
                        if (pageOrder.length > 0) {
                          const displayIndex = pageOrder.indexOf(pageNum);
                          if (displayIndex >= 0) {
                            setCurrentPage(displayIndex + 1);
                          } else {
                            setCurrentPage(pageNum);
                          }
                        } else {
                          setCurrentPage(pageNum);
                        }
                        setShowThumbnailModal(false);
                      }}
                      className="relative cursor-pointer group"
                    >
                      {/* 拡大ボタン（ドラッグハンドルの下に配置） */}
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          // ボタンの位置を取得
                          const rect = e.currentTarget.getBoundingClientRect();
                          const buttonX = rect.left + rect.width / 2;
                          const buttonY = rect.top + rect.height / 2;
                          setExpandedThumbnailPosition({ x: buttonX, y: buttonY });
                          
                          // 拡大表示用の画像を生成（大きなスケールでレンダリング）
                          if (pdfDoc) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const canvas = document.createElement('canvas');
                              const ctx = canvas.getContext('2d');
                              
                              if (ctx) {
                                // 拡大表示用のスケール（幅800px程度）
                                const viewport = page.getViewport({ scale: 1.0 });
                                const expandedScale = 800 / viewport.width;
                                const expandedViewport = page.getViewport({ scale: expandedScale });
                                
                                canvas.width = expandedViewport.width;
                                canvas.height = expandedViewport.height;

                                // PDFをレンダリング
                                const renderContext = {
                                  canvasContext: ctx,
                                  viewport: expandedViewport,
                                  canvas: canvas,
                                };

                                await page.render(renderContext).promise;

                                // 注釈を描画（注釈表示がONの場合）
                                if (showThumbnailsWithAnnotations && docId) {
                                  const actualPageNum = getActualPageNum(pageNum);
                                  const savedStrokes = await loadAnnotations(docId, actualPageNum);
                                  const savedTexts = await loadTextAnnotations(docId, actualPageNum);
                                  const savedShapes = await loadShapeAnnotations(docId, actualPageNum);

                                  // ストロークを描画
                                  if (savedStrokes.length > 0) {
                                    redrawStrokes(ctx, savedStrokes, expandedViewport.width, expandedViewport.height, false);
                                  }

                                  // テキスト注釈を描画
                                  if (savedTexts.length > 0) {
                                    redrawTextAnnotations(ctx, savedTexts, expandedViewport.width, expandedViewport.height, expandedScale);
                                  }

                                  // 図形注釈を描画
                                  if (savedShapes.length > 0) {
                                    await redrawShapeAnnotations(ctx, savedShapes, expandedViewport.width, expandedViewport.height);
                                  }
                                }

                                const imageData = canvas.toDataURL('image/png');
                                setExpandedThumbnailImage(imageData);
                        setExpandedThumbnail(pageNum);
                              }
                            } catch (error) {
                              console.error('拡大表示画像の生成エラー:', error);
                              // フォールバック：サムネイル画像を使用
                              setExpandedThumbnailImage(null);
                              setExpandedThumbnail(pageNum);
                            }
                          } else {
                            setExpandedThumbnailImage(null);
                            setExpandedThumbnail(pageNum);
                          }
                        }}
                        className="absolute top-10 right-2 p-1.5 bg-white/90 hover:bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity z-20"
                        title="拡大表示"
                      >
                        <MdZoomIn className="text-lg text-slate-700" />
                      </button>
                      {showThumbnailsWithAnnotations ? (
                        thumbnailsWithAnnotations[pageNum] ? (
                          <img
                            src={thumbnailsWithAnnotations[pageNum]}
                            alt={`ページ ${pageNum} (注釈付き)`}
                            className="w-full h-auto block rounded shadow-sm max-w-full"
                            style={{ maxWidth: '100%', height: 'auto' }}
                          />
                        ) : (
                          <div className="py-12 text-center text-slate-400 text-sm bg-slate-100 rounded">
                            読み込み中...
                          </div>
                        )
                      ) : (
                        thumbnails[pageNum] ? (
                        <img
                          src={thumbnails[pageNum]}
                          alt={`ページ ${pageNum}`}
                          className="w-full h-auto block rounded shadow-sm max-w-full"
                          style={{ maxWidth: '100%', height: 'auto' }}
                        />
                      ) : (
                        <div className="py-12 text-center text-slate-400 text-sm bg-slate-100 rounded">
                          読み込み中...
                        </div>
                        )
                      )}
                    </div>
                    
                    {/* ページ番号 */}
                    <div className={`text-sm text-center mt-2 font-semibold ${
                      (pageOrder.length > 0 && currentPage > 0 && currentPage <= pageOrder.length && pageOrder[currentPage - 1] === pageNum) || 
                      (pageOrder.length === 0 && currentPage === pageNum)
                        ? 'text-primary' : 'text-slate-600'
                    }`}>
                      ページ {pageNum} {pageOrder.length > 0 && `(${index + 1}番目)`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 拡大表示モーダル */}
      {expandedThumbnail && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 z-[10004] p-4"
          onClick={() => {
            setExpandedThumbnail(null);
            setExpandedThumbnailImage(null);
            setExpandedThumbnailPosition(null);
          }}
          style={{
            display: 'flex',
            alignItems: expandedThumbnailPosition ? 'flex-start' : 'center',
            justifyContent: expandedThumbnailPosition ? 'flex-start' : 'center',
          }}
        >
          <div 
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: expandedThumbnailPosition ? 'absolute' : 'relative',
              top: expandedThumbnailPosition 
                ? `${Math.min(Math.max(expandedThumbnailPosition.y - 100, 20), typeof window !== 'undefined' ? window.innerHeight - 400 : 400)}px`
                : undefined,
              left: expandedThumbnailPosition 
                ? `${Math.min(Math.max(expandedThumbnailPosition.x - 200, 20), typeof window !== 'undefined' ? window.innerWidth - 500 : 20)}px`
                : undefined,
              margin: expandedThumbnailPosition ? undefined : 'auto',
            }}
          >
            <button
              onClick={() => {
                setExpandedThumbnail(null);
                setExpandedThumbnailImage(null);
                setExpandedThumbnailPosition(null);
              }}
              className="absolute top-2 right-2 p-2 bg-white/90 hover:bg-white rounded-full shadow-lg z-10"
              title="閉じる"
            >
              <MdClose className="text-2xl text-slate-800" />
            </button>
            {expandedThumbnailImage ? (
              <img
                src={expandedThumbnailImage}
                alt={`ページ ${expandedThumbnail} (拡大${showThumbnailsWithAnnotations ? '・注釈付き' : ''})`}
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              />
            ) : showThumbnailsWithAnnotations && thumbnailsWithAnnotations[expandedThumbnail] ? (
              <img
                src={thumbnailsWithAnnotations[expandedThumbnail]}
                alt={`ページ ${expandedThumbnail} (拡大・注釈付き)`}
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
              />
            ) : thumbnails[expandedThumbnail] ? (
            <img
              src={thumbnails[expandedThumbnail]}
              alt={`ページ ${expandedThumbnail} (拡大)`}
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
            ) : (
              <div className="py-20 text-center text-white text-lg">
                読み込み中...
              </div>
            )}
            <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/50 text-white px-4 py-2 rounded-lg">
              ページ {expandedThumbnail}
            </div>
          </div>
        </div>
      )}

      {/* サムネイル表示 */}
      {pdfDoc && showThumbnails && (
        <div className="fixed left-0 top-0 bottom-0 w-52 bg-slate-50 border-r border-slate-200 p-3 shadow-lg" style={{ position: 'fixed', left: 0, top: 0, bottom: 0, width: '13rem', zIndex: 100, pointerEvents: 'auto', overflowY: 'auto', overflowX: 'hidden', paddingBottom: '2rem' }}>
          <div className="mb-3 font-semibold flex justify-between items-center text-slate-700">
            <span>ページ一覧</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowThumbnails(false);
              }}
              className="h-6 w-6 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded px-1 border-none bg-transparent cursor-pointer transition-colors"
              title="閉じる"
            >
              <MdClose className="text-lg" />
            </button>
        </div>
        {/* ページ削除ボタン */}
        <div className="mb-3 flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (selectedPagesForDelete.size > 0) {
                deleteSelectedPages();
              } else {
                deleteCurrentPage();
              }
            }}
            disabled={totalPages <= 1}
            className="flex-1 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
            title={selectedPagesForDelete.size > 0 ? `${selectedPagesForDelete.size}ページを削除` : '現在のページを削除'}
          >
            <MdDelete className="text-sm" />
            {selectedPagesForDelete.size > 0 ? `削除(${selectedPagesForDelete.size})` : '削除'}
          </button>
          {selectedPagesForDelete.size > 0 && (
            <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedPagesForDelete(new Set());
              }}
              className="px-3 py-1.5 text-xs bg-slate-400 hover:bg-slate-500 text-white rounded"
              title="選択を解除"
            >
              解除
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                copySelectedPages();
              }}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center justify-center gap-1"
              title="選択したページをコピー"
            >
              <MdFileCopy className="text-sm" />
              コピー({selectedPagesForDelete.size})
            </button>
            </>
          )}
        </div>
          {(pageOrder.length > 0 ? pageOrder : Array.from({ length: totalPages }, (_, i) => i + 1)).map((pageNum, index) => (
            <div
              key={pageNum}
              draggable
              onDragStart={() => handleDragStart(pageNum)}
              onDragOver={(e) => handleDragOver(e, pageNum)}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, pageNum)}
              className={`mb-2 p-2 rounded-md transition-all ${
                (pageOrder.length > 0 && currentPage > 0 && currentPage <= pageOrder.length && pageOrder[currentPage - 1] === pageNum) || 
                (pageOrder.length === 0 && currentPage === pageNum)
                  ? 'bg-primary/10 border-2 border-primary'
                  : 'bg-white border border-slate-200 hover:border-primary/50'
              } ${selectedPagesForDelete.has(pageNum) ? 'ring-2 ring-red-500' : ''} ${
                draggedPage === pageNum ? 'opacity-50' : ''
              } ${dragOverPage === pageNum ? 'border-blue-500 border-2' : ''}`}
            >
              <div className="flex items-start gap-2 mb-1">
                <input
                  type="checkbox"
                  checked={selectedPagesForDelete.has(pageNum)}
                  onChange={(e) => {
                    e.stopPropagation();
                    const newSelected = new Set(selectedPagesForDelete);
                    if (e.target.checked) {
                      newSelected.add(pageNum);
                    } else {
                      newSelected.delete(pageNum);
                    }
                    setSelectedPagesForDelete(newSelected);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                />
                <div className="flex items-center gap-1 flex-1">
                  <MdDragHandle 
                    className="text-slate-400 cursor-move flex-shrink-0" 
                    title="ドラッグして順序を変更"
                  />
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setCurrentPage(pageNum);
                    }}
                    className="flex-1 cursor-pointer"
                  >
                    {thumbnails[pageNum] ? (
                      <img
                        src={thumbnails[pageNum]}
                        alt={`ページ ${pageNum}`}
                        className="w-full h-auto block mb-1 rounded"
                      />
                    ) : (
                      <div className="py-5 text-center text-slate-400 text-xs">
                        読み込み中...
                      </div>
                    )}
                    <div className={`text-xs text-center ${
                      (pageOrder.length > 0 && currentPage > 0 && currentPage <= pageOrder.length && pageOrder[currentPage - 1] === pageNum) || 
                      (pageOrder.length === 0 && currentPage === pageNum)
                        ? 'font-bold text-primary' : 'text-slate-600'
                    }`}>
                      ページ {pageNum} {pageOrder.length > 0 && `(${index + 1}番目)`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
              ))}
            <div className="h-8"></div> {/* スクロール用の余白 */}
          </div>
        )}

        {/* ページ操作 */}
        {pdfDoc && (
          <>
            <div className="mb-4 flex gap-3 md:gap-4 items-center flex-wrap justify-between transition-all duration-300 relative z-50" style={{ pointerEvents: 'auto' }}>
              {/* 左側: ページ管理とナビゲーション */}
              <div className="flex gap-3 md:gap-4 items-center flex-wrap">
            <button
              onClick={() => setShowThumbnailModal(true)}
              title="ページ一覧のサムネイルを全画面で表示します"
              className="px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-sm text-white border-indigo-600 shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
              style={{
                background: 'linear-gradient(to right, #4f46e5, #9333ea)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #4338ca, #7e22ce)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #4f46e5, #9333ea)';
              }}
            >
              <MdList className="text-lg text-white" />
              ページ管理
            </button>
            <button
              onClick={goToPrevPage}
              disabled={currentPage === 1}
              title="前のページに移動します (←)"
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-cyan-500 shadow-md hover:scale-105 active:scale-95 ${
                currentPage === 1 ? 'cursor-not-allowed' : ''
              }`}
              style={{
                background: currentPage === 1
                  ? '#e2e8f0'
                  : 'linear-gradient(to right, #06b6d4, #3b82f6)',
                color: currentPage === 1 ? '#94a3b8' : 'white',
              }}
              onMouseEnter={(e) => {
                if (currentPage !== 1) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #0891b2, #2563eb)';
                }
              }}
              onMouseLeave={(e) => {
                if (currentPage !== 1) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #06b6d4, #3b82f6)';
                }
              }}
            >
              <MdNavigateBefore className={`text-lg ${currentPage === 1 ? 'text-slate-400' : 'text-white'}`} />
              前へ
            </button>
            <span className="text-sm font-semibold bg-gradient-to-r from-slate-600 to-slate-700 bg-clip-text text-transparent px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
              ページ {currentPage} / {totalPages}
            </span>
            <button
              onClick={goToNextPage}
              disabled={currentPage === totalPages}
              title="次のページに移動します (→)"
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-cyan-500 shadow-md hover:scale-105 active:scale-95 ${
                currentPage === totalPages ? 'cursor-not-allowed' : ''
              }`}
              style={{
                background: currentPage === totalPages
                  ? '#e2e8f0'
                  : 'linear-gradient(to right, #06b6d4, #3b82f6)',
                color: currentPage === totalPages ? '#94a3b8' : 'white',
              }}
              onMouseEnter={(e) => {
                if (currentPage !== totalPages) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #0891b2, #2563eb)';
                }
              }}
              onMouseLeave={(e) => {
                if (currentPage !== totalPages) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #06b6d4, #3b82f6)';
                }
              }}
            >
              次へ
              <MdNavigateNext className={`text-lg ${currentPage === totalPages ? 'text-slate-400' : 'text-white'}`} />
            </button>
            <span className="text-slate-300 mx-1">|</span>
                <button
              onClick={() => {
                const actualPageNum = getActualPageNum(currentPage);
                if (rotationMode === 'all') {
                  // 全ページを回転
                  setPageRotations(prev => {
                    const newRotations: Record<number, number> = {};
                    for (let i = 1; i <= totalPages; i++) {
                      const currentRot = prev[i] || 0;
                      newRotations[i] = (currentRot + 90) % 360;
                    }
                    return newRotations;
                  });
                } else {
                  // 現在のページのみ回転
                  setPageRotations(prev => {
                    const currentRot = prev[actualPageNum] || 0;
                    return { ...prev, [actualPageNum]: (currentRot + 90) % 360 };
                  });
                }
              }}
              title={`ページを90度回転します（${rotationMode === 'all' ? '全ページ' : '現在のページのみ'}）`}
              className="px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm text-white border-emerald-500 shadow-md hover:scale-105 active:scale-95"
              style={{
                background: 'linear-gradient(to right, #10b981, #14b8a6)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #059669, #0d9488)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #10b981, #14b8a6)';
              }}
            >
              <MdRotateRight className="text-lg" />
              回転 ({rotationMode === 'all' ? '全' : getActualPageNum(currentPage)}: {pageRotations[getActualPageNum(currentPage)] || 0}°)
            </button>
            <select
              value={rotationMode}
              onChange={(e) => setRotationMode(e.target.value as 'all' | 'current')}
              className="px-2 py-1 border rounded text-sm bg-white"
              title="回転モードを選択"
            >
              <option value="all">全ページ</option>
              <option value="current">現在のページ</option>
            </select>
        </div>

              {/* 右側: ズーム */}
              <div className="flex gap-3 items-center flex-wrap">
            <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
              <MdZoomOut className="text-base" />
              ズーム:
            </span>
            <button
              onClick={() => setScale(0.75)}
              title="表示倍率を75%に設定します"
                  className={`px-3 py-2 border rounded-lg text-sm font-medium transition-all shadow-sm border-violet-500 ${
                scale === 0.75 ? 'shadow-md' : ''
              }`}
              style={{
                background: scale === 0.75
                  ? 'linear-gradient(to right, #8b5cf6, #a855f7)'
                  : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                color: scale === 0.75 ? 'white' : '#334155',
              }}
              onMouseEnter={(e) => {
                if (scale === 0.75) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #7c3aed, #9333ea)';
                }
              }}
              onMouseLeave={(e) => {
                if (scale === 0.75) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #8b5cf6, #a855f7)';
                }
              }}
            >
              75%
            </button>
            <button
              onClick={() => setScale(1.0)}
              title="表示倍率を100%に設定します"
                  className={`px-3 py-2 border rounded-lg text-sm font-medium transition-all shadow-sm border-violet-500 ${
                scale === 1.0 ? 'shadow-md' : ''
              }`}
              style={{
                background: scale === 1.0
                  ? 'linear-gradient(to right, #8b5cf6, #a855f7)'
                  : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                color: scale === 1.0 ? 'white' : '#334155',
              }}
              onMouseEnter={(e) => {
                if (scale === 1.0) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #7c3aed, #9333ea)';
                }
              }}
              onMouseLeave={(e) => {
                if (scale === 1.0) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #8b5cf6, #a855f7)';
                }
              }}
            >
              100%
            </button>
            <button
              onClick={() => setScale(1.25)}
              title="表示倍率を125%に設定します"
                  className={`px-3 py-2 border rounded-lg text-sm font-medium transition-all shadow-sm border-violet-500 ${
                scale === 1.25 ? 'shadow-md' : ''
              }`}
              style={{
                background: scale === 1.25
                  ? 'linear-gradient(to right, #8b5cf6, #a855f7)'
                  : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                color: scale === 1.25 ? 'white' : '#334155',
              }}
              onMouseEnter={(e) => {
                if (scale === 1.25) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #7c3aed, #9333ea)';
                }
              }}
              onMouseLeave={(e) => {
                if (scale === 1.25) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #8b5cf6, #a855f7)';
                }
              }}
            >
              125%
            </button>
              </div>
          </div>


          {/* ツールバー */}
          <div className="mb-4 flex gap-3 md:gap-4 items-center flex-wrap justify-between transition-all duration-300 relative z-50" style={{ pointerEvents: 'auto' }}>
            {/* ツールボックス: 描画ツールをまとめる */}
            <div className="bg-white/90 backdrop-blur-sm border-2 border-slate-200 rounded-xl p-3 shadow-lg">
              <div className="text-xs font-semibold text-slate-600 mb-2 px-2">ツール</div>
              <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => {
                  setTool('pen');
                  if (textSelectionEnabled) {
                    setTextSelectionEnabled(false);
                  }
                }}
                title="手書きで線を描画します"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-indigo-600 ${
                  tool === 'pen' ? 'shadow-md' : ''
                }`}
                style={{
                  background: tool === 'pen'
                    ? 'linear-gradient(to right, #4f46e5, #9333ea)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: tool === 'pen' ? 'white' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (tool === 'pen') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #4338ca, #7e22ce)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (tool === 'pen') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #4f46e5, #9333ea)';
                  }
                }}
              >
                <MdBrush className={`text-base ${tool === 'pen' ? 'text-white' : 'text-indigo-600'}`} />
                ペン
              </button>
              <button
                onClick={() => {
                  setTool('eraser');
                  if (textSelectionEnabled) {
                    setTextSelectionEnabled(false);
                  }
                }}
                title="描画した線を消去します"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-red-500 ${
                  tool === 'eraser' ? 'shadow-md' : ''
                }`}
                style={{
                  background: tool === 'eraser'
                    ? 'linear-gradient(to right, #ef4444, #ec4899)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: tool === 'eraser' ? 'white' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (tool === 'eraser') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #dc2626, #db2777)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (tool === 'eraser') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #ef4444, #ec4899)';
                  }
                }}
              >
                <MdClear className={`text-base ${tool === 'eraser' ? 'text-white' : 'text-red-500'}`} />
                消しゴム
              </button>
              <button
                onClick={() => {
                  setTool('text');
                  if (textSelectionEnabled) {
                    setTextSelectionEnabled(false);
                  }
                }}
                title="テキストを追加します"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-blue-500 ${
                  tool === 'text' ? 'shadow-md' : ''
                }`}
                style={{
                  background: tool === 'text'
                    ? 'linear-gradient(to right, #3b82f6, #06b6d4)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: tool === 'text' ? 'white' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (tool === 'text') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #2563eb, #0891b2)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (tool === 'text') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #3b82f6, #06b6d4)';
                  }
                }}
              >
                <MdTextFields className={`text-base ${tool === 'text' ? 'text-white' : 'text-blue-500'}`} />
                テキスト
              </button>
              <button
                onClick={() => {
                  setTool('line');
                  if (textSelectionEnabled) {
                    setTextSelectionEnabled(false);
                  }
                }}
                title="直線を描画します"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-emerald-500 ${
                  tool === 'line' ? 'shadow-md' : ''
                }`}
                style={{
                  background: tool === 'line'
                    ? 'linear-gradient(to right, #10b981, #14b8a6)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: tool === 'line' ? 'white' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (tool === 'line') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #059669, #0d9488)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (tool === 'line') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #10b981, #14b8a6)';
                  }
                }}
              >
                <MdRemove className={`text-base ${tool === 'line' ? 'text-white' : 'text-emerald-500'}`} />
                線
              </button>
              <button
                onClick={() => {
                  setTool('rectangle');
                  if (textSelectionEnabled) {
                    setTextSelectionEnabled(false);
                  }
                }}
                title="四角形を描画します"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-orange-500 ${
                  tool === 'rectangle' ? 'shadow-md' : ''
                }`}
                style={{
                  background: tool === 'rectangle'
                    ? 'linear-gradient(to right, #f97316, #f59e0b)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: tool === 'rectangle' ? 'white' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (tool === 'rectangle') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #ea580c, #d97706)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (tool === 'rectangle') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #f97316, #f59e0b)';
                  }
                }}
              >
                <MdRectangle className={`text-base ${tool === 'rectangle' ? 'text-white' : 'text-orange-500'}`} />
                四角形
              </button>
              <button
                onClick={() => {
                  setTool('circle');
                  if (textSelectionEnabled) {
                    setTextSelectionEnabled(false);
                  }
                }}
                title="円を描画します"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-violet-500 ${
                  tool === 'circle' ? 'shadow-md' : ''
                }`}
                style={{
                  background: tool === 'circle'
                    ? 'linear-gradient(to right, #8b5cf6, #d946ef)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: tool === 'circle' ? 'white' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (tool === 'circle') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #7c3aed, #c026d3)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (tool === 'circle') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #8b5cf6, #d946ef)';
                  }
                }}
              >
                <MdCircle className={`text-base ${tool === 'circle' ? 'text-white' : 'text-violet-500'}`} />
                円
              </button>
              <button
                onClick={() => {
                  setTool('arrow');
                  if (textSelectionEnabled) {
                    setTextSelectionEnabled(false);
                  }
                }}
                title="矢印を描画します"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-rose-500 ${
                  tool === 'arrow' ? 'shadow-md' : ''
                }`}
                style={{
                  background: tool === 'arrow'
                    ? 'linear-gradient(to right, #f43f5e, #ec4899)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: tool === 'arrow' ? 'white' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (tool === 'arrow') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #e11d48, #db2777)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (tool === 'arrow') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #f43f5e, #ec4899)';
                  }
                }}
              >
                <MdArrowForward className={`text-base ${tool === 'arrow' ? 'text-white' : 'text-rose-500'}`} />
                矢印
              </button>
              <button
                onClick={() => {
                  setTool('highlight');
                  if (textSelectionEnabled) {
                    setTextSelectionEnabled(false);
                  }
                }}
                title="テキストをハイライトします"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-yellow-400 ${
                  tool === 'highlight' ? 'shadow-md' : ''
                }`}
                style={{
                  background: tool === 'highlight'
                    ? 'linear-gradient(to right, #facc15, #fbbf24)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: tool === 'highlight' ? '#1e293b' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (tool === 'highlight') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #eab308, #f59e0b)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (tool === 'highlight') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #facc15, #fbbf24)';
                  }
                }}
              >
                <MdHighlight className={`text-base ${tool === 'highlight' ? 'text-slate-800' : 'text-yellow-500'}`} />
                ハイライト
              </button>
              <div className="relative">
                <button
                  onClick={() => {
                    setTool('stamp');
                    if (textSelectionEnabled) {
                      setTextSelectionEnabled(false);
                    }
                  }}
                  title="スタンプを追加します"
                  className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-purple-500 ${
                    tool === 'stamp' ? 'shadow-md' : ''
                  }`}
                  style={{
                    background: tool === 'stamp'
                      ? 'linear-gradient(to right, #a855f7, #9333ea)'
                      : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                    color: tool === 'stamp' ? 'white' : '#334155',
                  }}
                  onMouseEnter={(e) => {
                    if (tool === 'stamp') {
                      e.currentTarget.style.background = 'linear-gradient(to right, #9333ea, #7e22ce)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (tool === 'stamp') {
                      e.currentTarget.style.background = 'linear-gradient(to right, #a855f7, #9333ea)';
                    }
                  }}
                >
                  <MdLocalOffer className={`text-base ${tool === 'stamp' ? 'text-white' : 'text-purple-500'}`} />
                  スタンプ
                  {tool === 'stamp' && (
                    <span className="ml-1 text-xs">
                      ({selectedStampType === 'date' ? '日付' : selectedStampType === 'approved' ? '承認' : '却下'})
                    </span>
                  )}
                </button>
                <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTextSelectionEnabled(!textSelectionEnabled);
              }}
              title={textSelectionEnabled ? "テキスト選択を無効化" : "テキスト選択を有効化"}
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm hover:scale-105 active:scale-95 ${
                textSelectionEnabled 
                  ? 'border-green-600 text-white shadow-md' 
                  : 'border-slate-300 bg-white text-slate-600'
              }`}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                zIndex: 10,
                background: textSelectionEnabled 
                  ? 'linear-gradient(to right, #16a34a, #22c55e)' 
                  : 'white',
                borderWidth: textSelectionEnabled ? '2px' : '1px',
                fontWeight: textSelectionEnabled ? 'bold' : 'normal',
              }}
              onMouseEnter={(e) => {
                if (textSelectionEnabled) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #15803d, #16a34a)';
                } else {
                  e.currentTarget.style.background = '#f1f5f9';
                }
              }}
              onMouseLeave={(e) => {
                if (textSelectionEnabled) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #16a34a, #22c55e)';
                } else {
                  e.currentTarget.style.background = 'white';
                }
              }}
            >
              <MdSelectAll className="text-base" />
              {textSelectionEnabled ? 'テキスト選択ON' : 'テキスト選択OFF'}
            </button>
            
                {tool === 'stamp' && (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-purple-300 rounded-lg shadow-lg p-2 z-50">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => setSelectedStampType('date')}
                        className={`px-3 py-1 text-sm rounded ${selectedStampType === 'date' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'}`}
                      >
                        日付
                      </button>
                      <button
                        onClick={() => setSelectedStampType('approved')}
                        className={`px-3 py-1 text-sm rounded ${selectedStampType === 'approved' ? 'bg-green-100 text-green-700' : 'hover:bg-gray-100'}`}
                      >
                        承認
                      </button>
                      <button
                        onClick={() => setSelectedStampType('rejected')}
                        className={`px-3 py-1 text-sm rounded ${selectedStampType === 'rejected' ? 'bg-red-100 text-red-700' : 'hover:bg-gray-100'}`}
                      >
                        却下
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setTool('select');
                  setSelectedAnnotationIds({ strokes: [], shapes: [], texts: [] });
                  // テキスト入力フィールドを閉じる
                  setTextInputPosition(null);
                  setTextInputValue('');
                  setEditingTextId(null);
                  // 描画状態をリセット
                  setCurrentStroke(null);
                  isDrawingRef.current = false;
                  setCurrentShape(null);
                  setShapeStartPoint(null);
                }}
                title="選択ツール: 注釈をクリックで選択、Ctrl+クリックで複数選択、Delete/Backspaceキーで削除、ドラッグで移動"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-slate-600 ${
                  tool === 'select' ? 'shadow-md' : ''
                }`}
                style={{
                  background: tool === 'select'
                    ? 'linear-gradient(to right, #475569, #334155)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: tool === 'select' ? 'white' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (tool === 'select') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #334155, #1e293b)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (tool === 'select') {
                    e.currentTarget.style.background = 'linear-gradient(to right, #475569, #334155)';
                  }
                }}
              >
                <MdSelectAll className={`text-base ${tool === 'select' ? 'text-white' : 'text-slate-600'}`} />
                選択
              </button>
              <button
                onClick={() => setShowAnnotationList(!showAnnotationList)}
                title="注釈一覧を表示/非表示"
                className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-green-500 ${
                  showAnnotationList ? 'shadow-md' : ''
                }`}
                style={{
                  background: showAnnotationList
                    ? 'linear-gradient(to right, #22c55e, #10b981)'
                    : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                  color: showAnnotationList ? 'white' : '#334155',
                }}
                onMouseEnter={(e) => {
                  if (showAnnotationList) {
                    e.currentTarget.style.background = 'linear-gradient(to right, #16a34a, #059669)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (showAnnotationList) {
                    e.currentTarget.style.background = 'linear-gradient(to right, #22c55e, #10b981)';
                  }
                }}
              >
                <MdList className={`text-base ${showAnnotationList ? 'text-white' : 'text-green-500'}`} />
                注釈一覧
              </button>
              {formFields.length > 0 && (
                <button
                  onClick={() => setShowFormFields(!showFormFields)}
                  title="フォームフィールドを表示/非表示"
                  className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-purple-500 ${
                    showFormFields ? 'shadow-md' : ''
                  }`}
                  style={{
                    background: showFormFields
                      ? 'linear-gradient(to right, #a855f7, #ec4899)'
                      : 'linear-gradient(to right, #f1f5f9, #e2e8f0)',
                    color: showFormFields ? 'white' : '#334155',
                  }}
                  onMouseEnter={(e) => {
                    if (showFormFields) {
                      e.currentTarget.style.background = 'linear-gradient(to right, #9333ea, #db2777)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (showFormFields) {
                      e.currentTarget.style.background = 'linear-gradient(to right, #a855f7, #ec4899)';
                    }
                  }}
                >
                  <MdTextFields className={`text-base ${showFormFields ? 'text-white' : 'text-purple-500'}`} />
                  フォーム ({formFields.length})
                </button>
              )}
              </div>
            </div>

            {(tool === 'pen' || tool === 'highlight') && (
              <div className="flex gap-3 items-center flex-wrap">
                <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                    <MdPalette className="text-lg text-purple-600" />
                    色:
                  </label>
                  <div className="flex gap-1 items-center">
                    {['#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500'].map((presetColor) => (
                      <button
                        key={presetColor}
                        onClick={() => setColor(presetColor)}
                        className={`w-8 h-8 rounded border-2 transition-all hover:scale-110 ${
                          color === presetColor ? 'border-slate-800 ring-2 ring-offset-1 ring-slate-400' : 'border-slate-300'
                        }`}
                        style={{ backgroundColor: presetColor }}
                        title={presetColor}
                      />
                    ))}
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                      className="w-10 h-8 rounded border border-slate-300 cursor-pointer ml-1"
                  />
                  </div>
                </div>
                {tool === 'pen' && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    太さ:
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={width}
                      onChange={(e) => setWidth(Number(e.target.value))}
                      className="w-20"
                    />
                    <span className="w-10 text-xs">{width}px</span>
                  </label>
                )}
                {tool === 'highlight' && (
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    モード:
                    <select
                      value={highlightMode}
                      onChange={(e) => setHighlightMode(e.target.value as 'auto' | 'manual')}
                      className="px-2 py-1 text-xs border border-slate-300 rounded"
                    >
                      <option value="auto">自動（クリックで文字列全体）</option>
                      <option value="manual">手動（ドラッグで範囲指定）</option>
                    </select>
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smoothStrokeEnabled}
                    onChange={(e) => setSmoothStrokeEnabled(e.target.checked)}
                    className="w-4 h-4"
                  />
                  ストローク平滑化
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={snapToTextEnabled}
                    onChange={(e) => setSnapToTextEnabled(e.target.checked)}
                    className="w-4 h-4"
                  />
                  テキストスナップ
                </label>
              </div>
            )}

            {tool === 'text' && (
              <>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <MdPalette className="text-lg text-purple-600" />
                    色:
                  </label>
                  <div className="flex gap-1 items-center">
                    {['#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500'].map((presetColor) => (
                      <button
                        key={presetColor}
                        onClick={() => setColor(presetColor)}
                        className={`w-8 h-8 rounded border-2 transition-all hover:scale-110 ${
                          color === presetColor ? 'border-slate-800 ring-2 ring-offset-1 ring-slate-400' : 'border-slate-300'
                        }`}
                        style={{ backgroundColor: presetColor }}
                        title={presetColor}
                      />
                    ))}
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-10 h-8 rounded border border-slate-300 cursor-pointer ml-1"
                    />
                  </div>
                </div>
                <label>
                  フォントサイズ:
                  <input
                    type="range"
                    min="8"
                    max="48"
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    style={{ marginLeft: '5px' }}
                  />
                  <span style={{ marginLeft: '5px' }}>{fontSize}px</span>
                </label>
              </>
            )}

            {(tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow') && (
              <div className="flex gap-3 items-center flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <MdPalette className="text-lg text-purple-600" />
                    色:
                  </label>
                  <div className="flex gap-1 items-center">
                    {['#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500'].map((presetColor) => (
                      <button
                        key={presetColor}
                        onClick={() => setColor(presetColor)}
                        className={`w-8 h-8 rounded border-2 transition-all hover:scale-110 ${
                          color === presetColor ? 'border-slate-800 ring-2 ring-offset-1 ring-slate-400' : 'border-slate-300'
                        }`}
                        style={{ backgroundColor: presetColor }}
                        title={presetColor}
                      />
                    ))}
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="w-10 h-8 rounded border border-slate-300 cursor-pointer ml-1"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  太さ:
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    className="w-20"
                  />
                  <span className="w-10 text-xs">{width}px</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fillShape}
                    onChange={(e) => setFillShape(e.target.checked)}
                    className="w-4 h-4"
                  />
                  塗りつぶし
                </label>
              </div>
            )}

            {tool === 'eraser' && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                消しゴムサイズ:
                <input
                  type="range"
                  min="5"
                  max="30"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="w-24"
                />
                <span className="w-10 text-xs">{width}px</span>
              </label>
            )}
          </div>

          {/* 操作ボタン */}
          <div className="mb-4 flex gap-3 md:gap-4 items-center flex-wrap transition-all duration-300 relative z-50" style={{ pointerEvents: 'auto' }}>
            {/* アクションツール（電子署名、承認ワークフロー、PDF分割） */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('電子署名ボタンがクリックされました');
                console.log('showSignatureDialogをtrueに設定します');
                setShowSignatureDialog(true);
                console.log('setShowSignatureDialog(true)を実行しました');
              }}
              title="電子署名を追加"
              className="px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-blue-500 shadow-md hover:scale-105 active:scale-95"
              style={{
                background: 'linear-gradient(to right, #3b82f6, #06b6d4)',
                color: 'white',
                pointerEvents: 'auto',
                cursor: 'pointer',
                zIndex: 10,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #2563eb, #0891b2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #3b82f6, #06b6d4)';
              }}
            >
              <MdAssignment className="text-base text-white" />
              電子署名
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('PDF分割ボタンがクリックされました');
                console.log('showSplitDialogをtrueに設定します');
                setShowSplitDialog(true);
                console.log('setShowSplitDialog(true)を実行しました');
              }}
              title="PDFを分割"
              className="px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-orange-500 shadow-md hover:scale-105 active:scale-95"
              style={{
                background: 'linear-gradient(to right, #f97316, #f59e0b)',
                color: 'white',
                pointerEvents: 'auto',
                cursor: 'pointer',
                zIndex: 10,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #ea580c, #d97706)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #f97316, #f59e0b)';
              }}
            >
              <MdContentCut className="text-base text-white" />
              PDF分割
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowWatermarkDialog(true);
              }}
              title="透かしを追加"
              className="px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-teal-500 shadow-md hover:scale-105 active:scale-95"
              style={{
                background: 'linear-gradient(to right, #14b8a6, #06b6d4)',
                color: 'white',
                pointerEvents: 'auto',
                cursor: 'pointer',
                zIndex: 10,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #0d9488, #0891b2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #14b8a6, #06b6d4)';
              }}
            >
              <MdSecurity className="text-base text-white" />
              透かし
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowTableOfContentsDialog(true);
              }}
              title="目次を生成"
              className="px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-indigo-500 shadow-md hover:scale-105 active:scale-95"
              style={{
                background: 'linear-gradient(to right, #6366f1, #8b5cf6)',
                color: 'white',
                pointerEvents: 'auto',
                cursor: 'pointer',
                zIndex: 10,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #4f46e5, #7c3aed)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #6366f1, #8b5cf6)';
              }}
            >
              <MdMenuBook className="text-base text-white" />
              目次
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowOCRDialog(true);
              }}
              title="OCR（光学文字認識）"
              className="px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-purple-500 shadow-md hover:scale-105 active:scale-95"
              style={{
                background: 'linear-gradient(to right, #a855f7, #9333ea)',
                color: 'white',
                pointerEvents: 'auto',
                cursor: 'pointer',
                zIndex: 10,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #9333ea, #7e22ce)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #a855f7, #9333ea)';
              }}
            >
              <span className="text-base text-white font-bold">Tt</span>
              OCR
            </button>
            <span className="text-slate-300 mx-1">|</span>
            {/* プレゼンモードボタン */}
            {pdfDoc && (
              <>
                <button
                  onClick={() => setIsPresentationMode(true)}
                  className="px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-green-500 shadow-md hover:scale-105 active:scale-95"
                  style={{
                    background: 'linear-gradient(to right, #10b981, #059669)',
                    color: 'white',
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                    zIndex: 10,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(to right, #059669, #047857)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(to right, #10b981, #059669)';
                  }}
                  title="スライドショーモード (F11)"
                >
                  <MdSlideshow className="text-base text-white" />
                  プレゼン
                </button>
                <span className="text-slate-300 mx-1">|</span>
              </>
            )}
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-slate-600 ${
                undoStack.length === 0 ? 'cursor-not-allowed' : 'shadow-md'
              }`}
              style={{ 
                minHeight: isMobile ? '44px' : 'auto',
                minWidth: isMobile ? '44px' : 'auto',
                touchAction: 'manipulation',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
                background: undoStack.length === 0
                  ? '#e2e8f0'
                  : 'linear-gradient(to right, #475569, #334155)',
                color: undoStack.length === 0 ? '#94a3b8' : 'white',
              }}
              onMouseEnter={(e) => {
                if (undoStack.length !== 0) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #334155, #1e293b)';
                }
              }}
              onMouseLeave={(e) => {
                if (undoStack.length !== 0) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #475569, #334155)';
                }
              }}
              title="元に戻す (Ctrl+Z)"
            >
              <MdUndo className={`text-base ${undoStack.length === 0 ? 'text-slate-400' : 'text-white'}`} />
              Undo
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-slate-600 ${
                redoStack.length === 0 ? 'cursor-not-allowed' : 'shadow-md'
              }`}
              style={{ 
                minHeight: isMobile ? '44px' : 'auto',
                minWidth: isMobile ? '44px' : 'auto',
                touchAction: 'manipulation',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
                background: redoStack.length === 0
                  ? '#e2e8f0'
                  : 'linear-gradient(to right, #475569, #334155)',
                color: redoStack.length === 0 ? '#94a3b8' : 'white',
              }}
              onMouseEnter={(e) => {
                if (redoStack.length !== 0) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #334155, #1e293b)';
                }
              }}
              onMouseLeave={(e) => {
                if (redoStack.length !== 0) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #475569, #334155)';
                }
              }}
              title="やり直し (Ctrl+Y / Ctrl+Shift+Z)"
            >
              <MdRedo className={`text-base ${redoStack.length === 0 ? 'text-slate-400' : 'text-white'}`} />
              Redo
            </button>
            <button
              onClick={handleClear}
              className="px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm text-white border-red-500 shadow-md hover:scale-105 active:scale-95"
              style={{ 
                minHeight: isMobile ? '44px' : 'auto',
                minWidth: isMobile ? '44px' : 'auto',
                touchAction: 'manipulation',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
                background: 'linear-gradient(to right, #ef4444, #ec4899)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #dc2626, #db2777)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(to right, #ef4444, #ec4899)';
              }}
              title="すべてクリア"
            >
              <MdDelete className="text-base" />
              Clear
            </button>
            <button
              onClick={handleExportJSON}
              disabled={!pdfDoc}
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm border-teal-500 hover:scale-105 active:scale-95 ${
                !pdfDoc ? 'cursor-not-allowed' : 'shadow-md'
              }`}
              style={{
                background: !pdfDoc
                  ? '#cbd5e1'
                  : 'linear-gradient(to right, #14b8a6, #06b6d4)',
                color: !pdfDoc ? '#64748b' : 'white',
              }}
              onMouseEnter={(e) => {
                if (pdfDoc) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #0d9488, #0891b2)';
                }
              }}
              onMouseLeave={(e) => {
                if (pdfDoc) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #14b8a6, #06b6d4)';
                }
              }}
              title="注釈データをJSON形式でエクスポートします（バックアップ用）"
            >
              <MdFileDownload className={`text-base ${!pdfDoc ? 'text-slate-500' : 'text-white'}`} />
              JSONエクスポート
            </button>
            <label
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all flex items-center gap-1 shadow-sm cursor-pointer border-purple-500 hover:shadow-lg hover:scale-105 active:scale-95 ${
                !pdfDoc ? 'cursor-not-allowed' : 'shadow-md'
              }`}
              style={{
                background: !pdfDoc
                  ? '#cbd5e1'
                  : 'linear-gradient(to right, #a855f7, #ec4899, #f43f5e)',
                color: !pdfDoc ? '#64748b' : 'white',
              }}
              onMouseEnter={(e) => {
                if (pdfDoc) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #9333ea, #db2777, #e11d48)';
                }
              }}
              onMouseLeave={(e) => {
                if (pdfDoc) {
                  e.currentTarget.style.background = 'linear-gradient(to right, #a855f7, #ec4899, #f43f5e)';
                }
              }}
              title="JSON形式の注釈データをインポートします"
            >
              <input
                type="file"
                accept="application/json"
                onChange={handleImportJSON}
                disabled={!pdfDoc}
                style={{ display: 'none' }}
              />
              <MdUpload className={`text-base ${!pdfDoc ? 'text-slate-500' : 'text-white'}`} />
              JSONインポート
            </label>
          </div>

          {/* PDF表示領域 */}
          <div
            ref={containerRef}
            className="relative inline-block border border-slate-300 bg-slate-50 rounded-lg shadow-sm"
            style={{ isolation: 'isolate', position: 'relative', zIndex: 0 }}
            onDoubleClick={(e) => {
              // テキスト選択モードが有効な場合、ダブルクリックでテキスト範囲を検出してコピー
              if (textSelectionEnabled) {
                e.stopPropagation();
                e.preventDefault();
                
                console.log('ダブルクリックイベント（container）:', { textSelectionEnabled, tool, pageSize: !!pageSize, textItemsCount: textItems.length });
                
                if (!pageSize || !containerRef.current) {
                  console.log('テキスト選択: pageSizeまたはcontainerRefがありません');
                  return;
                }
                
                const rect = containerRef.current.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                console.log('テキスト選択: クリック位置', { x, y, textItemsCount: textItems.length });
                
                // ハイライト機能と同じ方法でテキスト範囲を検出
                if (textItems.length > 0) {
                  const boundingBox = findTextBoundingBox(textItems, x, y, 30);
                  console.log('テキスト選択: バウンディングボックス', boundingBox);
                  
                  if (boundingBox) {
                    // テキスト範囲内のすべてのテキストアイテムを取得
                    const selectedTextItems = textItems.filter(item => {
                      return item.x >= boundingBox.x - 5 &&
                             item.x + item.width <= boundingBox.x + boundingBox.width + 5 &&
                             item.y >= boundingBox.y - 5 &&
                             item.y + item.height <= boundingBox.y + boundingBox.height + 5;
                    });
                    
                    console.log('テキスト選択: 選択されたアイテム数', selectedTextItems.length);
                    
                    // テキストを結合（行ごとに整理）
                    const selectedText = selectedTextItems
                      .sort((a, b) => {
                        // Y座標でソート（上から下へ）
                        if (Math.abs(a.y - b.y) > 5) return a.y - b.y;
                        // 同じ行ならX座標でソート（左から右へ）
                        return a.x - b.x;
                      })
                      .map(item => item.str)
                      .join('');
                    
                    console.log('テキスト選択: 抽出されたテキスト', selectedText);
                    
                    if (selectedText) {
                      // クリップボードにコピー
                      navigator.clipboard.writeText(selectedText).then(() => {
                        console.log('テキスト選択: クリップボードにコピー成功');
                        toast({
                          title: "テキストをコピーしました",
                          description: `"${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}"`,
                          variant: "success",
                        });
                      }).catch(err => {
                        console.error('クリップボードへのコピーに失敗:', err);
                        toast({
                          title: "エラー",
                          description: "テキストのコピーに失敗しました",
                          variant: "destructive",
                        });
                      });
                      
                      // 目次編集中の場合は、自動的に入力フィールドに設定
                      if (editingTOCIndex !== null) {
                        setEditingTOCTitle(selectedText);
                      }
                    } else {
                      console.log('テキスト選択: 抽出されたテキストが空です');
                    }
                  } else {
                    console.log('テキスト選択: バウンディングボックスが見つかりませんでした');
                  }
                } else {
                  console.log('テキスト選択: textItemsが空です');
                }
              }
            }}
          >
            <canvas
              ref={pdfCanvasRef}
              style={{ display: 'block', position: 'relative', zIndex: 1 }}
            />
            {/* テキストレイヤー（テキスト選択可能にする） */}
            {textSelectionEnabled && (
              <div
                ref={textLayerRef}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  zIndex: 9, // inkCanvasより下に配置（inkCanvasがzIndex: 11なので）
                  pointerEvents: 'none', // イベントをブロックしない
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  MozUserSelect: 'text',
                  msUserSelect: 'text',
                  overflow: 'hidden',
                  cursor: 'text',
                }}
              />
            )}
            <canvas
              ref={inkCanvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                touchAction: 'none',
                cursor: textSelectionEnabled ? 'text' : (tool === 'pen' || tool === 'highlight' ? 'crosshair' : tool === 'text' ? 'text' : (tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow') ? 'crosshair' : 'default'),
                pointerEvents: textSelectionEnabled ? 'auto' : ((tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow' || tool === 'select') ? 'none' : 'auto'),
                zIndex: textSelectionEnabled ? 11 : 2, // テキスト選択モードの時は最前面に
                width: '100%',
                height: '100%',
              }}
              onPointerDown={(e) => {
                console.log('inkCanvas onPointerDown: 呼び出されました', { textSelectionEnabled, tool, pointerEvents: textSelectionEnabled ? 'auto' : 'conditional' });
                e.stopPropagation(); // イベントの伝播を停止
                if (textSelectionEnabled) {
                  // テキスト選択モードの時はhandlePointerDownを呼び出す（テキスト選択処理のため）
                  console.log('inkCanvas onPointerDown: handlePointerDownを呼び出します');
                  e.preventDefault(); // デフォルト動作を防止
                  handlePointerDown(e);
                  return;
                }
                if (tool !== 'select') {
                  handlePointerDown(e);
                }
              }}
              onPointerMove={(e) => {
                if (textSelectionEnabled) {
                  // テキスト選択モードの時は描画を無効化
                  return;
                }
                if (tool !== 'select') {
                  handlePointerMove(e);
                }
              }}
              onPointerUp={(e) => {
                if (textSelectionEnabled) {
                  // テキスト選択モードの時は描画を無効化
                  return;
                }
                if (tool !== 'select') {
                  handlePointerUp(e);
                }
              }}
              onDoubleClick={(e) => {
                console.log('ダブルクリックイベント:', { textSelectionEnabled, tool, pageSize: !!pageSize, containerRef: !!containerRef.current, textItemsCount: textItems.length });
                
                // テキスト選択モードが有効な場合、ダブルクリックでテキスト範囲を検出してコピー
                if (textSelectionEnabled) {
                  e.stopPropagation();
                  e.preventDefault();
                  
                  if (!pageSize || !containerRef.current) {
                    console.log('テキスト選択: pageSizeまたはcontainerRefがありません');
                    return;
                  }
                  
                  const rect = containerRef.current.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const y = e.clientY - rect.top;
                  
                  console.log('テキスト選択: クリック位置', { x, y, textItemsCount: textItems.length });
                  
                  // ハイライト機能と同じ方法でテキスト範囲を検出
                  if (textItems.length > 0) {
                    const boundingBox = findTextBoundingBox(textItems, x, y, 30);
                    console.log('テキスト選択: バウンディングボックス', boundingBox);
                    
                    if (boundingBox) {
                      // テキスト範囲内のすべてのテキストアイテムを取得
                      const selectedTextItems = textItems.filter(item => {
                        return item.x >= boundingBox.x - 5 &&
                               item.x + item.width <= boundingBox.x + boundingBox.width + 5 &&
                               item.y >= boundingBox.y - 5 &&
                               item.y + item.height <= boundingBox.y + boundingBox.height + 5;
                      });
                      
                      console.log('テキスト選択: 選択されたアイテム数', selectedTextItems.length);
                      
                      // テキストを結合（行ごとに整理）
                      const selectedText = selectedTextItems
                        .sort((a, b) => {
                          // Y座標でソート（上から下へ）
                          if (Math.abs(a.y - b.y) > 5) return a.y - b.y;
                          // 同じ行ならX座標でソート（左から右へ）
                          return a.x - b.x;
                        })
                        .map(item => item.str)
                        .join('');
                      
                      console.log('テキスト選択: 抽出されたテキスト', selectedText);
                      
                      if (selectedText) {
                        // クリップボードにコピー
                        navigator.clipboard.writeText(selectedText).then(() => {
              console.log('テキスト選択: クリップボードにコピー成功');
              console.log('🔔 TOAST呼び出し開始 デバッグ');
              toast({
                title: `テキストをコピーしました`,
                description: `"${selectedText.replace(/^1\.\s*/, '').substring(0, 50)}${selectedText.length > 50 ? '...' : ''}"`,
                variant: "success",
              });
              console.log('🔔 TOAST呼び出し完了 デバッグ');
                        }).catch(err => {
                          console.error('クリップボードへのコピーに失敗:', err);
                          toast({
                            title: "エラー",
                            description: "テキストのコピーに失敗しました",
                            variant: "destructive",
                          });
                        });
                        
                        // 目次編集中の場合は、自動的に入力フィールドに設定
                        if (editingTOCIndex !== null) {
                          setEditingTOCTitle(selectedText);
                        }
                      } else {
                        console.log('テキスト選択: 抽出されたテキストが空です');
                      }
                    } else {
                      console.log('テキスト選択: バウンディングボックスが見つかりませんでした');
                    }
                  } else {
                    console.log('テキスト選択: textItemsが空です');
                  }
                }
              }}
            />
            <canvas
              ref={textCanvasRef}
              onClick={handleTextCanvasClick}
              onPointerDown={(e) => {
                if (tool === 'text' || tool === 'select') {
                  // 選択ツールの場合は描画状態をリセット
                  if (tool === 'select') {
                    isDrawingRef.current = false;
                    setCurrentStroke(null);
                  }
                  handlePointerDown(e);
                  e.stopPropagation(); // イベントの伝播を停止
                }
              }}
              onPointerMove={(e) => {
                if (tool === 'select') {
                  // 選択ツールの場合は描画状態をリセット
                  isDrawingRef.current = false;
                  setCurrentStroke(null);
                  handlePointerMove(e);
                  e.stopPropagation(); // イベントの伝播を停止
                }
              }}
              onPointerUp={(e) => {
                if (tool === 'select') {
                  // 選択ツールの場合は描画状態をリセット
                  isDrawingRef.current = false;
                  setCurrentStroke(null);
                  handlePointerUp(e);
                  e.stopPropagation(); // イベントの伝播を停止
                }
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                touchAction: 'none',
                cursor: tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'default',
                pointerEvents: (tool === 'text' || tool === 'select') ? 'auto' : 'none',
                zIndex: 3,
              }}
            />
            <canvas
              ref={shapeCanvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                touchAction: 'none',
                pointerEvents: (tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow' || tool === 'select') ? 'auto' : 'none',
                cursor: (tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow') ? 'crosshair' : tool === 'select' ? 'default' : 'default',
                zIndex: 4,
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
            />
            {/* テキスト入力フィールド */}
            {textInputPosition && (
              <div
                style={{
                  position: 'absolute',
                  left: `${textInputPosition.x}px`,
                  top: `${textInputPosition.y}px`,
                  zIndex: 1000,
                }}
              >
                <textarea
                  ref={textInputRef}
                  value={textInputValue}
                  onChange={(e) => setTextInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      // Enterキーで確定（Shift+Enterは改行）
                      e.preventDefault();
                      handleTextSubmit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setTextInputPosition(null);
                      setTextInputValue('');
                      setEditingTextId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    // テキストツールが選択されている場合は、onBlurで確定しない
                    // タッチキーボードが表示されている間はフォーカスを保持するため
                    if (tool === 'text') {
                      return;
                    }
                    
                    // テキストツール以外が選択されている場合のみ確定処理を実行
                    const relatedTarget = e.relatedTarget as HTMLElement;
                    if (!relatedTarget) {
                      // relatedTargetがnullの場合、少し待つ（タッチキーボードの表示待ち）
                      setTimeout(() => {
                        // テキスト入力フィールド自体にフォーカスが戻っている場合は確定しない
                        if (textInputRef.current && textInputRef.current === document.activeElement) return;
                        // それ以外の場合のみ確定
                        if (textInputPosition) {
                          handleTextSubmit();
                        }
                      }, 200);
                      return;
                    }
                    // テキスト入力フィールド自体にフォーカスが戻っている場合は確定しない
                    if (relatedTarget === textInputRef.current) return;
                    // 確定ボタンや削除ボタンがクリックされた場合は確定しない（ボタンのonClickで処理される）
                    if (relatedTarget.closest('button')) return;
                    if (!e.currentTarget.contains(relatedTarget)) {
                      handleTextSubmit();
                    }
                  }}
                  style={{
                    fontSize: `${fontSize}px`,
                    color: color,
                    border: '2px solid #0070f3',
                    borderRadius: '4px',
                    padding: '4px',
                    minWidth: '200px',
                    minHeight: '60px',
                    fontFamily: 'sans-serif',
                    resize: 'both',
                    backgroundColor: 'white',
                  }}
                  autoFocus
                  placeholder="テキストを入力（Enterで確定、Shift+Enterで折り返し、Escでキャンセル）"
                  onFocus={(e) => {
                    // タッチデバイスの場合、タッチキーボードが自動的に表示される
                    // 特に何もする必要はない
                  }}
                />
                <div className="mt-1 text-xs text-slate-500 mb-1">
                  💡 Shift+Enterで改行できます
                </div>
                <div className="mt-1 flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleTextSubmit}
                    className="h-7 px-2 text-xs"
                  >
                    確定
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (editingTextId) {
                        handleDeleteText(editingTextId);
                      }
                      setTextInputPosition(null);
                      setTextInputValue('');
                      setEditingTextId(null);
                    }}
                    className="h-7 px-2 text-xs"
                  >
                    削除
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setTextInputPosition(null);
                      setTextInputValue('');
                      setEditingTextId(null);
                    }}
                    className="h-7 px-2 text-xs"
                  >
                    キャンセル
                  </Button>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('音声ボタン（テキスト入力横）がマウスダウンされました');
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.nativeEvent) {
                        (e.nativeEvent as any).stopImmediatePropagation?.();
                      }
                      console.log('音声ボタン（テキスト入力横）がクリックされました');
                      console.log('setShowVoiceInput(true)を実行します');
                      
                      // PDFコンテナの位置を確認
                      if (containerRef.current && textInputPosition) {
                        const containerRect = containerRef.current.getBoundingClientRect();
                        const viewportHeight = window.innerHeight;
                        const textInputY = textInputPosition.y;
                        const containerBottom = containerRect.bottom;
                        
                        // テキスト入力フィールドがPDFの下にある場合、スクロールを誘導
                        if (textInputY > containerBottom || textInputY + 200 > viewportHeight) {
                          setTimeout(() => {
                            setDialogOpen(true);
                            setDialogTitle('音声入力モーダル');
                            setDialogMessage('音声入力モーダルが画面下部に表示されています。下にスクロールしてご確認ください。');
                            setDialogType('alert');
                          }, 100);
                        }
                      }
                      
                      setShowVoiceInput(true);
                    }}
                    style={{
                      position: 'relative',
                      zIndex: 1000,
                      pointerEvents: 'auto',
                    }}
                    className="h-7 px-2 text-xs border border-slate-300 rounded hover:bg-slate-100 flex items-center gap-1"
                    title="音声入力（日本語・英語）"
                  >
                    {isListening ? <MdMicOff className="text-base text-red-600" /> : <MdMic className="text-base text-blue-600" />}
                    音声
                  </button>
                </div>
              </div>
            )}
          </div>
          </>
        )}

      {/* 右側注釈一覧パネル */}
      {pdfDoc && showAnnotationList && (
        <div 
          className="fixed right-0 top-0 bottom-0 w-64 bg-gradient-to-b from-slate-50 to-slate-100 border-l border-slate-200 z-[100] shadow-lg flex flex-col" 
          style={{ 
            position: 'fixed', 
            right: 0, 
            top: 0, 
            bottom: 0, 
            width: '16rem', 
            height: '100vh', 
            display: 'flex', 
            flexDirection: 'column' 
          }}
        >
          <div 
            className="flex-shrink-0 p-3 mb-0 font-semibold flex justify-between items-center bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md" 
            style={{ flexShrink: 0 }}
          >
            <span className="flex items-center gap-2">
              <MdList className="text-lg" />
              注釈一覧（ページ {currentPage}）
            </span>
            <button
              onClick={(e) => {
                setShowAnnotationList(false);
              }}
              className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-white/20 text-white transition-colors"
              title="閉じる"
            >
              <MdClose className="text-lg" />
            </button>
          </div>
          <div 
            className="flex-1 overflow-y-auto overflow-x-hidden p-3" 
            style={{ 
              flex: '1 1 0%', 
              minHeight: 0, 
              overflowY: 'auto', 
              overflowX: 'hidden'
            }}
          >
          {/* ストローク一覧 */}
          {strokes.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-semibold mb-2 text-indigo-700 bg-indigo-50 px-2 py-1 rounded-md flex items-center gap-2">
                <MdBrush className="text-indigo-600" />
                ペン/ハイライト ({strokes.length})
              </div>
              {strokes.map((stroke, index) => (
                <div
                  key={stroke.id || index}
                  onClick={() => {
                    if (stroke.id) {
                      setSelectedAnnotationIds(prev => ({
                        strokes: prev.strokes.includes(stroke.id!) ? prev.strokes.filter(id => id !== stroke.id) : [...prev.strokes, stroke.id!],
                        shapes: prev.shapes,
                        texts: prev.texts,
                      }));
                    }
                  }}
                  className={`p-2.5 mb-2 rounded-lg cursor-pointer text-xs flex justify-between items-center transition-all shadow-sm ${
                    selectedAnnotationIds.strokes.includes(stroke.id || '')
                      ? 'bg-gradient-to-r from-indigo-100 to-purple-100 border-2 border-indigo-400 shadow-md'
                      : 'bg-white border border-indigo-200 hover:border-indigo-400 hover:shadow-md hover:bg-gradient-to-r hover:from-indigo-50 hover:to-purple-50'
                  }`}
                >
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className={`font-medium ${selectedAnnotationIds.strokes.includes(stroke.id || '') ? 'text-indigo-800' : 'text-slate-700'}`}>
                      <MdBrush className="inline mr-1 text-indigo-600" />
                      ストローク {index + 1}
                    </span>
                    <div className="text-[10px] text-orange-600 font-mono flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-orange-50 border border-orange-200">
                        {stroke.tool === 'pen' ? 'ペン' : stroke.tool === 'highlight' ? 'ハイライト' : '消しゴム'}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-orange-50 border border-orange-200">
                        {stroke.points.length}点
                      </span>
                      {stroke.color && (
                        <span 
                          className="inline-block w-3 h-3 rounded border border-orange-300"
                          style={{ backgroundColor: stroke.color }}
                          title={`色: ${stroke.color}`}
                        />
                      )}
                    </div>
                  </div>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (stroke.id && docId && pageSize) {
                        const newStrokes = strokes.filter(s => s.id !== stroke.id);
                        // 状態を同期的に更新（注釈一覧の表示を即座に更新するため）
                        setStrokes(newStrokes);
                        const actualPageNum = getActualPageNum(currentPage);
                        await saveAnnotations(docId, actualPageNum, newStrokes);
                        // 再描画（状態更新後に確実に実行するため、setTimeoutを使用）
                        setTimeout(() => {
                          if (inkCanvasRef.current && pageSize) {
                          const ctx = inkCanvasRef.current.getContext('2d');
                          if (ctx) {
                            const devicePixelRatio = window.devicePixelRatio || 1;
                            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
                            ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
                            redrawStrokes(ctx, newStrokes, pageSize.width, pageSize.height);
                          }
                        }
                        }, 0);
                      }
                    }}
                    className="h-6 px-2 text-xs bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-md hover:from-red-600 hover:to-pink-600 transition-all shadow-sm hover:shadow-md"
                  >
                    <MdDelete className="inline mr-1" />
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 図形一覧 */}
          {shapeAnnotations.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-semibold mb-2 text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md flex items-center gap-2">
                <MdShapeLine className="text-emerald-600" />
                図形 ({shapeAnnotations.length})
              </div>
              {shapeAnnotations.map((shape, index) => (
                <div
                  key={shape.id}
                  onClick={() => {
                    setSelectedAnnotationIds(prev => ({
                      strokes: prev.strokes,
                      shapes: prev.shapes.includes(shape.id) ? prev.shapes.filter(id => id !== shape.id) : [...prev.shapes, shape.id],
                      texts: prev.texts,
                    }));
                  }}
                  className={`p-2.5 mb-2 rounded-lg cursor-pointer text-xs flex justify-between items-center transition-all shadow-sm ${
                    selectedAnnotationIds.shapes.includes(shape.id)
                      ? 'bg-gradient-to-r from-emerald-100 to-teal-100 border-2 border-emerald-400 shadow-md'
                      : 'bg-white border border-emerald-200 hover:border-emerald-400 hover:shadow-md hover:bg-gradient-to-r hover:from-emerald-50 hover:to-teal-50'
                  }`}
                >
                  <span className={`font-medium ${selectedAnnotationIds.shapes.includes(shape.id) ? 'text-emerald-800' : 'text-slate-700'}`}>
                    {shape.type === 'line' ? <MdRemove className="inline mr-1 text-emerald-600" /> : 
                     shape.type === 'rectangle' ? <MdRectangle className="inline mr-1 text-emerald-600" /> : 
                     shape.type === 'circle' ? <MdCircle className="inline mr-1 text-emerald-600" /> : 
                     <MdArrowForward className="inline mr-1 text-emerald-600" />}
                    {shape.type === 'line' ? '線' : shape.type === 'rectangle' ? '四角形' : shape.type === 'circle' ? '円' : '矢印'} {index + 1}
                  </span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (docId && pageSize) {
                        const newShapes = shapeAnnotations.filter(s => s.id !== shape.id);
                        // 状態を同期的に更新（注釈一覧の表示を即座に更新するため）
                        setShapeAnnotations(newShapes);
                        const actualPageNum = getActualPageNum(currentPage);
                        await saveShapeAnnotations(docId, actualPageNum, newShapes);
                        // 再描画（キャンバスをクリアしてから再描画）
                        if (shapeCanvasRef.current) {
                          const ctx = shapeCanvasRef.current.getContext('2d');
                          if (ctx) {
                            const devicePixelRatio = window.devicePixelRatio || 1;
                            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
                            ctx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
                            redrawShapeAnnotations(ctx, newShapes, pageSize.width, pageSize.height).catch(console.error);
                          }
                        }
                      }
                    }}
                    className="h-6 px-2 text-xs bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-md hover:from-red-600 hover:to-pink-600 transition-all shadow-sm hover:shadow-md"
                  >
                    <MdDelete className="inline mr-1" />
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* テキスト一覧 */}
          {textAnnotations.length > 0 && (
            <div className="mb-4">
              <div className="text-sm font-semibold mb-2 text-blue-700 bg-blue-50 px-2 py-1 rounded-md flex items-center gap-2">
                <MdTextFields className="text-blue-600" />
                テキスト ({textAnnotations.length})
              </div>
              {textAnnotations.map((text, index) => (
                <div
                  key={text.id}
                  onClick={(e) => {
                    // ボタンなどの子要素からのクリックは無視
                    const target = e.target as HTMLElement;
                    if (target.tagName === 'BUTTON' || target.closest('button')) {
                      e.stopPropagation();
                      return false;
                    }
                    setSelectedAnnotationIds(prev => ({
                      strokes: prev.strokes,
                      shapes: prev.shapes,
                      texts: prev.texts.includes(text.id) ? prev.texts.filter(id => id !== text.id) : [...prev.texts, text.id],
                    }));
                  }}
                  onMouseDown={(e) => {
                    // ボタンからのマウスダウンは無視
                    const target = e.target as HTMLElement;
                    if (target.tagName === 'BUTTON' || target.closest('button')) {
                      e.stopPropagation();
                      return false;
                    }
                  }}
                  className={`p-2.5 mb-2 rounded-lg cursor-pointer text-xs flex justify-between items-center transition-all shadow-sm ${
                    selectedAnnotationIds.texts.includes(text.id)
                      ? 'bg-gradient-to-r from-blue-100 to-cyan-100 border-2 border-blue-400 shadow-md'
                      : 'bg-white border border-blue-200 hover:border-blue-400 hover:shadow-md hover:bg-gradient-to-r hover:from-blue-50 hover:to-cyan-50'
                  }`}
                >
                  <span 
                    className={`overflow-hidden text-ellipsis whitespace-nowrap max-w-[150px] font-medium ${selectedAnnotationIds.texts.includes(text.id) ? 'text-blue-800' : 'text-slate-700'}`}
                  >
                    <MdTextFields className="inline mr-1 text-blue-600" />
                    {text.text.substring(0, 20)}{text.text.length > 20 ? '...' : ''}
                  </span>
                  <div className="flex gap-1">
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (docId && pageSize) {
                          const newTexts = textAnnotations.filter(t => t.id !== text.id);
                          // 状態を同期的に更新（注釈一覧の表示を即座に更新するため）
                          setTextAnnotations(newTexts);
                          const actualPageNum = getActualPageNum(currentPage);
                          await saveTextAnnotations(docId, actualPageNum, newTexts);
                          // 再描画（キャンバスをクリアしてから再描画）
                          if (textCanvasRef.current) {
                            const ctx = textCanvasRef.current.getContext('2d');
                            if (ctx) {
                              const devicePixelRatio = window.devicePixelRatio || 1;
                              ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
                              ctx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
                              redrawTextAnnotations(ctx, newTexts, pageSize.width, pageSize.height);
                            }
                          }
                        }
                      }}
                      className="h-6 px-2 text-xs bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-md hover:from-red-600 hover:to-pink-600 transition-all shadow-sm hover:shadow-md"
                    >
                      <MdDelete className="inline mr-1" />
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {strokes.length === 0 && shapeAnnotations.length === 0 && textAnnotations.length === 0 && (
            <div className="text-center py-8 text-slate-400">
              <MdList className="text-4xl mx-auto mb-2 text-slate-300" />
              <p className="text-sm">このページには注釈がありません</p>
            </div>
          )}
          </div>
        </div>
      )}

      {/* 右側フォームフィールドパネル */}
      {pdfDoc && showFormFields && formFields.length > 0 && (
        <div 
          className="fixed right-0 top-0 bottom-0 w-80 bg-gradient-to-b from-slate-50 to-slate-100 border-l border-slate-200 z-[99] shadow-lg flex flex-col" 
          style={{ 
            position: 'fixed', 
            right: showAnnotationList ? '16rem' : 0, 
            top: 0, 
            bottom: 0, 
            width: '20rem', 
            height: '100vh', 
            display: 'flex', 
            flexDirection: 'column' 
          }}
        >
          <div 
            className="flex-shrink-0 p-3 mb-0 font-semibold flex justify-between items-center bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md" 
            style={{ flexShrink: 0 }}
          >
            <span className="flex items-center gap-2">
              <MdTextFields className="text-lg" />
              フォームフィールド ({formFields.length})
            </span>
            <button
              onClick={(e) => {
                setShowFormFields(false);
              }}
              className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-white/20 text-white transition-colors"
              title="閉じる"
            >
              <MdClose className="text-lg" />
            </button>
          </div>
          <div 
            className="flex-1 overflow-y-auto overflow-x-hidden p-3" 
            style={{ 
              flex: '1 1 0%', 
              minHeight: 0, 
              overflowY: 'auto', 
              overflowX: 'hidden'
            }}
          >
            {formFields.map((field) => {
              const isCalculated = !!field.calculationScript;
              const currentValue = formFieldValues[field.name] ?? field.value;
              
              return (
                <div key={field.id} className="mb-4 p-3 bg-white rounded-lg border border-purple-200 shadow-sm">
                  <label className="block text-xs font-semibold text-purple-700 mb-2">
                    {field.name}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                    {isCalculated && <span className="text-blue-500 ml-1 text-xs">(計算)</span>}
                    {field.readOnly && <span className="text-gray-500 ml-1 text-xs">(読み取り専用)</span>}
                  </label>
                  
                  {field.type === 'text' && (
                    <input
                      type="text"
                      value={String(currentValue)}
                      onChange={(e) => {
                        const newValue = e.target.value;
                        setFormFieldValues(prev => {
                          const updated = { ...prev, [field.name]: newValue };
                          // 計算フィールドを再計算
                          const calculated = calculateFormFields(formFields, updated);
                          return calculated;
                        });
                      }}
                      disabled={field.readOnly || isCalculated}
                      maxLength={field.maxLength}
                      className={`w-full px-2 py-1.5 text-sm border rounded-md ${
                        field.readOnly || isCalculated
                          ? 'bg-gray-100 text-gray-600 cursor-not-allowed'
                          : 'bg-white border-purple-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200'
                      }`}
                      placeholder={field.defaultValue ? String(field.defaultValue) : ''}
                    />
                  )}
                  
                  {field.type === 'checkbox' && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(currentValue)}
                        onChange={(e) => {
                          setFormFieldValues(prev => {
                            const updated = { ...prev, [field.name]: e.target.checked };
                            const calculated = calculateFormFields(formFields, updated);
                            return calculated;
                          });
                        }}
                        disabled={field.readOnly || isCalculated}
                        className="w-4 h-4 text-purple-600 border-purple-300 rounded focus:ring-purple-200 disabled:opacity-50"
                      />
                      <span className="text-sm text-slate-700">
                        {Boolean(currentValue) ? 'チェック済み' : '未チェック'}
                      </span>
                    </label>
                  )}
                  
                  {field.type === 'dropdown' && field.options && (
                    <select
                      value={Array.isArray(currentValue) ? currentValue[0] : String(currentValue)}
                      onChange={(e) => {
                        setFormFieldValues(prev => {
                          const updated = { ...prev, [field.name]: [e.target.value] };
                          const calculated = calculateFormFields(formFields, updated);
                          return calculated;
                        });
                      }}
                      disabled={field.readOnly || isCalculated}
                      className={`w-full px-2 py-1.5 text-sm border rounded-md ${
                        field.readOnly || isCalculated
                          ? 'bg-gray-100 text-gray-600 cursor-not-allowed'
                          : 'bg-white border-purple-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-200'
                      }`}
                    >
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  )}
                  
                  {field.type === 'radio' && field.options && (
                    <div className="space-y-1">
                      {field.options.map((option) => (
                        <label key={option} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name={field.name}
                            value={option}
                            checked={String(currentValue) === option}
                            onChange={(e) => {
                              setFormFieldValues(prev => {
                                const updated = { ...prev, [field.name]: e.target.value };
                                const calculated = calculateFormFields(formFields, updated);
                                return calculated;
                              });
                            }}
                            disabled={field.readOnly || isCalculated}
                            className="w-4 h-4 text-purple-600 border-purple-300 focus:ring-purple-200 disabled:opacity-50"
                          />
                          <span className="text-sm text-slate-700">{option}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  
                  {isCalculated && field.calculationScript && (
                    <div className="mt-2 text-xs text-blue-600 bg-blue-50 p-2 rounded">
                      計算式: {field.calculationScript}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}


      {/* カメラモーダル */}
      {showCameraModal && (
        <Dialog open={showCameraModal} onOpenChange={setShowCameraModal}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>カメラで写真を撮影</DialogTitle>
              <DialogDescription>板書や資料を撮影してPDFに変換できます</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="relative bg-black rounded-lg overflow-hidden" style={{ aspectRatio: '4/3' }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
                <canvas ref={cameraCanvasRef} className="hidden" />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2 justify-center">
                  <Button
                    onClick={() => capturePhoto(false)}
                    disabled={!isRecording}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <MdCamera className="mr-2" />
                    写真を撮る
                  </Button>
                  <Button
                    onClick={() => capturePhoto(true)}
                    disabled={!isRecording}
                    variant="outline"
                    className="border-purple-500 text-purple-600 hover:bg-purple-50"
                  >
                    <MdCollections className="mr-2" />
                    コレクションに追加
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      stopCamera();
                      setShowCameraModal(false);
                    }}
                  >
                    キャンセル
                  </Button>
                </div>
                <p className="text-xs text-slate-500 text-center">
                  「コレクションに追加」を選択すると、複数画像をまとめてPDFに結合できます
          </p>
        </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* 画像管理モーダル */}
      {showImageManager && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10001] p-4"
          onClick={(e) => {
            console.log('モーダルオーバーレイがクリックされました');
            setImageFiles([]);
            setShowImageManager(false);
          }}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => {
              console.log('モーダルコンテンツがクリックされました', e.target);
              e.stopPropagation();
            }}
            onMouseDown={(e) => {
              console.log('モーダルコンテンツがマウスダウンされました', e.target);
              e.stopPropagation();
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">ファイル管理 ({imageFiles.length}件)</h2>
              <button
                onClick={() => {
                  setImageFiles([]);
                  setShowImageManager(false);
                }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title="閉じる"
              >
                <MdClose className="text-xl text-slate-600" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">画像やPDFの順番を変更したり、削除できます</p>
            <div className="space-y-4">
              {imageFiles.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <MdImage className="text-4xl mx-auto mb-2 text-slate-300" />
                  <p className="text-sm">ファイルがありません</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {imageFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50"
                    >
                      <div className="flex-shrink-0 w-32 h-32 bg-slate-100 rounded overflow-hidden flex items-center justify-center">
                        {file.type === 'application/pdf' ? (
                          <MdInsertDriveFile className="text-3xl text-red-600" />
                        ) : (
                          <img
                            src={URL.createObjectURL(file)}
                            alt={`画像 ${index + 1}`}
                            className="w-full h-full object-contain"
                            style={{ maxWidth: '128px', maxHeight: '128px' }}
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{file.name}</p>
                        <p className="text-xs text-slate-500">
                          {file.type === 'application/pdf' ? 'PDF' : '画像'} • {(file.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => moveImage(index, 'up')}
                          disabled={index === 0}
                          className="p-2 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="上に移動"
                        >
                          <MdArrowUpward className="text-lg text-slate-600" />
                        </button>
                        <button
                          onClick={() => moveImage(index, 'down')}
                          disabled={index === imageFiles.length - 1}
                          className="p-2 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                          title="下に移動"
                        >
                          <MdArrowDownward className="text-lg text-slate-600" />
                        </button>
                        <button
                          onClick={() => removeImage(index)}
                          className="p-2 rounded hover:bg-red-100"
                          title="削除"
                        >
                          <MdDelete className="text-lg text-red-600" />
                        </button>
        </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 justify-end pt-4 border-t">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('クリアボタンがクリックされました');
                    setImageFiles([]);
                    setShowImageManager(false);
                  }}
                  className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-100"
                >
                  クリア
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('PDFに結合して読み込むボタンがクリックされました', {
                      imageFilesCount: imageFiles.length,
                      disabled: imageFiles.length === 0
                    });
                    if (imageFiles.length > 0) {
                      console.log('loadCombinedImagesを呼び出します');
                      loadCombinedImages();
                    } else {
                      console.warn('画像ファイルがありません');
                    }
                  }}
                  disabled={imageFiles.length === 0}
                  style={{
                    position: 'relative',
                    zIndex: 10000,
                    pointerEvents: 'auto',
                  }}
                  className={imageFiles.length === 0 
                    ? "px-6 py-3 bg-gradient-to-r from-slate-400 to-slate-500 opacity-50 cursor-not-allowed text-white rounded-lg font-semibold shadow-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    : "px-6 py-3 bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 hover:from-blue-700 hover:via-purple-700 hover:to-pink-700 text-white rounded-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 active:scale-95 flex items-center gap-2"
                  }
                >
                  <MdCollections className="text-lg" />
                  PDFに結合して読み込む
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 音声入力モーダル */}
      {showVoiceInput && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-[10002]"
          onClick={() => {
            if (isListening) {
              stopVoiceInput();
            }
            setShowVoiceInput(false);
          }}
          style={{
            display: 'flex',
            alignItems: textInputPosition ? 'flex-start' : 'center',
            justifyContent: textInputPosition ? 'flex-start' : 'center',
          }}
        >
          <div 
            className="rounded-2xl shadow-2xl p-6 max-w-lg w-full border-2 border-blue-300"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: textInputPosition ? 'fixed' : 'relative',
              top: textInputPosition 
                ? `${Math.min(Math.max(textInputPosition.y + 80, 20), typeof window !== 'undefined' ? window.innerHeight - 400 : 400)}px`
                : undefined,
              left: textInputPosition 
                ? `${Math.min(Math.max(textInputPosition.x + 250, 20), typeof window !== 'undefined' ? window.innerWidth - 500 : 20)}px`
                : undefined,
              margin: textInputPosition ? undefined : 'auto',
              background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 50%, #7dd3fc 100%)',
            }}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-900 drop-shadow-sm">音声入力</h2>
              <button
                onClick={() => {
                  if (isListening) {
                    stopVoiceInput();
                  }
                  setShowVoiceInput(false);
                }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title="閉じる"
              >
                <MdClose className="text-xl text-slate-600" />
              </button>
            </div>
            <p className="text-sm text-slate-800 font-medium mb-4 drop-shadow-sm">マイクに向かって話してください</p>
            <div className="space-y-4">
              <div className="flex items-center justify-center py-8">
                {isListening ? (
                  <div className="text-center">
                    <MdMic className="text-6xl text-red-600 animate-pulse mx-auto mb-4" />
                    <p className="text-lg font-semibold">音声を認識中...</p>
                  </div>
                ) : (
                  <div className="text-center">
                    <MdMic className="text-6xl text-blue-600 mx-auto mb-4" />
                    <p className="text-lg">準備完了</p>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">言語:</label>
                  <select
                    value={voiceLanguage}
                    onChange={(e) => setVoiceLanguage(e.target.value as 'ja-JP' | 'en-US')}
                    disabled={isListening}
                    className="px-3 py-1 border border-slate-300 rounded text-sm"
                  >
                    <option value="ja-JP">日本語</option>
                    <option value="en-US">English</option>
                  </select>
                </div>
                <div className="flex gap-2 justify-center">
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('音声入力ボタンがマウスダウンされました');
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.nativeEvent) {
                        (e.nativeEvent as any).stopImmediatePropagation?.();
                      }
                      console.log('音声入力ボタンがクリックされました');
                      console.log('startVoiceInputを呼び出します');
                      try {
                        startVoiceInput();
                      } catch (error) {
                        console.error('startVoiceInputエラー:', error);
                      }
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('音声入力ボタンがタッチされました');
                      try {
                        startVoiceInput();
                      } catch (error) {
                        console.error('startVoiceInputエラー:', error);
                      }
                    }}
                    disabled={isListening}
                    style={{
                      position: 'relative',
                      zIndex: 1000,
                      pointerEvents: 'auto',
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <MdMic className="text-base" />
                    {isListening ? '認識中...' : '音声認識を開始'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      stopVoiceInput();
                    }}
                    disabled={!isListening}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <MdMicOff className="text-base" />
                    音声認識を停止
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      stopVoiceInput();
                      setShowVoiceInput(false);
                    }}
                    className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-100"
                  >
                    キャンセル
                  </button>
                </div>
                <div className="text-xs text-slate-500 text-center">
                  <p>※ブラウザによっては音声認識に対応していない場合があります</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent 
          topPosition="top-[15%]"
          className={showThumbnails ? '!left-[calc(50%+6.5rem)]' : ''}
          style={{
            zIndex: 10001,
            left: showThumbnails ? 'calc(50% + 6.5rem)' : '50%',
            transform: 'translateX(-50%) translateY(0)',
          }}
        >
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogMessage}</DialogDescription>
          </DialogHeader>
          {dialogType === 'prompt' && (
            <Input
              value={dialogInputValue}
              onChange={(e) => setDialogInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && dialogCallback) {
                  dialogCallback(dialogInputValue);
                }
              }}
              autoFocus
            />
          )}
          <DialogFooter>
            {dialogType === 'alert' && (
              <Button onClick={() => {
                setDialogOpen(false);
                dialogCallback?.();
              }}>OK</Button>
            )}
            {dialogType === 'confirm' && (
              <>
                <Button variant="outline" onClick={() => {
                  setDialogOpen(false);
                  dialogCallback?.(false);
                }}>キャンセル</Button>
                <Button onClick={() => {
                  setDialogOpen(false);
                  dialogCallback?.(true);
                }}>OK</Button>
              </>
            )}
            {dialogType === 'prompt' && (
              <>
                <Button variant="outline" onClick={() => {
                  if (dialogCallback) {
                    dialogCallback(undefined);
                  }
                }}>キャンセル</Button>
                <Button onClick={() => {
                  if (dialogCallback) {
                    dialogCallback(dialogInputValue);
                  }
                }}>OK</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QRコードモーダル */}
      {showQRCode && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10002] p-4"
          onClick={() => setShowQRCode(false)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">このサイトのURL</h2>
              <button
                onClick={() => setShowQRCode(false)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                title="閉じる"
              >
                <MdClose className="text-xl text-slate-600" />
              </button>
            </div>
            <div className="flex flex-col items-center gap-4">
              <div className="bg-white p-2 rounded-lg border border-slate-200">
                <QRCodeSVG value={siteUrl} size={120} />
              </div>
              <p className="text-sm text-slate-600 break-all text-center">{siteUrl}</p>
            </div>
          </div>
        </div>
      )}

      {/* 電子署名ダイアログ */}
      <Dialog 
        open={showSignatureDialog}
        onOpenChange={(open) => {
          console.log('電子署名ダイアログ onOpenChange called with:', open);
          // openがtrueの場合のみ状態を更新
          if (open) {
            setShowSignatureDialog(true);
          }
          // openがfalseの場合は無視（手動で閉じるボタンのみで閉じる）
        }}
      >
        <DialogContent 
          topPosition="top-[15%]"
          className="max-w-2xl"
          style={{
            zIndex: 10001,
            left: '50%',
            top: '15%',
            transform: 'translateX(-50%) translateY(0)',
            background: 'linear-gradient(135deg, #dbeafe 0%, #e0f2fe 50%, #bae6fd 100%)',
          }}
          onClose={() => {
            setShowSignatureDialog(false);
            setSignatureName('');
            setSignatureEmail('');
            setSignatureReason('');
            setSignatureLocation('');
            setSignatureImage(null);
            setSignatureText('');
          }}
        >
            <DialogHeader className="pb-4 border-b border-blue-200 mb-4">
              <DialogTitle className="text-2xl font-bold text-slate-900 mb-2">電子署名を追加</DialogTitle>
              <DialogDescription className="text-base text-slate-600">PDFに電子署名を追加します</DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <div>
                <label className="block text-base font-semibold text-slate-800 mb-2">
                  署名者名 <span className="text-red-500 font-bold">*</span>
                </label>
                <Input
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="山田 太郎"
                  className="w-full h-11 text-base border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg px-4 transition-all"
                />
      </div>
              <div>
                <label className="block text-base font-semibold text-slate-800 mb-2">
                  メールアドレス
                </label>
                <Input
                  type="email"
                  value={signatureEmail}
                  onChange={(e) => setSignatureEmail(e.target.value)}
                  placeholder="example@company.com"
                  className="w-full h-11 text-base border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg px-4 transition-all"
                />
    </div>
              <div>
                <label className="block text-base font-semibold text-slate-800 mb-2">
                  署名理由
                </label>
                <Input
                  value={signatureReason}
                  onChange={(e) => setSignatureReason(e.target.value)}
                  placeholder="承認"
                  className="w-full h-11 text-base border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg px-4 transition-all"
                />
              </div>
              <div>
                <label className="block text-base font-semibold text-slate-800 mb-2">
                  署名場所
                </label>
                <Input
                  value={signatureLocation}
                  onChange={(e) => setSignatureLocation(e.target.value)}
                  placeholder="東京"
                  className="w-full h-11 text-base border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg px-4 transition-all"
                />
              </div>
              <div>
                <label className="block text-base font-semibold text-slate-800 mb-2">
                  署名画像（オプション）
                </label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/jpg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (event) => {
                        const result = event.target?.result as string;
                        // 画像をリサイズしてから設定
                        const img = new Image();
                        img.onload = () => {
                          const canvas = document.createElement('canvas');
                          const maxWidth = 400;
                          const maxHeight = 200;
                          let width = img.width;
                          let height = img.height;
                          
                          if (width > maxWidth || height > maxHeight) {
                            const ratio = Math.min(maxWidth / width, maxHeight / height);
                            width = width * ratio;
                            height = height * ratio;
                          }
                          
                          canvas.width = width;
                          canvas.height = height;
                          const ctx = canvas.getContext('2d');
                          if (ctx) {
                            ctx.drawImage(img, 0, 0, width, height);
                            setSignatureImage(canvas.toDataURL('image/png'));
                          }
                        };
                        img.src = result;
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="w-full h-11 text-base border-2 border-slate-300 rounded-lg px-4 py-2 file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer transition-all"
                />
                {signatureImage && (
                  <div className="mt-3 p-3 bg-slate-50 rounded-lg border-2 border-slate-200">
                    <img 
                      src={signatureImage} 
                      alt="署名画像" 
                      className="max-w-full max-h-48 border-2 border-slate-300 rounded-lg object-contain shadow-sm" 
                      style={{ maxWidth: '400px', maxHeight: '200px' }}
                    />
                    <button
                      onClick={() => setSignatureImage(null)}
                      className="mt-2 px-3 py-1.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors shadow-sm"
                    >
                      画像を削除
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-base font-semibold text-slate-800 mb-2">
                  署名テキスト（画像がない場合）
                </label>
                <Input
                  value={signatureText}
                  onChange={(e) => setSignatureText(e.target.value)}
                  placeholder="署名"
                  className="w-full h-11 text-base border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg px-4 transition-all"
                />
              </div>
              <div>
                <label className="block text-base font-semibold text-slate-800 mb-3">
                  署名位置
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex items-center gap-3 p-3 border-2 border-slate-300 rounded-lg cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition-all shadow-sm">
                    <input
                      type="radio"
                      name="signaturePosition"
                      value="bottom-left"
                      checked={signaturePosition === 'bottom-left'}
                      onChange={(e) => setSignaturePosition(e.target.value as 'bottom-left')}
                      className="w-5 h-5 text-blue-600"
                    />
                    <span className="text-base font-medium text-slate-700">左下</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border-2 border-slate-300 rounded-lg cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition-all shadow-sm">
                    <input
                      type="radio"
                      name="signaturePosition"
                      value="bottom-right"
                      checked={signaturePosition === 'bottom-right'}
                      onChange={(e) => setSignaturePosition(e.target.value as 'bottom-right')}
                      className="w-5 h-5 text-blue-600"
                    />
                    <span className="text-base font-medium text-slate-700">右下</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border-2 border-slate-300 rounded-lg cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition-all shadow-sm">
                    <input
                      type="radio"
                      name="signaturePosition"
                      value="top-left"
                      checked={signaturePosition === 'top-left'}
                      onChange={(e) => setSignaturePosition(e.target.value as 'top-left')}
                      className="w-5 h-5 text-blue-600"
                    />
                    <span className="text-base font-medium text-slate-700">左上</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border-2 border-slate-300 rounded-lg cursor-pointer hover:bg-blue-50 hover:border-blue-400 transition-all shadow-sm">
                    <input
                      type="radio"
                      name="signaturePosition"
                      value="top-right"
                      checked={signaturePosition === 'top-right'}
                      onChange={(e) => setSignaturePosition(e.target.value as 'top-right')}
                      className="w-5 h-5 text-blue-600"
                    />
                    <span className="text-base font-medium text-slate-700">右上</span>
                  </label>
                </div>
              </div>
            </div>
            <DialogFooter className="pt-4 border-t border-blue-200 mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowSignatureDialog(false);
                  setSignatureName('');
                  setSignatureEmail('');
                  setSignatureReason('');
                  setSignatureLocation('');
                  setSignatureImage(null);
                  setSignatureText('');
                  setSignaturePosition('bottom-left');
                }}
                className="h-11 px-6 text-base font-semibold border-2 border-slate-300 hover:bg-slate-50"
              >
                キャンセル
              </Button>
              <Button
                onClick={async () => {
                  if (!signatureName || !docId || !pageSize) {
                    toast({
                      title: "エラー",
                      description: "署名者名を入力してください",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  // 署名位置を計算
                  let x = 0.1, y = 0.1;
                  if (signaturePosition === 'bottom-right') {
                    x = 0.6; // 右側
                    y = 0.1; // 下側
                  } else if (signaturePosition === 'top-left') {
                    x = 0.1; // 左側
                    y = 0.75; // 上側（PDF座標系は下から上）
                  } else if (signaturePosition === 'top-right') {
                    x = 0.6; // 右側
                    y = 0.75; // 上側
                  } else {
                    // bottom-left (デフォルト)
                    x = 0.1;
                    y = 0.1;
                  }
                  
                  const signature: Signature = {
                    id: generateSignatureId(),
                    signerName: signatureName,
                    signerEmail: signatureEmail || undefined,
                    signDate: new Date(),
                    signatureImage: signatureImage || undefined,
                    signatureText: signatureText || undefined,
                    position: {
                      pageNumber: currentPage,
                      x,
                      y,
                      width: 0.3,
                      height: 0.15,
                    },
                    reason: signatureReason || undefined,
                    location: signatureLocation || undefined,
                  };
                  
                  await saveSignature(docId, signature);
                  setSignatures(prev => [...prev, signature]);
                  
                  toast({
                    title: "成功",
                    description: "電子署名を追加しました",
                    variant: "success",
                  });
                  
                  setShowSignatureDialog(false);
                  setSignatureName('');
                  setSignatureEmail('');
                  setSignatureReason('');
                  setSignatureLocation('');
                  setSignatureImage(null);
                  setSignatureText('');
                  setSignaturePosition('bottom-left');
                }}
                disabled={!signatureName}
              >
                署名を追加
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


      {/* PDF分割ダイアログ（ページ管理モーダルから） */}
      <Dialog 
        open={showSplitDialogFromThumbnail}
        onOpenChange={(open) => {
          console.log('PDF分割ダイアログ（ページ管理から） onOpenChange called with:', open);
          if (open) {
            setShowSplitDialogFromThumbnail(true);
          }
        }}
      >
        <DialogContent 
          topPosition="top-[15%]"
          className="max-w-2xl"
          style={{
            zIndex: 10001,
            left: '50%',
            top: '15%',
            transform: 'translateX(-50%) translateY(0)',
            backgroundColor: 'white',
          }}
          onClose={() => {
            setShowSplitDialogFromThumbnail(false);
            setSplitRangeInputs(['']);
            setSelectedPagesForDelete(new Set());
          }}
        >
            <DialogHeader className="pb-4 border-b border-slate-200 mb-4">
              <DialogTitle className="text-2xl font-bold text-slate-900 mb-2">PDFを分割（選択したページから）</DialogTitle>
              <DialogDescription className="text-base text-slate-600">ページ管理で選択したページを範囲としてPDFを分割します</DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <div className="space-y-4">
                {splitRangeInputs.map((input, index) => (
                  <div key={index} className="space-y-3 p-4 bg-slate-50 rounded-lg border-2 border-slate-200">
                    <label className="block text-base font-semibold text-slate-800">
                      範囲 {index + 1}（例: 1-3, 5, 7-9）
                    </label>
                    <div className="flex gap-3">
                      <Input
                        type="text"
                        value={input}
                        onChange={(e) => {
                          const newInputs = [...splitRangeInputs];
                          newInputs[index] = e.target.value;
                          setSplitRangeInputs(newInputs);
                        }}
                        placeholder="1-3, 5, 7-9"
                        className="flex-1 h-11 text-base border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg px-4 transition-all"
                      />
                      {splitRangeInputs.length > 1 && (
                        <button
                          onClick={() => {
                            setSplitRangeInputs(splitRangeInputs.filter((_, i) => i !== index));
                          }}
                          className="px-4 py-2 h-11 text-base font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors shadow-sm"
                        >
                          削除
                        </button>
                      )}
                    </div>
                    {input && (() => {
                      const ranges = parsePageRanges(input, totalPages);
                      const allPages: number[] = [];
                      ranges.forEach(range => {
                        for (let i = range.start; i <= range.end; i++) {
                          allPages.push(i);
                        }
                      });
                      const uniquePages = [...new Set(allPages)].sort((a, b) => a - b);
                      return (
                        <div className="p-3 bg-white rounded-lg border-2 border-blue-200 shadow-sm">
                          <p className="text-sm font-medium text-blue-800">
                            ページ: <span className="font-bold">{uniquePages.join(', ')}</span>
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() => {
                    setSplitRangeInputs([...splitRangeInputs, '']);
                  }}
                  className="w-full h-11 text-base font-semibold border-2 border-slate-300 hover:bg-slate-50"
                >
                  範囲を追加
                </Button>
                <div className="p-3 bg-blue-50 rounded-lg border-2 border-blue-200">
                  <p className="text-sm font-medium text-blue-800">
                    各範囲指定は1つのPDFファイルとして出力されます。例: "1-3, 5, 7-9" → 1つのPDF（1, 2, 3, 5, 7, 8, 9ページを含む）
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter className="pt-4 border-t border-orange-200 mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowSplitDialogFromThumbnail(false);
                  setSplitRangeInputs(['']);
                  setSelectedPagesForDelete(new Set());
                }}
                className="h-11 px-6 text-base font-semibold border-2 border-slate-300 hover:bg-slate-50"
              >
                キャンセル
              </Button>
              <Button
                onClick={async () => {
                  if (!originalPdfBytes) {
                    toast({
                      title: "エラー",
                      description: "PDFファイルが読み込まれていません",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  // 有効な範囲入力のみを抽出
                  const validInputs = splitRangeInputs.filter(input => input.trim());
                  if (validInputs.length === 0) {
                    toast({
                      title: "エラー",
                      description: "分割範囲を指定してください",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  try {
                    // 各範囲入力をページ番号の配列に変換
                    const pageGroups: number[][] = validInputs.map(input => {
                      const ranges = parsePageRanges(input, totalPages);
                      const allPages: number[] = [];
                      ranges.forEach(range => {
                        for (let i = range.start; i <= range.end; i++) {
                          allPages.push(i);
                        }
                      });
                      return [...new Set(allPages)].sort((a, b) => a - b);
                    });
                    
                    const splitPdfs = await splitPDFByPageGroups(originalPdfBytes, pageGroups);
                    
                    // 各分割PDFをダウンロード
                    for (let i = 0; i < splitPdfs.length; i++) {
                      const pages = pageGroups[i];
                      const blob = new Blob([splitPdfs[i] as BlobPart], { type: 'application/pdf' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      const pageStr = pages.length === 1 
                        ? `page${pages[0]}` 
                        : `pages${pages[0]}-${pages[pages.length - 1]}`;
                      a.download = `${originalFileName?.replace('.pdf', '') || 'document'}_${pageStr}.pdf`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }
                    
                    toast({
                      title: "成功",
                      description: `${splitPdfs.length}個のPDFファイルをダウンロードしました`,
                      variant: "success",
                    });
                    
                    setShowSplitDialogFromThumbnail(false);
                    setSplitRangeInputs(['']);
                    setSelectedPagesForDelete(new Set());
                  } catch (error) {
                    console.error('PDF分割エラー:', error);
                    toast({
                      title: "エラー",
                      description: 'PDFの分割に失敗しました: ' + (error instanceof Error ? error.message : String(error)),
                      variant: "destructive",
                    });
                  }
                }}
                disabled={splitRangeInputs.filter(input => input.trim()).length === 0}
              >
                分割してダウンロード
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {/* OCRダイアログ */}
      <Dialog 
        open={showOCRDialog}
        onOpenChange={(open) => {
          console.log('OCRダイアログ onOpenChange called with:', open);
          if (open) {
            setShowOCRDialog(true);
          }
        }}
      >
        <DialogContent 
          topPosition="top-[1%]"
          className="!flex !flex-col"
          style={{
            zIndex: 10001,
            left: '50%',
            top: '1%',
            transform: 'translateX(-50%) translateY(0)',
            background: 'linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 50%, #ddd6fe 100%)',
            border: '4px solid #a855f7',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
            overflow: 'hidden',
            width: '90vw',
            maxWidth: '90vw',
            height: '98vh',
            maxHeight: '98vh',
          } as React.CSSProperties & { display: 'flex' }}
          onClose={() => {
            setShowOCRDialog(false);
          }}
        >
          <DialogHeader className="pb-2 border-b-2 border-purple-300 mb-0 bg-white rounded-t-lg p-3 shadow-lg flex-shrink-0">
            <DialogTitle className="text-xl font-bold text-purple-900 mb-1">OCR（光学文字認識）</DialogTitle>
            <DialogDescription className="text-sm text-purple-800">PDFページからテキストを抽出します</DialogDescription>
          </DialogHeader>
          <div className="flex-1 space-y-2 mt-2 p-3 flex flex-col">
            <div className="p-2 bg-white rounded-lg border-2 border-purple-300 shadow-sm" style={{ borderWidth: '2px' }}>
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-purple-900 whitespace-nowrap">
                  OCR言語:
                </label>
                <select
                  value={ocrLanguage}
                  onChange={(e) => setOcrLanguage(e.target.value)}
                  disabled={isProcessingOCR}
                  className="flex-1 px-2 py-1 text-sm border-2 border-purple-400 rounded bg-white focus:border-purple-600 focus:ring-2 focus:ring-purple-200 font-medium"
                  style={{ borderWidth: '2px' }}
                >
                  <option value="jpn+eng">日本語 + 英語</option>
                  <option value="jpn">日本語のみ</option>
                  <option value="eng">英語のみ</option>
                </select>
              </div>
            </div>

            {ocrProgress && (
              <div className="p-2 bg-purple-200 rounded-lg border-2 border-purple-400 shadow-sm" style={{ borderWidth: '2px' }}>
                <p className="text-xs font-semibold text-purple-900 mb-1">
                  OCR処理中: {ocrProgress.current} / {ocrProgress.total} ページ
                </p>
                <div className="w-full bg-purple-300 rounded-full h-2 shadow-inner">
                  <div 
                    className="bg-gradient-to-r from-purple-600 to-purple-800 h-2 rounded-full transition-all duration-300" 
                    style={{ width: `${(ocrProgress.current / ocrProgress.total) * 100}%` }} 
                  />
                </div>
              </div>
            )}

            <div className="p-2 bg-white rounded-lg border-2 border-purple-300 shadow-sm" style={{ borderWidth: '2px' }}>
              <div className="flex flex-wrap gap-2 mb-2">
                <Button
                  onClick={handleOCRCurrentPage}
                  disabled={isProcessingOCR || !pdfDoc}
                  className="flex-1 min-w-[120px] h-8 px-3 text-xs font-semibold bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-purple-500"
                >
                  現在のページをOCR
                </Button>
                <Button
                  onClick={handleOCRAllPages}
                  disabled={isProcessingOCR || !pdfDoc}
                  className="flex-1 min-w-[120px] h-8 px-3 text-xs font-semibold bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-purple-500"
                >
                  全ページをOCR
                </Button>
                <Button
                  onClick={async () => {
                    // 全OCR結果をシナリオとして一括保存
                    if (docId && Object.keys(ocrResults).length > 0) {
                      const newScenarios: Record<number, string> = {};
                      for (const [pageNum, result] of Object.entries(ocrResults)) {
                        await saveScenario(docId, parseInt(pageNum), result.text);
                        newScenarios[parseInt(pageNum)] = result.text;
                      }
                      setScenarios(prev => ({ ...prev, ...newScenarios }));
                      toast({
                        title: "成功",
                        description: `${Object.keys(ocrResults).length}ページのシナリオを保存しました`,
                        variant: "success",
                      });
                    }
                  }}
                  disabled={!pdfDoc || Object.keys(ocrResults).length === 0}
                  className="flex-1 min-w-[140px] h-8 px-3 text-xs font-semibold bg-gradient-to-r from-green-600 to-green-800 hover:from-green-700 hover:to-green-900 text-white shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-green-500 flex items-center gap-1"
                  title="全OCR結果をシナリオとして保存"
                >
                  <MdNotes className="text-sm" />
                  全ページをシナリオにする
                </Button>
                <Button
                  onClick={() => {
                    // OCRモーダルは開いたままにして、シナリオモーダルを前面に表示
                    setShowScenarioDialog(true);
                  }}
                  disabled={!pdfDoc || Object.keys(scenarios).length === 0}
                  className="flex-1 min-w-[120px] h-8 px-3 text-xs font-semibold bg-gradient-to-r from-blue-600 to-blue-800 hover:from-blue-700 hover:to-blue-900 text-white shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-blue-500 flex items-center gap-1"
                  title="シナリオ一覧・編集・印刷"
                >
                  <MdDescription className="text-sm" />
                  シナリオ編集
                </Button>
              </div>
              <div className="flex gap-2 items-center">
                <Input
                  type="text"
                  placeholder="ページ指定（例: 1, 3, 5-7）"
                  value={ocrPageRangeInput}
                  onChange={(e) => setOcrPageRangeInput(e.target.value)}
                  disabled={isProcessingOCR || !pdfDoc}
                  className="flex-1 h-8 text-xs border-2 border-purple-400 rounded bg-white focus:border-purple-600 focus:ring-2 focus:ring-purple-200"
                  style={{ borderWidth: '2px' }}
                />
                <Button
                  onClick={handleOCRSpecifiedPages}
                  disabled={isProcessingOCR || !pdfDoc || !ocrPageRangeInput.trim()}
                  className="h-8 px-3 text-xs font-semibold bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-purple-500"
                >
                  指定ページをOCR
                </Button>
              </div>
            </div>

            {Object.keys(ocrResults).length > 0 && (() => {
              // 検索クエリに基づいてフィルタリングされたOCR結果を取得
              const filteredResults = Object.entries(ocrResults)
                .sort(([a], [b]) => parseInt(a) - parseInt(b)) // ページ番号でソート
                .filter(([_, result]) => {
                  if (!ocrSearchQuery.trim()) return true;
                  return result.text.toLowerCase().includes(ocrSearchQuery.toLowerCase());
                });
              
              const totalFilteredPages = filteredResults.length;
              const currentIndex = Math.max(0, Math.min(currentOcrResultPage - 1, totalFilteredPages - 1));
              const currentResult = filteredResults[currentIndex];
              
              return (
              <div className="p-2 bg-white rounded-lg border-2 border-purple-300 shadow-sm flex flex-col" style={{ borderWidth: '2px', maxHeight: 'calc(98vh - 300px)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-purple-900">OCR結果</h3>
                    <span className="text-xs text-purple-700 font-medium bg-purple-100 px-2 py-0.5 rounded-full">
                      {totalFilteredPages}ページ
                    </span>
                  </div>
                  <div className="flex gap-2 items-center flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-purple-700 font-medium whitespace-nowrap">サムネイルサイズ:</label>
                      <input
                        type="range"
                        min="100"
                        max="1000"
                        step="50"
                        value={ocrThumbnailSize}
                        onChange={(e) => setOcrThumbnailSize(parseInt(e.target.value))}
                        className="w-24 h-2 bg-purple-200 rounded-lg appearance-none cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, #a855f7 0%, #a855f7 ${((ocrThumbnailSize - 100) / 900) * 100}%, #e9d5ff ${((ocrThumbnailSize - 100) / 900) * 100}%, #e9d5ff 100%)`
                        }}
                      />
                      <span className="text-xs text-purple-700 font-medium whitespace-nowrap w-16">{ocrThumbnailSize}px</span>
                    </div>
                    <Input
                      type="text"
                      placeholder="検索..."
                      value={ocrSearchQuery}
                      onChange={(e) => setOcrSearchQuery(e.target.value)}
                      className="w-48 h-7 text-xs border border-purple-300 focus:border-purple-500"
                    />
                    {ocrSearchQuery.trim() && (
                      <span className="text-xs text-purple-600 font-medium whitespace-nowrap">
                        {totalFilteredPages}件
                      </span>
                    )}
                  </div>
                </div>
                {currentResult ? (
                  <div className="space-y-2 flex-1" style={{ minHeight: 0 }}>
                    {(() => {
                      const [pageNum, result] = currentResult;
                      return (
                      <div key={pageNum} className="p-2 bg-purple-50 rounded border border-purple-200 hover:bg-purple-100 transition-colors max-w-full" style={{ minHeight: '200px' }}>
                        <div className="flex items-center justify-between mb-2">
                          <button
                            onClick={() => {
                              setCurrentPage(parseInt(pageNum));
                              toast({
                                title: "ページ移動",
                                description: `ページ ${pageNum} に移動しました`,
                              });
                            }}
                            className="text-xs font-semibold text-purple-900 hover:text-purple-700 hover:underline cursor-pointer"
                          >
                            ページ {pageNum}
                          </button>
                          <div className="flex gap-1 items-center">
                            <span className="text-xs text-purple-700">信頼度: {result.confidence.toFixed(1)}%</span>
                            <button
                              onClick={() => {
                                setEditingOcrPage(parseInt(pageNum));
                                setEditingOcrText(result.text);
                              }}
                              className="px-2 py-0.5 text-xs font-medium bg-blue-500 text-white rounded hover:bg-blue-600"
                            >
                              編集
                            </button>
                            <button
                              onClick={async () => {
                                // OCR結果からシナリオを作成
                                if (docId) {
                                  await saveScenario(docId, parseInt(pageNum), result.text);
                                  setScenarios(prev => ({ ...prev, [parseInt(pageNum)]: result.text }));
                                  toast({
                                    title: "成功",
                                    description: `ページ ${pageNum} のシナリオを保存しました`,
                                    variant: "success",
                                  });
                                }
                              }}
                              className="px-2 py-0.5 text-xs font-medium bg-green-500 text-white rounded hover:bg-green-600 flex items-center gap-1"
                              title="OCR結果をシナリオとして保存"
                            >
                              <MdNotes className="text-xs" />
                              シナリオ保存
                            </button>
                            <button
                              onClick={() => {
                                // シナリオモーダルを開く（表示・印刷のみ）
                                setShowScenarioDialog(true);
                              }}
                              className="px-2 py-0.5 text-xs font-medium bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
                              title="シナリオモーダルで表示・印刷"
                            >
                              <MdDescription className="text-xs" />
                              シナリオ表示
                            </button>
                            <button
                              onClick={async () => {
                                if (docId) {
                                  await deleteOCRResult(docId, parseInt(pageNum));
                                  const newResults = { ...ocrResults };
                                  delete newResults[parseInt(pageNum)];
                                  setOcrResults(newResults);
                                  toast({
                                    title: "成功",
                                    description: `ページ ${pageNum} のOCR結果を削除しました`,
                                    variant: "success",
                                  });
                                }
                              }}
                              className="px-2 py-0.5 text-xs font-medium bg-red-500 text-white rounded hover:bg-red-600"
                            >
                              削除
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', alignItems: 'start' }}>
                          <div style={{ minWidth: 0, overflow: 'hidden' }}>
                            {editingOcrPage === parseInt(pageNum) ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <textarea
                                  value={editingOcrText}
                                  onChange={(e) => setEditingOcrText(e.target.value)}
                                  className="w-full text-sm text-purple-900 bg-white p-2 rounded border border-purple-400 resize-none"
                                  rows={16}
                                  style={{ 
                                    minHeight: '300px', 
                                    maxHeight: 'calc(98vh - 550px)', 
                                    wordBreak: 'break-word', 
                                    overflowWrap: 'break-word',
                                    overflowY: 'auto'
                                  }}
                                />
                                <div className="flex gap-1 flex-shrink-0">
                                  <button
                                    onClick={async () => {
                                      if (docId) {
                                        const updatedResult = { ...result, text: editingOcrText };
                                        await saveOCRResult(docId, parseInt(pageNum), updatedResult);
                                        const newResults = { ...ocrResults };
                                        newResults[parseInt(pageNum)] = updatedResult;
                                        setOcrResults(newResults);
                                        
                                        // シナリオにも反映（同期）
                                        if (scenarios[parseInt(pageNum)]) {
                                          await saveScenario(docId, parseInt(pageNum), editingOcrText);
                                          setScenarios(prev => ({ ...prev, [parseInt(pageNum)]: editingOcrText }));
                                        }
                                        
                                        setEditingOcrPage(null);
                                        setEditingOcrText('');
                                        toast({
                                          title: "成功",
                                          description: `ページ ${pageNum} のOCR結果を更新しました`,
                                          variant: "success",
                                        });
                                      }
                                    }}
                                    className="px-2 py-1 text-xs font-medium bg-green-500 text-white rounded hover:bg-green-600"
                                  >
                                    保存
                                  </button>
                                  <button
                                    onClick={async () => {
                                      // OCR結果をシナリオに保存してからシナリオモーダルを開く
                                      if (docId) {
                                        const updatedResult = { ...result, text: editingOcrText };
                                        await saveOCRResult(docId, parseInt(pageNum), updatedResult);
                                        const newResults = { ...ocrResults };
                                        newResults[parseInt(pageNum)] = updatedResult;
                                        setOcrResults(newResults);
                                        
                                        // シナリオにも保存
                                        await saveScenario(docId, parseInt(pageNum), editingOcrText);
                                        setScenarios(prev => ({ ...prev, [parseInt(pageNum)]: editingOcrText }));
                                        
                                        setEditingOcrPage(null);
                                        setEditingOcrText('');
                                        setShowScenarioDialog(true);
                                        toast({
                                          title: "成功",
                                          description: `ページ ${pageNum} のOCR結果とシナリオを更新しました`,
                                          variant: "success",
                                        });
                                      }
                                    }}
                                    className="px-2 py-1 text-xs font-medium bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
                                    title="OCR結果をシナリオに反映して表示"
                                  >
                                    <MdDescription className="text-xs" />
                                    シナリオに反映
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingOcrPage(null);
                                      setEditingOcrText('');
                                    }}
                                    className="px-2 py-1 text-xs font-medium bg-gray-500 text-white rounded hover:bg-gray-600"
                                  >
                                    キャンセル
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div 
                                className="text-sm text-purple-900 bg-white p-2 rounded border border-purple-200 overflow-y-auto overflow-x-hidden whitespace-pre-wrap leading-relaxed break-words" 
                                style={{ 
                                  wordBreak: 'break-word', 
                                  overflowWrap: 'break-word',
                                  minHeight: '200px',
                                  maxHeight: 'calc(98vh - 500px)'
                                }}
                              >
                                {ocrSearchQuery.trim() ? (
                                  result.text.split(new RegExp(`(${ocrSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')).map((part, idx) => 
                                    part.toLowerCase() === ocrSearchQuery.toLowerCase() ? (
                                      <mark key={idx} className="bg-yellow-300 text-purple-900 font-semibold">{part}</mark>
                                    ) : (
                                      <span key={idx}>{part}</span>
                                    )
                                  )
                                ) : (
                                  result.text || '(テキストが見つかりませんでした)'
                                )}
                              </div>
                            )}
                          </div>
                          <div style={{ flexShrink: 0, position: 'sticky', top: '0.5rem' }}>
                            {thumbnails[parseInt(pageNum)] ? (
                              <img
                                src={thumbnails[parseInt(pageNum)]}
                                alt={`ページ ${pageNum} のサムネイル`}
                                className="border-2 border-purple-400 rounded shadow-lg bg-white"
                                style={{ width: `${ocrThumbnailSize}px`, height: 'auto', display: 'block' }}
                              />
                            ) : (
                              <div style={{ width: `${ocrThumbnailSize}px`, height: `${ocrThumbnailSize * 1.4}px`, border: '2px solid #c084fc', borderRadius: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3e8ff', color: '#9333ea', fontSize: '0.75rem' }}>
                                サムネイルなし
                              </div>
                            )}
                          </div>
                        </div>
                        {result.words.length > 0 && (
                          <details className="mt-2">
                            <summary className="text-xs text-purple-700 cursor-pointer font-semibold">単語詳細 ({result.words.length}個)</summary>
                            <div className="mt-2 text-xs text-purple-800 space-y-1 max-h-32 overflow-y-auto">
                              {result.words.slice(0, 20).map((word, idx) => (
                                <div key={idx} className="p-1 bg-white rounded">
                                  {word.text} (信頼度: {word.confidence.toFixed(1)}%)
                                </div>
                              ))}
                              {result.words.length > 20 && (
                                <div className="text-purple-600 font-semibold">...他 {result.words.length - 20}個</div>
                              )}
                            </div>
                          </details>
                        )}
                      </div>
                      );
                    })()}
                    {/* ページナビゲーションボタン */}
                    <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-purple-200 flex-shrink-0" style={{ position: 'sticky', bottom: 0, backgroundColor: '#faf5ff', paddingTop: '0.75rem', paddingBottom: '0.75rem', zIndex: 50 }}>
                      <button
                        onClick={() => {
                          if (currentOcrResultPage > 1) {
                            setCurrentOcrResultPage(currentOcrResultPage - 1);
                          }
                        }}
                        disabled={currentOcrResultPage === 1}
                        className={`px-3 py-1.5 border rounded text-xs font-medium transition-all flex items-center gap-1 ${
                          currentOcrResultPage === 1
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed border-gray-300'
                            : 'bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white border-purple-500 shadow-sm hover:shadow-md'
                        }`}
                      >
                        <MdNavigateBefore className="text-sm" />
                        前へ
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-purple-900 px-3 py-1.5 bg-purple-50 rounded border border-purple-200">
                          ページ {currentOcrResultPage} / {totalFilteredPages}
                        </span>
                        <Input
                          type="number"
                          min={1}
                          max={totalFilteredPages}
                          value={currentOcrResultPage}
                          onChange={(e) => {
                            const page = parseInt(e.target.value);
                            if (!isNaN(page) && page >= 1 && page <= totalFilteredPages) {
                              setCurrentOcrResultPage(page);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const page = parseInt(e.currentTarget.value);
                              if (!isNaN(page) && page >= 1 && page <= totalFilteredPages) {
                                setCurrentOcrResultPage(page);
                              }
                            }
                          }}
                          className="w-16 h-8 text-xs text-center border-2 border-purple-400 rounded bg-white focus:border-purple-600 focus:ring-2 focus:ring-purple-200"
                          style={{ borderWidth: '2px' }}
                          placeholder="ページ"
                        />
                      </div>
                      <button
                        onClick={() => {
                          if (currentOcrResultPage < totalFilteredPages) {
                            setCurrentOcrResultPage(currentOcrResultPage + 1);
                          }
                        }}
                        disabled={currentOcrResultPage >= totalFilteredPages}
                        className={`px-3 py-1.5 border rounded text-xs font-medium transition-all flex items-center gap-1 ${
                          currentOcrResultPage >= totalFilteredPages
                            ? 'bg-gray-200 text-gray-400 cursor-not-allowed border-gray-300'
                            : 'bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white border-purple-500 shadow-sm hover:shadow-md'
                        }`}
                      >
                        次へ
                        <MdNavigateNext className="text-sm" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-purple-600 font-semibold text-lg mb-2">検索結果がありません</p>
                    <p className="text-purple-500 text-sm">「{ocrSearchQuery}」に一致するテキストが見つかりませんでした</p>
                  </div>
                )}
              </div>
              );
            })()}
            {Object.keys(ocrResults).length === 0 && (
              <div className="p-2 bg-white rounded-lg border-2 border-purple-300 shadow-sm" style={{ borderWidth: '2px' }}>
                <p className="text-center text-purple-600 py-4">OCR結果がありません。上記のボタンからOCRを実行してください。</p>
              </div>
            )}
          </div>
          <DialogFooter className="pt-2 border-t-2 border-purple-400 mt-0 bg-white rounded-b-lg p-2 shadow-lg flex-shrink-0 relative z-10">
            <Button
              variant="outline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowOCRDialog(false);
              }}
              disabled={isProcessingOCR}
              className="h-8 px-4 text-xs font-semibold border border-purple-400 hover:bg-purple-100 hover:border-purple-600 shadow-sm relative z-20"
              style={{ pointerEvents: 'auto' }}
            >
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* シナリオダイアログ - 独立したモーダルとして実装（OCRモーダルより前面に表示） */}
      {showScenarioDialog && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 99999,
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'auto',
          }}
          onClick={(e) => {
            console.log('🔴 シナリオモーダルオーバーレイ onClick:', e.target, e.currentTarget);
            const target = e.target as HTMLElement;
            // 編集エリア内のクリックは無視
            if (target.closest('[data-editing-area]') || target.closest('textarea')) {
              console.log('🔴 編集エリア内のクリックを無視');
              return;
            }
            setShowScenarioDialog(false);
          }}
        >
          <div
            className="bg-white border-4 border-green-600 shadow-2xl rounded-lg flex flex-col max-w-5xl w-[90vw] max-h-[90vh]"
            onClick={(e) => {
              console.log('🟠 シナリオモーダルコンテンツ onClick:', e.target, e.currentTarget);
              e.stopPropagation();
            }}
            style={{
              zIndex: 100011,
              position: 'relative',
              backgroundColor: '#ffffff',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              margin: '0 auto',
            }}
          >
            {/* ヘッダー */}
            <div 
              className="flex items-center justify-between p-6 border-b-4 border-green-600"
              style={{
                backgroundColor: '#f0fdf4',
                borderBottomWidth: '4px',
                borderBottomColor: '#16a34a',
              }}
            >
              <div>
                <h2 
                  className="flex items-center gap-2 text-3xl font-bold"
                  style={{
                    color: '#166534',
                  }}
                >
                  <MdDescription className="text-4xl" style={{ color: '#16a34a' }} />
                  プレゼンシナリオ
                </h2>
                <p 
                  className="text-base mt-2 font-semibold"
                  style={{
                    color: '#15803d',
                  }}
                >
                  OCR結果から作成したシナリオを編集・印刷できます
                </p>
              </div>
              <button
                onClick={() => setShowScenarioDialog(false)}
                className="p-3 hover:bg-green-200 rounded-lg transition-colors"
                title="閉じる"
                style={{
                  backgroundColor: '#dcfce7',
                }}
              >
                <MdClose className="text-3xl" style={{ color: '#166534' }} />
              </button>
            </div>
            <div 
              className="flex-1 overflow-y-auto p-6 space-y-4"
              style={{
                backgroundColor: '#ffffff',
                overflowY: 'auto',
                maxHeight: 'calc(90vh - 300px)',
                paddingLeft: '2rem',
                paddingRight: '2rem',
              }}
            >
              {Object.keys(scenarios).length === 0 ? (
                <div className="text-center py-8">
                  <MdNotes className="text-4xl text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600 font-semibold">シナリオがありません</p>
                  <p className="text-gray-500 text-sm mt-1">OCR結果から「シナリオ」ボタンで作成してください</p>
                </div>
              ) : (
                Object.entries(scenarios)
                  .sort(([a], [b]) => parseInt(a) - parseInt(b))
                  .map(([pageNum, scenario]) => (
                    <div 
                      key={pageNum} 
                      className="border-2 rounded-lg p-5"
                      style={{
                        borderColor: '#86efac',
                        backgroundColor: '#f0fdf4',
                        borderWidth: '2px',
                        position: 'relative',
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-green-900">ページ {pageNum}</h3>
                      </div>
                      <div className="text-base text-gray-900 whitespace-pre-wrap bg-gradient-to-br from-white to-green-50 p-5 rounded-lg border-2 border-green-300 shadow-md" style={{ 
                        fontFamily: 'MS Gothic, "Hiragino Kaku Gothic ProN", "Hiragino Sans", Meiryo, sans-serif',
                        lineHeight: '2.0',
                        minHeight: '120px',
                        fontSize: '15px',
                      }}>
                        {scenario}
                      </div>
                    </div>
                  ))
              )}
            </div>
            {/* フッター */}
            <div 
              className="flex-shrink-0 flex flex-col gap-3 p-6 border-t-4"
              style={{
                backgroundColor: '#f0fdf4',
                borderTopWidth: '4px',
                borderTopColor: '#16a34a',
              }}
            >
              {/* 印刷オプション */}
              <div className="flex items-center gap-3 w-full pb-2 border-b border-green-200">
                <label className="flex items-center gap-2 text-sm text-green-800 font-semibold">
                  <input
                    type="checkbox"
                    checked={scenarioPrintPageBreak}
                    onChange={(e) => setScenarioPrintPageBreak(e.target.checked)}
                    className="w-4 h-4 text-green-600 border-green-400 rounded focus:ring-green-500"
                  />
                  <span>ページごとに改ページ</span>
                </label>
              </div>
              <div className="flex gap-2 w-full">
                <Button
                  onClick={() => {
                    // 全ページ一括印刷
                    const printWindow = window.open('', '_blank');
                    if (printWindow) {
                      const sortedScenarios = Object.entries(scenarios)
                        .sort(([a], [b]) => parseInt(a) - parseInt(b));
                      const pageBreakStyle = scenarioPrintPageBreak ? 'page-break-after: always;' : '';
                      const printContent = `
                        <!DOCTYPE html>
                        <html>
                          <head>
                            <title>プレゼンシナリオ（全ページ）</title>
                            <style>
                              body { font-family: 'MS Gothic', sans-serif; padding: 20px; line-height: 2.0; }
                              h1 { color: #059669; border-bottom: 2px solid #059669; padding-bottom: 10px; margin-bottom: 30px; }
                              .page { margin-bottom: ${scenarioPrintPageBreak ? '0' : '30px'}; ${pageBreakStyle} padding: 20px; }
                              .page-number { font-weight: bold; color: #059669; margin-bottom: 15px; font-size: 1.2em; border-bottom: 1px solid #059669; padding-bottom: 5px; }
                              .scenario { white-space: pre-wrap; line-height: 2.0; font-size: 15px; }
                              @media print {
                                body { padding: 15px; }
                                .page { ${pageBreakStyle} margin-bottom: ${scenarioPrintPageBreak ? '0' : '20px'}; }
                                .page:last-child { page-break-after: auto; }
                              }
                            </style>
                          </head>
                          <body>
                            <h1>プレゼンシナリオ（全ページ）</h1>
                            ${sortedScenarios.map(([pageNum, scenario]) => `
                              <div class="page">
                                <div class="page-number">ページ ${pageNum}</div>
                                <div class="scenario">${scenario.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
                              </div>
                            `).join('')}
                          </body>
                        </html>
                      `;
                      printWindow.document.write(printContent);
                      printWindow.document.close();
                      printWindow.focus();
                      setTimeout(() => {
                        printWindow.print();
                      }, 250);
                    }
                  }}
                  disabled={Object.keys(scenarios).length === 0}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 flex-1"
                >
                  <MdPrint className="text-lg" />
                  全ページ印刷
                </Button>
                <Button
                  onClick={() => {
                    // 現在編集中のページのみ印刷（編集中でなくても選択可能）
                    const pageToPrint = editingScenarioPage || (Object.keys(scenarios).length > 0 ? parseInt(Object.keys(scenarios).sort((a, b) => parseInt(a) - parseInt(b))[0]) : null);
                    if (pageToPrint !== null && scenarios[pageToPrint]) {
                      const printWindow = window.open('', '_blank');
                      if (printWindow) {
                        const scenario = scenarios[pageToPrint];
                        const printContent = `
                          <!DOCTYPE html>
                          <html>
                            <head>
                              <title>プレゼンシナリオ - ページ ${pageToPrint}</title>
                              <style>
                                body { font-family: 'MS Gothic', sans-serif; padding: 20px; line-height: 2.0; }
                                h1 { color: #059669; border-bottom: 2px solid #059669; padding-bottom: 10px; margin-bottom: 30px; }
                                .page-number { font-weight: bold; color: #059669; margin-bottom: 15px; font-size: 1.2em; border-bottom: 1px solid #059669; padding-bottom: 5px; }
                                .scenario { white-space: pre-wrap; line-height: 2.0; font-size: 15px; }
                              </style>
                            </head>
                            <body>
                              <h1>プレゼンシナリオ</h1>
                              <div class="page-number">ページ ${pageToPrint}</div>
                              <div class="scenario">${scenario.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
                            </body>
                          </html>
                        `;
                        printWindow.document.write(printContent);
                        printWindow.document.close();
                        printWindow.focus();
                        setTimeout(() => {
                          printWindow.print();
                        }, 250);
                      }
                    } else {
                      toast({
                        title: "情報",
                        description: "印刷可能なページがありません",
                        variant: "default",
                      });
                    }
                  }}
                  disabled={Object.keys(scenarios).length === 0}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
                >
                  <MdPrint className="text-lg" />
                  現在のページ印刷
                </Button>
                <Button
                  onClick={() => setShowScenarioDialog(false)}
                  variant="outline"
                  className="border-2 border-green-400 hover:bg-green-100"
                >
                  閉じる
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* PDF分割ダイアログ */}
      <Dialog 
        open={showSplitDialog}
        onOpenChange={(open) => {
          console.log('PDF分割ダイアログ onOpenChange called with:', open);
          // openがtrueの場合のみ状態を更新
          if (open) {
            setShowSplitDialog(true);
          }
          // openがfalseの場合は無視（手動で閉じるボタンのみで閉じる）
        }}
      >
        <DialogContent 
          topPosition="top-[15%]"
          className="max-w-2xl"
          style={{
            zIndex: 10001,
            left: '50%',
            top: '15%',
            transform: 'translateX(-50%) translateY(0)',
            background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 50%, #fed7aa 100%)',
          }}
          onClose={() => {
            setShowSplitDialog(false);
            setSplitRangeInputs(['']);
          }}
        >
            <DialogHeader className="pb-4 border-b border-orange-200 mb-4">
              <DialogTitle className="text-2xl font-bold text-slate-900 mb-2">PDFを分割</DialogTitle>
              <DialogDescription className="text-base text-slate-600">指定したページ範囲でPDFを分割します</DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <div className="space-y-4">
                {splitRangeInputs.map((input, index) => (
                  <div key={index} className="space-y-3 p-4 bg-slate-50 rounded-lg border-2 border-slate-200">
                    <label className="block text-base font-semibold text-slate-800">
                      範囲 {index + 1}（例: 1-3, 5, 7-9）
                    </label>
                    <div className="flex gap-3">
                      <Input
                        type="text"
                        value={input}
                        onChange={(e) => {
                          const newInputs = [...splitRangeInputs];
                          newInputs[index] = e.target.value;
                          setSplitRangeInputs(newInputs);
                        }}
                        placeholder="1-3, 5, 7-9"
                        className="flex-1 h-11 text-base border-2 border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-lg px-4 transition-all"
                      />
                      {splitRangeInputs.length > 1 && (
                        <button
                          onClick={() => {
                            setSplitRangeInputs(splitRangeInputs.filter((_, i) => i !== index));
                          }}
                          className="px-4 py-2 h-11 text-base font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors shadow-sm"
                        >
                          削除
                        </button>
                      )}
                    </div>
                    {input && (() => {
                      const ranges = parsePageRanges(input, totalPages);
                      const allPages: number[] = [];
                      ranges.forEach(range => {
                        for (let i = range.start; i <= range.end; i++) {
                          allPages.push(i);
                        }
                      });
                      const uniquePages = [...new Set(allPages)].sort((a, b) => a - b);
                      return (
                        <div className="p-3 bg-white rounded-lg border-2 border-blue-200 shadow-sm">
                          <p className="text-sm font-medium text-blue-800">
                            ページ: <span className="font-bold">{uniquePages.join(', ')}</span>
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() => {
                    setSplitRangeInputs([...splitRangeInputs, '']);
                  }}
                  className="w-full h-11 text-base font-semibold border-2 border-slate-300 hover:bg-slate-50"
                >
                  範囲を追加
                </Button>
                <div className="p-3 bg-blue-50 rounded-lg border-2 border-blue-200">
                  <p className="text-sm font-medium text-blue-800">
                    各範囲指定は1つのPDFファイルとして出力されます。例: "1-3, 5, 7-9" → 1つのPDF（1, 2, 3, 5, 7, 8, 9ページを含む）
                  </p>
                </div>
              </div>
            </div>
            <DialogFooter className="pt-4 border-t border-orange-200 mt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowSplitDialog(false);
                  setSplitRangeInputs(['']);
                }}
                className="h-11 px-6 text-base font-semibold border-2 border-slate-300 hover:bg-slate-50"
              >
                キャンセル
              </Button>
              <Button
                onClick={async () => {
                  if (!originalPdfBytes) {
                    toast({
                      title: "エラー",
                      description: "PDFファイルが読み込まれていません",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  // 有効な範囲入力のみを抽出
                  const validInputs = splitRangeInputs.filter(input => input.trim());
                  if (validInputs.length === 0) {
                    toast({
                      title: "エラー",
                      description: "分割範囲を指定してください",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  try {
                    // 各範囲入力をページ番号の配列に変換
                    const pageGroups: number[][] = validInputs.map(input => {
                      const ranges = parsePageRanges(input, totalPages);
                      const allPages: number[] = [];
                      ranges.forEach(range => {
                        for (let i = range.start; i <= range.end; i++) {
                          allPages.push(i);
                        }
                      });
                      return [...new Set(allPages)].sort((a, b) => a - b);
                    });
                    
                    const splitPdfs = await splitPDFByPageGroups(originalPdfBytes, pageGroups);
                    
                    // 各分割PDFをダウンロード
                    for (let i = 0; i < splitPdfs.length; i++) {
                      const pages = pageGroups[i];
                      const blob = new Blob([splitPdfs[i] as BlobPart], { type: 'application/pdf' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      const pageStr = pages.length === 1 
                        ? `page${pages[0]}` 
                        : `pages${pages[0]}-${pages[pages.length - 1]}`;
                      a.download = `${originalFileName?.replace('.pdf', '') || 'document'}_${pageStr}.pdf`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }
                    
                    toast({
                      title: "成功",
                      description: `${splitPdfs.length}個のPDFファイルをダウンロードしました`,
                      variant: "success",
                    });
                    
                    setShowSplitDialog(false);
                    setSplitRangeInputs(['']);
                  } catch (error) {
                    console.error('PDF分割エラー:', error);
                    toast({
                      title: "エラー",
                      description: 'PDFの分割に失敗しました: ' + (error instanceof Error ? error.message : String(error)),
                      variant: "destructive",
                    });
                  }
                }}
                disabled={splitRangeInputs.filter(input => input.trim()).length === 0}
                className="h-11 px-6 text-base font-semibold bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                分割してダウンロード
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* 目次ダイアログ */}
      <Dialog 
        open={showTableOfContentsDialog}
        onOpenChange={(open) => {
          if (open) {
            setShowTableOfContentsDialog(true);
          }
        }}
      >
        <DialogContent 
          topPosition="top-[5%]"
          className="!flex !flex-col max-w-4xl"
          style={{
            zIndex: 10001,
            left: '50%',
            top: '5%',
            transform: 'translateX(-50%) translateY(0)',
            background: 'linear-gradient(135deg, #ede9fe 0%, #f3e8ff 50%, #e9d5ff 100%)',
            border: '4px solid #6366f1',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            padding: 0,
            overflow: 'hidden',
            width: '90vw',
            maxWidth: '90vw',
            height: '90vh',
            maxHeight: '90vh',
          } as React.CSSProperties & { display: 'flex' }}
          onClose={() => {
            setShowTableOfContentsDialog(false);
          }}
        >
          <DialogHeader className="pb-3 border-b-2 border-indigo-300 mb-0 bg-white rounded-t-lg p-4 shadow-sm flex-shrink-0">
            <DialogTitle className="text-xl font-bold text-indigo-900 mb-1">目次</DialogTitle>
            <DialogDescription className="text-sm text-indigo-700">PDFの見出しから目次を自動生成します</DialogDescription>
          </DialogHeader>
          <div className="flex-1 flex flex-col p-4 pl-6" style={{ minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingLeft: '1.5rem' }}>
            {tableOfContents.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-slate-600 mb-4 text-base">目次が生成されていません</p>
                  <Button
                    onClick={handleGenerateTableOfContents}
                    disabled={isGeneratingTOC}
                    className="h-11 px-6 text-base font-semibold bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600 text-white shadow-lg hover:shadow-xl transition-all"
                  >
                    {isGeneratingTOC ? '生成中...' : '目次を生成'}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center mb-4 flex-shrink-0 gap-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-indigo-800">
                      {tableOfContents.length}個の見出しが見つかりました
                    </p>
                    <p className="text-xs text-slate-500">
                      （重複を除外した数）
                    </p>
                  </div>
                  <Button
                    onClick={handleGenerateTableOfContents}
                    disabled={isGeneratingTOC}
                    variant="outline"
                    className="h-8 px-3 text-xs font-semibold border-2 border-indigo-300 hover:bg-indigo-50 ml-auto"
                  >
                    {isGeneratingTOC ? '再生成中...' : '再生成'}
                  </Button>
                </div>
                <div 
                  className="flex-1 pr-3"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: '#a5b4fc #e0e7ff',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    minHeight: 0,
                    flex: '1 1 auto',
                    position: 'relative',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  <div className="space-y-2" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', width: '100%', paddingBottom: '2rem' }}>
                    {tableOfContents.map((entry, index) => {
                      // デバッグ: 全エントリが表示されているか確認
                      if (index === tableOfContents.length - 1) {
                        console.log(`目次表示: 全${tableOfContents.length}個のエントリをレンダリング中。最後のエントリ: P${entry.page} - ${entry.title}`);
                      }
                      console.log(`📄📄📄 目次エントリ デバッグ: エントリ ${index} をレンダリング`, { page: entry.page, title: entry.title, isEditing: editingTOCIndex === index });
                      const isEditing = editingTOCIndex === index;
                      
                      return (
                        <div
                          key={`${entry.page}-${index}-${entry.title.substring(0, 20)}`}
                          className="py-3 px-4 rounded-lg border-l-4 border-indigo-400 bg-white/90 hover:bg-indigo-50 transition-all shadow-sm hover:shadow-md mb-3"
                          style={{ 
                            display: 'flex',
                            flexDirection: 'column',
                            width: '100%',
                            alignSelf: 'flex-start',
                            marginBottom: '0.75rem',
                          }}
                        >
                          {isEditing ? (
                            // 編集モード
                            <div className="flex items-start gap-3 w-full">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleJumpToPage(entry.page);
                                }}
                                className="text-sm font-bold whitespace-nowrap flex-shrink-0 pt-1 cursor-pointer transition-all px-3 py-1.5 rounded-md border-2 shadow-sm hover:shadow-md active:scale-95 font-semibold mr-2"
                                title={`ページ ${entry.page} に移動`}
                                style={{ 
                                  minWidth: '70px', 
                                  display: 'inline-block', 
                                  backgroundColor: '#a5b4fc', 
                                  borderColor: '#6366f1', 
                                  color: '#1e293b',
                                  borderWidth: '2px',
                                  borderStyle: 'solid',
                                }}
                              >
                                P{String(entry.page).padStart(2, '0')}：
                              </button>
                              <div className="flex-1 flex flex-col gap-2">
                                <Input
                                  value={editingTOCTitle}
                                  onChange={(e) => setEditingTOCTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      handleSaveEditTOC();
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      handleCancelEditTOC();
                                    }
                                  }}
                                  className="text-sm font-medium"
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <Button
                                    onClick={handleSaveEditTOC}
                                    size="sm"
                                    className="h-7 px-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                                  >
                                    保存
                                  </Button>
                                  <Button
                                    onClick={handleCancelEditTOC}
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-3 text-xs"
                                  >
                                    キャンセル
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ) : (
                            // 表示モード
                            <div className="flex items-start gap-3 w-full">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleJumpToPage(entry.page);
                                }}
                                className="text-sm font-bold whitespace-nowrap flex-shrink-0 cursor-pointer transition-all px-3 py-1.5 rounded-md border-2 shadow-sm hover:shadow-md active:scale-95 font-semibold mr-2"
                                title={`ページ ${entry.page} に移動`}
                                style={{ 
                                  minWidth: '70px', 
                                  display: 'inline-block', 
                                  backgroundColor: '#a5b4fc', 
                                  borderColor: '#6366f1', 
                                  color: '#1e293b',
                                  borderWidth: '2px',
                                  borderStyle: 'solid',
                                }}
                              >
                                P{String(entry.page).padStart(2, '0')}：
                              </button>
                              <span 
                                className="flex-1 text-sm text-slate-800 font-medium break-words leading-relaxed text-left cursor-pointer hover:text-indigo-900"
                                onClick={() => handleJumpToPage(entry.page)}
                              >
                                {entry.title}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStartEditTOC(index);
                                }}
                                className="flex-shrink-0 p-1 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100 rounded transition-colors"
                                title="編集"
                              >
                                <MdEdit className="text-base" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter className="pt-3 border-t border-indigo-200 mt-0 bg-white rounded-b-lg p-3 pl-6 flex-shrink-0" style={{ paddingLeft: '1.5rem' }}>
            <Button
              variant="outline"
              onClick={() => setShowTableOfContentsDialog(false)}
              className="h-9 px-5 text-sm font-semibold border-2 border-slate-300 hover:bg-slate-50"
            >
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 透かしダイアログ */}
      <Dialog open={showWatermarkDialog} onOpenChange={(open) => {
        if (open) {
          setShowWatermarkDialog(true);
        } else {
          setShowWatermarkDialog(false);
        }
      }}>
        <DialogContent
          topPosition="top-[15%]"
          className="max-w-md"
          style={{
            zIndex: 10001,
            left: '50%',
            top: '15%',
            transform: 'translateX(-50%) translateY(0)',
            background: 'linear-gradient(135deg, #ccfbf1 0%, #99f6e4 50%, #5eead4 100%)',
          }}
          onClose={() => {
            setShowWatermarkDialog(false);
            setWatermarkText('');
          }}
        >
          <DialogHeader className="pb-4 border-b border-teal-200 mb-4">
            <DialogTitle className="text-2xl font-bold text-slate-900 mb-2">透かしを追加</DialogTitle>
            <DialogDescription className="text-base text-slate-600">PDFに透かし文字を追加します</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">透かし文字</label>
              <Input
                type="text"
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
                placeholder="例: 機密、承認済み、下書き"
                className="w-full"
              />
            </div>
            {watermarkHistory.length > 0 && (
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-2">履歴から選択</label>
                <div className="flex flex-wrap gap-2">
                  {watermarkHistory.slice(0, 10).map((text, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => setWatermarkText(text)}
                      className="px-3 py-1.5 text-sm bg-white border-2 border-slate-300 rounded-lg hover:bg-teal-50 hover:border-teal-400 transition-all shadow-sm"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">配置パターン</label>
              <select
                value={watermarkPattern}
                onChange={(e) => setWatermarkPattern(e.target.value as 'center' | 'grid' | 'tile')}
                className="w-full px-4 py-2.5 text-base border-2 border-slate-300 rounded-lg bg-white focus:border-teal-400 focus:ring-2 focus:ring-teal-200"
              >
                <option value="center">中央1箇所</option>
                <option value="grid">グリッド状（均等配置）</option>
                <option value="tile">タイル状（繰り返し配置）</option>
              </select>
            </div>
            {(watermarkPattern === 'grid' || watermarkPattern === 'tile') && (
              <div className="p-4 bg-white/60 rounded-lg border-2 border-slate-200">
                <label className="block text-sm font-semibold text-slate-800 mb-3">
                  密度（{watermarkPattern === 'grid' ? '列数・行数' : '間隔'}）: {watermarkDensity}
                </label>
                <input
                  type="range"
                  min="2"
                  max="10"
                  value={watermarkDensity}
                  onChange={(e) => setWatermarkDensity(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-500"
                />
                <div className="flex justify-between text-xs text-slate-600 mt-2 font-medium">
                  <span>低密度</span>
                  <span>高密度</span>
                </div>
              </div>
            )}
            <div className="p-4 bg-white/60 rounded-lg border-2 border-slate-200">
              <label className="block text-sm font-semibold text-slate-800 mb-3">配置角度: {watermarkAngle}°</label>
              <div className="flex items-center gap-4 mb-3">
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="15"
                  value={watermarkAngle}
                  onChange={(e) => setWatermarkAngle(parseInt(e.target.value))}
                  className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-500"
                />
                <Input
                  type="number"
                  min="0"
                  max="360"
                  value={watermarkAngle}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    setWatermarkAngle(Math.max(0, Math.min(360, val)));
                  }}
                  className="w-20 px-3 py-2 text-base border-2 border-slate-300 rounded-lg bg-white focus:border-teal-400 focus:ring-2 focus:ring-teal-200"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                  <button
                    key={angle}
                    type="button"
                    onClick={() => setWatermarkAngle(angle)}
                    className={`px-4 py-2 text-sm font-semibold border-2 rounded-lg transition-all shadow-sm ${
                      watermarkAngle === angle
                        ? 'bg-teal-500 text-white border-teal-500 shadow-md'
                        : 'bg-white border-slate-300 hover:bg-teal-50 hover:border-teal-400'
                    }`}
                  >
                    {angle}°
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4 bg-white/60 rounded-lg border-2 border-slate-200">
              <label className="block text-sm font-semibold text-slate-800 mb-3">
                濃度: {Math.round(watermarkOpacity * 100)}%
              </label>
              <div className="flex items-center gap-4 mb-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={watermarkOpacity * 100}
                  onChange={(e) => setWatermarkOpacity(parseInt(e.target.value) / 100)}
                  className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-teal-500"
                />
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={Math.round(watermarkOpacity * 100)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    setWatermarkOpacity(Math.max(0, Math.min(100, val)) / 100);
                  }}
                  className="w-20 px-3 py-2 text-base border-2 border-slate-300 rounded-lg bg-white focus:border-teal-400 focus:ring-2 focus:ring-teal-200"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percent) => (
                  <button
                    key={percent}
                    type="button"
                    onClick={() => setWatermarkOpacity(percent / 100)}
                    className={`px-3 py-1.5 text-xs font-semibold border-2 rounded-lg transition-all shadow-sm ${
                      Math.round(watermarkOpacity * 100) === percent
                        ? 'bg-teal-500 text-white border-teal-500 shadow-md'
                        : 'bg-white border-slate-300 hover:bg-teal-50 hover:border-teal-400'
                    }`}
                  >
                    {percent}%
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-white/60 rounded-lg border-2 border-slate-200">
              <input
                type="checkbox"
                id="watermark-preview"
                checked={showWatermarkPreview}
                onChange={(e) => setShowWatermarkPreview(e.target.checked)}
                className="w-5 h-5 text-teal-600 border-2 border-slate-300 rounded focus:ring-2 focus:ring-teal-200"
              />
              <label htmlFor="watermark-preview" className="text-sm font-semibold text-slate-800 cursor-pointer">
                プレビューを表示
              </label>
            </div>
          </div>
          <DialogFooter className="pt-4 border-t border-teal-200 mt-4">
            <Button
              onClick={() => {
                setShowWatermarkDialog(false);
                setWatermarkText('');
              }}
              variant="outline"
              className="h-11 px-6 text-base font-semibold border-2 border-slate-300 hover:bg-slate-50"
            >
              キャンセル
            </Button>
            <Button
              onClick={async () => {
                if (watermarkText.trim()) {
                  await saveWatermarkHistory(watermarkText.trim());
                  const history = await getAllWatermarkHistory();
                  setWatermarkHistory(history);
                  toast({
                    title: "成功",
                    description: "透かしを設定しました。エクスポート時に反映されます。",
                    variant: "success",
                  });
                }
                setShowWatermarkDialog(false);
              }}
              className="h-11 px-6 text-base font-semibold bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white shadow-lg hover:shadow-xl transition-all"
            >
              設定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}

