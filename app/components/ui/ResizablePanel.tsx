import { useState, useRef, useCallback, type ReactNode } from 'react';

interface ResizablePanelProps {
  topPanel: ReactNode;
  bottomPanel: ReactNode;
  defaultTopHeight?: number; // percentage (0-100)
  minTopHeight?: number; // percentage
  maxTopHeight?: number; // percentage
}

const RESIZER_HEIGHT = 8; // px

export function ResizablePanel({
  topPanel,
  bottomPanel,
  defaultTopHeight = 60,
  minTopHeight = 20,
  maxTopHeight = 80,
}: ResizablePanelProps) {
  const [topHeight, setTopHeight] = useState(defaultTopHeight);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      // Account for resizer height when calculating percentage
      const availableHeight = containerRect.height - RESIZER_HEIGHT;
      const mouseY = e.clientY - containerRect.top;
      const newTopHeight = (mouseY / availableHeight) * 100;

      setTopHeight(Math.max(minTopHeight, Math.min(maxTopHeight, newTopHeight)));
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
  }, [minTopHeight, maxTopHeight]);

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden">
      <div style={{ height: `calc(${topHeight}% - ${RESIZER_HEIGHT / 2}px)` }} className="min-h-0 overflow-hidden">
        {topPanel}
      </div>
      <div
        className="shrink-0 cursor-row-resize bg-border hover:bg-primary/50 transition-colors flex items-center justify-center"
        style={{ height: RESIZER_HEIGHT }}
        onMouseDown={handleMouseDown}
      >
        <div className="w-12 h-1 rounded-full bg-muted-foreground/30" />
      </div>
      <div style={{ height: `calc(${100 - topHeight}% - ${RESIZER_HEIGHT / 2}px)` }} className="min-h-0 overflow-hidden">
        {bottomPanel}
      </div>
    </div>
  );
}
