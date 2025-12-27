import { useState, useEffect } from 'react';
import type { Route } from './+types/home';
import { Header } from '@components/layout/Header';
import { Toolbar } from '@components/editor/Toolbar';
import { Canvas2D } from '@components/editor/Canvas2D';
import { GroupPanel } from '@components/editor/GroupPanel';
import { Preview3D } from '@components/editor/Preview3D';
import { ResizablePanel } from '@components/ui/ResizablePanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { Grid2X2, Box } from 'lucide-react';

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

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Toolbar />
        {isCompactLayout ? (
          // Compact layout (narrow or short screen): Tab-based layout
          <Tabs defaultValue="canvas" className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-center border-b border-border bg-card px-2 py-1.5">
              <TabsList className="h-8">
                <TabsTrigger value="canvas" className="gap-1.5 px-3 text-xs">
                  <Grid2X2 className="h-3.5 w-3.5" />
                  2D Canvas
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-1.5 px-3 text-xs">
                  <Box className="h-3.5 w-3.5" />
                  3D Preview
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="canvas" className="m-0 flex-1 overflow-hidden">
              <Canvas2D />
            </TabsContent>
            <TabsContent value="preview" className="m-0 flex-1 overflow-hidden">
              <Preview3D />
            </TabsContent>
          </Tabs>
        ) : (
          // Normal layout (wide and tall screen): Resizable panel layout
          <ResizablePanel
            topPanel={<Canvas2D />}
            bottomPanel={<Preview3D />}
            defaultTopHeight={60}
            minTopHeight={30}
            maxTopHeight={85}
          />
        )}
        <GroupPanel />
      </div>
    </div>
  );
}
