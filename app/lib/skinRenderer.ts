import { type RGBA, type Layer, SKIN_WIDTH, SKIN_HEIGHT } from '../types/editor';

// Cached offscreen canvas for scaled rendering
let offscreenCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let offscreenCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function getOffscreenCanvas(): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } | null {
  if (offscreenCanvas && offscreenCtx) {
    return { canvas: offscreenCanvas, ctx: offscreenCtx };
  }

  try {
    // Try OffscreenCanvas first (more performant)
    if (typeof OffscreenCanvas !== 'undefined') {
      offscreenCanvas = new OffscreenCanvas(SKIN_WIDTH, SKIN_HEIGHT);
      offscreenCtx = offscreenCanvas.getContext('2d');
    } else {
      // Fallback to regular canvas
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = SKIN_WIDTH;
      offscreenCanvas.height = SKIN_HEIGHT;
      offscreenCtx = offscreenCanvas.getContext('2d');
    }

    if (!offscreenCtx) return null;
    return { canvas: offscreenCanvas, ctx: offscreenCtx };
  } catch {
    return null;
  }
}

/**
 * Draw the composited skin texture on a canvas.
 * Takes a pre-computed composite (RGBA[][]) instead of raw pixel data.
 * Optimized: uses ImageData + drawImage scaling for better performance.
 */
export function renderSkinToCanvas(
  ctx: CanvasRenderingContext2D,
  composite: RGBA[][],
  scale: number = 1
): void {
  const width = SKIN_WIDTH * scale;
  const height = SKIN_HEIGHT * scale;

  // Create ImageData at native resolution
  const imageData = ctx.createImageData(SKIN_WIDTH, SKIN_HEIGHT);
  const data = imageData.data;

  for (let y = 0; y < SKIN_HEIGHT; y++) {
    const row = composite[y];
    const rowOffset = y * SKIN_WIDTH * 4;
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const pixel = row[x];
      const idx = rowOffset + x * 4;
      data[idx] = pixel.r;
      data[idx + 1] = pixel.g;
      data[idx + 2] = pixel.b;
      data[idx + 3] = pixel.a;
    }
  }

  // For scale=1, direct put
  if (scale === 1) {
    ctx.putImageData(imageData, 0, 0);
    return;
  }

  // For scaled rendering, use offscreen canvas + drawImage (much faster than fillRect per pixel)
  const offscreen = getOffscreenCanvas();
  if (offscreen) {
    offscreen.ctx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen.canvas as CanvasImageSource, 0, 0, width, height);
  } else {
    // Fallback: direct putImageData at scale 1, then scale context
    ctx.save();
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    ctx.putImageData(imageData, 0, 0);
    ctx.restore();
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

/**
 * Draw highlight overlay for a specific layer's pixels.
 * Uses the layer's pixel data directly.
 */
export function drawLayerHighlight(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  scale: number,
  color: string = 'rgba(255, 255, 0, 0.5)'
): void {
  ctx.fillStyle = color;

  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const pixel = layer.pixels[y][x];
      if (pixel && pixel.a > 0) {
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

/**
 * Download skin as PNG.
 * Takes a pre-computed composite (RGBA[][]).
 */
export async function downloadSkin(
  composite: RGBA[][],
  filename: string = 'skin.png'
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = SKIN_WIDTH;
  canvas.height = SKIN_HEIGHT;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  renderSkinToCanvas(ctx, composite, 1);

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
