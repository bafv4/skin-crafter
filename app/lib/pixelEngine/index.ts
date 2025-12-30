/**
 * PixelEngine - メインスレッド側API
 * Web Worker とのインターフェースを提供
 */

import type { WorkerCommand, WorkerResponse } from './messages';
import { SKIN_WIDTH, SKIN_HEIGHT } from './PixelBuffer';

export { SKIN_WIDTH, SKIN_HEIGHT } from './PixelBuffer';

type CompositeCallback = (imageData: ImageData) => void;
type LayerDataCallback = (layerId: string, data: Uint8ClampedArray) => void;
type AllLayersDataCallback = (layers: Array<{ layerId: string; order: number; data: Uint8ClampedArray }>) => void;
type PixelCallback = (layerId: string, x: number, y: number, r: number, g: number, b: number, a: number) => void;

export class PixelEngine {
  private worker: Worker | null = null;
  private compositeCallback: CompositeCallback | null = null;
  private layerDataCallback: LayerDataCallback | null = null;
  private allLayersDataCallback: AllLayersDataCallback | null = null;
  private pixelCallback: PixelCallback | null = null;
  private isInitialized = false;

  /**
   * Worker を初期化
   * SSR 環境では何もしない
   */
  init(): void {
    if (this.isInitialized) return;
    if (typeof window === 'undefined') return; // SSR guard

    try {
      // Vite の Worker インポート構文を使用
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = (e) => {
        console.error('PixelEngine Worker error:', e);
      };
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize PixelEngine Worker:', error);
    }
  }

  /**
   * Worker からのメッセージを処理
   */
  private handleMessage(e: MessageEvent<WorkerResponse>): void {
    const response = e.data;

    switch (response.type) {
      case 'COMPOSITE_READY': {
        if (this.compositeCallback) {
          const data = new Uint8ClampedArray(response.buffer);
          const imageData = new ImageData(data, response.width, response.height);
          this.compositeCallback(imageData);
        }
        break;
      }

      case 'LAYER_DATA': {
        if (this.layerDataCallback) {
          const data = new Uint8ClampedArray(response.buffer);
          this.layerDataCallback(response.layerId, data);
        }
        break;
      }

      case 'ALL_LAYERS_DATA': {
        if (this.allLayersDataCallback) {
          const layers = response.layers.map(l => ({
            layerId: l.layerId,
            order: l.order,
            data: new Uint8ClampedArray(l.buffer)
          }));
          this.allLayersDataCallback(layers);
        }
        break;
      }

      case 'PIXEL_DATA': {
        if (this.pixelCallback) {
          this.pixelCallback(
            response.layerId,
            response.x,
            response.y,
            response.r,
            response.g,
            response.b,
            response.a
          );
        }
        break;
      }

      case 'ERROR': {
        console.error('PixelEngine Worker error:', response.message);
        break;
      }

      case 'OK': {
        // 成功応答（必要に応じて処理）
        break;
      }
    }
  }

  /**
   * Worker にコマンドを送信
   */
  private send(cmd: WorkerCommand, transfer?: Transferable[]): void {
    if (!this.worker) {
      this.init();
    }
    this.worker?.postMessage(cmd, transfer ?? []);
  }

  // ========== Public API ==========

  /**
   * レイヤーを作成
   */
  createLayer(layerId: string, order: number): void {
    this.send({ type: 'CREATE_LAYER', layerId, order });
  }

  /**
   * レイヤーを削除
   */
  deleteLayer(layerId: string): void {
    this.send({ type: 'DELETE_LAYER', layerId });
  }

  /**
   * 全レイヤーをクリア
   */
  clearAllLayers(): void {
    this.send({ type: 'CLEAR_ALL_LAYERS' });
  }

  /**
   * ピクセルを設定
   */
  setPixel(layerId: string, x: number, y: number, r: number, g: number, b: number, a: number): void {
    this.send({ type: 'SET_PIXEL', layerId, x, y, r, g, b, a });
  }

  /**
   * ピクセルを消去
   */
  erasePixel(layerId: string, x: number, y: number): void {
    this.send({ type: 'ERASE_PIXEL', layerId, x, y });
  }

  /**
   * 矩形領域にピクセルを設定
   */
  setPixelRect(layerId: string, x1: number, y1: number, x2: number, y2: number, r: number, g: number, b: number, a: number): void {
    this.send({ type: 'SET_PIXEL_RECT', layerId, x1, y1, x2, y2, r, g, b, a });
  }

  /**
   * 矩形領域を消去
   */
  erasePixelRect(layerId: string, x1: number, y1: number, x2: number, y2: number): void {
    this.send({ type: 'ERASE_PIXEL_RECT', layerId, x1, y1, x2, y2 });
  }

  /**
   * レイヤーをクリア
   */
  clearLayer(layerId: string): void {
    this.send({ type: 'CLEAR_LAYER', layerId });
  }

  /**
   * レイヤーの順序を設定
   */
  setLayerOrder(layerId: string, order: number): void {
    this.send({ type: 'SET_LAYER_ORDER', layerId, order });
  }

  /**
   * 合成をリクエスト
   * @param visibleLayerIds 可視レイヤーのID配列
   * @param layerOpacities レイヤーIDと不透明度のマップ
   * @param layerOrders レイヤーIDと順序のマップ
   * @param layerGroupIds レイヤーIDとグループIDのマップ
   * @param groupOrders グループIDと順序のマップ
   * @param callback 合成完了時のコールバック
   */
  requestComposite(
    visibleLayerIds: string[],
    layerOpacities: Record<string, number>,
    layerOrders: Record<string, number>,
    layerGroupIds: Record<string, string | null>,
    groupOrders: Record<string, number>,
    callback: CompositeCallback
  ): void {
    this.compositeCallback = callback;
    this.send({
      type: 'REQUEST_COMPOSITE',
      visibleLayerIds,
      layerOpacities,
      layerOrders,
      layerGroupIds,
      groupOrders
    });
  }

  /**
   * レイヤーデータを取得
   */
  getLayerData(layerId: string, callback: LayerDataCallback): void {
    this.layerDataCallback = callback;
    this.send({ type: 'GET_LAYER_DATA', layerId });
  }

  /**
   * 全レイヤーのデータを取得
   */
  getAllLayersData(callback: AllLayersDataCallback): void {
    this.allLayersDataCallback = callback;
    this.send({ type: 'GET_ALL_LAYERS_DATA' });
  }

  /**
   * レイヤーデータを設定
   */
  setLayerData(layerId: string, order: number, data: Uint8ClampedArray): void {
    const buffer = data.buffer.slice(0) as ArrayBuffer;
    this.send({ type: 'SET_LAYER_DATA', layerId, order, data: buffer }, [buffer]);
  }

  /**
   * レイヤーを複製
   */
  duplicateLayer(sourceId: string, newId: string, newOrder: number): void {
    this.send({ type: 'DUPLICATE_LAYER', sourceId, newId, newOrder });
  }

  /**
   * ピクセルを取得
   */
  getPixel(layerId: string, x: number, y: number, callback: PixelCallback): void {
    this.pixelCallback = callback;
    this.send({ type: 'GET_PIXEL', layerId, x, y });
  }

  /**
   * Worker を終了
   */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
    }
  }

  /**
   * 初期化済みかどうか
   */
  get initialized(): boolean {
    return this.isInitialized;
  }
}

// シングルトンインスタンス
let engineInstance: PixelEngine | null = null;

/**
 * PixelEngine のシングルトンインスタンスを取得
 */
export function getPixelEngine(): PixelEngine {
  if (!engineInstance) {
    engineInstance = new PixelEngine();
    engineInstance.init();
  }
  return engineInstance;
}

/**
 * PixelEngine を破棄（テスト用）
 */
export function destroyPixelEngine(): void {
  if (engineInstance) {
    engineInstance.destroy();
    engineInstance = null;
  }
}
