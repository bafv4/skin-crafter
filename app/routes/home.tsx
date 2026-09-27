import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import type { Route } from './+types/home';
import { Header } from '@components/layout/Header';
import { Toolbar } from '@components/editor/Toolbar';
import { Canvas2D } from '@components/editor/Canvas2D';
import { LayerPanel } from '@components/editor/GroupPanel';
import { ResizableHorizontalPanel } from '@components/ui/ResizableHorizontalPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { Grid2X2, Box, Layers, Loader2 } from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';

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
// これより狭い画面（スマホ）では、レイヤーパネルも含めてタブで切り替える
const MOBILE_WIDTH_BREAKPOINT = 768;

type LayoutMode = 'wide' | 'compact' | 'mobile';

function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>('wide');

  useEffect(() => {
    const checkSize = () => {
      if (window.innerWidth < MOBILE_WIDTH_BREAKPOINT) {
        setMode('mobile');
      } else if (window.innerWidth < NARROW_WIDTH_BREAKPOINT || window.innerHeight < SHORT_HEIGHT_BREAKPOINT) {
        // Use tab layout if screen is narrow OR short
        setMode('compact');
      } else {
        setMode('wide');
      }
    };

    checkSize();
    window.addEventListener('resize', checkSize);
    return () => window.removeEventListener('resize', checkSize);
  }, []);

  return mode;
}

function Preview3DWithFallback() {
  return (
    <Suspense fallback={<Preview3DFallback />}>
      <Preview3D />
    </Suspense>
  );
}

const TAB_TRIGGER_CLASS = 'gap-1.5 px-3 text-xs';

// スマホ幅: レイヤー / 2D / 3D をタブで切り替える
function MobileEditor() {
  const [tab, setTab] = useState('canvas');
  // レイヤー設定の「キャンバスから取得」中は 2D キャンバスを表示し、終わったらレイヤーに戻す
  const isPickingLayerColor = useEditorStore((state) => state.layerColorPickTarget !== null);
  const tabBeforePick = useRef<string | null>(null);
  useEffect(() => {
    if (isPickingLayerColor) {
      tabBeforePick.current = tab;
      setTab('canvas');
    } else if (tabBeforePick.current !== null) {
      setTab(tabBeforePick.current);
      tabBeforePick.current = null;
    }
  }, [isPickingLayerColor]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-center border-b border-border bg-card px-2 py-1.5">
        <TabsList className="h-8">
          <TabsTrigger value="layers" className={TAB_TRIGGER_CLASS}>
            <Layers className="h-3.5 w-3.5" />
            レイヤー
          </TabsTrigger>
          <TabsTrigger value="canvas" className={TAB_TRIGGER_CLASS}>
            <Grid2X2 className="h-3.5 w-3.5" />
            2D
          </TabsTrigger>
          <TabsTrigger value="preview" className={TAB_TRIGGER_CLASS}>
            <Box className="h-3.5 w-3.5" />
            3D
          </TabsTrigger>
        </TabsList>
      </div>
      {/* レイヤーパネルと 2D キャンバスは切り替えても状態（開いているダイアログや表示倍率）を保つ */}
      <TabsContent value="layers" forceMount className="m-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
        <LayerPanel fill />
      </TabsContent>
      <TabsContent value="canvas" forceMount className="m-0 flex-1 overflow-hidden data-[state=inactive]:hidden">
        <Canvas2D />
      </TabsContent>
      <TabsContent value="preview" className="m-0 flex-1 overflow-hidden">
        <Preview3DWithFallback />
      </TabsContent>
    </Tabs>
  );
}

export default function Home() {
  const layoutMode = useLayoutMode();

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

        {layoutMode === 'mobile' ? (
          <MobileEditor />
        ) : (
        <>
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
        {layoutMode === 'compact' ? (
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
              <Preview3DWithFallback />
            </TabsContent>
          </Tabs>
        ) : (
          // Normal layout (wide and tall screen): Horizontal resizable panel layout
          <ResizableHorizontalPanel
            leftPanel={<Canvas2D />}
            rightPanel={<Preview3DWithFallback />}
            leftLabel="2Dキャンバス"
            rightLabel="3Dプレビュー"
            defaultLeftWidth={50}
            minLeftWidth={25}
            maxLeftWidth={75}
          />
        )}
        </>
        )}
      </div>
    </div>
  );
}
