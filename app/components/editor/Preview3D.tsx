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
import { Eye, EyeOff, RotateCcw, Pause, ZoomIn, ZoomOut, RotateCw } from 'lucide-react';
import { Preview3DCanvas } from './Preview3D.client';

export function Preview3D() {
  const { showLayer2, toggleLayer2 } = useEditorStore();
  const [autoRotate, setAutoRotate] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.2, 2));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.2, 0.5));
  const handleReset = () => {
    setZoom(1);
    setResetKey((k) => k + 1);
  };

  return (
    <div className="flex h-full flex-col bg-muted/30">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <span className="text-sm font-medium">3D Preview</span>
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
                  variant={autoRotate ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setAutoRotate(!autoRotate)}
                >
                  {autoRotate ? <RotateCcw className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}
                  Rotate
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle auto rotation</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={showLayer2 ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleLayer2}
                >
                  {showLayer2 ? <Eye className="mr-1 h-3 w-3" /> : <EyeOff className="mr-1 h-3 w-3" />}
                  Layer 2
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle layer 2 overlay visibility</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>
      <div className="flex-1">
        <Preview3DCanvas
          autoRotate={autoRotate}
          zoom={zoom}
          onZoomChange={setZoom}
          resetKey={resetKey}
        />
      </div>
    </div>
  );
}
