import type { Config } from "@react-router/dev/config";

export default {
  // SPA mode - no server-side rendering
  ssr: false,
  // GitHub Pages などサブパスで配信するとき（vite.config.ts の base と同じ値）。
  // これがないとアセットは読めてもルートが一致せず、画面が表示されない
  basename: process.env.BASE_PATH || "/",
} satisfies Config;
