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
import { AboutDialog } from './AboutDialog';
import { useEditorStore } from '../../stores/editorStore';
import { downloadSkin, loadSkinFromFile } from '@lib/skinRenderer';
import { useEffect, useRef } from 'react';
import type { Layer, LayerGroup, PaletteColor, RGBA, LayerPixels, MaterialType } from '../../types/editor';
import { createEmptyLayerPixels, SKIN_WIDTH, SKIN_HEIGHT } from '../../types/editor';

// Compact pixel format for layer: [r, g, b, a] or null for transparent
type CompactLayerPixel = [number, number, number, number] | null;

// Sparse pixel format: [x, y, r, g, b, a] — only non-null pixels stored
type SparsePixel = [number, number, number, number, number, number];

// Compact layer format v6 (array instead of object)
// [id, name, baseColor[r,g,b,a], noiseSettings[brightness,hue,material], groupId, order, layerType, visible, opacity, sparsePixels]
type CompactLayerV6 = [
  string, // 0: id
  string, // 1: name
  [number, number, number, number], // 2: baseColor
  [number, number, string | null], // 3: noiseSettings [brightness, hue, material]
  string | null, // 4: groupId
  number, // 5: order
  'direct' | 'singleColor', // 6: layerType
  boolean, // 7: visible
  number, // 8: opacity
  SparsePixel[] // 9: sparse pixels (non-null only)
];

// Legacy v5 layer format
type CompactLayerV5 = [
  string, // 0: id
  string, // 1: name
  [number, number, number, number], // 2: baseColor
  [number, number], // 3: noiseSettings [brightness, hue]
  string | null, // 4: groupId
  number, // 5: order
  'direct' | 'singleColor', // 6: layerType
  boolean, // 7: visible
  number, // 8: opacity
  CompactLayerPixel[][] // 9: pixels
];

// Compact group format
// [id, name, collapsed, order, visible]
type CompactGroup = [string, string, boolean, number, boolean];

// Compact palette format
// [id, color[r,g,b,a], name?]
type CompactPalette = [string, [number, number, number, number], string?];

// V4 format (legacy)
type CompactPixelV4 = [number, number, number, number, number] | null;
type CompactLayerV4 = [string, string, [number, number, number, number], [number, number], string | null, number, 'direct' | 'singleColor', boolean, number?];

export function Header() {
  const { layers, layerGroups, palette, theme, setTheme, loadFromImageData, reset, modelType, setModelType, getComposite } = useEditorStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

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
      const composite = getComposite();
      await downloadSkin(composite, 'minecraft-skin.png');
    } catch (error) {
      console.error('Failed to export skin:', error);
    }
  };

  const handleExportJson = () => {
    try {
      // Convert layers to compact v6 format (sparse pixels + material)
      const compactLayers: CompactLayerV6[] = layers.map(l => {
        // Convert layer pixels to sparse format (only non-null pixels)
        const sparsePixels: SparsePixel[] = [];
        for (let y = 0; y < SKIN_HEIGHT; y++) {
          for (let x = 0; x < SKIN_WIDTH; x++) {
            const p = l.pixels[y]?.[x];
            if (p) {
              sparsePixels.push([x, y, p.r, p.g, p.b, p.a]);
            }
          }
        }

        return [
          l.id,
          l.name,
          [l.baseColor.r, l.baseColor.g, l.baseColor.b, l.baseColor.a],
          [l.noiseSettings.brightness, l.noiseSettings.hue, l.noiseSettings.material ?? null],
          l.groupId,
          l.order,
          l.layerType,
          l.visible,
          l.opacity ?? 100,
          sparsePixels,
        ];
      });

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

      const data = {
        v: 6, // version 6 - sparse pixels + material type
        m: modelType === 'steve' ? 0 : 1, // model type: 0=steve, 1=alex
        l: compactLayers,
        g: compactGroups,
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

      const store = useEditorStore.getState();

      // Set model type (0=steve, 1=alex)
      store.setModelType(data.m === 1 ? 'alex' : 'steve');

      let importedLayers: Layer[];

      if (data.v === 6) {
        // Version 6 format - sparse pixels + material type
        importedLayers = (data.l as CompactLayerV6[]).map(l => {
          // Convert sparse pixels to LayerPixels (64x64 grid)
          const pixels = createEmptyLayerPixels();
          for (const sp of l[9]) {
            pixels[sp[1]][sp[0]] = { r: sp[2], g: sp[3], b: sp[4], a: sp[5] };
          }

          return {
            id: l[0],
            name: l[1],
            baseColor: { r: l[2][0], g: l[2][1], b: l[2][2], a: l[2][3] },
            noiseSettings: { brightness: l[3][0], hue: l[3][1], material: (l[3][2] as MaterialType) ?? undefined },
            groupId: l[4],
            order: l[5],
            layerType: l[6],
            visible: l[7],
            opacity: l[8] ?? 100,
            pixels,
          };
        });
      } else if (data.v === 5) {
        // Version 5 format - per-layer pixels (legacy)
        importedLayers = (data.l as CompactLayerV5[]).map(l => {
          // Convert compact pixels to LayerPixels
          const pixels: LayerPixels = (l[9] as CompactLayerPixel[][]).map(row =>
            row.map(p => p === null ? null : { r: p[0], g: p[1], b: p[2], a: p[3] })
          );

          return {
            id: l[0],
            name: l[1],
            baseColor: { r: l[2][0], g: l[2][1], b: l[2][2], a: l[2][3] },
            noiseSettings: { brightness: l[3][0], hue: l[3][1] },
            groupId: l[4],
            order: l[5],
            layerType: l[6],
            visible: l[7],
            opacity: l[8] ?? 100,
            pixels,
          };
        });
      } else if (data.v === 4) {
        // Version 4 format - migrate to v5
        // In v4, pixels were stored separately with layer references
        const v4Layers = data.l as CompactLayerV4[];
        const v4Pixels = data.p as CompactPixelV4[][];

        importedLayers = v4Layers.map((l, layerIndex) => {
          // Create empty pixels for this layer
          const pixels = createEmptyLayerPixels();

          // Find all pixels that belong to this layer
          for (let y = 0; y < SKIN_HEIGHT; y++) {
            for (let x = 0; x < SKIN_WIDTH; x++) {
              const p = v4Pixels[y]?.[x];
              if (p !== null && p[0] === layerIndex) {
                // This pixel belongs to this layer
                pixels[y][x] = { r: p[1], g: p[2], b: p[3], a: p[4] };
              }
            }
          }

          return {
            id: l[0],
            name: l[1],
            baseColor: { r: l[2][0], g: l[2][1], b: l[2][2], a: l[2][3] },
            noiseSettings: { brightness: l[3][0], hue: l[3][1] },
            groupId: l[4],
            order: l[5],
            layerType: l[6],
            visible: l[7],
            opacity: l[8] ?? 100,
            pixels,
          };
        });
      } else {
        throw new Error('Unsupported project version. Please use version 4, 5 or 6 format.');
      }

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

      // プロジェクトを開く（PixelEngine の作り直しと、前のプロジェクトの履歴の破棄もここで行う）
      store.loadProject({
        layers: importedLayers,
        layerGroups: importedGroups,
        palette: importedPalette,
      });
    } catch (error) {
      console.error('Failed to import JSON:', error);
      alert('プロジェクトファイルの読み込みに失敗しました。バージョン4〜6形式のファイルを使用してください。');
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
        {/* タイトルをクリックすると「Skin Crafter について」を開く */}
        <h1 className="text-xl font-bold text-foreground">
          <button
            type="button"
            className="flex items-center gap-3 whitespace-nowrap rounded-md -mx-1 px-1 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setAboutOpen(true)}
            aria-haspopup="dialog"
            title="Skin Crafter について"
          >
            <CraftingTableIcon className="h-8 w-8" />
            Skin Crafter
          </button>
        </h1>
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

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
