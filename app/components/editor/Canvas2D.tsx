import { useRef, useEffect, useState, useCallback } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { SKIN_WIDTH, SKIN_HEIGHT, getSkinParts, type SkinRegion, type RGBA, type ToolType } from '../../types/editor';
import {
  renderSkinToCanvas,
  drawGrid,
  drawCheckerboard,
  drawLayerHighlight,
  getPixelFromMouse,
  CHECKER_COLORS,
} from '@lib/skinRenderer';
import { Button } from '@components/ui/button';
import { ButtonGroup } from '@components/ui/button-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip';
import { ZoomIn, ZoomOut, RotateCw, Grid3X3, Pipette } from 'lucide-react';
import { ViewHint, type HintItem } from './ViewHint';
import { TOOLS } from './Toolbar';
import { CanvasBackgroundMenu } from './CanvasBackgroundPicker';

const DEFAULT_SCALE = 8;
const MIN_SCALE = 2;
const MAX_SCALE = 32;
// キャンバスの周りの余白（表示領域の p-4、枠の p-2 と罫線）
const CANVAS_FRAME_PADDING = 2 * (16 + 8 + 1);

// 表示領域に収まる倍率。既定の倍率より大きくはしない（広い画面ではこれまでどおり 8x）
export function fitScale(width: number, height: number): number {
  const fit = Math.floor(Math.min(width - CANVAS_FRAME_PADDING, height - CANVAS_FRAME_PADDING) / SKIN_WIDTH);
  return Math.max(MIN_SCALE, Math.min(DEFAULT_SCALE, fit));
}

export function Canvas2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const highlightCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  // 拡大・縮小の操作をするまでは、表示領域の大きさに合わせて倍率を決める
  const userZoomedRef = useRef(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(null);
  const [rectEnd, setRectEnd] = useState<{ x: number; y: number } | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<SkinRegion | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);

  // Use individual selectors to minimize re-renders
  const activeTool = useEditorStore((state) => state.activeTool);
  const activeLayerId = useEditorStore((state) => state.activeLayerId);
  const highlightedLayerId = useEditorStore((state) => state.highlightedLayerId);
  const setPixel = useEditorStore((state) => state.setPixel);
  const setPixelRect = useEditorStore((state) => state.setPixelRect);
  const commitDrawing = useEditorStore((state) => state.commitDrawing);
  const modelType = useEditorStore((state) => state.modelType);
  const drawingColor = useEditorStore((state) => state.drawingColor);
  const previewVersion = useEditorStore((state) => state.previewVersion);
  const canvasBackground = useEditorStore((state) => state.canvasBackground);
  const layerColorPickTarget = useEditorStore((state) => state.layerColorPickTarget);
  const endLayerColorPick = useEditorStore((state) => state.endLayerColorPick);

  // Only get layers when needed for highlight or active layer info (not for rendering)
  const layers = useEditorStore((state) => state.layers);

  // レイヤー基本色の取得中（対象レイヤーが存在する場合のみ）
  const pickTargetLayerName = layerColorPickTarget
    ? layers.find((l) => l.id === layerColorPickTarget)?.name ?? null
    : null;
  const isPickingLayerColor = pickTargetLayerName !== null;

  // 基本色の取得中は Esc でキャンセル（ダイアログに戻る）
  useEffect(() => {
    if (!isPickingLayerColor) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endLayerColorPick();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPickingLayerColor, endLayerColorPick]);

  // Get skin parts for current model type
  const skinParts = getSkinParts(modelType);

  // Render canvas with requestAnimationFrame batching
  useEffect(() => {
    // Cancel any pending animation frame
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    // Schedule the render on the next animation frame
    rafIdRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Set canvas size
      canvas.width = SKIN_WIDTH * scale;
      canvas.height = SKIN_HEIGHT * scale;

      // Disable image smoothing for crisp pixels
      ctx.imageSmoothingEnabled = false;

      // Draw background (transparency indicator)
      if (canvasBackground.type === 'checker') {
        const [c1, c2] = CHECKER_COLORS[canvasBackground.variant];
        drawCheckerboard(ctx, canvas.width, canvas.height, scale, 2, c1, c2);
      } else {
        ctx.fillStyle = canvasBackground.color;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Get the composite and draw it
      const composite = useEditorStore.getState().getComposite();
      renderSkinToCanvas(ctx, composite, scale);

      // Draw grid
      drawGrid(ctx, scale);

      // Draw rectangle preview
      if (rectStart && rectEnd && (activeTool === 'rectangle' || activeTool === 'rectangleEraser')) {
        const minX = Math.min(rectStart.x, rectEnd.x);
        const maxX = Math.max(rectStart.x, rectEnd.x);
        const minY = Math.min(rectStart.y, rectEnd.y);
        const maxY = Math.max(rectStart.y, rectEnd.y);

        const isErasing = activeTool === 'rectangleEraser';
        ctx.strokeStyle = isErasing ? 'rgba(255, 60, 60, 0.8)' : 'rgba(0, 120, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          minX * scale,
          minY * scale,
          (maxX - minX + 1) * scale,
          (maxY - minY + 1) * scale
        );

        ctx.fillStyle = isErasing ? 'rgba(255, 60, 60, 0.2)' : 'rgba(0, 120, 255, 0.2)';
        ctx.fillRect(
          minX * scale,
          minY * scale,
          (maxX - minX + 1) * scale,
          (maxY - minY + 1) * scale
        );
      }

      rafIdRef.current = null;
    });

    // Cleanup on unmount
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [previewVersion, scale, rectStart, rectEnd, activeTool, canvasBackground]);

  // Draw layer highlight on separate canvas (lightweight, only redraws on highlight change)
  useEffect(() => {
    const highlightCanvas = highlightCanvasRef.current;
    if (!highlightCanvas) return;

    const ctx = highlightCanvas.getContext('2d');
    if (!ctx) return;

    highlightCanvas.width = SKIN_WIDTH * scale;
    highlightCanvas.height = SKIN_HEIGHT * scale;

    ctx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

    if (highlightedLayerId) {
      const highlightedLayer = layers.find(l => l.id === highlightedLayerId);
      if (highlightedLayer) {
        drawLayerHighlight(ctx, highlightedLayer, scale);
      }
    }
  }, [highlightedLayerId, scale, layers]);

  // Draw overlay with skin part labels
  useEffect(() => {
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas || !showOverlay) return;

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    overlayCanvas.width = SKIN_WIDTH * scale;
    overlayCanvas.height = SKIN_HEIGHT * scale;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Draw part boundaries and labels
    for (const part of skinParts) {
      const x = part.x * scale;
      const y = part.y * scale;
      const w = part.width * scale;
      const h = part.height * scale;

      // Draw border
      ctx.strokeStyle = part.layer === 1 ? 'rgba(59, 130, 246, 0.5)' : 'rgba(168, 85, 247, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      // Highlight hovered region
      if (hoveredRegion && hoveredRegion.name === part.name) {
        ctx.fillStyle = part.layer === 1 ? 'rgba(59, 130, 246, 0.2)' : 'rgba(168, 85, 247, 0.2)';
        ctx.fillRect(x, y, w, h);
      }
    }
  }, [scale, showOverlay, hoveredRegion, skinParts]);

  // Get skin region at position
  const getSkinRegionAt = useCallback((x: number, y: number): SkinRegion | null => {
    for (const part of skinParts) {
      if (
        x >= part.x &&
        x < part.x + part.width &&
        y >= part.y &&
        y < part.y + part.height
      ) {
        return part;
      }
    }
    return null;
  }, [skinParts]);

  // Get the color to use for drawing
  const getDrawColor = useCallback((): RGBA => {
    // Get the active layer to check its type
    const activeLayer = layers.find(l => l.id === activeLayerId);
    if (activeLayer && activeLayer.layerType === 'singleColor') {
      // For singleColor layers, use the layer's baseColor
      return activeLayer.baseColor;
    }
    // For direct layers or no active layer, use the drawing color
    return drawingColor;
  }, [activeLayerId, layers, drawingColor]);

  // Paint a single pixel directly on the canvas for immediate feedback (bypasses React re-render)
  const drawPixelDirect = useCallback((canvas: HTMLCanvasElement, px: number, py: number, color: RGBA | null) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (color === null) {
      ctx.clearRect(px * scale, py * scale, scale, scale);
    } else {
      ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`;
      ctx.fillRect(px * scale, py * scale, scale, scale);
    }
  }, [scale]);

  // Handle mouse events
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Middle mouse button - do nothing
      if (e.button === 1) {
        e.preventDefault();
        return;
      }

      // Right mouse button for panning
      if (e.button === 2) {
        e.preventDefault();
        setIsPanning(true);
        setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const pos = getPixelFromMouse(e.nativeEvent, canvas, scale);
      if (!pos) return;

      if (activeTool === 'eyedropper') {
        // Pick color from composite（透明ピクセルならスポイトのまま）
        const { getComposite, applyPickedColor } = useEditorStore.getState();
        const pixel = getComposite()[pos.y][pos.x];
        if (pixel.a > 0) {
          applyPickedColor(pixel);
        }
        return;
      }

      if (activeTool === 'rectangle' || activeTool === 'rectangleEraser') {
        setRectStart(pos);
        setRectEnd(pos);
        setIsDrawing(true);
        return;
      }

      // Pencil or eraser
      setIsDrawing(true);
      const color = activeTool === 'eraser' ? null : getDrawColor();
      setPixel(pos.x, pos.y, color);
      drawPixelDirect(canvas, pos.x, pos.y, color);
    },
    [activeTool, scale, setPixel, panOffset, getDrawColor, drawPixelDirect]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Handle panning
      if (isPanning) {
        setPanOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const pos = getPixelFromMouse(e.nativeEvent, canvas, scale);

      // Update hovered region
      if (pos) {
        const region = getSkinRegionAt(pos.x, pos.y);
        setHoveredRegion(region);
      } else {
        setHoveredRegion(null);
      }

      if (!isDrawing) return;
      if (!pos) return;

      if (activeTool === 'rectangle' || activeTool === 'rectangleEraser') {
        setRectEnd(pos);
        return;
      }

      // Pencil or eraser
      const color = activeTool === 'eraser' ? null : getDrawColor();
      setPixel(pos.x, pos.y, color);
      drawPixelDirect(canvas, pos.x, pos.y, color);
    },
    [isDrawing, isPanning, activeTool, scale, setPixel, panStart, getSkinRegionAt, getDrawColor, drawPixelDirect]
  );

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if ((activeTool === 'rectangle' || activeTool === 'rectangleEraser') && rectStart && rectEnd) {
      const color = activeTool === 'rectangleEraser' ? null : getDrawColor();
      setPixelRect(
        rectStart.x,
        rectStart.y,
        rectEnd.x,
        rectEnd.y,
        color
      );
      // setPixelRect already increments previewVersion
    } else if (isDrawing) {
      // Commit drawing to update 3D preview
      commitDrawing();
    }

    setIsDrawing(false);
    setRectStart(null);
    setRectEnd(null);
  }, [isPanning, activeTool, rectStart, rectEnd, setPixelRect, isDrawing, commitDrawing, getDrawColor]);

  // 表示領域の大きさが変わったら（画面の回転・パネル幅の変更など）収まる倍率にする
  const fitToContainer = useCallback((fallback?: number) => {
    const container = containerRef.current;
    // 非表示のタブ内では大きさが 0 になるので、fallback がなければ何もしない
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      setScale(fitScale(container.clientWidth, container.clientHeight));
    } else if (fallback !== undefined) {
      setScale(fallback);
    }
  }, []);

  // 拡大・縮小（以降は表示領域の大きさに合わせない）
  const zoomBy = useCallback((delta: number) => {
    userZoomedRef.current = true;
    setScale((prev) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta)));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!userZoomedRef.current) fitToContainer();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitToContainer]);

  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY > 0 ? -1 : 1);
  }, [zoomBy]);

  // Zoom handlers
  const handleZoomIn = () => zoomBy(2);
  const handleZoomOut = () => zoomBy(-2);
  // 表示をリセット: 表示領域に収まる倍率と中央の位置に戻し、以降も大きさに合わせる
  const handleReset = () => {
    userZoomedRef.current = false;
    fitToContainer(DEFAULT_SCALE);
    setPanOffset({ x: 0, y: 0 });
  };

  // Get cursor style
  const getCursor = () => {
    if (isPanning) return 'grabbing';
    switch (activeTool) {
      case 'eyedropper':
        return 'crosshair';
      case 'eraser':
        return 'cell';
      default:
        return 'crosshair';
    }
  };

  // Format region name for display
  const formatRegionName = (name: string): string => {
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="flex h-full flex-col bg-muted/30">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          {/* スマホ幅ではタブに「2D」とあるので見出しを省く */}
          <span className="hidden text-sm font-medium sm:inline">2Dキャンバス</span>
          {hoveredRegion && (
            <span className={`rounded px-1.5 py-0.5 text-xs ${
              hoveredRegion.layer === 1
                ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400'
                : 'bg-purple-500/20 text-purple-600 dark:text-purple-400'
            }`}>
              {formatRegionName(hoveredRegion.name)} (L{hoveredRegion.layer})
            </span>
          )}
        </div>
        <TooltipProvider>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ButtonGroup>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleZoomOut}
                  >
                    <ZoomOut className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>縮小</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleZoomIn}
                  >
                    <ZoomIn className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>拡大</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                  >
                    <RotateCw className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>表示をリセット</p>
                </TooltipContent>
              </Tooltip>
            </ButtonGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showOverlay ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowOverlay(!showOverlay)}
                >
                  <Grid3X3 className="mr-1 h-3 w-3" />
                  オーバーレイ
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>パーツ領域の表示を切り替え</p>
              </TooltipContent>
            </Tooltip>
            <CanvasBackgroundMenu />
            <span className="tabular-nums text-xs text-muted-foreground">{scale}x</span>
          </div>
        </TooltipProvider>
      </div>

      {/* Canvas Area */}
      <div
        ref={containerRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden p-4"
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className="rounded-lg border border-border bg-card p-2 shadow-sm"
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
          }}
        >
          <div className="relative">
            <canvas
              ref={canvasRef}
              className="block"
              style={{ cursor: getCursor() }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => {
                handleMouseUp();
                setHoveredRegion(null);
              }}
            />
            <canvas
              ref={highlightCanvasRef}
              className="pointer-events-none absolute left-0 top-0"
            />
            {showOverlay && (
              <canvas
                ref={overlayCanvasRef}
                className="pointer-events-none absolute left-0 top-0"
              />
            )}
          </div>
        </div>
        {isPickingLayerColor && (
          <div className="absolute inset-x-2 top-2 z-20 flex justify-center">
            <div
              role="status"
              className="flex items-center gap-3 rounded-md border border-primary bg-card px-3 py-2 text-xs shadow-md"
            >
              <Pipette className="h-4 w-4 shrink-0 text-primary" />
              <span>
                「{pickTargetLayerName}」の基本色を選択中：色の付いた部分をクリック
              </span>
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={endLayerColorPick}>
                キャンセル（Esc）
              </Button>
            </div>
          </div>
        )}
        <ViewHint items={HINTS_BY_TOOL[activeTool]} storageKey="skin-crafter:hint-2d" />
      </div>
    </div>
  );
}

// 左クリック操作の説明（ツールごと）
const TOOL_CLICK_HINTS: Record<ToolType, string> = {
  pencil: 'クリック・ドラッグで描画',
  eraser: 'クリック・ドラッグで消去',
  rectangle: 'ドラッグで矩形を塗りつぶし',
  rectangleEraser: 'ドラッグで矩形を消去',
  eyedropper: 'クリックで色を取得（取得後は元のツールに戻る）',
};

const COMMON_HINTS: HintItem[] = [
  { keys: ['右ドラッグ'], label: 'キャンバスを移動' },
  { keys: ['ホイール'], label: '拡大・縮小' },
  { keys: ['Ctrl/⌘+Z', 'Ctrl/⌘+Y'], label: '元に戻す・やり直し' },
  { keys: TOOLS.map((t) => t.shortcut), label: 'ツール切替' },
];

// ツールごとのヒント（再描画のたびに配列を作らないようモジュールレベルで用意）
const HINTS_BY_TOOL = Object.fromEntries(
  TOOLS.map((t) => [t.type, [{ keys: ['左クリック'], label: TOOL_CLICK_HINTS[t.type] }, ...COMMON_HINTS]])
) as Record<ToolType, HintItem[]>;
