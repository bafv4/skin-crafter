import { useState, useEffect, useMemo } from 'react';
import { Pencil, Eraser, Square, Pipette, Undo2, Redo2, Palette, Sparkles, ShieldOff, Shield } from 'lucide-react';
import { Button } from '@components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@components/ui/popover';
import { ColorPicker } from '@components/ui/color-picker';
import { useEditorStore } from '../../stores/editorStore';
import type { ToolType } from '../../types/editor';
import { rgbaToHex } from '../../types/editor';
import { GenerateOptionsDialog } from './GroupPanel';

const tools: { type: ToolType; icon: React.ReactNode; label: string; shortcut: string }[] = [
  { type: 'pencil', icon: <Pencil className="h-5 w-5" />, label: 'ペンシル', shortcut: 'P' },
  { type: 'eraser', icon: <Eraser className="h-5 w-5" />, label: '消しゴム', shortcut: 'E' },
  { type: 'rectangle', icon: <Square className="h-5 w-5" />, label: '矩形', shortcut: 'R' },
  { type: 'eyedropper', icon: <Pipette className="h-5 w-5" />, label: 'スポイト', shortcut: 'I' },
];

export function Toolbar() {
  // Use individual selectors to minimize re-renders
  const activeTool = useEditorStore((state) => state.activeTool);
  const setActiveTool = useEditorStore((state) => state.setActiveTool);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const history = useEditorStore((state) => state.history);
  const historyIndex = useEditorStore((state) => state.historyIndex);
  const activeLayerId = useEditorStore((state) => state.activeLayerId);
  const layers = useEditorStore((state) => state.layers);
  const drawingColor = useEditorStore((state) => state.drawingColor);
  const setDrawingColor = useEditorStore((state) => state.setDrawingColor);
  const generateLayers = useEditorStore((state) => state.generateLayers);
  const preservePixels = useEditorStore((state) => state.preservePixels);
  const togglePreservePixels = useEditorStore((state) => state.togglePreservePixels);

  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);

  // Check if active layer is in direct (multi-color) mode
  const activeLayer = activeLayerId ? layers.find(l => l.id === activeLayerId) : null;
  const isDirectMode = activeLayer?.layerType === 'direct' || layers.length === 0;

  // Check if there are any layers with pixels (for auto-generate button)
  // With the new architecture, we don't have "ungrouped" pixels anymore
  // The auto-generate feature is now only available when importing images
  const hasUngroupedPixels = false; // Disabled in new architecture

  const handleGenerate = (options: { thresholdValue: number; applyNoise: boolean }) => {
    generateLayers({ thresholdValue: options.thresholdValue, applyNoise: options.applyNoise });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'p':
            setActiveTool('pencil');
            break;
          case 'e':
            setActiveTool('eraser');
            break;
          case 'r':
            setActiveTool('rectangle');
            break;
          case 'i':
            setActiveTool('eyedropper');
            break;
        }
      }

      // Undo/Redo
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          redo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveTool, undo, redo]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex w-16 flex-col items-center gap-1.5 border-r border-border bg-card py-3">
        {tools.map((tool) => (
          <Tooltip key={tool.type}>
            <TooltipTrigger asChild>
              <Button
                variant={activeTool === tool.type ? 'default' : 'ghost'}
                size="icon"
                className="h-10 w-10"
                onClick={() => setActiveTool(tool.type)}
              >
                {tool.icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{tool.label} ({tool.shortcut})</p>
            </TooltipContent>
          </Tooltip>
        ))}

        <div className="my-1.5 h-px w-10 bg-border" />

        {/* Preserve pixels toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={preservePixels ? 'default' : 'ghost'}
              size="icon"
              className="h-10 w-10"
              onClick={togglePreservePixels}
            >
              {preservePixels ? <Shield className="h-5 w-5" /> : <ShieldOff className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{preservePixels ? '上書き禁止モード (有効)' : '上書き禁止モード (無効)'}</p>
          </TooltipContent>
        </Tooltip>

        {/* Drawing color picker for direct mode */}
        {isDirectMode && (
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    className="h-10 w-10 rounded-md border-2 border-border hover:border-muted-foreground transition-colors flex items-center justify-center"
                    style={{ backgroundColor: rgbaToHex(drawingColor) }}
                  >
                    <Palette className="h-4 w-4 drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]" style={{ color: drawingColor.r + drawingColor.g + drawingColor.b > 380 ? '#000' : '#fff' }} />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>描画カラー</p>
              </TooltipContent>
            </Tooltip>
            <PopoverContent side="right" className="w-56">
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">描画カラー</p>
                <ColorPicker color={drawingColor} onChange={setDrawingColor} />
              </div>
            </PopoverContent>
          </Popover>
        )}

        {hasUngroupedPixels && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                onClick={() => setGenerateDialogOpen(true)}
              >
                <Sparkles className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>レイヤーを自動生成</p>
            </TooltipContent>
          </Tooltip>
        )}

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={undo}
              disabled={!canUndo}
            >
              <Undo2 className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>元に戻す (Ctrl+Z)</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10"
              onClick={redo}
              disabled={!canRedo}
            >
              <Redo2 className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>やり直し (Ctrl+Y)</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <GenerateOptionsDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        onGenerate={handleGenerate}
        title="レイヤーを自動生成"
        description="ピクセルの色から類似色をグループ化してレイヤーを生成します。"
      />
    </TooltipProvider>
  );
}
