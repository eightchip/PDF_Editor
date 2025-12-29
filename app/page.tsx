'use client';

import React, { useState, useRef, useEffect } from 'react';
import { loadPDF, renderPage } from './lib/pdf';
import { drawStroke, redrawStrokes, normalizePoint } from './lib/ink';
import { saveAnnotations, loadAnnotations, deleteAnnotations, getAllAnnotations, saveTextAnnotations, loadTextAnnotations, deleteTextAnnotations, getAllTextAnnotations, saveShapeAnnotations, loadShapeAnnotations, deleteShapeAnnotations, getAllShapeAnnotations, type Stroke, type TextAnnotation, type ShapeAnnotation } from './lib/db';
import { generateDocId } from './lib/id';
import { exportAnnotatedPDFV2 } from './lib/export';
import { exportAnnotationsToJSON, importAnnotationsFromJSON } from './lib/json-export';
import { drawTextAnnotation, redrawTextAnnotations, generateTextId } from './lib/text';
import { drawShapeAnnotation, redrawShapeAnnotations, generateShapeId } from './lib/shapes';
import { extractTextItems, findNearestTextLine, findTextBoundingBox, smoothStroke, type TextItem } from './lib/text-detection';
import { convertImageToPDF } from './lib/image-to-pdf';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button"; // Dialog内でのみ使用
import { MdClose, MdSave, MdFileDownload, MdUndo, MdRedo, MdDelete, MdEdit, MdHighlight, MdTextFields, MdShapeLine, MdRectangle, MdCircle, MdArrowForward, MdSelectAll, MdList, MdZoomIn, MdZoomOut, MdRotateRight, MdNavigateBefore, MdNavigateNext, MdImage, MdInsertDriveFile, MdCreate, MdFormatColorFill, MdBrush, MdClear, MdRemove, MdPalette, MdUpload, MdQrCode, MdCameraAlt, MdCamera, MdMic, MdMicOff, MdArrowUpward, MdArrowDownward, MdCollections, MdDragHandle } from 'react-icons/md';
import { QRCodeSVG } from 'qrcode.react';
// PDF.jsの型は動的インポートで取得

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
  const [pageRotation, setPageRotation] = useState(0); // 0, 90, 180, 270
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [showThumbnailModal, setShowThumbnailModal] = useState(false); // 全画面サムネイルモーダルの表示状態
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [pageOrder, setPageOrder] = useState<number[]>([]); // ページの表示順序
  const [draggedPage, setDraggedPage] = useState<number | null>(null); // ドラッグ中のページ番号
  const [dragOverPage, setDragOverPage] = useState<number | null>(null); // ドラッグオーバー中のページ番号
  const [expandedThumbnail, setExpandedThumbnail] = useState<number | null>(null); // 拡大表示中のサムネイル番号
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
  const [tool, setTool] = useState<'pen' | 'eraser' | 'text' | 'line' | 'rectangle' | 'circle' | 'arrow' | 'highlight' | 'select'>('pen');
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
  const containerRef = useRef<HTMLDivElement>(null);
  const isDrawingRef = useRef(false);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

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
      // 画像またはPDFをコレクションに追加
      setImageFiles(prev => {
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
        const arrayBuffer = await convertImageToPDF(file, 0);
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        const pdfFile = new File([blob], file.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });

        const id = await generateDocId(pdfFile);
        setDocId(id);
        
        setOriginalPdfBytes(arrayBuffer);
        setOriginalFileName(pdfFile.name); // 変換後のPDFファイル名を保存
        
        const doc = await loadPDF(pdfFile);
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
        setScale(1.0);
        setPageRotation(0); // 初期回転は0度
        setStrokes([]);
        setUndoStack([]);
        setRedoStack([]);
        setPageSizes({});
        setTextItems([]);
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
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // 複数ファイルが選択された場合、すべてをコレクションに追加
    if (files.length > 1) {
      const validFiles = Array.from(files).filter(f => 
        f.type.startsWith('image/') || f.type === 'application/pdf'
      );
      if (validFiles.length > 0) {
        setImageFiles(prev => [...prev, ...validFiles]);
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
          const arrayBuffer = await file.arrayBuffer();
          const id = await generateDocId(file);
          setDocId(id);
          
          setOriginalPdfBytes(arrayBuffer);
          setOriginalFileName(file.name); // 元のファイル名を保存
          
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
        } catch (error) {
          console.error('ファイル読み込みエラー:', error);
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

  // ページレンダリング
  const renderCurrentPage = async () => {
    if (!pdfDoc || !pdfCanvasRef.current || !inkCanvasRef.current) return;

    try {
      // pageOrderが設定されている場合は、表示順序から実際のページ番号に変換
      const actualPageNum = getActualPageNum(currentPage);
      const page = await pdfDoc.getPage(actualPageNum);
      const pdfCanvas = pdfCanvasRef.current;
      const inkCanvas = inkCanvasRef.current;

      // PDFをレンダリング
      const size = await renderPage(page, pdfCanvas, scale, pageRotation);
      setPageSize(size);
      
      // ページサイズを記録（エクスポート用、scale=1.0でのサイズ）
      if (scale === 1.0) {
        // pageOrderが設定されている場合は、実際のページ番号で記録
        const actualPageNum = getActualPageNum(currentPage);
        setPageSizes(prev => ({ ...prev, [actualPageNum]: size }));
      }

      // テキストを抽出（スナップ機能用）
      if (snapToTextEnabled) {
        try {
          const items = await extractTextItems(page, scale);
          setTextItems(items);
        } catch (error) {
          console.warn('テキスト抽出に失敗しました:', error);
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
      if (docId) {
        // pageOrderが設定されている場合は、表示順序から実際のページ番号に変換
        const actualPageNum = getActualPageNum(currentPage);
        const savedStrokes = await loadAnnotations(docId, actualPageNum);
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
            redrawShapeAnnotations(shapeCtx, savedShapes, size.width, size.height);
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
  useEffect(() => {
    renderCurrentPage();
  }, [pdfDoc, currentPage, scale, docId, pageRotation]);

  // サムネイル生成
  const generateThumbnails = async () => {
    if (!pdfDoc) return;

    const newThumbnails: Record<number, string> = {};
    
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) continue;

        // サムネイルサイズ（幅150px、高さはアスペクト比を保持）
        const viewport = page.getViewport({ scale: 1.0 });
        const thumbnailScale = 150 / viewport.width;
        const thumbnailViewport = page.getViewport({ scale: thumbnailScale });
        
        canvas.width = thumbnailViewport.width;
        canvas.height = thumbnailViewport.height;

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

  // PDF読み込み時にサムネイルを生成
  useEffect(() => {
    if (pdfDoc && totalPages > 0) {
      generateThumbnails();
    }
  }, [pdfDoc, totalPages]);

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
      
      // 入力フィールドにフォーカスがある場合は無視
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLButtonElement
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

      // ←: 前のページ
      if (e.key === 'ArrowLeft' && !isCtrl) {
        e.preventDefault();
        goToPrevPage();
        return;
      }

      // →: 次のページ
      if (e.key === 'ArrowRight' && !isCtrl) {
        e.preventDefault();
        goToNextPage();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [undoStack, redoStack, pdfDoc, isExporting, currentPage, totalPages]);

  // 描画開始
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pageSize) return;

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

    // ハイライトツールの場合
    if (tool === 'highlight') {
      // 自動モード：テキスト全体を検出してハイライト
      if (highlightMode === 'auto' && textItems.length > 0) {
        const boundingBox = findTextBoundingBox(textItems, x, y, 30);
        if (boundingBox) {
        // テキスト全体のバウンディングボックスをハイライトとして描画
        // 矩形の4つの角をpointsとして追加
        const normalizedX1 = boundingBox.x / pageSize.width;
        const normalizedY1 = boundingBox.y / pageSize.height;
        const normalizedX2 = (boundingBox.x + boundingBox.width) / pageSize.width;
        const normalizedY2 = (boundingBox.y + boundingBox.height) / pageSize.height;

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
          redrawShapeAnnotations(ctx, movedShapes, pageSize.width, pageSize.height);
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

    // 図形ツールの場合
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
          redrawShapeAnnotations(ctx, shapeAnnotations, pageSize.width, pageSize.height);
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
            redrawShapeAnnotations(ctx, movedShapes, pageSize.width, pageSize.height);
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

    // 図形ツールの場合
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
            redrawShapeAnnotations(ctx, shapeAnnotations, pageSize.width, pageSize.height);
          }
        }
        e.preventDefault();
        return;
      }

      const newShapes = [...shapeAnnotations, currentShape];
      setShapeAnnotations(newShapes);
      
      // Undoスタックに追加
      setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
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
          redrawShapeAnnotations(ctx, newShapes, pageSize.width, pageSize.height);
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
    const newStrokes = [...strokes, currentStroke];
    setStrokes(newStrokes);
    setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    setRedoStack([]);
    setCurrentStroke(null);
    isDrawingRef.current = false;

    // 保存
    const actualPageNum = getActualPageNum(currentPage);
    await saveAnnotations(docId, actualPageNum, newStrokes);

    e.preventDefault();
  };

  // 前のページ
  const goToPrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  // 次のページ
  const goToNextPage = () => {
    if (pdfDoc && currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // 表示順序のインデックスから実際のページ番号に変換するヘルパー関数
  const getActualPageNum = (displayIndex: number): number => {
    if (pageOrder.length > 0 && displayIndex > 0 && displayIndex <= pageOrder.length) {
      return pageOrder[displayIndex - 1];
    }
    return displayIndex;
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
    if (undoStack.length === 0 || !docId) return;

    const previousState = undoStack[undoStack.length - 1];
    
    // 現在の状態をRedoスタックに追加
    setRedoStack([...redoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    
    // Undoスタックから最後の要素を削除
    const newUndoStack = undoStack.slice(0, -1);
    setUndoStack(newUndoStack);
    
    // 状態を更新（同期的に）
    setStrokes(previousState.strokes);
    setShapeAnnotations(previousState.shapes);
    setTextAnnotations(previousState.texts);

    // 保存
    const actualPageNum = getActualPageNum(currentPage);
    await saveAnnotations(docId, actualPageNum, previousState.strokes);
    await saveShapeAnnotations(docId, actualPageNum, previousState.shapes);
    await saveTextAnnotations(docId, actualPageNum, previousState.texts);

    // 再描画（状態更新後に実行）
    // requestAnimationFrameを使用して、状態更新が完了した後に再描画
    requestAnimationFrame(() => {
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
          redrawShapeAnnotations(ctx, previousState.shapes, pageSize.width, pageSize.height);
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
    });
  };

  // Redo
  const handleRedo = async () => {
    if (redoStack.length === 0 || !docId) return;

    const nextState = redoStack[redoStack.length - 1];
    
    // 現在の状態をUndoスタックに追加
    setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    
    // Redoスタックから最後の要素を削除
    const newRedoStack = redoStack.slice(0, -1);
    setRedoStack(newRedoStack);
    
    // 状態を更新（同期的に）
    setStrokes(nextState.strokes);
    setShapeAnnotations(nextState.shapes);
    setTextAnnotations(nextState.texts);

    // 保存
    const actualPageNum = getActualPageNum(currentPage);
    await saveAnnotations(docId, actualPageNum, nextState.strokes);
    await saveShapeAnnotations(docId, actualPageNum, nextState.shapes);
    await saveTextAnnotations(docId, actualPageNum, nextState.texts);

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

    // 再描画（キャンバスをクリアしてから再描画）
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
        redrawShapeAnnotations(ctx, newShapes, pageSize.width, pageSize.height);
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
  };

  // Clear
  const handleClear = async () => {
    if (!docId || !inkCanvasRef.current || !pageSize) return;

    setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    setRedoStack([]);
    setStrokes([]);
    setTextAnnotations([]);
    setShapeAnnotations([]);

    await deleteAnnotations(docId, currentPage);
    await deleteTextAnnotations(docId, currentPage);
    await deleteShapeAnnotations(docId, currentPage);

    // クリア
    const ctx = inkCanvasRef.current.getContext('2d');
    if (ctx) {
      const devicePixelRatio = window.devicePixelRatio || 1;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
    }
    if (textCanvasRef.current) {
      const textCtx = textCanvasRef.current.getContext('2d');
      if (textCtx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        textCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        textCtx.clearRect(0, 0, textCanvasRef.current.width, textCanvasRef.current.height);
      }
    }
    if (shapeCanvasRef.current) {
      const shapeCtx = shapeCanvasRef.current.getContext('2d');
      if (shapeCtx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        shapeCtx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        shapeCtx.clearRect(0, 0, shapeCanvasRef.current.width, shapeCanvasRef.current.height);
      }
    }
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

    const newText: TextAnnotation = {
      id: editingTextId || generateTextId(),
      x: Math.max(0, Math.min(1, normalizedX)),
      y: Math.max(0, Math.min(1, normalizedY)),
      text: textInputValue,
      fontSize,
      color,
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

      // 注釈をPDFに焼き込む
      const pdfBytes = await exportAnnotatedPDFV2(
        originalPdfBytes,
        annotations,
        allPageSizes,
        textAnnotations,
        shapeAnnotations
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

  // 名前を付けて保存（ブラウザのネイティブファイル保存ダイアログを使用）
  const handleSaveAs = async () => {
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
    setIsExporting(true);
    try {
      const pdfBytes = await generateAnnotatedPDF();
      if (!pdfBytes) return;

      // ダウンロード（タイムスタンプ付きファイル名）
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annotated_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "成功",
        description: "注釈付きPDFをエクスポートしました",
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
    <div className="h-screen bg-gradient-to-br from-slate-50 to-slate-100 relative overflow-hidden" style={{ height: '100vh', overflow: 'hidden' }}>
      <div className="h-full max-w-[1800px] mx-auto p-4 md:p-6 lg:p-8 transition-all duration-300" style={{ 
        position: 'relative', 
        zIndex: 1,
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
        className="mb-6 p-6 border-2 border-dashed rounded-xl bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 hover:from-blue-100 hover:via-purple-100 hover:to-pink-100 transition-all duration-300 text-center hover:scale-[1.02] hover:shadow-lg border-blue-300 hover:border-purple-400"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={async (e) => {
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
        <div className="flex gap-2">
          <label className="inline-block flex-1">
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
                  ファイルを選択
                </span>
              </div>
            </div>
          </label>
          <label className="inline-block">
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif"
              onChange={(e) => handleFileSelect(e, true)}
              className="hidden"
              multiple
            />
            <div className="px-6 py-4 border-2 border-dashed rounded-xl bg-gradient-to-br from-purple-50 via-pink-50 to-rose-50 hover:from-purple-100 hover:via-pink-100 hover:to-rose-100 cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-lg border-purple-300 hover:border-pink-400">
              <div className="flex items-center justify-center gap-3">
                <MdCollections className="text-3xl text-purple-600" />
                <span className="text-base font-semibold bg-gradient-to-r from-purple-600 via-pink-600 to-rose-600 bg-clip-text text-transparent">
                  コレクションに追加
                </span>
              </div>
            </div>
          </label>
        </div>
        <div className="mt-4 px-5 py-4 bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 border-3 border-blue-600 rounded-xl shadow-lg" style={{ borderWidth: '3px', borderStyle: 'solid', borderColor: '#2563eb' }}>
          <div className="text-sm text-slate-800 font-bold mb-2.5 flex items-center gap-2">
            <MdInsertDriveFile className="text-blue-600 text-lg" />
            PDFファイルまたは画像ファイル（PNG、JPEG、WebP、GIF）を選択できます
          </div>
          <div className="text-xs text-slate-700 pl-7 space-y-1">
            <div>• 画像ファイルは自動的にPDFに変換されます</div>
            <div>• または、ファイルをここにドラッグ&ドロップしてください</div>
          </div>
        </div>
      </div>

      {/* 保存ボタン（画面上部中央） */}
      {pdfDoc && (
        <div className="mb-6 flex justify-center items-center gap-3 flex-wrap">
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
                className="gap-4"
                style={{ 
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
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
                        // ワンクリックでメイン画面のスライドを指定
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
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        // ダブルクリックで拡大表示
                        setExpandedThumbnail(pageNum);
                      }}
                      className="relative cursor-pointer"
                    >
                      {thumbnails[pageNum] ? (
                        <img
                          src={thumbnails[pageNum]}
                          alt={`ページ ${pageNum}`}
                          className="w-full h-auto block rounded shadow-sm"
                        />
                      ) : (
                        <div className="py-12 text-center text-slate-400 text-sm bg-slate-100 rounded">
                          読み込み中...
                        </div>
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
      {expandedThumbnail && thumbnails[expandedThumbnail] && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-[10004] p-4"
          onClick={() => setExpandedThumbnail(null)}
        >
          <div 
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setExpandedThumbnail(null)}
              className="absolute top-2 right-2 p-2 bg-white/90 hover:bg-white rounded-full shadow-lg z-10"
              title="閉じる"
            >
              <MdClose className="text-2xl text-slate-800" />
            </button>
            <img
              src={thumbnails[expandedThumbnail]}
              alt={`ページ ${expandedThumbnail} (拡大)`}
              className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
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
            <div className="mb-4 flex gap-3 md:gap-4 items-center flex-wrap transition-all duration-300 relative z-50" style={{ pointerEvents: 'auto' }}>
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
              onClick={() => setPageRotation((prev) => (prev + 90) % 360)}
              title="ページを90度回転します"
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
              回転 ({pageRotation}°)
            </button>
        </div>

          {/* ズーム */}
          <div className="mb-4 flex gap-3 items-center flex-wrap relative z-50" style={{ pointerEvents: 'auto' }}>
            <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
              <MdZoomOut className="text-base" />
              ズーム:
            </span>
            <button
              onClick={() => setScale(0.75)}
              title="表示倍率を75%に設定します"
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all shadow-sm border-violet-500 ${
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
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all shadow-sm border-violet-500 ${
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
              className={`px-4 py-2 border rounded-lg text-sm font-medium transition-all shadow-sm border-violet-500 ${
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

          {/* ツールバー */}
          <div className="mb-4 flex gap-3 md:gap-4 items-center flex-wrap transition-all duration-300 relative z-50" style={{ pointerEvents: 'auto' }}>
            <div className="flex gap-3 flex-wrap">
              <button
                onClick={() => setTool('pen')}
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
                onClick={() => setTool('eraser')}
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
                onClick={() => setTool('text')}
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
                onClick={() => setTool('line')}
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
                onClick={() => setTool('rectangle')}
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
                onClick={() => setTool('circle')}
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
                onClick={() => setTool('arrow')}
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
                onClick={() => setTool('highlight')}
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
            </div>

            {(tool === 'pen' || tool === 'highlight') && (
              <div className="flex gap-3 items-center flex-wrap">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  色:
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-10 h-8 rounded border border-slate-300 cursor-pointer"
                  />
                </label>
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
          >
            <canvas
              ref={pdfCanvasRef}
              style={{ display: 'block', position: 'relative', zIndex: 1 }}
            />
            <canvas
              ref={inkCanvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                touchAction: 'none',
                cursor: tool === 'pen' || tool === 'highlight' ? 'crosshair' : tool === 'text' ? 'text' : (tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow') ? 'crosshair' : 'default',
                pointerEvents: (tool === 'line' || tool === 'rectangle' || tool === 'circle' || tool === 'arrow' || tool === 'select') ? 'none' : 'auto',
                zIndex: 2,
                width: '100%',
                height: '100%',
              }}
              onPointerDown={(e) => {
                if (tool !== 'select') {
                  handlePointerDown(e);
                }
              }}
              onPointerMove={(e) => {
                if (tool !== 'select') {
                  handlePointerMove(e);
                }
              }}
              onPointerUp={(e) => {
                if (tool !== 'select') {
                  handlePointerUp(e);
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
                  placeholder="テキストを入力（Enterで確定、Escでキャンセル）"
                  onFocus={(e) => {
                    // タッチデバイスの場合、タッチキーボードが自動的に表示される
                    // 特に何もする必要はない
                  }}
                />
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
                  <span className={`font-medium ${selectedAnnotationIds.strokes.includes(stroke.id || '') ? 'text-indigo-800' : 'text-slate-700'}`}>
                    <MdBrush className="inline mr-1 text-indigo-600" />
                    ストローク {index + 1}
                  </span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (stroke.id && docId && pageSize) {
                        const newStrokes = strokes.filter(s => s.id !== stroke.id);
                        // 状態を同期的に更新（注釈一覧の表示を即座に更新するため）
                        setStrokes(newStrokes);
                        const actualPageNum = getActualPageNum(currentPage);
                        await saveAnnotations(docId, actualPageNum, newStrokes);
                        // 再描画（キャンバスをクリアしてから再描画）
                        if (inkCanvasRef.current) {
                          const ctx = inkCanvasRef.current.getContext('2d');
                          if (ctx) {
                            const devicePixelRatio = window.devicePixelRatio || 1;
                            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
                            ctx.clearRect(0, 0, inkCanvasRef.current.width, inkCanvasRef.current.height);
                            redrawStrokes(ctx, newStrokes, pageSize.width, pageSize.height);
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
                            redrawShapeAnnotations(ctx, newShapes, pageSize.width, pageSize.height);
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
                onClick={() => setShowImageManager(false)}
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
                      <div className="flex-shrink-0 w-16 h-16 bg-slate-100 rounded overflow-hidden flex items-center justify-center">
                        {file.type === 'application/pdf' ? (
                          <MdInsertDriveFile className="text-3xl text-red-600" />
                        ) : (
                          <img
                            src={URL.createObjectURL(file)}
                            alt={`画像 ${index + 1}`}
                            className="w-full h-full object-cover"
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
          className="fixed inset-0 bg-black bg-opacity-50 z-[10002] p-4"
          onClick={() => {
            if (isListening) {
              stopVoiceInput();
            }
            setShowVoiceInput(false);
          }}
          style={{
            display: 'flex',
            alignItems: textInputPosition ? 'flex-start' : 'center',
            justifyContent: 'center',
            paddingTop: textInputPosition 
              ? `${Math.min(Math.max(textInputPosition.y + 150, 20), typeof window !== 'undefined' ? window.innerHeight - 400 : 400)}px`
              : undefined,
          }}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">音声入力</h2>
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
            <p className="text-sm text-slate-600 mb-4">マイクに向かって話してください</p>
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
      </div>
    </div>
  );
}
