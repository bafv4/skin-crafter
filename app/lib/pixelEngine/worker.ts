/**
 * PixelEngine Web Worker
 * ピクセル操作と合成処理をメインスレッドから分離して実行
 */

import { PixelBuffer, SKIN_WIDTH, SKIN_HEIGHT } from './PixelBuffer';
import { Compositor } from './Compositor';
import type { WorkerCommand, WorkerResponse } from './messages';

// レイヤーバッファのマップ
const layers = new Map<string, PixelBuffer>();

// 合成エンジン
const compositor = new Compositor(SKIN_WIDTH, SKIN_HEIGHT);

/**
 * レスポンスを送信
 */
function respond(response: WorkerResponse, transfer?: Transferable[]): void {
  // Use postMessage with StructuredSerializeOptions for transferable objects
  if (transfer && transfer.length > 0) {
    (self as unknown as Worker).postMessage(response, transfer);
  } else {
    (self as unknown as Worker).postMessage(response);
  }
}

/**
 * メッセージハンドラ
 */
self.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const cmd = e.data;

  try {
    switch (cmd.type) {
      case 'CREATE_LAYER': {
        const buffer = new PixelBuffer(SKIN_WIDTH, SKIN_HEIGHT);
        buffer.order = cmd.order;
        layers.set(cmd.layerId, buffer);
        break;
      }

      case 'DELETE_LAYER': {
        layers.delete(cmd.layerId);
        break;
      }

      case 'CLEAR_ALL_LAYERS': {
        layers.clear();
        break;
      }

      case 'SET_PIXEL': {
        const layer = layers.get(cmd.layerId);
        if (layer) {
          layer.setPixel(cmd.x, cmd.y, cmd.r, cmd.g, cmd.b, cmd.a);
        }
        break;
      }

      case 'ERASE_PIXEL': {
        const layer = layers.get(cmd.layerId);
        if (layer) {
          layer.erasePixel(cmd.x, cmd.y);
        }
        break;
      }

      case 'SET_PIXEL_RECT': {
        const layer = layers.get(cmd.layerId);
        if (layer) {
          layer.setPixelRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.r, cmd.g, cmd.b, cmd.a);
        }
        break;
      }

      case 'ERASE_PIXEL_RECT': {
        const layer = layers.get(cmd.layerId);
        if (layer) {
          layer.erasePixelRect(cmd.x1, cmd.y1, cmd.x2, cmd.y2);
        }
        break;
      }

      case 'CLEAR_LAYER': {
        const layer = layers.get(cmd.layerId);
        if (layer) {
          layer.clear();
        }
        break;
      }

      case 'SET_LAYER_VISIBILITY': {
        // 可視性はメインスレッド側で管理し、合成時に渡される
        // このコマンドは将来の拡張用
        break;
      }

      case 'SET_LAYER_OPACITY': {
        // 不透明度もメインスレッド側で管理
        break;
      }

      case 'SET_LAYER_ORDER': {
        const layer = layers.get(cmd.layerId);
        if (layer) {
          layer.order = cmd.order;
        }
        break;
      }

      case 'REQUEST_COMPOSITE': {
        const result = compositor.compositeFromMap(
          layers,
          cmd.visibleLayerIds,
          cmd.layerOpacities,
          cmd.layerOrders
        );

        // バッファをコピーしてtransfer（元のバッファは維持）
        const buffer = result.buffer.slice(0) as ArrayBuffer;

        const response: WorkerResponse = {
          type: 'COMPOSITE_READY',
          buffer,
          width: SKIN_WIDTH,
          height: SKIN_HEIGHT
        };
        respond(response, [buffer]);
        break;
      }

      case 'GET_LAYER_DATA': {
        const layer = layers.get(cmd.layerId);
        if (layer) {
          const buffer = layer.getTransferableBuffer();
          const response: WorkerResponse = {
            type: 'LAYER_DATA',
            layerId: cmd.layerId,
            buffer
          };
          respond(response, [buffer]);
        } else {
          respond({ type: 'ERROR', message: `Layer not found: ${cmd.layerId}` });
        }
        break;
      }

      case 'GET_ALL_LAYERS_DATA': {
        const layersData: Array<{ layerId: string; order: number; buffer: ArrayBuffer }> = [];
        const transferList: ArrayBuffer[] = [];

        for (const [layerId, buffer] of layers) {
          const arrayBuffer = buffer.getTransferableBuffer();
          layersData.push({
            layerId,
            order: buffer.order,
            buffer: arrayBuffer
          });
          transferList.push(arrayBuffer);
        }

        const response: WorkerResponse = {
          type: 'ALL_LAYERS_DATA',
          layers: layersData
        };
        respond(response, transferList);
        break;
      }

      case 'SET_LAYER_DATA': {
        let layer = layers.get(cmd.layerId);
        if (!layer) {
          layer = new PixelBuffer(SKIN_WIDTH, SKIN_HEIGHT);
          layers.set(cmd.layerId, layer);
        }
        layer.setFromArrayBuffer(cmd.data);
        layer.order = cmd.order;
        break;
      }

      case 'DUPLICATE_LAYER': {
        const source = layers.get(cmd.sourceId);
        if (source) {
          const cloned = source.clone();
          cloned.order = cmd.newOrder;
          layers.set(cmd.newId, cloned);
        } else {
          respond({ type: 'ERROR', message: `Source layer not found: ${cmd.sourceId}` });
        }
        break;
      }

      case 'GET_PIXEL': {
        const layer = layers.get(cmd.layerId);
        if (layer) {
          const [r, g, b, a] = layer.getPixel(cmd.x, cmd.y);
          const response: WorkerResponse = {
            type: 'PIXEL_DATA',
            layerId: cmd.layerId,
            x: cmd.x,
            y: cmd.y,
            r, g, b, a
          };
          respond(response);
        } else {
          respond({ type: 'ERROR', message: `Layer not found: ${cmd.layerId}` });
        }
        break;
      }

      default:
        // 未知のコマンド
        respond({ type: 'ERROR', message: `Unknown command: ${(cmd as WorkerCommand).type}` });
    }
  } catch (error) {
    respond({
      type: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
