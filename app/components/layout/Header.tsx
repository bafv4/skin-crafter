import { useState } from 'react';
import { Moon, Sun, Download, Upload, RotateCcw, FileJson, PersonStanding, Image } from 'lucide-react';
import { Button } from '@components/ui/button';
import { ButtonGroup } from '@components/ui/button-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@components/ui/alert-dialog';
import { CraftingTableIcon } from '@components/icons/CraftingTableIcon';
import { useEditorStore } from '../../stores/editorStore';
import { downloadSkin, loadSkinFromFile } from '@lib/skinRenderer';
import { useEffect, useRef } from 'react';
import type { Layer, LayerGroup, PaletteColor, RGBA } from '../../types/editor';

// Compact pixel format: [layerIndex, r, g, b, a] or null for transparent
type CompactPixel = [number, number, number, number, number] | null;

// Compact layer format (array instead of object)
// [id, name, baseColor[r,g,b,a], noiseSettings[brightness,hue], groupId, order, layerType, visible]
type CompactLayer = [string, string, [number, number, number, number], [number, number], string | null, number, 'direct' | 'singleColor', boolean];

// Compact group format
// [id, name, collapsed, order, visible]
type CompactGroup = [string, string, boolean, number, boolean];

// Compact palette format
// [id, color[r,g,b,a], name?]
type CompactPalette = [string, [number, number, number, number], string?];

export function Header() {
  const { pixels, layers, layerGroups, palette, theme, setTheme, loadFromImageData, reset, modelType, setModelType } = useEditorStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      // System theme
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
  }, [theme]);

  const handleExport = async () => {
    try {
      await downloadSkin(pixels, 'minecraft-skin.png', layers, layerGroups);
    } catch (error) {
      console.error('Failed to export skin:', error);
    }
  };

  const handleExportJson = () => {
    try {
      // Build layer ID to index map
      const layerIdToIndex = new Map<string, number>();
      layers.forEach((l, i) => layerIdToIndex.set(l.id, i));

      // Convert layers to compact format
      const compactLayers: CompactLayer[] = layers.map(l => [
        l.id,
        l.name,
        [l.baseColor.r, l.baseColor.g, l.baseColor.b, l.baseColor.a],
        [l.noiseSettings.brightness, l.noiseSettings.hue],
        l.groupId,
        l.order,
        l.layerType,
        l.visible,
      ]);

      // Convert groups to compact format
      const compactGroups: CompactGroup[] = layerGroups.map(g => [
        g.id,
        g.name,
        g.collapsed,
        g.order,
        g.visible,
      ]);

      // Convert palette to compact format
      const compactPalette: CompactPalette[] = palette.map(p =>
        p.name
          ? [p.id, [p.color.r, p.color.g, p.color.b, p.color.a], p.name]
          : [p.id, [p.color.r, p.color.g, p.color.b, p.color.a]]
      );

      // Convert pixels to compact format
      // Use null for transparent pixels, [layerIndex, r, g, b, a] for others
      const compactPixels: CompactPixel[][] = pixels.map(row =>
        row.map(p => {
          if (p.color.a === 0) return null;
          const layerIndex = p.layerId ? layerIdToIndex.get(p.layerId) ?? -1 : -1;
          return [layerIndex, p.color.r, p.color.g, p.color.b, p.color.a];
        })
      );

      const data = {
        v: 4, // version
        m: modelType === 'steve' ? 0 : 1, // model type: 0=steve, 1=alex
        l: compactLayers,
        g: compactGroups,
        p: compactPixels,
        c: compactPalette, // color palette
      };

      // Use compact JSON (no pretty print)
      const json = JSON.stringify(data);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'skin-project.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export JSON:', error);
    }
  };

  const handleImportJson = () => {
    jsonInputRef.current?.click();
  };

  const handleJsonFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.v !== 4) {
        throw new Error('Unsupported project version. Please use version 4 format.');
      }

      const store = useEditorStore.getState();

      // Set model type (0=steve, 1=alex)
      store.setModelType(data.m === 1 ? 'alex' : 'steve');

      // Convert compact layers to full format
      const importedLayers: Layer[] = (data.l as CompactLayer[]).map(l => ({
        id: l[0],
        name: l[1],
        baseColor: { r: l[2][0], g: l[2][1], b: l[2][2], a: l[2][3] },
        noiseSettings: { brightness: l[3][0], hue: l[3][1] },
        groupId: l[4],
        order: l[5],
        layerType: l[6],
        visible: l[7],
      }));

      // Convert compact groups to full format
      const importedGroups: LayerGroup[] = (data.g as CompactGroup[]).map(g => ({
        id: g[0],
        name: g[1],
        collapsed: g[2],
        order: g[3],
        visible: g[4],
      }));

      // Convert compact palette to full format
      const importedPalette: PaletteColor[] = (data.c as CompactPalette[] || []).map(p => ({
        id: p[0],
        color: { r: p[1][0], g: p[1][1], b: p[1][2], a: p[1][3] },
        name: p[2],
      }));

      // Convert compact pixels to full format
      const importedPixels = (data.p as CompactPixel[][]).map(row =>
        row.map(p => {
          if (p === null) {
            return { layerId: null, color: { r: 0, g: 0, b: 0, a: 0 } };
          }
          const [layerIndex, r, g, b, a] = p;
          const layerId = layerIndex >= 0 && layerIndex < importedLayers.length
            ? importedLayers[layerIndex].id
            : null;
          return { layerId, color: { r, g, b, a } };
        })
      );

      // Restore state
      useEditorStore.setState({
        pixels: importedPixels,
        layers: importedLayers,
        layerGroups: importedGroups,
        palette: importedPalette,
        activeLayerId: importedLayers.length > 0 ? importedLayers[0].id : null,
        previewVersion: store.previewVersion + 1,
      });
    } catch (error) {
      console.error('Failed to import JSON:', error);
      alert('プロジェクトファイルの読み込みに失敗しました。バージョン4形式のファイルを使用してください。');
    }

    e.target.value = '';
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const imageData = await loadSkinFromFile(file);
      loadFromImageData(imageData);
    } catch (error) {
      console.error('Failed to load skin:', error);
    }

    // Reset input
    e.target.value = '';
  };

  const toggleTheme = () => {
    if (theme === 'light') {
      setTheme('dark');
    } else if (theme === 'dark') {
      setTheme('system');
    } else {
      setTheme('light');
    }
  };

  return (
    <TooltipProvider>
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-3">
          <CraftingTableIcon className="h-8 w-8" />
          <h1 className="text-xl font-bold text-foreground">Skin Crafter</h1>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png"
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={jsonInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleJsonFileChange}
          />

          {/* Model Type Toggle */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <PersonStanding className="h-4 w-4" />
              <span>モデル</span>
            </div>
          <ButtonGroup>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={modelType === 'steve' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setModelType('steve')}
                  className="h-8 gap-1"
                >
                  <span className="text-s">Steve</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Steveモデル (腕4px)</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={modelType === 'alex' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setModelType('alex')}
                  className="h-8 gap-1"
                >
                  <span className="text-s">Alex</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Alexモデル (腕3px)</p>
              </TooltipContent>
            </Tooltip>
          </ButtonGroup>
          </div>

          <div className="mx-1 h-6 w-px bg-border" />

          {/* PNG Import/Export */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Image className="h-3.5 w-3.5" />
              <span>PNG</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleImport}>
                  <Upload className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>PNGを読み込む</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleExport}>
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>PNGを書き出す</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="mx-1 h-6 w-px bg-border" />

          {/* JSON Project Import/Export */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileJson className="h-3.5 w-3.5" />
              <span>JSON</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleImportJson}>
                  <Upload className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>プロジェクトを読み込む (JSON)</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleExportJson}>
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>プロジェクトを書き出す (JSON)</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="mx-1 h-6 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setResetDialogOpen(true)}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>リセット</p>
            </TooltipContent>
          </Tooltip>

          <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>編集をリセット</AlertDialogTitle>
                <AlertDialogDescription>
                  すべてのピクセル、レイヤー、グループを削除してキャンバスをクリアします。この操作は元に戻せません。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>キャンセル</AlertDialogCancel>
                <AlertDialogAction
                  onClick={reset}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  リセット
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="mx-2 h-6 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={toggleTheme}>
                {theme === 'dark' ? (
                  <Moon className="h-4 w-4" />
                ) : theme === 'light' ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <div className="flex h-4 w-4 items-center justify-center">
                    <Sun className="h-3 w-3" />
                    <Moon className="h-3 w-3 -ml-1" />
                  </div>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>テーマ: {theme === 'dark' ? 'ダーク' : theme === 'light' ? 'ライト' : 'システム'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}
