import { Moon, Sun, Download, Upload, RotateCcw, FileJson, PersonStanding, Image } from 'lucide-react';
import { Button } from '@components/ui/button';
import { ButtonGroup } from '@components/ui/button-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@components/ui/tooltip';
import { CraftingTableIcon } from '@components/icons/CraftingTableIcon';
import { useEditorStore } from '../../stores/editorStore';
import { downloadSkin, loadSkinFromFile } from '@lib/skinRenderer';
import { useEffect, useRef } from 'react';

export function Header() {
  const { pixels, groups, theme, setTheme, loadFromImageData, reset, modelType, setModelType } = useEditorStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

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
      await downloadSkin(pixels, 'minecraft-skin.png');
    } catch (error) {
      console.error('Failed to export skin:', error);
    }
  };

  const handleExportJson = () => {
    try {
      const data = {
        version: 1,
        modelType,
        groups: groups.map(g => ({
          id: g.id,
          name: g.name,
          baseColor: g.baseColor,
          noiseSettings: g.noiseSettings,
        })),
        pixels: pixels.map(row =>
          row.map(p => ({
            groupId: p.groupId,
            color: p.color,
          }))
        ),
      };
      const json = JSON.stringify(data, null, 2);
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

      if (data.version !== 1) {
        throw new Error('Unsupported project version');
      }

      // Import the data using the store
      const store = useEditorStore.getState();

      // Set model type
      if (data.modelType === 'steve' || data.modelType === 'alex') {
        store.setModelType(data.modelType);
      }

      // Restore pixels and groups directly
      useEditorStore.setState({
        pixels: data.pixels,
        groups: data.groups,
        activeGroupId: data.groups.length > 0 ? data.groups[0].id : null,
        previewVersion: store.previewVersion + 1,
      });
    } catch (error) {
      console.error('Failed to import JSON:', error);
      alert('Failed to import project file. Please check the file format.');
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
              <span>Model</span>
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
                <p>Steve model (4px arms)</p>
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
                <p>Alex model (3px arms)</p>
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
                <p>Import PNG</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleExport}>
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Export PNG</p>
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
                <p>Import Project (JSON)</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleExportJson}>
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Export Project (JSON)</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="mx-1 h-6 w-px bg-border" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Reset</p>
            </TooltipContent>
          </Tooltip>

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
              <p>Theme: {theme}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}
