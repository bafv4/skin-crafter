// 画面の大きさによるレイアウトの切り替え（home.tsx のレイアウトと、ビューのヒントの初期表示で共有する）

// これより狭い画面（スマホ）では、レイヤーパネルも含めてタブで切り替える（Tailwind の md と同じ）
export const MOBILE_WIDTH_BREAKPOINT = 768;
// これより狭い、または低い画面では、2D キャンバスと 3D プレビューをタブで切り替える
export const NARROW_WIDTH_BREAKPOINT = 1024;
export const SHORT_HEIGHT_BREAKPOINT = 800;
// これより低い画面（横向きのスマホなど）では、表示領域を隠さないようヒントを最初は折りたたむ
export const VERY_SHORT_HEIGHT_BREAKPOINT = 500;

// ヒントを最初は折りたたむ小さい画面
export const SMALL_SCREEN_QUERY =
  `(max-width: ${MOBILE_WIDTH_BREAKPOINT - 1}px), (max-height: ${VERY_SHORT_HEIGHT_BREAKPOINT - 1}px)`;
