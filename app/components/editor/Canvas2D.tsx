import { useRef, useEffect, useState, useCallback } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { SKIN_WIDTH, SKIN_HEIGHT, getSkinParts, type SkinRegion } from '../../types/editor';
import {
  renderSkinToCanvas,
  drawGrid,
  drawCheckerboard,
  drawGroupHighlight,
  getPixelFromMouse,
} from '@lib/skinRenderer';
import { Button } from '@components/ui/button';
import { ButtonGroup } from '@components/ui/button-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip';
import { ZoomIn, ZoomOut, RotateCw, Grid3X3 } from 'lucide-react';

const DEFAULT_SCALE = 8;
const MIN_SCALE = 4;
const MAX_SCALE = 32;

export function Canvas2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const highlightCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(null);
  const [rectEnd, setRectEnd] = useState<{ x: number; y: number } | null>(null);
  const [hoveredRegion, setHoveredRegion] = useState<SkinRegion | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);

  const {
    pixels,
    activeTool,
    activeGroupId,
    highlightedGroupId,
    setPixel,
    setPixelRect,
    setActiveGroup,
    commitDrawing,
    groups,
    modelType,
  } = useEditorStore();

  // Get skin parts for current model type
  const skinParts = getSkinParts(modelType);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = SKIN_WIDTH * scale;
    canvas.height = SKIN_HEIGHT * scale;

    // Disable image smoothing for crisp pixels
    ctx.imageSmoothingEnabled = false;

    // Draw checkerboard background (transparency indicator)
    drawCheckerboard(ctx, canvas.width, canvas.height, scale, 2);

    // Draw skin pixels
    renderSkinToCanvas(ctx, pixels, scale);

    // Draw grid
    drawGrid(ctx, scale);

    // Draw rectangle preview
    if (rectStart && rectEnd && activeTool === 'rectangle') {
      const minX = Math.min(rectStart.x, rectEnd.x);
      const maxX = Math.max(rectStart.x, rectEnd.x);
      const minY = Math.min(rectStart.y, rectEnd.y);
      const maxY = Math.max(rectStart.y, rectEnd.y);

      ctx.strokeStyle = 'rgba(0, 120, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(
        minX * scale,
        minY * scale,
        (maxX - minX + 1) * scale,
        (maxY - minY + 1) * scale
      );

      ctx.fillStyle = 'rgba(0, 120, 255, 0.2)';
      ctx.fillRect(
        minX * scale,
        minY * scale,
        (maxX - minX + 1) * scale,
        (maxY - minY + 1) * scale
      );
    }
  }, [pixels, scale, rectStart, rectEnd, activeTool]);

  // Draw group highlight on separate canvas (lightweight, only redraws on highlight change)
  useEffect(() => {
    const highlightCanvas = highlightCanvasRef.current;
    if (!highlightCanvas) return;

    const ctx = highlightCanvas.getContext('2d');
    if (!ctx) return;

    highlightCanvas.width = SKIN_WIDTH * scale;
    highlightCanvas.height = SKIN_HEIGHT * scale;

    ctx.clearRect(0, 0, highlightCanvas.width, highlightCanvas.height);

    if (highlightedGroupId) {
      drawGroupHighlight(ctx, pixels, highlightedGroupId, scale);
    }
  }, [highlightedGroupId, scale, pixels]);

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
        // Pick group from pixel
        const pixel = pixels[pos.y][pos.x];
        if (pixel.groupId) {
          setActiveGroup(pixel.groupId);
        }
        return;
      }

      if (activeTool === 'rectangle') {
        setRectStart(pos);
        setRectEnd(pos);
        setIsDrawing(true);
        return;
      }

      // Pencil or eraser
      setIsDrawing(true);
      if (activeTool === 'eraser') {
        setPixel(pos.x, pos.y, null);
      } else if (activeGroupId || groups.length === 0) {
        // Draw with active group, or directly if no groups exist
        setPixel(pos.x, pos.y, activeGroupId ?? 'direct');
      }
    },
    [activeTool, activeGroupId, groups.length, pixels, scale, setPixel, setActiveGroup, panOffset]
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

      if (activeTool === 'rectangle') {
        setRectEnd(pos);
        return;
      }

      // Pencil or eraser
      if (activeTool === 'eraser') {
        setPixel(pos.x, pos.y, null);
      } else if (activeGroupId || groups.length === 0) {
        // Draw with active group, or directly if no groups exist
        setPixel(pos.x, pos.y, activeGroupId ?? 'direct');
      }
    },
    [isDrawing, isPanning, activeTool, activeGroupId, groups.length, scale, setPixel, panStart, getSkinRegionAt]
  );

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (activeTool === 'rectangle' && rectStart && rectEnd) {
      setPixelRect(
        rectStart.x,
        rectStart.y,
        rectEnd.x,
        rectEnd.y,
        activeGroupId ?? (groups.length === 0 ? 'direct' : null)
      );
      // setPixelRect already increments previewVersion
    } else if (isDrawing) {
      // Commit drawing to update 3D preview
      commitDrawing();
    }

    setIsDrawing(false);
    setRectStart(null);
    setRectEnd(null);
  }, [isPanning, activeTool, rectStart, rectEnd, activeGroupId, groups.length, setPixelRect, isDrawing, commitDrawing]);

  // Handle wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => {
      const delta = e.deltaY > 0 ? -1 : 1;
      return Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev + delta));
    });
  }, []);

  // Zoom handlers
  const handleZoomIn = () => setScale((s) => Math.min(s + 2, MAX_SCALE));
  const handleZoomOut = () => setScale((s) => Math.max(s - 2, MIN_SCALE));
  const handleReset = () => {
    setScale(DEFAULT_SCALE);
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
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">2D Canvas</span>
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
          <div className="flex items-center gap-2">
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
                  <p>Zoom Out</p>
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
                  <p>Zoom In</p>
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
                  <p>Reset View</p>
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
                  Overlay
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle skin part overlay</p>
              </TooltipContent>
            </Tooltip>
            <span className="tabular-nums text-xs text-muted-foreground">{scale}x</span>
          </div>
        </TooltipProvider>
      </div>

      {/* Canvas Area */}
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-hidden p-4"
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
      </div>
    </div>
  );
}
