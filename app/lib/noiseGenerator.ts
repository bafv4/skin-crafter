import type { RGBA } from '../types/editor';

// Convert RGB to HSL
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
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

  return [h, s, l];
}

// Convert HSL to RGB
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

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

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

// Apply brightness noise to a color
export function applyBrightnessNoise(color: RGBA, intensity: number): RGBA {
  if (intensity === 0) return color;

  // Random variation based on intensity (0-100)
  const maxVariation = (intensity / 100) * 50; // Max ±50 brightness change
  const variation = (Math.random() - 0.5) * 2 * maxVariation;

  return {
    r: Math.max(0, Math.min(255, Math.round(color.r + variation))),
    g: Math.max(0, Math.min(255, Math.round(color.g + variation))),
    b: Math.max(0, Math.min(255, Math.round(color.b + variation))),
    a: color.a,
  };
}

// Apply hue shift to a color
export function applyHueShift(color: RGBA, intensity: number): RGBA {
  if (intensity === 0) return color;

  const [h, s, l] = rgbToHsl(color.r, color.g, color.b);

  // Random hue shift based on intensity (0-100)
  const maxShift = (intensity / 100) * 0.1; // Max ±10% hue shift (36 degrees)
  const shift = (Math.random() - 0.5) * 2 * maxShift;
  const newH = (h + shift + 1) % 1;

  const [r, g, b] = hslToRgb(newH, s, l);

  return { r, g, b, a: color.a };
}

// Apply both brightness and hue noise
export function applyNoise(
  color: RGBA,
  brightnessIntensity: number,
  hueIntensity: number
): RGBA {
  let result = { ...color };

  if (brightnessIntensity > 0) {
    result = applyBrightnessNoise(result, brightnessIntensity);
  }

  if (hueIntensity > 0) {
    result = applyHueShift(result, hueIntensity);
  }

  return result;
}

// Generate a preview of noise effect on multiple samples
export function generateNoisePreview(
  baseColor: RGBA,
  brightnessIntensity: number,
  hueIntensity: number,
  sampleCount: number = 16
): RGBA[] {
  const samples: RGBA[] = [];

  for (let i = 0; i < sampleCount; i++) {
    samples.push(applyNoise(baseColor, brightnessIntensity, hueIntensity));
  }

  return samples;
}
