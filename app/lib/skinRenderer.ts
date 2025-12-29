import { type PixelData, type Layer, type LayerGroup, SKIN_WIDTH, SKIN_HEIGHT } from '../types/editor';

// Draw the skin texture on a canvas using ImageData for better performance
export function renderSkinToCanvas(
  ctx: CanvasRenderingContext2D,
  pixels: PixelData[][],
  scale: number = 1,
  layers?: Layer[],
  layerGroups?: LayerGroup[]
): void {
  const width = SKIN_WIDTH * scale;
  const height = SKIN_HEIGHT * scale;

  // Build a set of hidden layer IDs for quick lookup
  const hiddenLayerIds = new Set<string>();
  if (layers && layerGroups) {
    // First, collect layers in hidden groups
    const hiddenGroupIds = new Set(
      layerGroups.filter((g) => !g.visible).map((g) => g.id)
    );

    for (const layer of layers) {
      // Layer is hidden if: the layer itself is not visible, or its group is not visible
      if (!layer.visible || (layer.groupId && hiddenGroupIds.has(layer.groupId))) {
        hiddenLayerIds.add(layer.id);
      }
    }
  }

  // For scale=1, use ImageData for maximum performance
  if (scale === 1) {
    const imageData = ctx.createImageData(SKIN_WIDTH, SKIN_HEIGHT);
    const data = imageData.data;

    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const pixel = pixels[y][x];
        const idx = (y * SKIN_WIDTH + x) * 4;

        // Skip rendering if pixel belongs to a hidden layer
        if (pixel.layerId && hiddenLayerIds.has(pixel.layerId)) {
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
          continue;
        }

        data[idx] = pixel.color.r;
        data[idx + 1] = pixel.color.g;
        data[idx + 2] = pixel.color.b;
        data[idx + 3] = pixel.color.a;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return;
  }

  // For scaled rendering, use fillRect but avoid string concatenation
  ctx.clearRect(0, 0, width, height);

  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const pixel = pixels[y][x];
      // Skip rendering if pixel belongs to a hidden layer
      if (pixel.layerId && hiddenLayerIds.has(pixel.layerId)) {
        continue;
      }
      const { r, g, b, a } = pixel.color;
      if (a > 0) {
        ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
}

// Grid cache for avoiding re-rendering
let gridCache: { scale: number; canvas: HTMLCanvasElement } | null = null;

// Draw grid overlay with caching
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  scale: number,
  color: string = 'rgba(128, 128, 128, 0.3)'
): void {
  const width = SKIN_WIDTH * scale;
  const height = SKIN_HEIGHT * scale;

  // Check cache
  if (gridCache && gridCache.scale === scale) {
    ctx.drawImage(gridCache.canvas, 0, 0);
    return;
  }

  // Create new cached grid
  const cacheCanvas = document.createElement('canvas');
  cacheCanvas.width = width;
  cacheCanvas.height = height;
  const cacheCtx = cacheCanvas.getContext('2d');

  if (!cacheCtx) {
    // Fallback to direct drawing
    drawGridDirect(ctx, scale, color);
    return;
  }

  drawGridDirect(cacheCtx, scale, color);

  // Store in cache
  gridCache = { scale, canvas: cacheCanvas };

  // Draw to target context
  ctx.drawImage(cacheCanvas, 0, 0);
}

// Direct grid drawing (used for caching)
function drawGridDirect(
  ctx: CanvasRenderingContext2D,
  scale: number,
  color: string
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;

  // Vertical lines
  for (let x = 0; x <= SKIN_WIDTH; x++) {
    ctx.beginPath();
    ctx.moveTo(x * scale, 0);
    ctx.lineTo(x * scale, SKIN_HEIGHT * scale);
    ctx.stroke();
  }

  // Horizontal lines
  for (let y = 0; y <= SKIN_HEIGHT; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * scale);
    ctx.lineTo(SKIN_WIDTH * scale, y * scale);
    ctx.stroke();
  }
}

// Draw highlight for selected layer
export function drawGroupHighlight(
  ctx: CanvasRenderingContext2D,
  pixels: PixelData[][],
  layerId: string,
  scale: number,
  color: string = 'rgba(255, 255, 0, 0.5)'
): void {
  ctx.fillStyle = color;

  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      if (pixels[y][x].layerId === layerId) {
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
}

// Checkerboard cache for avoiding re-rendering
let checkerboardCache: { width: number; height: number; scale: number; size: number; canvas: HTMLCanvasElement } | null = null;

// Draw checkerboard pattern for transparency with caching
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  size: number = 4,
  color1: string = '#ffffff',
  color2: string = '#cccccc'
): void {
  // Check cache
  if (checkerboardCache &&
      checkerboardCache.width === width &&
      checkerboardCache.height === height &&
      checkerboardCache.scale === scale &&
      checkerboardCache.size === size) {
    ctx.drawImage(checkerboardCache.canvas, 0, 0);
    return;
  }

  // Create new cached checkerboard
  const cacheCanvas = document.createElement('canvas');
  cacheCanvas.width = width;
  cacheCanvas.height = height;
  const cacheCtx = cacheCanvas.getContext('2d');

  if (!cacheCtx) {
    // Fallback to direct drawing
    drawCheckerboardDirect(ctx, width, height, scale, size, color1, color2);
    return;
  }

  drawCheckerboardDirect(cacheCtx, width, height, scale, size, color1, color2);

  // Store in cache
  checkerboardCache = { width, height, scale, size, canvas: cacheCanvas };

  // Draw to target context
  ctx.drawImage(cacheCanvas, 0, 0);
}

// Direct checkerboard drawing (used for caching)
function drawCheckerboardDirect(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  size: number,
  color1: string,
  color2: string
): void {
  const cellSize = size * scale;

  for (let y = 0; y < height; y += cellSize) {
    for (let x = 0; x < width; x += cellSize) {
      const isEven = ((x / cellSize) + (y / cellSize)) % 2 === 0;
      ctx.fillStyle = isEven ? color1 : color2;
      ctx.fillRect(x, y, cellSize, cellSize);
    }
  }
}

// Convert canvas to PNG blob
export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create blob'));
      }
    }, 'image/png');
  });
}

// Download skin as PNG
export async function downloadSkin(
  pixels: PixelData[][],
  filename: string = 'skin.png',
  layers?: Layer[],
  layerGroups?: LayerGroup[]
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = SKIN_WIDTH;
  canvas.height = SKIN_HEIGHT;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  renderSkinToCanvas(ctx, pixels, 1, layers, layerGroups);

  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

// Load skin from file
export async function loadSkinFromFile(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SKIN_WIDTH;
      canvas.height = SKIN_HEIGHT;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Draw image scaled to 64x64 if necessary
      ctx.drawImage(img, 0, 0, SKIN_WIDTH, SKIN_HEIGHT);
      const imageData = ctx.getImageData(0, 0, SKIN_WIDTH, SKIN_HEIGHT);

      URL.revokeObjectURL(url);
      resolve(imageData);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

// Get pixel position from mouse event
export function getPixelFromMouse(
  event: MouseEvent | React.MouseEvent,
  canvas: HTMLCanvasElement,
  scale: number
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / scale);
  const y = Math.floor((event.clientY - rect.top) / scale);

  if (x >= 0 && x < SKIN_WIDTH && y >= 0 && y < SKIN_HEIGHT) {
    return { x, y };
  }

  return null;
}
