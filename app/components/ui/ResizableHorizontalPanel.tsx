import { useState, useRef, useCallback, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from './button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

interface ResizableHorizontalPanelProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  leftLabel?: string;
  rightLabel?: string;
  defaultLeftWidth?: number; // percentage (0-100)
  minLeftWidth?: number; // percentage
  maxLeftWidth?: number; // percentage
}

const RESIZER_WIDTH = 8; // px

export function ResizableHorizontalPanel({
  leftPanel,
  rightPanel,
  leftLabel = '2D',
  rightLabel = '3D',
  defaultLeftWidth = 50,
  minLeftWidth = 20,
  maxLeftWidth = 80,
}: ResizableHorizontalPanelProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [collapsedPanel, setCollapsedPanel] = useState<'left' | 'right' | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const savedLeftWidth = useRef(defaultLeftWidth);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (collapsedPanel) return; // Don't allow resizing when collapsed

    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const availableWidth = containerRect.width - RESIZER_WIDTH;
      const mouseX = e.clientX - containerRect.left;
      const newLeftWidth = (mouseX / availableWidth) * 100;

      setLeftWidth(Math.max(minLeftWidth, Math.min(maxLeftWidth, newLeftWidth)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [collapsedPanel, minLeftWidth, maxLeftWidth]);

  const toggleLeftPanel = useCallback(() => {
    if (collapsedPanel === 'left') {
      setCollapsedPanel(null);
      setLeftWidth(savedLeftWidth.current);
    } else {
      savedLeftWidth.current = leftWidth;
      setCollapsedPanel('left');
    }
  }, [collapsedPanel, leftWidth]);

  const toggleRightPanel = useCallback(() => {
    if (collapsedPanel === 'right') {
      setCollapsedPanel(null);
      setLeftWidth(savedLeftWidth.current);
    } else {
      savedLeftWidth.current = leftWidth;
      setCollapsedPanel('right');
    }
  }, [collapsedPanel, leftWidth]);

  // Calculate widths based on collapsed state
  const getLeftStyle = () => {
    if (collapsedPanel === 'left') return { width: 0, minWidth: 0 };
    if (collapsedPanel === 'right') return { flex: 1 };
    return { width: `calc(${leftWidth}% - ${RESIZER_WIDTH / 2}px)` };
  };

  const getRightStyle = () => {
    if (collapsedPanel === 'right') return { width: 0, minWidth: 0 };
    if (collapsedPanel === 'left') return { flex: 1 };
    return { width: `calc(${100 - leftWidth}% - ${RESIZER_WIDTH / 2}px)` };
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Left Panel */}
        <div
          style={getLeftStyle()}
          className={`min-w-0 overflow-hidden ${collapsedPanel === 'left' ? 'invisible' : ''}`}
        >
          {leftPanel}
        </div>

        {/* Resizer with collapse buttons */}
        <div
          className={`shrink-0 flex flex-col items-center justify-center bg-border transition-colors ${
            collapsedPanel ? '' : 'cursor-col-resize hover:bg-primary/50'
          }`}
          style={{ width: RESIZER_WIDTH }}
          onMouseDown={handleMouseDown}
        >
          {/* When left panel is collapsed: show only expand left button */}
          {collapsedPanel === 'left' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-sm hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLeftPanel();
                  }}
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{leftLabel}を表示</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* When right panel is collapsed: show only expand right button */}
          {collapsedPanel === 'right' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-sm hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleRightPanel();
                  }}
                >
                  <PanelRightOpen className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{rightLabel}を表示</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* When both panels are visible: show both collapse buttons */}
          {!collapsedPanel && (
            <>
              {/* Collapse left button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLeftPanel();
                    }}
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{leftLabel}を非表示</p>
                </TooltipContent>
              </Tooltip>

              {/* Drag handle indicator */}
              <div className="h-8 w-1 rounded-full bg-muted-foreground/30 my-2" />

              {/* Collapse right button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-sm hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRightPanel();
                    }}
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{rightLabel}を非表示</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        {/* Right Panel */}
        <div
          style={getRightStyle()}
          className={`min-w-0 overflow-hidden ${collapsedPanel === 'right' ? 'invisible' : ''}`}
        >
          {rightPanel}
        </div>
      </div>
    </TooltipProvider>
  );
}
