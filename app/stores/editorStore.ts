import { create } from 'zustand';
import {
  type PixelData,
  type Layer,
  type LayerGroup,
  type LayerType,
  type ToolType,
  type ModelType,
  type ThemeType,
  type HistoryEntry,
  type PixelChange,
  type LayerChange,
  type LayerGroupChange,
  type RGBA,
  type PaletteColor,
  type MaterialType,
  SKIN_WIDTH,
  SKIN_HEIGHT,
  MAX_HISTORY,
  createEmptyPixels,
  generateId,
} from '../types/editor';
import {
  generateLayersFromImageData,
  mergeSimilarLayers,
  mergeLayers,
  splitLayerByColor,
  splitLayerBySelection,
  blendBorderPixels,
  COLOR_THRESHOLD_PRESETS,
  type ColorThresholdPreset,
} from '../lib/layerGenerator';

interface EditorState {
  // Canvas data
  pixels: PixelData[][];
  layers: Layer[];
  layerGroups: LayerGroup[];

  // Selection state
  activeLayerId: string | null;
  activeTool: ToolType;
  highlightedLayerId: string | null;

  // Direct drawing color (used when no layers exist)
  drawingColor: RGBA;

  // Settings
  modelType: ModelType;
  showLayer2: boolean;
  preservePixels: boolean; // When true, don't overwrite existing pixels
  theme: ThemeType;

  // History
  history: HistoryEntry[];
  historyIndex: number;

  // Preview update version (incremented when 3D preview should update)
  previewVersion: number;

  // Color palette
  palette: PaletteColor[];


  // Actions
  setPixel: (x: number, y: number, layerId: string | null) => void;
  setPixelRect: (x1: number, y1: number, x2: number, y2: number, layerId: string | null) => void;
  commitDrawing: () => void; // Call when drawing ends to update 3D preview
  setActiveTool: (tool: ToolType) => void;
  setActiveLayer: (layerId: string | null) => void;
  setHighlightedLayer: (layerId: string | null) => void;
  setDrawingColor: (color: RGBA) => void;

  // Layer actions
  createLayer: (name: string, color: RGBA, layerType?: LayerType) => string;
  updateLayerColor: (layerId: string, color: RGBA) => void;
  updateLayerName: (layerId: string, name: string) => void;
  updateLayerType: (layerId: string, layerType: LayerType) => void;
  toggleLayerVisibility: (layerId: string) => void;
  deleteLayer: (layerId: string) => void;
  applyNoise: (layerId: string, brightness: number, hue: number, brightnessDirection?: 'both' | 'positive' | 'negative', hueDirection?: 'both' | 'positive' | 'negative', material?: MaterialType) => void;
  resetNoise: (layerId: string) => void;
  reorderLayer: (layerId: string, newOrder: number, newGroupId: string | null) => void;
  duplicateLayer: (layerId: string) => string | null;

  // Layer group actions
  createLayerGroup: (name: string) => string;
  updateLayerGroupName: (groupId: string, name: string) => void;
  deleteLayerGroup: (groupId: string) => void;
  toggleLayerGroupCollapsed: (groupId: string) => void;
  toggleLayerGroupVisibility: (groupId: string) => void;
  reorderLayerGroup: (groupId: string, newOrder: number) => void;
  moveLayerToGroup: (layerId: string, groupId: string | null) => void;

  // Settings actions
  setModelType: (type: ModelType) => void;
  toggleLayer2: () => void;
  togglePreservePixels: () => void;
  setTheme: (theme: ThemeType) => void;

  // History actions
  undo: () => void;
  redo: () => void;
  saveToHistory: () => void;

  // File actions
  loadFromImageData: (imageData: ImageData) => void;
  generateLayers: (options?: { threshold?: ColorThresholdPreset; thresholdValue?: number; applyNoise?: boolean }) => void;
  mergeLayersById: (sourceLayerId: string, targetLayerId: string) => void;
  mergeSimilarLayersAction: (options?: { threshold?: ColorThresholdPreset; thresholdValue?: number; applyNoise?: boolean }) => void;
  splitLayerByColorAction: (layerId: string, options?: { threshold?: ColorThresholdPreset; thresholdValue?: number; applyNoise?: boolean }) => void;
  splitLayerBySelectionAction: (layerId: string, selectedPixels: { x: number; y: number }[]) => string | null;
  blendBordersAction: (blendStrength?: number, layerId?: string) => void;
  getImageData: () => ImageData;
  reset: () => void;

  // Palette actions
  addToPalette: (color: RGBA, name?: string) => void;
  removeFromPalette: (id: string) => void;
  updatePaletteColor: (id: string, color: RGBA) => void;
  renamePaletteColor: (id: string, name: string) => void;
  clearPalette: () => void;
}

// Helper to deep clone pixels
// Performance optimization: Only clone when actually modifying
function clonePixels(pixels: PixelData[][]): PixelData[][] {
  // Use a more efficient cloning approach - rows are cloned on demand
  const cloned: PixelData[][] = new Array(pixels.length);
  for (let y = 0; y < pixels.length; y++) {
    const row = pixels[y];
    const newRow: PixelData[] = new Array(row.length);
    for (let x = 0; x < row.length; x++) {
      const pixel = row[x];
      newRow[x] = {
        layerId: pixel.layerId,
        color: { r: pixel.color.r, g: pixel.color.g, b: pixel.color.b, a: pixel.color.a },
      };
    }
    cloned[y] = newRow;
  }
  return cloned;
}

// Helper to deep clone layers
function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map((layer) => ({
    ...layer,
    baseColor: { ...layer.baseColor },
    noiseSettings: { ...layer.noiseSettings },
  }));
}

// Helper to deep clone layer groups
function cloneLayerGroups(groups: LayerGroup[]): LayerGroup[] {
  return groups.map((group) => ({ ...group }));
}

// Helper to clone a single pixel
function clonePixel(pixel: PixelData): PixelData {
  return {
    layerId: pixel.layerId,
    color: { r: pixel.color.r, g: pixel.color.g, b: pixel.color.b, a: pixel.color.a },
  };
}

// Helper to clone a single layer
function cloneLayer(layer: Layer): Layer {
  return {
    ...layer,
    baseColor: { ...layer.baseColor },
    noiseSettings: { ...layer.noiseSettings },
  };
}

// Snapshot of state before changes (for diff calculation)
let snapshotPixels: PixelData[][] | null = null;
let snapshotLayers: Layer[] | null = null;
let snapshotLayerGroups: LayerGroup[] | null = null;

// Take a snapshot of current state before making changes
function takeSnapshot(pixels: PixelData[][], layers: Layer[], layerGroups: LayerGroup[]) {
  snapshotPixels = clonePixels(pixels);
  snapshotLayers = cloneLayers(layers);
  snapshotLayerGroups = cloneLayerGroups(layerGroups);
}

// Calculate diff between snapshot and current state
function calculateDiff(
  currentPixels: PixelData[][],
  currentLayers: Layer[],
  currentLayerGroups: LayerGroup[]
): HistoryEntry | null {
  if (!snapshotPixels || !snapshotLayers || !snapshotLayerGroups) {
    return null;
  }

  const pixelChanges: PixelChange[] = [];
  const layerChanges: LayerChange[] = [];
  const layerGroupChanges: LayerGroupChange[] = [];

  // Calculate pixel changes
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const oldPixel = snapshotPixels[y][x];
      const newPixel = currentPixels[y][x];
      if (
        oldPixel.layerId !== newPixel.layerId ||
        oldPixel.color.r !== newPixel.color.r ||
        oldPixel.color.g !== newPixel.color.g ||
        oldPixel.color.b !== newPixel.color.b ||
        oldPixel.color.a !== newPixel.color.a
      ) {
        pixelChanges.push({
          x,
          y,
          oldPixel: clonePixel(oldPixel),
          newPixel: clonePixel(newPixel),
        });
      }
    }
  }

  // Calculate layer changes
  const oldLayerMap = new Map(snapshotLayers.map(l => [l.id, l]));
  const newLayerMap = new Map(currentLayers.map(l => [l.id, l]));

  // Find removed and updated layers
  for (const oldLayer of snapshotLayers) {
    const newLayer = newLayerMap.get(oldLayer.id);
    if (!newLayer) {
      layerChanges.push({ type: 'remove', layerId: oldLayer.id, oldLayer: cloneLayer(oldLayer) });
    } else if (
      oldLayer.name !== newLayer.name ||
      oldLayer.baseColor.r !== newLayer.baseColor.r ||
      oldLayer.baseColor.g !== newLayer.baseColor.g ||
      oldLayer.baseColor.b !== newLayer.baseColor.b ||
      oldLayer.baseColor.a !== newLayer.baseColor.a ||
      oldLayer.noiseSettings.brightness !== newLayer.noiseSettings.brightness ||
      oldLayer.noiseSettings.hue !== newLayer.noiseSettings.hue ||
      oldLayer.groupId !== newLayer.groupId ||
      oldLayer.order !== newLayer.order ||
      oldLayer.layerType !== newLayer.layerType ||
      oldLayer.visible !== newLayer.visible
    ) {
      layerChanges.push({ type: 'update', layerId: oldLayer.id, oldLayer: cloneLayer(oldLayer), newLayer: cloneLayer(newLayer) });
    }
  }

  // Find added layers
  for (const newLayer of currentLayers) {
    if (!oldLayerMap.has(newLayer.id)) {
      layerChanges.push({ type: 'add', layerId: newLayer.id, newLayer: cloneLayer(newLayer) });
    }
  }

  // Calculate layer group changes
  const oldGroupMap = new Map(snapshotLayerGroups.map(g => [g.id, g]));
  const newGroupMap = new Map(currentLayerGroups.map(g => [g.id, g]));

  // Find removed and updated groups
  for (const oldGroup of snapshotLayerGroups) {
    const newGroup = newGroupMap.get(oldGroup.id);
    if (!newGroup) {
      layerGroupChanges.push({ type: 'remove', groupId: oldGroup.id, oldGroup: { ...oldGroup } });
    } else if (
      oldGroup.name !== newGroup.name ||
      oldGroup.collapsed !== newGroup.collapsed ||
      oldGroup.order !== newGroup.order ||
      oldGroup.visible !== newGroup.visible
    ) {
      layerGroupChanges.push({ type: 'update', groupId: oldGroup.id, oldGroup: { ...oldGroup }, newGroup: { ...newGroup } });
    }
  }

  // Find added groups
  for (const newGroup of currentLayerGroups) {
    if (!oldGroupMap.has(newGroup.id)) {
      layerGroupChanges.push({ type: 'add', groupId: newGroup.id, newGroup: { ...newGroup } });
    }
  }

  // If no changes, return null
  if (pixelChanges.length === 0 && layerChanges.length === 0 && layerGroupChanges.length === 0) {
    return null;
  }

  return { pixelChanges, layerChanges, layerGroupChanges };
}

// Clear snapshot after saving to history
function clearSnapshot() {
  snapshotPixels = null;
  snapshotLayers = null;
  snapshotLayerGroups = null;
}

// Noise direction type
type NoiseDirection = 'both' | 'positive' | 'negative';

// Material type for noise generation
// MaterialType is imported from '../types/editor'
export type { MaterialType } from '../types/editor';

// Apply brightness noise to a color
function applyBrightnessNoise(color: RGBA, intensity: number, direction: NoiseDirection = 'both'): RGBA {
  let variation: number;
  if (direction === 'positive') {
    variation = Math.random() * intensity * 2.55; // 0 to +intensity%
  } else if (direction === 'negative') {
    variation = -Math.random() * intensity * 2.55; // -intensity% to 0
  } else {
    variation = ((Math.random() - 0.5) * 2 * intensity * 2.55); // ±intensity%
  }
  return {
    r: Math.max(0, Math.min(255, Math.round(color.r + variation))),
    g: Math.max(0, Math.min(255, Math.round(color.g + variation))),
    b: Math.max(0, Math.min(255, Math.round(color.b + variation))),
    a: color.a,
  };
}

// Apply hue shift to a color
function applyHueShift(color: RGBA, intensity: number, direction: NoiseDirection = 'both'): RGBA {
  // Convert RGB to HSL
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    // Achromatic
    return color;
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  // Apply hue shift based on direction
  let shift: number;
  if (direction === 'positive') {
    shift = Math.random() * (intensity / 100) * 0.1; // 0 to +10%
  } else if (direction === 'negative') {
    shift = -Math.random() * (intensity / 100) * 0.1; // -10% to 0
  } else {
    shift = (Math.random() - 0.5) * 2 * (intensity / 100) * 0.1; // ±10%
  }
  h = (h + shift + 1) % 1;

  // Convert back to RGB
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    a: color.a,
  };
}

// Apply saturation shift to a color
function applySaturationShift(color: RGBA, intensity: number, direction: NoiseDirection = 'both'): RGBA {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return color;

  const d = max - min;
  let s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }

  // Apply saturation shift
  let shift: number;
  if (direction === 'positive') {
    shift = Math.random() * (intensity / 100) * 0.3;
  } else if (direction === 'negative') {
    shift = -Math.random() * (intensity / 100) * 0.3;
  } else {
    shift = (Math.random() - 0.5) * 2 * (intensity / 100) * 0.3;
  }
  s = Math.max(0, Math.min(1, s + shift));

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    a: color.a,
  };
}

// Material-specific noise application
function applyMaterialNoise(
  color: RGBA,
  brightness: number,
  hue: number,
  brightnessDir: NoiseDirection,
  hueDir: NoiseDirection,
  material: MaterialType
): RGBA {
  let result = { ...color };

  switch (material) {
    case 'hair': {
      // Hair: Strong directional brightness (darker streaks), subtle warm hue shift
      // Creates strand-like variation with mostly darkening
      if (brightness > 0) {
        // 70% chance of darkening, 30% chance of lightening
        const darkBias = Math.random() < 0.7 ? 'negative' : 'positive';
        result = applyBrightnessNoise(result, brightness * 1.2, darkBias);
      }
      if (hue > 0) {
        // Subtle warm shift for natural hair
        result = applyHueShift(result, hue * 0.5, 'positive');
      }
      break;
    }

    case 'cloth': {
      // Cloth: Moderate brightness variation, slight saturation shift for fabric texture
      // Creates woven/thread-like variation
      if (brightness > 0) {
        result = applyBrightnessNoise(result, brightness * 0.8, brightnessDir);
      }
      if (hue > 0) {
        // Slight desaturation for worn fabric look
        result = applySaturationShift(result, hue * 0.6, 'negative');
        result = applyHueShift(result, hue * 0.3, hueDir);
      }
      break;
    }

    case 'skin': {
      // Skin: Subtle brightness, warm/cool hue variation for natural skin tones
      // Creates subtle subsurface scattering-like effect
      if (brightness > 0) {
        // Subtle brightness, biased toward slight darkening
        result = applyBrightnessNoise(result, brightness * 0.6, brightnessDir);
      }
      if (hue > 0) {
        // Warm shift for blood/life undertones
        result = applyHueShift(result, hue * 0.7, 'positive');
        // Slight saturation variation
        result = applySaturationShift(result, hue * 0.3, 'both');
      }
      break;
    }

    case 'metal': {
      // Metal: High contrast brightness (specular highlights), minimal hue shift
      // Creates polished/reflective appearance
      if (brightness > 0) {
        // High contrast - either bright highlights or dark shadows
        const isHighlight = Math.random() < 0.3;
        if (isHighlight) {
          result = applyBrightnessNoise(result, brightness * 2.0, 'positive');
        } else {
          result = applyBrightnessNoise(result, brightness * 0.8, 'negative');
        }
      }
      if (hue > 0) {
        // Very subtle hue shift, slight desaturation for metallic look
        result = applySaturationShift(result, hue * 0.4, 'negative');
      }
      break;
    }

    case 'plastic': {
      // Plastic: Smooth brightness gradient, maintains saturation
      // Creates glossy, uniform appearance
      if (brightness > 0) {
        // Lower intensity, more uniform
        result = applyBrightnessNoise(result, brightness * 0.5, brightnessDir);
      }
      if (hue > 0) {
        // Plastic maintains color well, slight variation
        result = applyHueShift(result, hue * 0.4, hueDir);
      }
      break;
    }

    case 'other':
    default: {
      // Default behavior - original implementation
      if (brightness > 0) {
        result = applyBrightnessNoise(result, brightness, brightnessDir);
      }
      if (hue > 0) {
        result = applyHueShift(result, hue, hueDir);
      }
      break;
    }
  }

  return result;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // Initial state
  pixels: createEmptyPixels(),
  layers: [],
  layerGroups: [],
  activeLayerId: null,
  activeTool: 'pencil',
  highlightedLayerId: null,
  drawingColor: { r: 0, g: 0, b: 0, a: 255 }, // Default black
  modelType: 'steve',
  showLayer2: true,
  preservePixels: false,
  theme: 'system',
  history: [],
  historyIndex: -1,
  previewVersion: 0,
  palette: [],

  // Pixel actions
  setPixel: (x, y, layerId) => {
    if (x < 0 || x >= SKIN_WIDTH || y < 0 || y >= SKIN_HEIGHT) return;

    const { pixels, layers, layerGroups, drawingColor, preservePixels } = get();

    // Check if pixel needs to change
    const currentPixel = pixels[y][x];

    // Skip if preservePixels is enabled and pixel already has content
    if (preservePixels && currentPixel.color.a > 0) {
      return;
    }

    // Take snapshot if this is the first change in a drawing session
    if (!snapshotPixels) {
      takeSnapshot(pixels, layers, layerGroups);
    }

    let newColor: RGBA;
    let newLayerId: string | null;

    if (layerId === null) {
      // Eraser - set to transparent
      newLayerId = null;
      newColor = { r: 0, g: 0, b: 0, a: 0 };
    } else {
      const layer = layers.find((l) => l.id === layerId);
      if (layer) {
        newLayerId = layerId;
        newColor = layer.layerType === 'direct' ? drawingColor : layer.baseColor;
      } else if (layers.length === 0) {
        newLayerId = null;
        newColor = drawingColor;
      } else {
        return; // No valid layer, do nothing
      }
    }

    // Skip if pixel is already the same
    if (
      currentPixel.layerId === newLayerId &&
      currentPixel.color.r === newColor.r &&
      currentPixel.color.g === newColor.g &&
      currentPixel.color.b === newColor.b &&
      currentPixel.color.a === newColor.a
    ) {
      return;
    }

    // Create a shallow copy of the pixel array and only update the changed row
    const newPixels = [...pixels];
    newPixels[y] = [...pixels[y]];
    newPixels[y][x] = {
      layerId: newLayerId,
      color: { ...newColor },
    };

    // Note: History is NOT saved here - it's saved in commitDrawing() when drawing ends
    set({ pixels: newPixels });
  },

  setPixelRect: (x1, y1, x2, y2, layerId) => {
    const { pixels, layers, layerGroups, drawingColor, preservePixels, saveToHistory, previewVersion } = get();

    // Take snapshot before making changes
    takeSnapshot(pixels, layers, layerGroups);

    const newPixels = clonePixels(pixels);

    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(SKIN_WIDTH - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(SKIN_HEIGHT - 1, Math.max(y1, y2));

    const layer = layerId ? layers.find((l) => l.id === layerId) : null;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        // Skip if preservePixels is enabled and pixel already has content
        if (preservePixels && pixels[y][x].color.a > 0) {
          continue;
        }

        if (layerId === null) {
          newPixels[y][x] = {
            layerId: null,
            color: { r: 0, g: 0, b: 0, a: 0 },
          };
        } else if (layer) {
          // For 'direct' layers, use drawingColor; for 'singleColor', use baseColor
          const colorToUse = layer.layerType === 'direct' ? drawingColor : layer.baseColor;
          newPixels[y][x] = {
            layerId,
            color: { ...colorToUse },
          };
        } else if (layers.length === 0) {
          // No layers exist - draw directly with drawingColor
          newPixels[y][x] = {
            layerId: null,
            color: { ...drawingColor },
          };
        }
      }
    }

    saveToHistory();
    set({ pixels: newPixels, previewVersion: previewVersion + 1 });
  },

  commitDrawing: () => {
    const { saveToHistory } = get();
    saveToHistory();
    set((state) => ({ previewVersion: state.previewVersion + 1 }));
  },

  setActiveTool: (tool) => set({ activeTool: tool }),
  setActiveLayer: (layerId) => set({ activeLayerId: layerId }),
  setHighlightedLayer: (layerId) => set({ highlightedLayerId: layerId }),
  setDrawingColor: (color) => set({ drawingColor: color }),

  // Layer actions
  createLayer: (name, color, layerType = 'singleColor') => {
    const id = generateId();
    const { layers } = get();
    const maxOrder = layers.length > 0 ? Math.max(...layers.map(l => l.order)) : -1;
    const newLayer: Layer = {
      id,
      name,
      baseColor: color,
      noiseSettings: { brightness: 0, hue: 0 },
      groupId: null,
      order: maxOrder + 1,
      layerType,
      visible: true,
    };
    set((state) => ({
      layers: [...state.layers, newLayer],
      activeLayerId: id,
    }));
    return id;
  },

  updateLayerColor: (layerId, color) => {
    const { pixels, layers } = get();
    const newLayers = layers.map((l) =>
      l.id === layerId ? { ...l, baseColor: color } : l
    );

    // Update all pixels belonging to this layer
    const newPixels = pixels.map((row) =>
      row.map((pixel) =>
        pixel.layerId === layerId
          ? { ...pixel, color: { ...color } }
          : pixel
      )
    );

    set((state) => ({ layers: newLayers, pixels: newPixels, previewVersion: state.previewVersion + 1 }));
  },

  updateLayerName: (layerId, name) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, name } : l
      ),
    }));
  },

  updateLayerType: (layerId, layerType) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, layerType } : l
      ),
    }));
  },

  toggleLayerVisibility: (layerId) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, visible: !l.visible } : l
      ),
      previewVersion: state.previewVersion + 1,
    }));
  },

  deleteLayer: (layerId) => {
    const { pixels, layers, activeLayerId } = get();

    // Remove layer
    const newLayers = layers.filter((l) => l.id !== layerId);

    // Clear pixels belonging to this layer
    const newPixels = pixels.map((row) =>
      row.map((pixel) =>
        pixel.layerId === layerId
          ? { layerId: null, color: { r: 0, g: 0, b: 0, a: 0 } }
          : pixel
      )
    );

    set((state) => ({
      layers: newLayers,
      pixels: newPixels,
      activeLayerId: activeLayerId === layerId ? null : activeLayerId,
      previewVersion: state.previewVersion + 1,
    }));
  },

  applyNoise: (layerId, brightness, hue, brightnessDirection = 'both', hueDirection = 'both', material = 'other') => {
    const { pixels, layers } = get();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;

    // Update layer noise settings (including material)
    const newLayers = layers.map((l) =>
      l.id === layerId
        ? { ...l, noiseSettings: { brightness, hue, material } }
        : l
    );

    // Apply noise to all pixels in this layer using material-specific function
    const newPixels = pixels.map((row) =>
      row.map((pixel) => {
        if (pixel.layerId !== layerId) return pixel;

        const newColor = applyMaterialNoise(
          layer.baseColor,
          brightness,
          hue,
          brightnessDirection,
          hueDirection,
          material
        );
        return { ...pixel, color: newColor };
      })
    );

    set((state) => ({ layers: newLayers, pixels: newPixels, previewVersion: state.previewVersion + 1 }));
  },

  resetNoise: (layerId) => {
    const { pixels, layers } = get();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;

    // Reset noise settings to zero
    const newLayers = layers.map((l) =>
      l.id === layerId
        ? { ...l, noiseSettings: { brightness: 0, hue: 0, material: undefined } }
        : l
    );

    // Reset all pixels in this layer to the base color
    const newPixels = pixels.map((row) =>
      row.map((pixel) => {
        if (pixel.layerId !== layerId) return pixel;
        return { ...pixel, color: { ...layer.baseColor } };
      })
    );

    set((state) => ({ layers: newLayers, pixels: newPixels, previewVersion: state.previewVersion + 1 }));
  },

  reorderLayer: (layerId, newOrder, newGroupId) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, order: newOrder, groupId: newGroupId } : l
      ),
    }));
  },

  duplicateLayer: (layerId) => {
    const { pixels, layers, layerGroups, saveToHistory } = get();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return null;

    // Take snapshot before making changes
    takeSnapshot(pixels, layers, layerGroups);

    // Create a new layer with copied properties
    const newId = generateId();
    const maxOrder = layers.length > 0 ? Math.max(...layers.map(l => l.order)) : -1;
    const newLayer: Layer = {
      ...layer,
      id: newId,
      name: `${layer.name} のコピー`,
      baseColor: { ...layer.baseColor },
      noiseSettings: { ...layer.noiseSettings },
      order: maxOrder + 1,
      groupId: null, // Don't preserve group
    };

    // Clone pixels and apply copied pixels to new layer
    const newPixels = clonePixels(pixels);
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const pixel = pixels[y][x];
        if (pixel.layerId === layerId) {
          newPixels[y][x] = {
            layerId: newId,
            color: { ...pixel.color },
          };
        }
      }
    }

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      layers: [...state.layers, newLayer],
      activeLayerId: newId,
      previewVersion: state.previewVersion + 1,
    }));

    return newId;
  },

  // Layer group actions
  createLayerGroup: (name) => {
    const id = generateId();
    const { layerGroups } = get();
    const maxOrder = layerGroups.length > 0 ? Math.max(...layerGroups.map(g => g.order)) : -1;
    const newGroup: LayerGroup = {
      id,
      name,
      collapsed: false,
      order: maxOrder + 1,
      visible: true,
    };
    set((state) => ({
      layerGroups: [...state.layerGroups, newGroup],
    }));
    return id;
  },

  updateLayerGroupName: (groupId, name) => {
    set((state) => ({
      layerGroups: state.layerGroups.map((g) =>
        g.id === groupId ? { ...g, name } : g
      ),
    }));
  },

  deleteLayerGroup: (groupId) => {
    set((state) => ({
      layerGroups: state.layerGroups.filter((g) => g.id !== groupId),
      // Move layers out of the deleted group
      layers: state.layers.map((l) =>
        l.groupId === groupId ? { ...l, groupId: null } : l
      ),
    }));
  },

  toggleLayerGroupCollapsed: (groupId) => {
    set((state) => ({
      layerGroups: state.layerGroups.map((g) =>
        g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
      ),
    }));
  },

  toggleLayerGroupVisibility: (groupId) => {
    set((state) => ({
      layerGroups: state.layerGroups.map((g) =>
        g.id === groupId ? { ...g, visible: !g.visible } : g
      ),
      previewVersion: state.previewVersion + 1,
    }));
  },

  reorderLayerGroup: (groupId, newOrder) => {
    set((state) => ({
      layerGroups: state.layerGroups.map((g) =>
        g.id === groupId ? { ...g, order: newOrder } : g
      ),
    }));
  },

  moveLayerToGroup: (layerId, groupId) => {
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (!layer) return state;

      // Calculate new order within target group
      const targetLayers = state.layers.filter((l) => l.groupId === groupId);
      const maxOrder = targetLayers.length > 0 ? Math.max(...targetLayers.map(l => l.order)) : -1;

      return {
        layers: state.layers.map((l) =>
          l.id === layerId ? { ...l, groupId, order: maxOrder + 1 } : l
        ),
      };
    });
  },

  // Settings actions
  setModelType: (type) => set({ modelType: type }),
  toggleLayer2: () => set((state) => ({ showLayer2: !state.showLayer2 })),
  togglePreservePixels: () => set((state) => ({ preservePixels: !state.preservePixels })),
  setTheme: (theme) => set({ theme }),

  // History actions (diff-based)
  saveToHistory: () => {
    const { pixels, layers, layerGroups, history, historyIndex } = get();

    // Calculate diff from snapshot
    const diff = calculateDiff(pixels, layers, layerGroups);

    // Clear snapshot after calculating diff
    clearSnapshot();

    // If no changes, don't save
    if (!diff) {
      return;
    }

    // Truncate future history if we're not at the end
    const newHistory = history.slice(0, historyIndex + 1);

    // Add diff entry
    newHistory.push(diff);

    // Limit history size
    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
    }

    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  undo: () => {
    const { pixels, layers, layerGroups, history, historyIndex } = get();
    if (historyIndex < 0) return;

    const entry = history[historyIndex];

    // Apply reverse of the diff
    const newPixels = [...pixels];
    for (const change of entry.pixelChanges) {
      if (newPixels[change.y] === pixels[change.y]) {
        newPixels[change.y] = [...pixels[change.y]];
      }
      newPixels[change.y][change.x] = clonePixel(change.oldPixel);
    }

    // Reverse layer changes
    let newLayers = [...layers];
    for (const change of entry.layerChanges) {
      if (change.type === 'add') {
        // Reverse add = remove
        newLayers = newLayers.filter(l => l.id !== change.layerId);
      } else if (change.type === 'remove' && change.oldLayer) {
        // Reverse remove = add
        newLayers.push(cloneLayer(change.oldLayer));
      } else if (change.type === 'update' && change.oldLayer) {
        // Reverse update = restore old
        newLayers = newLayers.map(l => l.id === change.layerId ? cloneLayer(change.oldLayer!) : l);
      }
    }

    // Reverse layer group changes
    let newLayerGroups = [...layerGroups];
    for (const change of entry.layerGroupChanges) {
      if (change.type === 'add') {
        newLayerGroups = newLayerGroups.filter(g => g.id !== change.groupId);
      } else if (change.type === 'remove' && change.oldGroup) {
        newLayerGroups.push({ ...change.oldGroup });
      } else if (change.type === 'update' && change.oldGroup) {
        newLayerGroups = newLayerGroups.map(g => g.id === change.groupId ? { ...change.oldGroup! } : g);
      }
    }

    set((state) => ({
      pixels: newPixels,
      layers: newLayers,
      layerGroups: newLayerGroups,
      historyIndex: historyIndex - 1,
      previewVersion: state.previewVersion + 1,
    }));
  },

  redo: () => {
    const { pixels, layers, layerGroups, history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    const entry = history[newIndex];

    // Apply the diff
    const newPixels = [...pixels];
    for (const change of entry.pixelChanges) {
      if (newPixels[change.y] === pixels[change.y]) {
        newPixels[change.y] = [...pixels[change.y]];
      }
      newPixels[change.y][change.x] = clonePixel(change.newPixel);
    }

    // Apply layer changes
    let newLayers = [...layers];
    for (const change of entry.layerChanges) {
      if (change.type === 'add' && change.newLayer) {
        newLayers.push(cloneLayer(change.newLayer));
      } else if (change.type === 'remove') {
        newLayers = newLayers.filter(l => l.id !== change.layerId);
      } else if (change.type === 'update' && change.newLayer) {
        newLayers = newLayers.map(l => l.id === change.layerId ? cloneLayer(change.newLayer!) : l);
      }
    }

    // Apply layer group changes
    let newLayerGroups = [...layerGroups];
    for (const change of entry.layerGroupChanges) {
      if (change.type === 'add' && change.newGroup) {
        newLayerGroups.push({ ...change.newGroup });
      } else if (change.type === 'remove') {
        newLayerGroups = newLayerGroups.filter(g => g.id !== change.groupId);
      } else if (change.type === 'update' && change.newGroup) {
        newLayerGroups = newLayerGroups.map(g => g.id === change.groupId ? { ...change.newGroup! } : g);
      }
    }

    set((state) => ({
      pixels: newPixels,
      layers: newLayers,
      layerGroups: newLayerGroups,
      historyIndex: newIndex,
      previewVersion: state.previewVersion + 1,
    }));
  },

  // File actions
  loadFromImageData: (imageData) => {
    const { pixels, layers, layerGroups, saveToHistory } = get();
    takeSnapshot(pixels, layers, layerGroups);
    const newPixels: PixelData[][] = [];

    // Create a single layer for all imported pixels
    const layerId = generateId();
    const newLayer: Layer = {
      id: layerId,
      name: 'インポート画像',
      baseColor: { r: 128, g: 128, b: 128, a: 255 }, // Neutral gray as base
      noiseSettings: { brightness: 0, hue: 0 },
      groupId: null,
      order: 0,
      layerType: 'direct', // Multi-color mode for imported images
      visible: true,
    };

    // Load pixels and assign to the layer
    let hasPixels = false;
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      newPixels[y] = [];
      for (let x = 0; x < SKIN_WIDTH; x++) {
        if (x < imageData.width && y < imageData.height) {
          const i = (y * imageData.width + x) * 4;
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          const a = imageData.data[i + 3];

          // Assign non-transparent pixels to the layer
          if (a > 0) {
            hasPixels = true;
            newPixels[y][x] = {
              layerId: layerId,
              color: { r, g, b, a },
            };
          } else {
            newPixels[y][x] = {
              layerId: null,
              color: { r: 0, g: 0, b: 0, a: 0 },
            };
          }
        } else {
          newPixels[y][x] = {
            layerId: null,
            color: { r: 0, g: 0, b: 0, a: 0 },
          };
        }
      }
    }

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      layers: hasPixels ? [newLayer] : [],
      layerGroups: [],
      activeLayerId: hasPixels ? layerId : null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  generateLayers: (options = {}) => {
    const { pixels, layers, layerGroups, saveToHistory } = get();
    takeSnapshot(pixels, layers, layerGroups);
    const { threshold = 'normal', thresholdValue: customThreshold, applyNoise = true } = options;
    // Use custom threshold value if provided, otherwise use preset
    const finalThreshold = customThreshold ?? COLOR_THRESHOLD_PRESETS[threshold];

    // Convert current pixels to ImageData for layer generation
    const imageData = new ImageData(SKIN_WIDTH, SKIN_HEIGHT);
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const i = (y * SKIN_WIDTH + x) * 4;
        const pixel = pixels[y][x];
        imageData.data[i] = pixel.color.r;
        imageData.data[i + 1] = pixel.color.g;
        imageData.data[i + 2] = pixel.color.b;
        imageData.data[i + 3] = pixel.color.a;
      }
    }

    // Generate layers based on color similarity, adjacency, and body parts
    const { pixels: newPixels, layers: newLayers } = generateLayersFromImageData(
      imageData,
      finalThreshold,
      applyNoise
    );

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      layers: newLayers,
      activeLayerId: newLayers.length > 0 ? newLayers[0].id : null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  mergeLayersById: (sourceLayerId, targetLayerId) => {
    const { pixels, layers, layerGroups, saveToHistory } = get();
    takeSnapshot(pixels, layers, layerGroups);

    const { pixels: newPixels, layers: newLayers } = mergeLayers(
      pixels,
      layers,
      sourceLayerId,
      targetLayerId
    );

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      layers: newLayers,
      activeLayerId: state.activeLayerId === sourceLayerId ? targetLayerId : state.activeLayerId,
      previewVersion: state.previewVersion + 1,
    }));
  },

  mergeSimilarLayersAction: (options = {}) => {
    const { pixels, layers, layerGroups, saveToHistory } = get();
    takeSnapshot(pixels, layers, layerGroups);
    const { threshold = 'normal', thresholdValue: customThreshold, applyNoise = true } = options;
    // Use custom threshold value if provided, otherwise use preset
    const finalThreshold = customThreshold ?? COLOR_THRESHOLD_PRESETS[threshold];

    const { pixels: newPixels, layers: newLayers } = mergeSimilarLayers(
      pixels,
      layers,
      finalThreshold,
      applyNoise
    );

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      layers: newLayers,
      activeLayerId: newLayers.length > 0 ? newLayers[0].id : null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  splitLayerByColorAction: (layerId, options = {}) => {
    const { pixels, layers, layerGroups, saveToHistory } = get();
    takeSnapshot(pixels, layers, layerGroups);
    const { threshold = 'strict', thresholdValue: customThreshold, applyNoise = false } = options;
    // Use custom threshold value if provided, otherwise use preset
    const finalThreshold = customThreshold ?? COLOR_THRESHOLD_PRESETS[threshold];

    const { pixels: newPixels, layers: newLayers } = splitLayerByColor(
      pixels,
      layers,
      layerId,
      finalThreshold,
      applyNoise
    );

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      layers: newLayers,
      previewVersion: state.previewVersion + 1,
    }));
  },

  splitLayerBySelectionAction: (layerId, selectedPixels) => {
    const { pixels, layers, layerGroups, saveToHistory } = get();
    takeSnapshot(pixels, layers, layerGroups);

    const { pixels: newPixels, layers: newLayers, newLayerId } = splitLayerBySelection(
      pixels,
      layers,
      layerId,
      selectedPixels
    );

    if (newLayerId) {
      saveToHistory();
      set((state) => ({
        pixels: newPixels,
        layers: newLayers,
        activeLayerId: newLayerId,
        previewVersion: state.previewVersion + 1,
      }));
    }

    return newLayerId;
  },

  blendBordersAction: (blendStrength = 15, layerId?: string) => {
    const { pixels, layers, layerGroups, saveToHistory } = get();
    takeSnapshot(pixels, layers, layerGroups);

    const { pixels: newPixels } = blendBorderPixels(pixels, blendStrength, layerId);

    saveToHistory();
    set((state) => ({ pixels: newPixels, previewVersion: state.previewVersion + 1 }));
  },

  getImageData: () => {
    const { pixels } = get();
    const imageData = new ImageData(SKIN_WIDTH, SKIN_HEIGHT);

    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const i = (y * SKIN_WIDTH + x) * 4;
        const pixel = pixels[y][x];
        imageData.data[i] = pixel.color.r;
        imageData.data[i + 1] = pixel.color.g;
        imageData.data[i + 2] = pixel.color.b;
        imageData.data[i + 3] = pixel.color.a;
      }
    }

    return imageData;
  },

  reset: () => {
    set({
      pixels: createEmptyPixels(),
      layers: [],
      layerGroups: [],
      activeLayerId: null,
      activeTool: 'pencil',
      highlightedLayerId: null,
      history: [],
      historyIndex: -1,
      // Note: palette is intentionally NOT reset to preserve user's saved colors
    });
  },

  // Palette actions
  addToPalette: (color, name) => {
    const id = generateId();
    set((state) => ({
      palette: [...state.palette, { id, color: { ...color }, name }],
    }));
  },

  removeFromPalette: (id) => {
    set((state) => ({
      palette: state.palette.filter((p) => p.id !== id),
    }));
  },

  updatePaletteColor: (id, color) => {
    set((state) => ({
      palette: state.palette.map((p) =>
        p.id === id ? { ...p, color: { ...color } } : p
      ),
    }));
  },

  renamePaletteColor: (id, name) => {
    set((state) => ({
      palette: state.palette.map((p) =>
        p.id === id ? { ...p, name } : p
      ),
    }));
  },

  clearPalette: () => {
    set({ palette: [] });
  },
}));
