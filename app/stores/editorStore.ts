import { create } from 'zustand';
import {
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
  type LayerPixels,
  SKIN_WIDTH,
  SKIN_HEIGHT,
  MAX_HISTORY,
  generateId,
} from '../types/editor';
import { computeLayerComposite, rgbaEqual } from '../lib/layerComposite';
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
import { getPixelEngine } from '../lib/pixelEngine';

// Helper: Create empty layer pixels (64x64 grid of null)
function createEmptyLayerPixels(): LayerPixels {
  const pixels: LayerPixels = [];
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    pixels[y] = [];
    for (let x = 0; x < SKIN_WIDTH; x++) {
      pixels[y][x] = null;
    }
  }
  return pixels;
}

// Helper: Clone layer pixels (deep copy)
function cloneLayerPixels(pixels: LayerPixels): LayerPixels {
  return pixels.map(row => row.map(p => p ? { ...p } : null));
}

// Helper: Convert LayerPixels to Uint8ClampedArray for PixelEngine
function layerPixelsToUint8(pixels: LayerPixels): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4);
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const pixel = pixels[y]?.[x];
      const i = (y * SKIN_WIDTH + x) * 4;
      if (pixel) {
        data[i] = pixel.r;
        data[i + 1] = pixel.g;
        data[i + 2] = pixel.b;
        data[i + 3] = pixel.a;
      }
    }
  }
  return data;
}

// Helper: Convert Uint8ClampedArray to LayerPixels
function uint8ToLayerPixels(data: Uint8ClampedArray): LayerPixels {
  const pixels: LayerPixels = createEmptyLayerPixels();
  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const i = (y * SKIN_WIDTH + x) * 4;
      const a = data[i + 3];
      if (a > 0) {
        pixels[y][x] = {
          r: data[i],
          g: data[i + 1],
          b: data[i + 2],
          a
        };
      }
    }
  }
  return pixels;
}

interface EditorState {
  // Canvas data - layers now contain their own pixels
  layers: Layer[];
  layerGroups: LayerGroup[];

  // Composite cache (computed from layers)
  compositeCache: RGBA[][] | null;

  // Selection state
  activeLayerId: string | null;
  activeTool: ToolType;
  highlightedLayerId: string | null;

  // Direct drawing color
  drawingColor: RGBA;

  // Settings
  modelType: ModelType;
  showLayer2: boolean;
  preservePixels: boolean;
  theme: ThemeType;

  // History
  history: HistoryEntry[];
  historyIndex: number;

  // Preview update version
  previewVersion: number;

  // Color palette
  palette: PaletteColor[];

  // Actions
  setPixel: (x: number, y: number, color: RGBA | null) => void;
  setPixelRect: (x1: number, y1: number, x2: number, y2: number, color: RGBA | null) => void;
  commitDrawing: () => void;
  setActiveTool: (tool: ToolType) => void;
  setActiveLayer: (layerId: string | null) => void;
  setHighlightedLayer: (layerId: string | null) => void;
  setDrawingColor: (color: RGBA) => void;

  // Composite getter
  getComposite: () => RGBA[][];

  // Layer actions
  createLayer: (name: string, color: RGBA, layerType?: LayerType) => string;
  updateLayerColor: (layerId: string, color: RGBA) => void;
  updateLayerName: (layerId: string, name: string) => void;
  updateLayerType: (layerId: string, layerType: LayerType) => void;
  updateLayerOpacity: (layerId: string, opacity: number) => void;
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

// Helper to deep clone a layer (including pixels)
function cloneLayer(layer: Layer): Layer {
  return {
    ...layer,
    baseColor: { ...layer.baseColor },
    noiseSettings: { ...layer.noiseSettings },
    pixels: cloneLayerPixels(layer.pixels),
  };
}

// Helper to deep clone layers
function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map(cloneLayer);
}

// Helper to deep clone layer groups
function cloneLayerGroups(groups: LayerGroup[]): LayerGroup[] {
  return groups.map((group) => ({ ...group }));
}

// Snapshot of state before changes (for diff calculation)
let snapshotLayers: Layer[] | null = null;
let snapshotLayerGroups: LayerGroup[] | null = null;

// Take a snapshot of current state before making changes
function takeSnapshot(layers: Layer[], layerGroups: LayerGroup[]) {
  snapshotLayers = cloneLayers(layers);
  snapshotLayerGroups = cloneLayerGroups(layerGroups);
}

// Calculate diff between snapshot and current state
function calculateDiff(
  currentLayers: Layer[],
  currentLayerGroups: LayerGroup[]
): HistoryEntry | null {
  if (!snapshotLayers || !snapshotLayerGroups) {
    return null;
  }

  const pixelChanges: PixelChange[] = [];
  const layerChanges: LayerChange[] = [];
  const layerGroupChanges: LayerGroupChange[] = [];

  // Build maps for comparison
  const oldLayerMap = new Map(snapshotLayers.map(l => [l.id, l]));
  const newLayerMap = new Map(currentLayers.map(l => [l.id, l]));

  // Calculate pixel changes for existing layers
  for (const oldLayer of snapshotLayers) {
    const newLayer = newLayerMap.get(oldLayer.id);
    if (newLayer) {
      // Compare pixels
      for (let y = 0; y < SKIN_HEIGHT; y++) {
        for (let x = 0; x < SKIN_WIDTH; x++) {
          const oldPixel = oldLayer.pixels[y]?.[x] ?? null;
          const newPixel = newLayer.pixels[y]?.[x] ?? null;
          if (!rgbaEqual(oldPixel, newPixel)) {
            pixelChanges.push({
              layerId: oldLayer.id,
              x,
              y,
              oldPixel: oldPixel ? { ...oldPixel } : null,
              newPixel: newPixel ? { ...newPixel } : null,
            });
          }
        }
      }
    }
  }

  // Find removed and updated layers (metadata only, pixels handled above)
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
      oldLayer.visible !== newLayer.visible ||
      oldLayer.opacity !== newLayer.opacity
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

  for (const newGroup of currentLayerGroups) {
    if (!oldGroupMap.has(newGroup.id)) {
      layerGroupChanges.push({ type: 'add', groupId: newGroup.id, newGroup: { ...newGroup } });
    }
  }

  if (pixelChanges.length === 0 && layerChanges.length === 0 && layerGroupChanges.length === 0) {
    return null;
  }

  return { pixelChanges, layerChanges, layerGroupChanges };
}

// Clear snapshot after saving to history
function clearSnapshot() {
  snapshotLayers = null;
  snapshotLayerGroups = null;
}

// Noise direction type
type NoiseDirection = 'both' | 'positive' | 'negative';

// Export MaterialType from types
export type { MaterialType } from '../types/editor';

// Apply brightness noise to a color
function applyBrightnessNoise(color: RGBA, intensity: number, direction: NoiseDirection = 'both'): RGBA {
  let variation: number;
  if (direction === 'positive') {
    variation = Math.random() * intensity * 2.55;
  } else if (direction === 'negative') {
    variation = -Math.random() * intensity * 2.55;
  } else {
    variation = ((Math.random() - 0.5) * 2 * intensity * 2.55);
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
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
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

  let shift: number;
  if (direction === 'positive') {
    shift = Math.random() * (intensity / 100) * 0.1;
  } else if (direction === 'negative') {
    shift = -Math.random() * (intensity / 100) * 0.1;
  } else {
    shift = (Math.random() - 0.5) * 2 * (intensity / 100) * 0.1;
  }
  h = (h + shift + 1) % 1;

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

// Apply saturation shift
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
      if (brightness > 0) {
        const darkBias = Math.random() < 0.7 ? 'negative' : 'positive';
        result = applyBrightnessNoise(result, brightness * 1.2, darkBias);
      }
      if (hue > 0) {
        result = applyHueShift(result, hue * 0.5, 'positive');
      }
      break;
    }

    case 'cloth': {
      if (brightness > 0) {
        result = applyBrightnessNoise(result, brightness * 0.8, brightnessDir);
      }
      if (hue > 0) {
        result = applySaturationShift(result, hue * 0.6, 'negative');
        result = applyHueShift(result, hue * 0.3, hueDir);
      }
      break;
    }

    case 'skin': {
      if (brightness > 0) {
        result = applyBrightnessNoise(result, brightness * 0.6, brightnessDir);
      }
      if (hue > 0) {
        result = applyHueShift(result, hue * 0.7, 'positive');
        result = applySaturationShift(result, hue * 0.3, 'both');
      }
      break;
    }

    case 'metal': {
      if (brightness > 0) {
        const isHighlight = Math.random() < 0.3;
        if (isHighlight) {
          result = applyBrightnessNoise(result, brightness * 2.0, 'positive');
        } else {
          result = applyBrightnessNoise(result, brightness * 0.8, 'negative');
        }
      }
      if (hue > 0) {
        result = applySaturationShift(result, hue * 0.4, 'negative');
      }
      break;
    }

    case 'plastic': {
      if (brightness > 0) {
        result = applyBrightnessNoise(result, brightness * 0.5, brightnessDir);
      }
      if (hue > 0) {
        result = applyHueShift(result, hue * 0.4, hueDir);
      }
      break;
    }

    case 'other':
    default: {
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

// Auto-create layer helper
function ensureActiveLayer(state: EditorState, set: (partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void): string {
  if (state.activeLayerId) {
    const layer = state.layers.find(l => l.id === state.activeLayerId);
    if (layer) return state.activeLayerId;
  }

  // Auto-create a new layer
  const id = generateId();
  const maxOrder = state.layers.length > 0 ? Math.max(...state.layers.map(l => l.order)) : -1;
  const newLayer: Layer = {
    id,
    name: '新規レイヤー',
    baseColor: state.drawingColor,
    noiseSettings: { brightness: 0, hue: 0 },
    groupId: null,
    order: maxOrder + 1,
    layerType: 'direct',
    visible: true,
    opacity: 100,
    pixels: createEmptyLayerPixels(),
  };

  set({
    layers: [...state.layers, newLayer],
    activeLayerId: id,
    compositeCache: null,
  });

  return id;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // Initial state
  layers: [],
  layerGroups: [],
  compositeCache: null,
  activeLayerId: null,
  activeTool: 'pencil',
  highlightedLayerId: null,
  drawingColor: { r: 0, g: 0, b: 0, a: 255 },
  modelType: 'steve',
  showLayer2: true,
  preservePixels: false,
  theme: 'system',
  history: [],
  historyIndex: -1,
  previewVersion: 0,
  palette: [],

  // Get composite (with caching)
  // Note: compositeCache is invalidated when layers change, but lazily recomputed
  getComposite: () => {
    const state = get();
    if (state.compositeCache) return state.compositeCache;

    const composite = computeLayerComposite(state.layers, state.layerGroups);
    // Use setState without triggering re-render cycle for cache update
    set({ compositeCache: composite });
    return composite;
  },

  // Pixel actions - now modifies only the active layer
  // Optimized: directly mutates pixel array, creates shallow copy of layer reference
  // Also sends data to PixelEngine for high-performance rendering
  setPixel: (x, y, color) => {
    if (x < 0 || x >= SKIN_WIDTH || y < 0 || y >= SKIN_HEIGHT) return;

    const state = get();
    const { layerGroups, preservePixels } = state;

    // Ensure we have an active layer (auto-create if needed)
    const activeLayerId = ensureActiveLayer(state, set);

    // Get updated state after potential layer creation
    const updatedState = get();
    const layerIndex = updatedState.layers.findIndex(l => l.id === activeLayerId);
    if (layerIndex === -1) return;

    const layer = updatedState.layers[layerIndex];
    const currentPixel = layer.pixels[y]?.[x] ?? null;

    // Skip if preservePixels is enabled and pixel already has content
    if (preservePixels && currentPixel && currentPixel.a > 0) {
      return;
    }

    // Determine the color to use
    let newColor: RGBA | null;
    if (color === null) {
      newColor = null;
    } else {
      newColor = layer.layerType === 'direct' ? color : layer.baseColor;
    }

    // Check if pixel is already the same
    if (rgbaEqual(currentPixel, newColor)) {
      return;
    }

    // Take snapshot if this is the first change in a drawing session
    if (!snapshotLayers) {
      takeSnapshot(updatedState.layers, layerGroups);
    }

    // Directly mutate the pixel array for performance
    // Create new layer reference only (shallow copy) to trigger React updates
    layer.pixels[y][x] = newColor ? { ...newColor } : null;

    // Send to PixelEngine for high-performance rendering
    const engine = getPixelEngine();
    if (newColor) {
      engine.setPixel(activeLayerId, x, y, newColor.r, newColor.g, newColor.b, newColor.a);
    } else {
      engine.erasePixel(activeLayerId, x, y);
    }

    // Create a new layers array with the same layer reference
    // (Zustand detects change via array reference, component uses layer.pixels)
    const newLayers = updatedState.layers.slice();
    newLayers[layerIndex] = { ...layer };

    set({ layers: newLayers, compositeCache: null });
  },

  setPixelRect: (x1, y1, x2, y2, color) => {
    const state = get();
    const { layerGroups, preservePixels } = state;

    // Ensure we have an active layer
    const activeLayerId = ensureActiveLayer(state, set);

    // Get updated state
    const updatedState = get();
    const layerIndex = updatedState.layers.findIndex(l => l.id === activeLayerId);
    if (layerIndex === -1) return;

    // Take snapshot before making changes
    takeSnapshot(updatedState.layers, layerGroups);

    const layer = updatedState.layers[layerIndex];
    const layerPixels = layer.pixels;

    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(SKIN_WIDTH - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(SKIN_HEIGHT - 1, Math.max(y1, y2));

    // Determine the color to use
    const colorToUse = color === null ? null : (layer.layerType === 'direct' ? color : layer.baseColor);

    // Directly mutate pixels for performance
    for (let y = minY; y <= maxY; y++) {
      const row = layerPixels[y];
      for (let x = minX; x <= maxX; x++) {
        const existingPixel = row[x];
        if (preservePixels && existingPixel && existingPixel.a > 0) {
          continue;
        }
        row[x] = colorToUse ? { ...colorToUse } : null;
      }
    }

    // Send to PixelEngine for high-performance rendering
    const engine = getPixelEngine();
    if (colorToUse) {
      engine.setPixelRect(activeLayerId, minX, minY, maxX, maxY, colorToUse.r, colorToUse.g, colorToUse.b, colorToUse.a);
    } else {
      engine.erasePixelRect(activeLayerId, minX, minY, maxX, maxY);
    }

    // Create shallow copies to trigger React updates
    const newLayers = updatedState.layers.slice();
    newLayers[layerIndex] = { ...layer };

    const { saveToHistory } = get();
    set({ layers: newLayers, compositeCache: null });
    saveToHistory();
    set((state) => ({ previewVersion: state.previewVersion + 1 }));
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
      opacity: 100,
      pixels: createEmptyLayerPixels(),
    };

    // Create layer in PixelEngine
    const engine = getPixelEngine();
    engine.createLayer(id, maxOrder + 1);

    set((state) => ({
      layers: [...state.layers, newLayer],
      activeLayerId: id,
      compositeCache: null,
    }));
    return id;
  },

  updateLayerColor: (layerId, color) => {
    const { layers } = get();
    const layerIndex = layers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const newLayerPixels = cloneLayerPixels(layer.pixels);

    // Update all pixels in this layer to the new color (for singleColor mode)
    if (layer.layerType === 'singleColor') {
      for (let y = 0; y < SKIN_HEIGHT; y++) {
        for (let x = 0; x < SKIN_WIDTH; x++) {
          if (newLayerPixels[y][x]?.a && newLayerPixels[y][x]!.a > 0) {
            newLayerPixels[y][x] = { ...color };
          }
        }
      }
    }

    const newLayers = [...layers];
    newLayers[layerIndex] = { ...layer, baseColor: color, pixels: newLayerPixels };

    // Sync to PixelEngine
    const engine = getPixelEngine();
    engine.setLayerData(layerId, layer.order, layerPixelsToUint8(newLayerPixels));

    set((state) => ({ layers: newLayers, compositeCache: null, previewVersion: state.previewVersion + 1 }));
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

  updateLayerOpacity: (layerId, opacity) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, opacity: Math.max(0, Math.min(100, opacity)) } : l
      ),
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  toggleLayerVisibility: (layerId) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, visible: !l.visible } : l
      ),
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  deleteLayer: (layerId) => {
    const { activeLayerId } = get();

    // Delete layer from PixelEngine
    const engine = getPixelEngine();
    engine.deleteLayer(layerId);

    set((state) => ({
      layers: state.layers.filter((l) => l.id !== layerId),
      activeLayerId: activeLayerId === layerId ? null : activeLayerId,
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  applyNoise: (layerId, brightness, hue, brightnessDirection = 'both', hueDirection = 'both', material = 'other') => {
    const { layers } = get();
    const layerIndex = layers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const newLayerPixels = cloneLayerPixels(layer.pixels);

    // Apply noise to all pixels in this layer
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        if (newLayerPixels[y][x]?.a && newLayerPixels[y][x]!.a > 0) {
          const newColor = applyMaterialNoise(
            layer.baseColor,
            brightness,
            hue,
            brightnessDirection,
            hueDirection,
            material
          );
          newLayerPixels[y][x] = newColor;
        }
      }
    }

    const newLayers = [...layers];
    newLayers[layerIndex] = {
      ...layer,
      noiseSettings: { brightness, hue, material },
      pixels: newLayerPixels,
    };

    // Sync to PixelEngine
    const engine = getPixelEngine();
    engine.setLayerData(layerId, layer.order, layerPixelsToUint8(newLayerPixels));

    set((state) => ({ layers: newLayers, compositeCache: null, previewVersion: state.previewVersion + 1 }));
  },

  resetNoise: (layerId) => {
    const { layers } = get();
    const layerIndex = layers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const newLayerPixels = cloneLayerPixels(layer.pixels);

    // Reset all pixels to base color
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        if (newLayerPixels[y][x]?.a && newLayerPixels[y][x]!.a > 0) {
          newLayerPixels[y][x] = { ...layer.baseColor };
        }
      }
    }

    const newLayers = [...layers];
    newLayers[layerIndex] = {
      ...layer,
      noiseSettings: { brightness: 0, hue: 0, material: undefined },
      pixels: newLayerPixels,
    };

    // Sync to PixelEngine
    const engine = getPixelEngine();
    engine.setLayerData(layerId, layer.order, layerPixelsToUint8(newLayerPixels));

    set((state) => ({ layers: newLayers, compositeCache: null, previewVersion: state.previewVersion + 1 }));
  },

  reorderLayer: (layerId, newOrder, newGroupId) => {
    set((state) => ({
      layers: state.layers.map((l) =>
        l.id === layerId ? { ...l, order: newOrder, groupId: newGroupId } : l
      ),
      compositeCache: null,
    }));
  },

  duplicateLayer: (layerId) => {
    const { layers, layerGroups, saveToHistory } = get();
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return null;

    takeSnapshot(layers, layerGroups);

    const newId = generateId();
    const maxOrder = layers.length > 0 ? Math.max(...layers.map(l => l.order)) : -1;
    const newLayer: Layer = {
      ...layer,
      id: newId,
      name: `${layer.name} のコピー`,
      baseColor: { ...layer.baseColor },
      noiseSettings: { ...layer.noiseSettings },
      order: maxOrder + 1,
      groupId: null,
      opacity: layer.opacity ?? 100,
      pixels: cloneLayerPixels(layer.pixels),
    };

    // Duplicate layer in PixelEngine
    const engine = getPixelEngine();
    engine.duplicateLayer(layerId, newId, maxOrder + 1);

    saveToHistory();
    set((state) => ({
      layers: [...state.layers, newLayer],
      activeLayerId: newId,
      compositeCache: null,
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
      compositeCache: null,
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

  // History actions
  saveToHistory: () => {
    const { layers, layerGroups, history, historyIndex } = get();

    const diff = calculateDiff(layers, layerGroups);
    clearSnapshot();

    if (!diff) {
      return;
    }

    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(diff);

    if (newHistory.length > MAX_HISTORY) {
      newHistory.shift();
    }

    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  undo: () => {
    const { layers, layerGroups, history, historyIndex } = get();
    if (historyIndex < 0) return;

    const entry = history[historyIndex];
    const engine = getPixelEngine();

    // Build layer map for updates
    const layerMap = new Map(layers.map(l => [l.id, cloneLayer(l)]));

    // Reverse pixel changes
    for (const change of entry.pixelChanges) {
      const layer = layerMap.get(change.layerId);
      if (layer) {
        layer.pixels[change.y][change.x] = change.oldPixel ? { ...change.oldPixel } : null;
        // Sync to PixelEngine
        if (change.oldPixel) {
          engine.setPixel(change.layerId, change.x, change.y, change.oldPixel.r, change.oldPixel.g, change.oldPixel.b, change.oldPixel.a);
        } else {
          engine.erasePixel(change.layerId, change.x, change.y);
        }
      }
    }

    // Reverse layer changes
    for (const change of entry.layerChanges) {
      if (change.type === 'add') {
        layerMap.delete(change.layerId);
        engine.deleteLayer(change.layerId);
      } else if (change.type === 'remove' && change.oldLayer) {
        layerMap.set(change.layerId, cloneLayer(change.oldLayer));
        engine.createLayer(change.layerId, change.oldLayer.order);
        engine.setLayerData(change.layerId, change.oldLayer.order, layerPixelsToUint8(change.oldLayer.pixels));
      } else if (change.type === 'update' && change.oldLayer) {
        const existing = layerMap.get(change.layerId);
        if (existing) {
          // Preserve current pixels, restore metadata
          const oldLayer = cloneLayer(change.oldLayer);
          oldLayer.pixels = existing.pixels;
          layerMap.set(change.layerId, oldLayer);
          engine.setLayerOrder(change.layerId, change.oldLayer.order);
        }
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
      layers: Array.from(layerMap.values()),
      layerGroups: newLayerGroups,
      historyIndex: historyIndex - 1,
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  redo: () => {
    const { layers, layerGroups, history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    const engine = getPixelEngine();

    // Build layer map for updates
    const layerMap = new Map(layers.map(l => [l.id, cloneLayer(l)]));

    // Apply pixel changes
    for (const change of entry.pixelChanges) {
      const layer = layerMap.get(change.layerId);
      if (layer) {
        layer.pixels[change.y][change.x] = change.newPixel ? { ...change.newPixel } : null;
        // Sync to PixelEngine
        if (change.newPixel) {
          engine.setPixel(change.layerId, change.x, change.y, change.newPixel.r, change.newPixel.g, change.newPixel.b, change.newPixel.a);
        } else {
          engine.erasePixel(change.layerId, change.x, change.y);
        }
      }
    }

    // Apply layer changes
    for (const change of entry.layerChanges) {
      if (change.type === 'add' && change.newLayer) {
        layerMap.set(change.layerId, cloneLayer(change.newLayer));
        engine.createLayer(change.layerId, change.newLayer.order);
        engine.setLayerData(change.layerId, change.newLayer.order, layerPixelsToUint8(change.newLayer.pixels));
      } else if (change.type === 'remove') {
        layerMap.delete(change.layerId);
        engine.deleteLayer(change.layerId);
      } else if (change.type === 'update' && change.newLayer) {
        const existing = layerMap.get(change.layerId);
        if (existing) {
          const newLayer = cloneLayer(change.newLayer);
          newLayer.pixels = existing.pixels;
          layerMap.set(change.layerId, newLayer);
          engine.setLayerOrder(change.layerId, change.newLayer.order);
        }
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
      layers: Array.from(layerMap.values()),
      layerGroups: newLayerGroups,
      historyIndex: newIndex,
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  // File actions
  loadFromImageData: (imageData) => {
    const { layers, layerGroups, saveToHistory } = get();
    takeSnapshot(layers, layerGroups);

    // Clear all layers in PixelEngine first
    const engine = getPixelEngine();
    engine.clearAllLayers();

    // Create a single layer for all imported pixels
    const layerId = generateId();
    const layerPixels = createEmptyLayerPixels();
    let hasPixels = false;

    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        if (x < imageData.width && y < imageData.height) {
          const i = (y * imageData.width + x) * 4;
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          const a = imageData.data[i + 3];

          if (a > 0) {
            hasPixels = true;
            layerPixels[y][x] = { r, g, b, a };
          }
        }
      }
    }

    const newLayer: Layer = {
      id: layerId,
      name: 'インポート画像',
      baseColor: { r: 128, g: 128, b: 128, a: 255 },
      noiseSettings: { brightness: 0, hue: 0 },
      groupId: null,
      order: 0,
      layerType: 'direct',
      visible: true,
      opacity: 100,
      pixels: layerPixels,
    };

    // Sync layer data to PixelEngine
    if (hasPixels) {
      engine.createLayer(layerId, 0);
      engine.setLayerData(layerId, 0, layerPixelsToUint8(layerPixels));
    }

    saveToHistory();
    set((state) => ({
      layers: hasPixels ? [newLayer] : [],
      layerGroups: [],
      activeLayerId: hasPixels ? layerId : null,
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  generateLayers: (options = {}) => {
    const { layers, layerGroups, saveToHistory } = get();
    takeSnapshot(layers, layerGroups);
    const { threshold = 'normal', thresholdValue: customThreshold, applyNoise = true } = options;
    const finalThreshold = customThreshold ?? COLOR_THRESHOLD_PRESETS[threshold];

    // Get composite to generate layers from
    const composite = get().getComposite();
    const imageData = new ImageData(SKIN_WIDTH, SKIN_HEIGHT);
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const i = (y * SKIN_WIDTH + x) * 4;
        const pixel = composite[y][x];
        imageData.data[i] = pixel.r;
        imageData.data[i + 1] = pixel.g;
        imageData.data[i + 2] = pixel.b;
        imageData.data[i + 3] = pixel.a;
      }
    }

    const { layers: newLayers } = generateLayersFromImageData(
      imageData,
      finalThreshold,
      applyNoise
    );

    // Sync all new layers to PixelEngine
    const engine = getPixelEngine();
    engine.clearAllLayers();
    for (const layer of newLayers) {
      engine.createLayer(layer.id, layer.order);
      engine.setLayerData(layer.id, layer.order, layerPixelsToUint8(layer.pixels));
    }

    saveToHistory();
    set((state) => ({
      layers: newLayers,
      activeLayerId: newLayers.length > 0 ? newLayers[0].id : null,
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  mergeLayersById: (sourceLayerId, targetLayerId) => {
    const { layers, layerGroups, saveToHistory } = get();
    takeSnapshot(layers, layerGroups);

    const { layers: newLayers } = mergeLayers(
      layers,
      sourceLayerId,
      targetLayerId
    );

    // Sync merged layers to PixelEngine
    const engine = getPixelEngine();
    engine.deleteLayer(sourceLayerId);
    const targetLayer = newLayers.find(l => l.id === targetLayerId);
    if (targetLayer) {
      engine.setLayerData(targetLayerId, targetLayer.order, layerPixelsToUint8(targetLayer.pixels));
    }

    saveToHistory();
    set((state) => ({
      layers: newLayers,
      activeLayerId: state.activeLayerId === sourceLayerId ? targetLayerId : state.activeLayerId,
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  mergeSimilarLayersAction: (options = {}) => {
    const { layers, layerGroups, saveToHistory } = get();
    takeSnapshot(layers, layerGroups);
    const { threshold = 'normal', thresholdValue: customThreshold, applyNoise = true } = options;
    const finalThreshold = customThreshold ?? COLOR_THRESHOLD_PRESETS[threshold];

    const { layers: newLayers } = mergeSimilarLayers(
      layers,
      finalThreshold,
      applyNoise
    );

    // Sync all new layers to PixelEngine (full rebuild)
    const engine = getPixelEngine();
    engine.clearAllLayers();
    for (const layer of newLayers) {
      engine.createLayer(layer.id, layer.order);
      engine.setLayerData(layer.id, layer.order, layerPixelsToUint8(layer.pixels));
    }

    saveToHistory();
    set((state) => ({
      layers: newLayers,
      activeLayerId: newLayers.length > 0 ? newLayers[0].id : null,
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  splitLayerByColorAction: (layerId, options = {}) => {
    const { layers, layerGroups, saveToHistory } = get();
    takeSnapshot(layers, layerGroups);
    const { threshold = 'strict', thresholdValue: customThreshold, applyNoise = false } = options;
    const finalThreshold = customThreshold ?? COLOR_THRESHOLD_PRESETS[threshold];

    const { layers: newLayers } = splitLayerByColor(
      layers,
      layerId,
      finalThreshold,
      applyNoise
    );

    // Sync all layers to PixelEngine (full rebuild for split operation)
    const engine = getPixelEngine();
    engine.clearAllLayers();
    for (const layer of newLayers) {
      engine.createLayer(layer.id, layer.order);
      engine.setLayerData(layer.id, layer.order, layerPixelsToUint8(layer.pixels));
    }

    saveToHistory();
    set((state) => ({
      layers: newLayers,
      compositeCache: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  splitLayerBySelectionAction: (layerId, selectedPixels) => {
    const { layers, layerGroups, saveToHistory } = get();
    takeSnapshot(layers, layerGroups);

    const { layers: newLayers, newLayerId } = splitLayerBySelection(
      layers,
      layerId,
      selectedPixels
    );

    if (newLayerId) {
      // Sync affected layers to PixelEngine
      const engine = getPixelEngine();
      const originalLayer = newLayers.find(l => l.id === layerId);
      const newLayer = newLayers.find(l => l.id === newLayerId);
      if (originalLayer) {
        engine.setLayerData(layerId, originalLayer.order, layerPixelsToUint8(originalLayer.pixels));
      }
      if (newLayer) {
        engine.createLayer(newLayerId, newLayer.order);
        engine.setLayerData(newLayerId, newLayer.order, layerPixelsToUint8(newLayer.pixels));
      }

      saveToHistory();
      set((state) => ({
        layers: newLayers,
        activeLayerId: newLayerId,
        compositeCache: null,
        previewVersion: state.previewVersion + 1,
      }));
    }

    return newLayerId;
  },

  blendBordersAction: (blendStrength = 15, layerId?: string) => {
    const { layers, layerGroups, saveToHistory } = get();
    takeSnapshot(layers, layerGroups);

    const { layers: newLayers } = blendBorderPixels(layers, blendStrength, layerId);

    // Sync affected layers to PixelEngine
    const engine = getPixelEngine();
    if (layerId) {
      const layer = newLayers.find(l => l.id === layerId);
      if (layer) {
        engine.setLayerData(layerId, layer.order, layerPixelsToUint8(layer.pixels));
      }
    } else {
      // All layers were affected
      for (const layer of newLayers) {
        engine.setLayerData(layer.id, layer.order, layerPixelsToUint8(layer.pixels));
      }
    }

    saveToHistory();
    set((state) => ({ layers: newLayers, compositeCache: null, previewVersion: state.previewVersion + 1 }));
  },

  getImageData: () => {
    const composite = get().getComposite();
    const imageData = new ImageData(SKIN_WIDTH, SKIN_HEIGHT);

    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const i = (y * SKIN_WIDTH + x) * 4;
        const pixel = composite[y][x];
        imageData.data[i] = pixel.r;
        imageData.data[i + 1] = pixel.g;
        imageData.data[i + 2] = pixel.b;
        imageData.data[i + 3] = pixel.a;
      }
    }

    return imageData;
  },

  reset: () => {
    // Clear all layers in PixelEngine
    const engine = getPixelEngine();
    engine.clearAllLayers();

    set({
      layers: [],
      layerGroups: [],
      activeLayerId: null,
      activeTool: 'pencil',
      highlightedLayerId: null,
      history: [],
      historyIndex: -1,
      compositeCache: null,
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
