import { type PixelData, SKIN_WIDTH, SKIN_HEIGHT } from '../types/editor';

// Draw the skin texture on a canvas
export function renderSkinToCanvas(
  ctx: CanvasRenderingContext2D,
  pixels: PixelData[][],
  scale: number = 1
): void {
  ctx.clearRect(0, 0, SKIN_WIDTH * scale, SKIN_HEIGHT * scale);

  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      const pixel = pixels[y][x];
      if (pixel.color.a > 0) {
        ctx.fillStyle = `rgba(${pixel.color.r}, ${pixel.color.g}, ${pixel.color.b}, ${pixel.color.a / 255})`;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
}

// Draw grid overlay
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  scale: number,
  color: string = 'rgba(128, 128, 128, 0.3)'
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

// Draw highlight for selected group
export function drawGroupHighlight(
  ctx: CanvasRenderingContext2D,
  pixels: PixelData[][],
  groupId: string,
  scale: number,
  color: string = 'rgba(255, 255, 0, 0.5)'
): void {
  ctx.fillStyle = color;

  for (let y = 0; y < SKIN_HEIGHT; y++) {
    for (let x = 0; x < SKIN_WIDTH; x++) {
      if (pixels[y][x].groupId === groupId) {
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
}

// Draw checkerboard pattern for transparency
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  size: number = 4,
  color1: string = '#ffffff',
  color2: string = '#cccccc'
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
  filename: string = 'skin.png'
): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = SKIN_WIDTH;
  canvas.height = SKIN_HEIGHT;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  renderSkinToCanvas(ctx, pixels, 1);

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
