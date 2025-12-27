import { create } from 'zustand';
import {
  type PixelData,
  type Group,
  type ToolType,
  type ModelType,
  type ThemeType,
  type HistoryEntry,
  type RGBA,
  SKIN_WIDTH,
  SKIN_HEIGHT,
  MAX_HISTORY,
  createEmptyPixels,
  generateId,
} from '../types/editor';
import {
  generateGroupsFromImageData,
  mergeSimilarGroups,
  mergeGroups,
  splitGroupByColor,
  splitGroupBySelection,
  blendBorderPixels,
  COLOR_THRESHOLD_PRESETS,
  type ColorThresholdPreset,
} from '../lib/groupGenerator';

interface EditorState {
  // Canvas data
  pixels: PixelData[][];
  groups: Group[];

  // Selection state
  activeGroupId: string | null;
  activeTool: ToolType;
  highlightedGroupId: string | null;

  // Direct drawing color (used when no groups exist)
  drawingColor: RGBA;

  // Settings
  modelType: ModelType;
  showLayer2: boolean;
  theme: ThemeType;

  // History
  history: HistoryEntry[];
  historyIndex: number;

  // Preview update version (incremented when 3D preview should update)
  previewVersion: number;

  // Actions
  setPixel: (x: number, y: number, groupId: string | null) => void;
  setPixelRect: (x1: number, y1: number, x2: number, y2: number, groupId: string | null) => void;
  commitDrawing: () => void; // Call when drawing ends to update 3D preview
  setActiveTool: (tool: ToolType) => void;
  setActiveGroup: (groupId: string | null) => void;
  setHighlightedGroup: (groupId: string | null) => void;
  setDrawingColor: (color: RGBA) => void;

  // Group actions
  createGroup: (name: string, color: RGBA) => string;
  updateGroupColor: (groupId: string, color: RGBA) => void;
  updateGroupName: (groupId: string, name: string) => void;
  deleteGroup: (groupId: string) => void;
  applyNoise: (groupId: string, brightness: number, hue: number, brightnessDirection?: 'both' | 'positive' | 'negative', hueDirection?: 'both' | 'positive' | 'negative', material?: MaterialType) => void;

  // Settings actions
  setModelType: (type: ModelType) => void;
  toggleLayer2: () => void;
  setTheme: (theme: ThemeType) => void;

  // History actions
  undo: () => void;
  redo: () => void;
  saveToHistory: () => void;

  // File actions
  loadFromImageData: (imageData: ImageData) => void;
  generateGroups: (options?: { threshold?: ColorThresholdPreset; thresholdValue?: number; applyNoise?: boolean }) => void;
  mergeGroupsById: (sourceGroupId: string, targetGroupId: string) => void;
  mergeSimilarGroupsAction: (options?: { threshold?: ColorThresholdPreset; thresholdValue?: number; applyNoise?: boolean }) => void;
  splitGroupByColorAction: (groupId: string, options?: { threshold?: ColorThresholdPreset; thresholdValue?: number; applyNoise?: boolean }) => void;
  splitGroupBySelectionAction: (groupId: string, selectedPixels: { x: number; y: number }[]) => string | null;
  blendBordersAction: (blendStrength?: number, groupId?: string) => void;
  getImageData: () => ImageData;
  reset: () => void;
}

// Helper to deep clone pixels
function clonePixels(pixels: PixelData[][]): PixelData[][] {
  return pixels.map((row) =>
    row.map((pixel) => ({
      ...pixel,
      color: { ...pixel.color },
    }))
  );
}

// Helper to deep clone groups
function cloneGroups(groups: Group[]): Group[] {
  return groups.map((group) => ({
    ...group,
    baseColor: { ...group.baseColor },
    noiseSettings: { ...group.noiseSettings },
  }));
}

// Noise direction type
type NoiseDirection = 'both' | 'positive' | 'negative';

// Material type for noise generation
export type MaterialType = 'hair' | 'cloth' | 'skin' | 'metal' | 'plastic' | 'other';

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
  groups: [],
  activeGroupId: null,
  activeTool: 'pencil',
  highlightedGroupId: null,
  drawingColor: { r: 0, g: 0, b: 0, a: 255 }, // Default black
  modelType: 'steve',
  showLayer2: true,
  theme: 'system',
  history: [],
  historyIndex: -1,
  previewVersion: 0,

  // Pixel actions
  setPixel: (x, y, groupId) => {
    if (x < 0 || x >= SKIN_WIDTH || y < 0 || y >= SKIN_HEIGHT) return;

    const { pixels, groups, drawingColor, saveToHistory } = get();
    const newPixels = clonePixels(pixels);

    if (groupId === null) {
      // Eraser - set to transparent
      newPixels[y][x] = {
        groupId: null,
        color: { r: 0, g: 0, b: 0, a: 0 },
      };
    } else {
      const group = groups.find((g) => g.id === groupId);
      if (group) {
        newPixels[y][x] = {
          groupId,
          color: { ...group.baseColor },
        };
      } else if (groups.length === 0) {
        // No groups exist - draw directly with drawingColor
        newPixels[y][x] = {
          groupId: null,
          color: { ...drawingColor },
        };
      }
    }

    saveToHistory();
    set({ pixels: newPixels });
  },

  setPixelRect: (x1, y1, x2, y2, groupId) => {
    const { pixels, groups, drawingColor, saveToHistory, previewVersion } = get();
    const newPixels = clonePixels(pixels);

    const minX = Math.max(0, Math.min(x1, x2));
    const maxX = Math.min(SKIN_WIDTH - 1, Math.max(x1, x2));
    const minY = Math.max(0, Math.min(y1, y2));
    const maxY = Math.min(SKIN_HEIGHT - 1, Math.max(y1, y2));

    const group = groupId ? groups.find((g) => g.id === groupId) : null;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (groupId === null) {
          newPixels[y][x] = {
            groupId: null,
            color: { r: 0, g: 0, b: 0, a: 0 },
          };
        } else if (group) {
          newPixels[y][x] = {
            groupId,
            color: { ...group.baseColor },
          };
        } else if (groups.length === 0) {
          // No groups exist - draw directly with drawingColor
          newPixels[y][x] = {
            groupId: null,
            color: { ...drawingColor },
          };
        }
      }
    }

    saveToHistory();
    set({ pixels: newPixels, previewVersion: previewVersion + 1 });
  },

  commitDrawing: () => {
    set((state) => ({ previewVersion: state.previewVersion + 1 }));
  },

  setActiveTool: (tool) => set({ activeTool: tool }),
  setActiveGroup: (groupId) => set({ activeGroupId: groupId }),
  setHighlightedGroup: (groupId) => set({ highlightedGroupId: groupId }),
  setDrawingColor: (color) => set({ drawingColor: color }),

  // Group actions
  createGroup: (name, color) => {
    const id = generateId();
    const newGroup: Group = {
      id,
      name,
      baseColor: color,
      noiseSettings: { brightness: 0, hue: 0 },
    };
    set((state) => ({
      groups: [...state.groups, newGroup],
      activeGroupId: id,
    }));
    return id;
  },

  updateGroupColor: (groupId, color) => {
    const { pixels, groups } = get();
    const newGroups = groups.map((g) =>
      g.id === groupId ? { ...g, baseColor: color } : g
    );

    // Update all pixels belonging to this group
    const newPixels = pixels.map((row) =>
      row.map((pixel) =>
        pixel.groupId === groupId
          ? { ...pixel, color: { ...color } }
          : pixel
      )
    );

    set((state) => ({ groups: newGroups, pixels: newPixels, previewVersion: state.previewVersion + 1 }));
  },

  updateGroupName: (groupId, name) => {
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, name } : g
      ),
    }));
  },

  deleteGroup: (groupId) => {
    const { pixels, groups, activeGroupId } = get();

    // Remove group
    const newGroups = groups.filter((g) => g.id !== groupId);

    // Clear pixels belonging to this group
    const newPixels = pixels.map((row) =>
      row.map((pixel) =>
        pixel.groupId === groupId
          ? { groupId: null, color: { r: 0, g: 0, b: 0, a: 0 } }
          : pixel
      )
    );

    set((state) => ({
      groups: newGroups,
      pixels: newPixels,
      activeGroupId: activeGroupId === groupId ? null : activeGroupId,
      previewVersion: state.previewVersion + 1,
    }));
  },

  applyNoise: (groupId, brightness, hue, brightnessDirection = 'both', hueDirection = 'both', material = 'other') => {
    const { pixels, groups } = get();
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    // Update group noise settings
    const newGroups = groups.map((g) =>
      g.id === groupId
        ? { ...g, noiseSettings: { brightness, hue } }
        : g
    );

    // Apply noise to all pixels in this group using material-specific function
    const newPixels = pixels.map((row) =>
      row.map((pixel) => {
        if (pixel.groupId !== groupId) return pixel;

        const newColor = applyMaterialNoise(
          group.baseColor,
          brightness,
          hue,
          brightnessDirection,
          hueDirection,
          material
        );
        return { ...pixel, color: newColor };
      })
    );

    set((state) => ({ groups: newGroups, pixels: newPixels, previewVersion: state.previewVersion + 1 }));
  },

  // Settings actions
  setModelType: (type) => set({ modelType: type }),
  toggleLayer2: () => set((state) => ({ showLayer2: !state.showLayer2 })),
  setTheme: (theme) => set({ theme }),

  // History actions
  saveToHistory: () => {
    const { pixels, groups, history, historyIndex } = get();

    // Truncate future history if we're not at the end
    const newHistory = history.slice(0, historyIndex + 1);

    // Add current state
    newHistory.push({
      pixels: clonePixels(pixels),
      groups: cloneGroups(groups),
    });

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
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    const entry = history[newIndex];

    set({
      pixels: clonePixels(entry.pixels),
      groups: cloneGroups(entry.groups),
      historyIndex: newIndex,
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    const entry = history[newIndex];

    set({
      pixels: clonePixels(entry.pixels),
      groups: cloneGroups(entry.groups),
      historyIndex: newIndex,
    });
  },

  // File actions
  loadFromImageData: (imageData) => {
    const { saveToHistory } = get();
    const newPixels: PixelData[][] = [];

    // Load pixels without generating groups
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      newPixels[y] = [];
      for (let x = 0; x < SKIN_WIDTH; x++) {
        if (x < imageData.width && y < imageData.height) {
          const i = (y * imageData.width + x) * 4;
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          const a = imageData.data[i + 3];

          newPixels[y][x] = {
            groupId: null, // No group assigned yet
            color: { r, g, b, a },
          };
        } else {
          newPixels[y][x] = {
            groupId: null,
            color: { r: 0, g: 0, b: 0, a: 0 },
          };
        }
      }
    }

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      groups: [],
      activeGroupId: null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  generateGroups: (options = {}) => {
    const { pixels, saveToHistory } = get();
    const { threshold = 'normal', thresholdValue: customThreshold, applyNoise = true } = options;
    // Use custom threshold value if provided, otherwise use preset
    const finalThreshold = customThreshold ?? COLOR_THRESHOLD_PRESETS[threshold];

    // Convert current pixels to ImageData for group generation
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

    // Generate groups based on color similarity, adjacency, and body parts
    const { pixels: newPixels, groups: newGroups } = generateGroupsFromImageData(
      imageData,
      finalThreshold,
      applyNoise
    );

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      groups: newGroups,
      activeGroupId: newGroups.length > 0 ? newGroups[0].id : null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  mergeGroupsById: (sourceGroupId, targetGroupId) => {
    const { pixels, groups, saveToHistory, activeGroupId } = get();

    const { pixels: newPixels, groups: newGroups } = mergeGroups(
      pixels,
      groups,
      sourceGroupId,
      targetGroupId
    );

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      groups: newGroups,
      activeGroupId: state.activeGroupId === sourceGroupId ? targetGroupId : state.activeGroupId,
      previewVersion: state.previewVersion + 1,
    }));
  },

  mergeSimilarGroupsAction: (options = {}) => {
    const { pixels, groups, saveToHistory } = get();
    const { threshold = 'normal', thresholdValue: customThreshold, applyNoise = true } = options;
    // Use custom threshold value if provided, otherwise use preset
    const finalThreshold = customThreshold ?? COLOR_THRESHOLD_PRESETS[threshold];

    const { pixels: newPixels, groups: newGroups } = mergeSimilarGroups(
      pixels,
      groups,
      finalThreshold,
      applyNoise
    );

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      groups: newGroups,
      activeGroupId: newGroups.length > 0 ? newGroups[0].id : null,
      previewVersion: state.previewVersion + 1,
    }));
  },

  splitGroupByColorAction: (groupId, options = {}) => {
    const { pixels, groups, saveToHistory } = get();
    const { threshold = 'strict', thresholdValue: customThreshold, applyNoise = false } = options;
    // Use custom threshold value if provided, otherwise use preset
    const finalThreshold = customThreshold ?? COLOR_THRESHOLD_PRESETS[threshold];

    const { pixels: newPixels, groups: newGroups } = splitGroupByColor(
      pixels,
      groups,
      groupId,
      finalThreshold,
      applyNoise
    );

    saveToHistory();
    set((state) => ({
      pixels: newPixels,
      groups: newGroups,
      previewVersion: state.previewVersion + 1,
    }));
  },

  splitGroupBySelectionAction: (groupId, selectedPixels) => {
    const { pixels, groups, saveToHistory } = get();

    const { pixels: newPixels, groups: newGroups, newGroupId } = splitGroupBySelection(
      pixels,
      groups,
      groupId,
      selectedPixels
    );

    if (newGroupId) {
      saveToHistory();
      set((state) => ({
        pixels: newPixels,
        groups: newGroups,
        activeGroupId: newGroupId,
        previewVersion: state.previewVersion + 1,
      }));
    }

    return newGroupId;
  },

  blendBordersAction: (blendStrength = 15, groupId?: string) => {
    const { pixels, saveToHistory } = get();

    const { pixels: newPixels } = blendBorderPixels(pixels, blendStrength, groupId);

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
      groups: [],
      activeGroupId: null,
      activeTool: 'pencil',
      highlightedGroupId: null,
      history: [],
      historyIndex: -1,
    });
  },
}));
