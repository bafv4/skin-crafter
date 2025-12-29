import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import type { Route } from './+types/home';
import { Header } from '@components/layout/Header';
import { Toolbar } from '@components/editor/Toolbar';
import { Canvas2D } from '@components/editor/Canvas2D';
import { LayerPanel } from '@components/editor/GroupPanel';
import { ResizableHorizontalPanel } from '@components/ui/ResizableHorizontalPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { Grid2X2, Box, Loader2 } from 'lucide-react';

// Constants for layer panel resizing
const DEFAULT_LAYER_PANEL_WIDTH = 288; // 72 * 4 = 288px (w-72)
const MIN_LAYER_PANEL_WIDTH = 200;
const MAX_LAYER_PANEL_WIDTH = 450;
const RESIZER_WIDTH = 6;

// Lazy load 3D preview to reduce initial bundle size (Three.js is large)
const Preview3D = lazy(() => import('@components/editor/Preview3D').then(m => ({ default: m.Preview3D })));

// Loading fallback for 3D preview
function Preview3DFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-muted/30">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">3Dプレビューを読み込み中...</span>
      </div>
    </div>
  );
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Skin Crafter - Minecraft Skin Editor' },
    { name: 'description', content: 'Create and edit Minecraft skins with an intuitive group-based painting system' },
  ];
}

// Breakpoints for compact layout detection
const NARROW_WIDTH_BREAKPOINT = 1024;
const SHORT_HEIGHT_BREAKPOINT = 800;

function useIsCompactLayout() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const checkSize = () => {
      // Use tab layout if screen is narrow OR short
      setIsCompact(
        window.innerWidth < NARROW_WIDTH_BREAKPOINT ||
        window.innerHeight < SHORT_HEIGHT_BREAKPOINT
      );
    };

    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  return isCompact;
}

export default function Home() {
  const isCompactLayout = useIsCompactLayout();

  // Layer panel resizing state
  const [layerPanelWidth, setLayerPanelWidth] = useState(DEFAULT_LAYER_PANEL_WIDTH);
  const isDraggingLayerPanel = useRef(false);

  const handleLayerPanelMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingLayerPanel.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingLayerPanel.current) return;
      // Calculate width from the left edge (after toolbar which is 56px = w-14)
      const toolbarWidth = 56;
      const newWidth = e.clientX - toolbarWidth;
      setLayerPanelWidth(Math.max(MIN_LAYER_PANEL_WIDTH, Math.min(MAX_LAYER_PANEL_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      isDraggingLayerPanel.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Toolbar */}
        <Toolbar />

        {/* Left-center: Layer Panel with resizer */}
        <div className="flex h-full">
          <LayerPanel width={layerPanelWidth} />
          {/* Resizer handle */}
          <div
            className="h-full cursor-col-resize bg-border hover:bg-primary/50 transition-colors flex items-center justify-center"
            style={{ width: RESIZER_WIDTH }}
            onMouseDown={handleLayerPanelMouseDown}
          >
            <div className="h-8 w-1 rounded-full bg-muted-foreground/30" />
          </div>
        </div>

        {/* Right: Canvas and Preview */}
        {isCompactLayout ? (
          // Compact layout (narrow or short screen): Tab-based layout
          <Tabs defaultValue="canvas" className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-center border-b border-border bg-card px-2 py-1.5">
              <TabsList className="h-8">
                <TabsTrigger value="canvas" className="gap-1.5 px-3 text-xs">
                  <Grid2X2 className="h-3.5 w-3.5" />
                  2D
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-1.5 px-3 text-xs">
                  <Box className="h-3.5 w-3.5" />
                  3D
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="canvas" className="m-0 flex-1 overflow-hidden">
              <Canvas2D />
            </TabsContent>
            <TabsContent value="preview" className="m-0 flex-1 overflow-hidden">
              <Suspense fallback={<Preview3DFallback />}>
                <Preview3D />
              </Suspense>
            </TabsContent>
          </Tabs>
        ) : (
          // Normal layout (wide and tall screen): Horizontal resizable panel layout
          <ResizableHorizontalPanel
            leftPanel={<Canvas2D />}
            rightPanel={
              <Suspense fallback={<Preview3DFallback />}>
                <Preview3D />
              </Suspense>
            }
            leftLabel="2Dキャンバス"
            rightLabel="3Dプレビュー"
            defaultLeftWidth={50}
            minLeftWidth={25}
            maxLeftWidth={75}
          />
        )}
      </div>
    </div>
  );
}
