/**
 * Worker通信の型定義
 * Main Thread ↔ Web Worker 間のメッセージ型
 */

// Main → Worker コマンド
export type WorkerCommand =
  | { type: 'CREATE_LAYER'; layerId: string; order: number }
  | { type: 'DELETE_LAYER'; layerId: string }
  | { type: 'CLEAR_ALL_LAYERS' }
  | { type: 'SET_PIXEL'; layerId: string; x: number; y: number; r: number; g: number; b: number; a: number }
  | { type: 'ERASE_PIXEL'; layerId: string; x: number; y: number }
  | { type: 'SET_PIXEL_RECT'; layerId: string; x1: number; y1: number; x2: number; y2: number; r: number; g: number; b: number; a: number }
  | { type: 'ERASE_PIXEL_RECT'; layerId: string; x1: number; y1: number; x2: number; y2: number }
  | { type: 'CLEAR_LAYER'; layerId: string }
  | { type: 'SET_LAYER_VISIBILITY'; layerId: string; visible: boolean }
  | { type: 'SET_LAYER_OPACITY'; layerId: string; opacity: number }
  | { type: 'SET_LAYER_ORDER'; layerId: string; order: number }
  | { type: 'REQUEST_COMPOSITE'; visibleLayerIds: string[]; layerOpacities: Record<string, number>; layerOrders: Record<string, number> }
  | { type: 'GET_LAYER_DATA'; layerId: string }
  | { type: 'GET_ALL_LAYERS_DATA' }
  | { type: 'SET_LAYER_DATA'; layerId: string; order: number; data: ArrayBuffer }
  | { type: 'DUPLICATE_LAYER'; sourceId: string; newId: string; newOrder: number }
  | { type: 'GET_PIXEL'; layerId: string; x: number; y: number };

// Worker → Main レスポンス
export type WorkerResponse =
  | { type: 'COMPOSITE_READY'; buffer: ArrayBuffer; width: number; height: number }
  | { type: 'LAYER_DATA'; layerId: string; buffer: ArrayBuffer }
  | { type: 'ALL_LAYERS_DATA'; layers: Array<{ layerId: string; order: number; buffer: ArrayBuffer }> }
  | { type: 'PIXEL_DATA'; layerId: string; x: number; y: number; r: number; g: number; b: number; a: number }
  | { type: 'ERROR'; message: string }
  | { type: 'OK' };
