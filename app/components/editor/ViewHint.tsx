import { useEffect, useState } from 'react';
import { CircleHelp, X } from 'lucide-react';
import { cn } from '@lib/utils';

export interface HintItem {
  keys: string[];
  label: string;
}

// ブラウザごとの表示設定（失敗しても表示は継続する）
function readHidden(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) === 'hidden';
  } catch {
    return false;
  }
}

function writeHidden(storageKey: string, hidden: boolean) {
  try {
    if (hidden) {
      localStorage.setItem(storageKey, 'hidden');
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // ストレージが使えない環境では保存しない
  }
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 py-px font-sans text-[10px] font-medium leading-none text-foreground">
      {children}
    </kbd>
  );
}

// ビュー下部に重ねて表示する操作方法のヒント
export function ViewHint({
  items,
  storageKey,
  className,
}: {
  items: HintItem[];
  storageKey: string;
  className?: string;
}) {
  const [hidden, setHidden] = useState(false);

  // SSR/プリレンダー時と差が出ないよう、マウント後に読み込む
  useEffect(() => {
    setHidden(readHidden(storageKey));
  }, [storageKey]);

  const toggle = (next: boolean) => {
    setHidden(next);
    writeHidden(storageKey, next);
  };

  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => toggle(false)}
        aria-label="操作方法を表示"
        title="操作方法を表示"
        className={cn(
          'absolute bottom-2 left-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground',
          className
        )}
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-2 bottom-2 z-10 flex justify-start',
        className
      )}
    >
      <div
        role="note"
        aria-label="操作方法"
        className="pointer-events-auto flex max-w-full items-start gap-2 rounded-md border border-border bg-card/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur"
      >
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {items.map((item) => (
            <li key={item.label} className="flex items-center gap-1 whitespace-nowrap">
              {item.keys.map((key, i) => (
                <span key={key} className="flex items-center gap-0.5">
                  {i > 0 && <span>/</span>}
                  <Kbd>{key}</Kbd>
                </span>
              ))}
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => toggle(true)}
          aria-label="操作方法を隠す"
          title="操作方法を隠す"
          className="-mr-1 shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
