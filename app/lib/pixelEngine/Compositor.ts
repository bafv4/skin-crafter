/**
 * Compositor - 複数レイヤーを合成するクラス
 * Porter-Duff "over" 演算によるアルファブレンディング
 */

import { PixelBuffer, SKIN_WIDTH, SKIN_HEIGHT, BUFFER_SIZE } from './PixelBuffer';

interface LayerInfo {
  buffer: PixelBuffer;
  visible: boolean;
  opacity: number;
  order: number;
}

export class Compositor {
  private result: Uint8ClampedArray;
  private readonly width: number;
  private readonly height: number;

  constructor(width: number = SKIN_WIDTH, height: number = SKIN_HEIGHT) {
    this.width = width;
    this.height = height;
    this.result = new Uint8ClampedArray(width * height * 4);
  }

  /**
   * 複数レイヤーを合成
   * @param layers レイヤー情報の配列
   * @returns 合成結果の Uint8ClampedArray
   */
  composite(layers: LayerInfo[]): Uint8ClampedArray {
    // 結果バッファをクリア
    this.result.fill(0);

    // 可視レイヤーのみフィルタし、orderでソート（大きい→小さい = 背面→前面）
    const visibleLayers = layers
      .filter(l => l.visible && l.opacity > 0)
      .sort((a, b) => b.order - a.order);

    // 背面から前面へ順にブレンド
    for (const layer of visibleLayers) {
      this.blendLayer(layer.buffer, layer.opacity);
    }

    return this.result;
  }

  /**
   * 指定されたレイヤーIDと設定で合成（Worker用簡易版）
   * グループのorderを考慮してソート
   */
  compositeFromMap(
    layerMap: Map<string, PixelBuffer>,
    visibleLayerIds: string[],
    layerOpacities: Record<string, number>,
    layerOrders: Record<string, number>,
    layerGroupIds: Record<string, string | null> = {},
    groupOrders: Record<string, number> = {}
  ): Uint8ClampedArray {
    // 結果バッファをクリア
    this.result.fill(0);

    // 可視レイヤーを収集し、orderでソート
    const layers: Array<{ buffer: PixelBuffer; opacity: number; order: number; groupOrder: number }> = [];

    for (const layerId of visibleLayerIds) {
      const buffer = layerMap.get(layerId);
      if (!buffer) continue;

      const opacity = layerOpacities[layerId] ?? 100;
      const order = layerOrders[layerId] ?? 0;
      const groupId = layerGroupIds[layerId];
      const groupOrder = groupId ? (groupOrders[groupId] ?? Infinity) : Infinity;

      if (opacity > 0) {
        layers.push({ buffer, opacity, order, groupOrder });
      }
    }

    // グループorderでソート、次にレイヤーorderでソート（大きい→小さい = 背面→前面）
    layers.sort((a, b) => {
      if (a.groupOrder !== b.groupOrder) {
        return b.groupOrder - a.groupOrder;
      }
      return b.order - a.order;
    });

    // 背面から前面へ順にブレンド
    for (const layer of layers) {
      this.blendLayer(layer.buffer, layer.opacity);
    }

    return this.result;
  }

  /**
   * 単一レイヤーを結果バッファにブレンド
   * Porter-Duff "over" 演算
   */
  private blendLayer(layer: PixelBuffer, opacity: number): void {
    const src = layer.data;
    const dst = this.result;
    const opacityFactor = opacity / 100;

    const length = src.length;
    for (let i = 0; i < length; i += 4) {
      // ソースのアルファ（不透明度を適用）
      const srcA = (src[i + 3] * opacityFactor) / 255;
      if (srcA === 0) continue;

      // デスティネーションのアルファ
      const dstA = dst[i + 3] / 255;

      // 出力アルファ: αout = αsrc + αdst × (1 - αsrc)
      const outA = srcA + dstA * (1 - srcA);

      if (outA > 0) {
        // 各チャンネルのウェイト
        const srcW = srcA / outA;
        const dstW = (dstA * (1 - srcA)) / outA;

        // RGB チャンネルをブレンド
        dst[i] = Math.round(src[i] * srcW + dst[i] * dstW);
        dst[i + 1] = Math.round(src[i + 1] * srcW + dst[i + 1] * dstW);
        dst[i + 2] = Math.round(src[i + 2] * srcW + dst[i + 2] * dstW);
        dst[i + 3] = Math.round(outA * 255);
      }
    }
  }

  /**
   * 結果バッファのコピーを取得（Transferable用）
   */
  getResultBuffer(): ArrayBuffer {
    return this.result.buffer.slice(0) as ArrayBuffer;
  }

  /**
   * 結果を ImageData として取得
   */
  toImageData(): ImageData {
    return new ImageData(new Uint8ClampedArray(this.result), this.width, this.height);
  }
}
