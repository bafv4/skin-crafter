import { useState } from 'react';
import { useEditorStore } from '../../stores/editorStore';
import { Button } from '@components/ui/button';
import { ButtonGroup } from '@components/ui/button-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@components/ui/popover';
import { Eye, EyeOff, RotateCcw, Pause, ZoomIn, ZoomOut, RotateCw, PersonStanding } from 'lucide-react';
import { Preview3DCanvas, DEFAULT_PART_VISIBILITY, BODY_PART_KEYS, type PartVisibility } from './Preview3D.client';
import { PartVisibilityPicker } from './PartVisibilityPicker';
import { ViewHint, type HintItem } from './ViewHint';

// OrbitControls の設定（Preview3D.client.tsx）に対応
const HINT_ITEMS: HintItem[] = [
  { keys: ['左ドラッグ', '右ドラッグ'], label: '回転' },
  { keys: ['ホイールドラッグ'], label: '移動' },
  { keys: ['ホイール'], label: '拡大・縮小' },
];

export function Preview3D() {
  const showLayer2 = useEditorStore((state) => state.showLayer2);
  const toggleLayer2 = useEditorStore((state) => state.toggleLayer2);
  const [autoRotate, setAutoRotate] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [partVisibility, setPartVisibility] = useState<PartVisibility>(DEFAULT_PART_VISIBILITY);
  const hasHiddenParts = BODY_PART_KEYS.some(
    (key) => !partVisibility[key].inner || !partVisibility[key].outer
  );

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.2, 2));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.5));
  const handleReset = () => {
    setZoom(1);
    setResetKey((k) => k + 1);
  };

  return (
    <div className="flex h-full flex-col bg-muted/30">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2">
        <span className="hidden shrink-0 whitespace-nowrap text-sm font-medium sm:inline">3Dプレビュー</span>
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
                  variant={autoRotate ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAutoRotate(!autoRotate)}
                >
                  {autoRotate ? <RotateCcw className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}
                  回転
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>自動回転の切り替え</p>
              </TooltipContent>
            </Tooltip>
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button variant={hasHiddenParts ? 'default' : 'outline'} size="sm">
                      <PersonStanding className="mr-1 h-3 w-3" />
                      パーツ
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>パーツごとの表示を切り替え</p>
                </TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="w-80">
                <PartVisibilityPicker visibility={partVisibility} onChange={setPartVisibility} />
              </PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showLayer2 ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleLayer2}
                >
                  {showLayer2 ? <Eye className="mr-1 h-3 w-3" /> : <EyeOff className="mr-1 h-3 w-3" />}
                  レイヤー2
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>レイヤー2（外装）の表示を切り替え</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      <div className="relative flex-1">
        <Preview3DCanvas
          autoRotate={autoRotate}
          zoom={zoom}
          onZoomChange={setZoom}
          resetKey={resetKey}
          partVisibility={partVisibility}
        />
        <ViewHint items={HINT_ITEMS} storageKey="skin-crafter:hint-3d" />
      </div>
    </div>
  );
}
