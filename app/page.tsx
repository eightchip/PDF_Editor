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
// PDF.jsの型は動的インポートで取得

export default function Home() {
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [docId, setDocId] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [originalPdfBytes, setOriginalPdfBytes] = useState<ArrayBuffer | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  const [isExporting, setIsExporting] = useState(false);
  const [pageRotation, setPageRotation] = useState(0); // 0, 90, 180, 270
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [showThumbnails, setShowThumbnails] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<number, string>>({});
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showAnnotationList, setShowAnnotationList] = useState(false);


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

  // 画像ファイル選択時の処理（PDF変換後に回転するため、プレビューは不要）
  const handleImageFileSelect = (file: File) => {
    // 画像を直接PDFに変換（回転はPDF表示後にpageRotationで行う）
    const convertAndLoad = async () => {
      try {
        const arrayBuffer = await convertImageToPDF(file, 0);
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        const pdfFile = new File([blob], file.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });

        const id = await generateDocId(pdfFile);
        setDocId(id);
        
        setOriginalPdfBytes(arrayBuffer);
        
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
        alert('画像の変換に失敗しました: ' + (error instanceof Error ? error.message : String(error)));
      }
    };
    
    convertAndLoad();
  };


  // ファイル選択（PDFまたは画像）
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 画像ファイルの場合は回転UIを表示
    if (file.type.startsWith('image/')) {
      handleImageFileSelect(file);
      return;
    }

    // PDFファイルの場合は直接読み込む
    if (file.type === 'application/pdf') {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const id = await generateDocId(file);
        setDocId(id);
        
        setOriginalPdfBytes(arrayBuffer);
        
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
        alert('ファイルの読み込みに失敗しました: ' + (error instanceof Error ? error.message : String(error)));
      }
    } else {
      alert('PDFファイルまたは画像ファイル（PNG、JPEG、WebPなど）を選択してください');
    }
  };

  // ページレンダリング
  const renderCurrentPage = async () => {
    if (!pdfDoc || !pdfCanvasRef.current || !inkCanvasRef.current) return;

    try {
      const page = await pdfDoc.getPage(currentPage);
      const pdfCanvas = pdfCanvasRef.current;
      const inkCanvas = inkCanvasRef.current;

      // PDFをレンダリング
      const size = await renderPage(page, pdfCanvas, scale, pageRotation);
      setPageSize(size);
      
      // ページサイズを記録（エクスポート用、scale=1.0でのサイズ）
      if (scale === 1.0) {
        setPageSizes(prev => ({ ...prev, [currentPage]: size }));
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
        const savedStrokes = await loadAnnotations(docId, currentPage);
        // 既存のストロークにIDがない場合は生成
        const strokesWithIds = savedStrokes.map(stroke => ({
          ...stroke,
          id: stroke.id || `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        }));
        setStrokes(strokesWithIds);
        setUndoStack([]);
        setRedoStack([]);

        // テキスト注釈を読み込み
        const savedTexts = await loadTextAnnotations(docId, currentPage);
        setTextAnnotations(savedTexts);

        // 図形注釈を読み込み
        const savedShapes = await loadShapeAnnotations(docId, currentPage);
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

  // 自動保存機能（30秒ごと）
  useEffect(() => {
    if (!docId || !pdfDoc) return;

    const autoSaveInterval = setInterval(async () => {
      if (isSaving) return; // 既に保存中の場合はスキップ

      try {
        setIsSaving(true);
        await saveAnnotations(docId, currentPage, strokes);
        await saveShapeAnnotations(docId, currentPage, shapeAnnotations);
        await saveTextAnnotations(docId, currentPage, textAnnotations);
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
          saveAnnotations(docId, currentPage, newStrokes);
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
        
      // 再描画（inkCanvasRefをクリアしてから再描画）
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
    
    // 選択ツールの場合は絶対に描画しない（最終チェック）
    if (tool === 'select') {
      isDrawingRef.current = false;
      setCurrentStroke(null);
      setCurrentShape(null);
      return;
    }
    
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
        await saveAnnotations(docId, currentPage, movedStrokes);
        await saveShapeAnnotations(docId, currentPage, movedShapes);
        await saveTextAnnotations(docId, currentPage, movedTexts);
        
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
    
    // 選択ツールでない場合のみ描画処理を実行
    if (tool === 'select') {
      isDrawingRef.current = false;
      setCurrentStroke(null);
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
      await saveShapeAnnotations(docId, currentPage, newShapes);

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
    await saveAnnotations(docId, currentPage, newStrokes);

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

  // Undo
  const handleUndo = async () => {
    if (undoStack.length === 0 || !docId) return;

    const previousState = undoStack[undoStack.length - 1];
    setRedoStack([...redoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    setUndoStack(undoStack.slice(0, -1));
    setStrokes(previousState.strokes);
    setShapeAnnotations(previousState.shapes);
    setTextAnnotations(previousState.texts);

    await saveAnnotations(docId, currentPage, previousState.strokes);
    await saveShapeAnnotations(docId, currentPage, previousState.shapes);
    await saveTextAnnotations(docId, currentPage, previousState.texts);

    // 再描画
    if (inkCanvasRef.current && pageSize) {
      const ctx = inkCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        redrawStrokes(ctx, previousState.strokes, pageSize.width, pageSize.height);
      }
    }
    if (shapeCanvasRef.current && pageSize) {
      const ctx = shapeCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        redrawShapeAnnotations(ctx, previousState.shapes, pageSize.width, pageSize.height);
      }
    }
    if (textCanvasRef.current && pageSize) {
      const ctx = textCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        redrawTextAnnotations(ctx, previousState.texts, pageSize.width, pageSize.height);
      }
    }
  };

  // Redo
  const handleRedo = async () => {
    if (redoStack.length === 0 || !docId) return;

    const nextState = redoStack[redoStack.length - 1];
    setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations, texts: textAnnotations }]);
    setRedoStack(redoStack.slice(0, -1));
    setStrokes(nextState.strokes);
    setShapeAnnotations(nextState.shapes);
    setTextAnnotations(nextState.texts);

    await saveAnnotations(docId, currentPage, nextState.strokes);
    await saveShapeAnnotations(docId, currentPage, nextState.shapes);
    await saveTextAnnotations(docId, currentPage, nextState.texts);

    // 再描画
    if (inkCanvasRef.current && pageSize) {
      const ctx = inkCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        redrawStrokes(ctx, nextState.strokes, pageSize.width, pageSize.height);
      }
    }
    if (shapeCanvasRef.current && pageSize) {
      const ctx = shapeCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        redrawShapeAnnotations(ctx, nextState.shapes, pageSize.width, pageSize.height);
      }
    }
    if (textCanvasRef.current && pageSize) {
      const ctx = textCanvasRef.current.getContext('2d');
      if (ctx) {
        const devicePixelRatio = window.devicePixelRatio || 1;
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        redrawTextAnnotations(ctx, nextState.texts, pageSize.width, pageSize.height);
      }
    }
  };

  // 選択した注釈を削除
  const handleDeleteSelected = async () => {
    if (!docId || !pageSize) return;

    // Undoスタックに追加
    setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations }]);
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
    await saveAnnotations(docId, currentPage, newStrokes);
    await saveShapeAnnotations(docId, currentPage, newShapes);
    await saveTextAnnotations(docId, currentPage, newTexts);

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

    setUndoStack([...undoStack, { strokes, shapes: shapeAnnotations }]);
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
    if (!docId || !pageSize || !textInputPosition || !textInputValue.trim()) {
      setTextInputPosition(null);
      setTextInputValue('');
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
    await saveTextAnnotations(docId, currentPage, updatedTexts);

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
    await saveTextAnnotations(docId, currentPage, updatedTexts);

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

  // 注釈付きPDFをエクスポート
  const handleExport = async () => {
    if (!docId || !originalPdfBytes || !pdfDoc) {
      alert('PDFが読み込まれていません');
      return;
    }

    setIsExporting(true);
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

      // ダウンロード
      const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `annotated_${docId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert('注釈付きPDFをエクスポートしました');
    } catch (error) {
      console.error('エクスポートエラー:', error);
      alert('エクスポートに失敗しました: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsExporting(false);
    }
  };

  // 注釈をJSON形式でエクスポート
  const handleExportJSON = async () => {
    if (!docId || !totalPages) {
      alert('PDFが読み込まれていません');
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

      alert('注釈をJSON形式でエクスポートしました');
    } catch (error) {
      console.error('JSONエクスポートエラー:', error);
      alert('エクスポートに失敗しました: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // 注釈をJSON形式でインポート
  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== 'application/json') {
      alert('JSONファイルを選択してください');
      return;
    }

    try {
      const text = await file.text();
      const importData = importAnnotationsFromJSON(text);

      // 現在のPDFと一致するか確認
      if (importData.docId !== docId) {
        const confirmImport = confirm(
          `インポートする注釈は別のPDF（ID: ${importData.docId}）のものです。\n` +
          `現在のPDF（ID: ${docId}）に上書きしますか？`
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

      alert(`${importedCount}ページの注釈をインポートしました`);
    } catch (error) {
      console.error('JSONインポートエラー:', error);
      alert('インポートに失敗しました: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      // ファイル入力をリセット
      e.target.value = '';
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: '20px' }}>PDF注釈アプリ</h1>

      {/* ファイル選択 */}
      <div
        style={{
          marginBottom: '20px',
          padding: '20px',
          border: '2px dashed #ccc',
          borderRadius: '8px',
          backgroundColor: '#f9f9f9',
          textAlign: 'center',
        }}
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
            const file = files[0];
            if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
              // handleFileSelectと同じ処理を実行
              if (file.type.startsWith('image/')) {
                handleImageFileSelect(file);
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
                } catch (error) {
                  console.error('ファイル読み込みエラー:', error);
                  alert('ファイルの読み込みに失敗しました: ' + (error instanceof Error ? error.message : String(error)));
                }
              }
            } else {
              alert('PDFファイルまたは画像ファイルを選択してください');
            }
          }
        }}
      >
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/jpg,image/webp,image/gif"
          onChange={handleFileSelect}
          style={{ marginBottom: '10px' }}
        />
        <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
          PDFファイルまたは画像ファイル（PNG、JPEG、WebP、GIF）を選択できます。画像ファイルは自動的にPDFに変換されます。
        </div>
        <div style={{ fontSize: '12px', color: '#999', marginTop: '5px' }}>
          または、ファイルをここにドラッグ&ドロップしてください
        </div>
      </div>


      {/* キーボードショートカット一覧 */}
      {showKeyboardShortcuts && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            zIndex: 10000,
            maxWidth: '500px',
            maxHeight: '80vh',
            overflow: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{ margin: 0 }}>キーボードショートカット</h2>
            <button
              onClick={() => setShowKeyboardShortcuts(false)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                padding: '0',
                width: '30px',
                height: '30px',
              }}
            >
              ×
            </button>
        </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div><strong>Ctrl+Z</strong></div>
            <div>Undo（元に戻す）</div>
            <div><strong>Ctrl+Y / Ctrl+Shift+Z</strong></div>
            <div>Redo（やり直し）</div>
            <div><strong>Ctrl+S</strong></div>
            <div>PDFエクスポート</div>
            <div><strong>Delete / Backspace</strong></div>
            <div>選択した注釈を削除</div>
            <div><strong>←</strong></div>
            <div>前のページ</div>
            <div><strong>→</strong></div>
            <div>次のページ</div>
          </div>
        </div>
      )}

      {pdfDoc && (
        <div>
          {/* サムネイル表示 */}
          {showThumbnails && (
            <div
              style={{
                position: 'fixed',
                left: 0,
                top: 0,
                bottom: 0,
                width: '200px',
                backgroundColor: '#f5f5f5',
                borderRight: '1px solid #ddd',
                overflowY: 'auto',
                padding: '10px',
                zIndex: 1000,
              }}
            >
              <div style={{ marginBottom: '10px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>ページ一覧</span>
                <button
                  onClick={() => setShowThumbnails(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '20px',
                    cursor: 'pointer',
                    padding: '0',
                    width: '24px',
                    height: '24px',
                  }}
                >
                  ×
                </button>
              </div>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <div
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  style={{
                    marginBottom: '10px',
                    padding: '5px',
                    backgroundColor: currentPage === pageNum ? '#e3f2fd' : 'white',
                    border: currentPage === pageNum ? '2px solid #2196F3' : '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  {thumbnails[pageNum] ? (
                    <img
                      src={thumbnails[pageNum]}
                      alt={`ページ ${pageNum}`}
                      style={{
                        width: '100%',
                        height: 'auto',
                        display: 'block',
                        marginBottom: '5px',
                      }}
                    />
                  ) : (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#999', fontSize: '12px' }}>
                      読み込み中...
                    </div>
                  )}
                  <div style={{ fontSize: '12px', fontWeight: currentPage === pageNum ? 'bold' : 'normal' }}>
                    ページ {pageNum}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ページ操作 */}
          <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginLeft: showThumbnails ? '210px' : '0', transition: 'margin-left 0.3s' }}>
            <button
              onClick={() => setShowThumbnails(!showThumbnails)}
              style={{ padding: '5px 15px', backgroundColor: showThumbnails ? '#0070f3' : '#6c757d', color: 'white' }}
            >
              {showThumbnails ? '📑 サムネイル非表示' : '📑 サムネイル表示'}
            </button>
            <button
              onClick={goToPrevPage}
              disabled={currentPage === 1}
              style={{ padding: '5px 15px' }}
            >
              前へ
            </button>
            <span>
              ページ {currentPage} / {totalPages}
            </span>
            <button
              onClick={goToNextPage}
              disabled={currentPage === totalPages}
              style={{ padding: '5px 15px' }}
            >
              次へ
            </button>
            <span style={{ marginLeft: '10px' }}>|</span>
            <button
              onClick={() => setPageRotation((prev) => (prev + 90) % 360)}
              style={{ padding: '5px 15px', backgroundColor: '#4CAF50', color: 'white' }}
            >
              ↻ 回転 ({pageRotation}°)
            </button>
        </div>

          {/* ズーム */}
          <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span>ズーム:</span>
            <button
              onClick={() => setScale(0.75)}
              style={{ padding: '5px 15px' }}
            >
              75%
            </button>
            <button
              onClick={() => setScale(1.0)}
              style={{ padding: '5px 15px' }}
            >
              100%
            </button>
            <button
              onClick={() => setScale(1.25)}
              style={{ padding: '5px 15px' }}
            >
              125%
            </button>
          </div>

          {/* ツールバー */}
          <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginLeft: showThumbnails ? '210px' : '0', transition: 'margin-left 0.3s' }}>
            <div>
              <button
                onClick={() => setTool('pen')}
                style={{
                  padding: '5px 15px',
                  backgroundColor: tool === 'pen' ? '#0070f3' : '#f0f0f0',
                  color: tool === 'pen' ? 'white' : 'black',
                }}
              >
                ペン
              </button>
              <button
                onClick={() => setTool('eraser')}
                style={{
                  padding: '5px 15px',
                  backgroundColor: tool === 'eraser' ? '#0070f3' : '#f0f0f0',
                  color: tool === 'eraser' ? 'white' : 'black',
                }}
              >
                消しゴム
              </button>
              <button
                onClick={() => setTool('text')}
                style={{
                  padding: '5px 15px',
                  backgroundColor: tool === 'text' ? '#0070f3' : '#f0f0f0',
                  color: tool === 'text' ? 'white' : 'black',
                }}
              >
                テキスト
              </button>
              <button
                onClick={() => setTool('line')}
                style={{
                  padding: '5px 15px',
                  backgroundColor: tool === 'line' ? '#0070f3' : '#f0f0f0',
                  color: tool === 'line' ? 'white' : 'black',
                }}
              >
                線
              </button>
              <button
                onClick={() => setTool('rectangle')}
                style={{
                  padding: '5px 15px',
                  backgroundColor: tool === 'rectangle' ? '#0070f3' : '#f0f0f0',
                  color: tool === 'rectangle' ? 'white' : 'black',
                }}
              >
                矩形
              </button>
              <button
                onClick={() => setTool('circle')}
                style={{
                  padding: '5px 15px',
                  backgroundColor: tool === 'circle' ? '#0070f3' : '#f0f0f0',
                  color: tool === 'circle' ? 'white' : 'black',
                }}
              >
                円
              </button>
              <button
                onClick={() => setTool('arrow')}
                style={{
                  padding: '5px 15px',
                  backgroundColor: tool === 'arrow' ? '#0070f3' : '#f0f0f0',
                  color: tool === 'arrow' ? 'white' : 'black',
                }}
              >
                矢印
              </button>
              <button
                onClick={() => setTool('highlight')}
                style={{
                  padding: '5px 15px',
                  backgroundColor: tool === 'highlight' ? '#0070f3' : '#f0f0f0',
                  color: tool === 'highlight' ? 'white' : 'black',
                }}
              >
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
                style={{
                  padding: '5px 15px',
                  backgroundColor: tool === 'select' ? '#0070f3' : '#f0f0f0',
                  color: tool === 'select' ? 'white' : 'black',
                }}
                title="選択ツール: 注釈をクリックで選択、Ctrl+クリックで複数選択、Deleteキーで削除、ドラッグで移動"
              >
                選択
              </button>
              <button
                onClick={() => setShowAnnotationList(!showAnnotationList)}
                style={{
                  padding: '5px 15px',
                  backgroundColor: showAnnotationList ? '#0070f3' : '#6c757d',
                  color: 'white',
                }}
                title="注釈一覧を表示/非表示"
              >
                📋 注釈一覧
              </button>
            </div>

            {(tool === 'pen' || tool === 'highlight') && (
              <>
                <label>
                  色:
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    style={{ marginLeft: '5px' }}
                  />
                </label>
                {tool === 'pen' && (
                  <label>
                    太さ:
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={width}
                      onChange={(e) => setWidth(Number(e.target.value))}
                      style={{ marginLeft: '5px' }}
                    />
                    <span style={{ marginLeft: '5px' }}>{width}px</span>
                  </label>
                )}
                {tool === 'highlight' && (
                  <label>
                    モード:
                    <select
                      value={highlightMode}
                      onChange={(e) => setHighlightMode(e.target.value as 'auto' | 'manual')}
                      style={{ marginLeft: '5px', padding: '2px 5px' }}
                    >
                      <option value="auto">自動（クリックで文字列全体）</option>
                      <option value="manual">手動（ドラッグで範囲指定）</option>
                    </select>
                  </label>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={smoothStrokeEnabled}
                    onChange={(e) => setSmoothStrokeEnabled(e.target.checked)}
                    style={{ marginLeft: '5px' }}
                  />
                  ストローク平滑化
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={snapToTextEnabled}
                    onChange={(e) => setSnapToTextEnabled(e.target.checked)}
                    style={{ marginLeft: '5px' }}
                  />
                  テキストスナップ
                </label>
              </>
            )}

            {tool === 'text' && (
              <>
                <label>
                  色:
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    style={{ marginLeft: '5px' }}
                  />
                </label>
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
              <>
                <label>
                  色:
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    style={{ marginLeft: '5px' }}
                  />
                </label>
                <label>
                  太さ:
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={width}
                    onChange={(e) => setWidth(Number(e.target.value))}
                    style={{ marginLeft: '5px' }}
                  />
                  <span style={{ marginLeft: '5px' }}>{width}px</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={fillShape}
                    onChange={(e) => setFillShape(e.target.checked)}
                    style={{ marginLeft: '5px' }}
                  />
                  塗りつぶし
                </label>
              </>
            )}

            {tool === 'eraser' && (
              <label>
                消しゴムサイズ:
                <input
                  type="range"
                  min="5"
                  max="30"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  style={{ marginLeft: '5px' }}
                />
                <span style={{ marginLeft: '5px' }}>{width}px</span>
              </label>
            )}
          </div>

          {/* 操作ボタン */}
          <div style={{ marginBottom: '10px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginLeft: showThumbnails ? '210px' : '0', transition: 'margin-left 0.3s' }}>
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              style={{ padding: '5px 15px' }}
            >
              Undo
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              style={{ padding: '5px 15px' }}
            >
              Redo
            </button>
            <button
              onClick={handleClear}
              style={{ padding: '5px 15px', backgroundColor: '#ff4444', color: 'white' }}
            >
              Clear
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || !pdfDoc}
              style={{
                padding: '5px 15px',
                backgroundColor: isExporting || !pdfDoc ? '#ccc' : '#28a745',
                color: 'white',
                cursor: isExporting || !pdfDoc ? 'not-allowed' : 'pointer',
              }}
            >
              {isExporting ? 'エクスポート中...' : 'PDFエクスポート'}
            </button>
            <button
              onClick={handleExportJSON}
              disabled={!pdfDoc}
              style={{
                padding: '5px 15px',
                backgroundColor: !pdfDoc ? '#ccc' : '#17a2b8',
                color: 'white',
                cursor: !pdfDoc ? 'not-allowed' : 'pointer',
              }}
            >
              JSONエクスポート
            </button>
            <button
              onClick={() => setShowKeyboardShortcuts(!showKeyboardShortcuts)}
              style={{
                padding: '5px 15px',
                backgroundColor: '#6c757d',
                color: 'white',
                cursor: 'pointer',
              }}
              title="キーボードショートカット"
            >
              ⌨️ ショートカット
            </button>
            <label
              style={{
                padding: '5px 15px',
                backgroundColor: !pdfDoc ? '#ccc' : '#6c757d',
                color: 'white',
                cursor: !pdfDoc ? 'not-allowed' : 'pointer',
                display: 'inline-block',
              }}
            >
              <input
                type="file"
                accept="application/json"
                onChange={handleImportJSON}
                disabled={!pdfDoc}
                style={{ display: 'none' }}
              />
              JSONインポート
            </label>
          </div>

          {/* PDF表示領域 */}
          <div
            ref={containerRef}
            style={{
              position: 'relative',
              display: 'inline-block',
              border: '1px solid #ccc',
              backgroundColor: '#f5f5f5',
              marginLeft: showThumbnails ? '210px' : '0',
              marginRight: showAnnotationList ? '260px' : '0',
              transition: 'margin-left 0.3s, margin-right 0.3s',
            }}
          >
            <canvas
              ref={pdfCanvasRef}
              style={{ display: 'block' }}
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
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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
                    // フォーカスが別の要素に移った場合のみ確定
                    if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) {
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
                  placeholder="テキストを入力（Ctrl+Enterで確定、Escでキャンセル）"
                />
                <div style={{ marginTop: '4px', display: 'flex', gap: '4px' }}>
                  <button
                    onClick={handleTextSubmit}
                    style={{ padding: '4px 8px', fontSize: '12px' }}
                  >
                    確定
                  </button>
                  <button
                    onClick={() => {
                      if (editingTextId) {
                        handleDeleteText(editingTextId);
                      }
                      setTextInputPosition(null);
                      setTextInputValue('');
                      setEditingTextId(null);
                    }}
                    style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: '#ff4444', color: 'white' }}
                  >
                    削除
                  </button>
                  <button
                    onClick={() => {
                      setTextInputPosition(null);
                      setTextInputValue('');
                      setEditingTextId(null);
                    }}
                    style={{ padding: '4px 8px', fontSize: '12px' }}
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 右側注釈一覧パネル */}
      {pdfDoc && showAnnotationList && (
        <div
          style={{
            position: 'fixed',
            right: 0,
            top: 0,
            bottom: 0,
            width: '250px',
            backgroundColor: '#f5f5f5',
            borderLeft: '1px solid #ddd',
            overflowY: 'auto',
            padding: '10px',
            zIndex: 1000,
          }}
        >
          <div style={{ marginBottom: '10px', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>注釈一覧（ページ {currentPage}）</span>
            <button
              onClick={() => setShowAnnotationList(false)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '20px',
                cursor: 'pointer',
                padding: '0',
                width: '24px',
                height: '24px',
              }}
            >
              ×
            </button>
          </div>
          
          {/* ストローク一覧 */}
          {strokes.length > 0 && (
            <div style={{ marginBottom: '15px' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '5px' }}>ペン/ハイライト ({strokes.length})</div>
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
                  style={{
                    padding: '5px',
                    marginBottom: '3px',
                    backgroundColor: selectedAnnotationIds.strokes.includes(stroke.id || '') ? '#e3f2fd' : 'white',
                    border: selectedAnnotationIds.strokes.includes(stroke.id || '') ? '2px solid #2196F3' : '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>ストローク {index + 1}</span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (stroke.id && docId && pageSize) {
                        const newStrokes = strokes.filter(s => s.id !== stroke.id);
                        // 状態を同期的に更新（注釈一覧の表示を即座に更新するため）
                        setStrokes(newStrokes);
                        await saveAnnotations(docId, currentPage, newStrokes);
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
                    style={{
                      background: '#ff4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      padding: '2px 6px',
                      fontSize: '10px',
                      cursor: 'pointer',
                    }}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 図形一覧 */}
          {shapeAnnotations.length > 0 && (
            <div style={{ marginBottom: '15px' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '5px' }}>図形 ({shapeAnnotations.length})</div>
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
                  style={{
                    padding: '5px',
                    marginBottom: '3px',
                    backgroundColor: selectedAnnotationIds.shapes.includes(shape.id) ? '#e3f2fd' : 'white',
                    border: selectedAnnotationIds.shapes.includes(shape.id) ? '2px solid #2196F3' : '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span>{shape.type === 'line' ? '線' : shape.type === 'rectangle' ? '矩形' : shape.type === 'circle' ? '円' : '矢印'} {index + 1}</span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (docId && pageSize) {
                        const newShapes = shapeAnnotations.filter(s => s.id !== shape.id);
                        // 状態を同期的に更新（注釈一覧の表示を即座に更新するため）
                        setShapeAnnotations(newShapes);
                        await saveShapeAnnotations(docId, currentPage, newShapes);
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
                    style={{
                      background: '#ff4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      padding: '2px 6px',
                      fontSize: '10px',
                      cursor: 'pointer',
                    }}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* テキスト一覧 */}
          {textAnnotations.length > 0 && (
            <div style={{ marginBottom: '15px' }}>
              <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '5px' }}>テキスト ({textAnnotations.length})</div>
              {textAnnotations.map((text, index) => (
                <div
                  key={text.id}
                  onClick={() => {
                    setSelectedAnnotationIds(prev => ({
                      strokes: prev.strokes,
                      shapes: prev.shapes,
                      texts: prev.texts.includes(text.id) ? prev.texts.filter(id => id !== text.id) : [...prev.texts, text.id],
                    }));
                  }}
                  style={{
                    padding: '5px',
                    marginBottom: '3px',
                    backgroundColor: selectedAnnotationIds.texts.includes(text.id) ? '#e3f2fd' : 'white',
                    border: selectedAnnotationIds.texts.includes(text.id) ? '2px solid #2196F3' : '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '150px' }}>
                    {text.text.substring(0, 20)}{text.text.length > 20 ? '...' : ''}
                  </span>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (docId && pageSize) {
                        const newTexts = textAnnotations.filter(t => t.id !== text.id);
                        // 状態を同期的に更新（注釈一覧の表示を即座に更新するため）
                        setTextAnnotations(newTexts);
                        await saveTextAnnotations(docId, currentPage, newTexts);
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
                    style={{
                      background: '#ff4444',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      padding: '2px 6px',
                      fontSize: '10px',
                      cursor: 'pointer',
                    }}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}

          {strokes.length === 0 && shapeAnnotations.length === 0 && textAnnotations.length === 0 && (
            <div style={{ color: '#999', fontSize: '12px', textAlign: 'center', padding: '20px' }}>
              このページには注釈がありません
            </div>
          )}
        </div>
      )}
    </div>
  );
}
