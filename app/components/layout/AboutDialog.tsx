// アプリについて（ヘッダーの「Skin Crafter」をクリックすると開く）
import { ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@components/ui/dialog';
import { CraftingTableIcon } from '@components/icons/CraftingTableIcon';
import { TOOLS } from '@components/editor/Toolbar';
// 名前付きで読み込み、package.json のほかの項目をバンドルに含めない
import { version } from '../../../package.json';

const APP_VERSION = version.replace(/^v/, '');
const REPOSITORY_URL = 'https://github.com/bafv4/skin-crafter';

const FEATURES = [
  'レイヤーとグループで色を整理しながら描画（単色モード＋ノイズ / マルチカラーモード）',
  'スキン画像（PNG）の読み込みと、似た色ごとのレイヤー自動生成・統合・分割',
  'リアルタイム 3D プレビュー（Steve / Alex、パーツごとの表示切替）',
  '名前付きのカラーパレット',
  'PNG の書き出し、プロジェクト（JSON）の書き出し・読み込み',
];

const SHORTCUTS: { keys: string[]; label: string }[] = [
  ...TOOLS.map((t) => ({ keys: [t.shortcut], label: t.label })),
  { keys: ['Ctrl/⌘+Z'], label: '元に戻す' },
  { keys: ['Ctrl/⌘+Y', 'Ctrl/⌘+Shift+Z'], label: 'やり直し' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <CraftingTableIcon className="h-10 w-10 shrink-0" />
            <div className="flex flex-col gap-0.5 text-left">
              <DialogTitle className="text-xl">Skin Crafter</DialogTitle>
              <span className="text-xs text-muted-foreground">バージョン {APP_VERSION}</span>
            </div>
          </div>
          <DialogDescription className="text-left pt-2">
            ブラウザで動く Minecraft のスキンエディタです。64×64 のスキンをレイヤーとグループで整理しながら描き、3D プレビューで仕上がりを確認できます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 overflow-y-auto pr-1 text-sm">
          <Section title="主な機能">
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
              {FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </Section>

          <Section title="キーボードショートカット">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.label} className="contents">
                  <dt className="flex flex-wrap gap-1">
                    {s.keys.map((key) => (
                      <kbd key={key} className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
                    ))}
                  </dt>
                  <dd className="text-muted-foreground">{s.label}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              キャンバスや 3D プレビューの操作方法は、各ビューの左下のヒントにも表示されます。
            </p>
          </Section>

          <Section title="データの保存">
            <p className="text-muted-foreground">
              作業内容はこのブラウザ内（IndexedDB）に自動で保存され、サーバーには送信されません。ブラウザのサイトデータを削除すると消えるため、大切なスキンはプロジェクト（JSON）として書き出しておいてください。
            </p>
          </Section>

          <Section title="リンク">
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              GitHub リポジトリ
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Section>

          <p className="border-t pt-3 text-xs text-muted-foreground">
            Minecraft は Mojang Studios の商標です。Skin Crafter は非公式のツールであり、Mojang Studios および Microsoft とは関係ありません。
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
