import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, Upload, X } from 'lucide-react';
import { api } from '../api';
import { cn } from '../lib/utils';

// Same cap as the server: 10 MB of PGN is tens of thousands of games.
const MAX_BYTES = 10_000_000;

interface PgnImportResult {
  imported: number;
  total: number;
  duplicates: number;
  skipped: Record<string, number>;
  ids: number[];
}

/** Patzer's take on lichess.org/paste: paste PGN text or pick a .pgn file.
 *  One game opens straight in the analyzer; several land in the list. */
export default function PgnImportPanel({ onClose, onDone }: {
  onClose: () => void;
  onDone: (msg: { text: string; error?: boolean }) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (pgn: string) => api.post<PgnImportResult>('/api/games/import/pgn', { pgn }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['games'] });
      if (r.ids.length === 1) {
        navigate(`/review/${r.ids[0]}`);
        return;
      }
      const skipped = Object.values(r.skipped).reduce((a, b) => a + b, 0);
      onDone({ text: t('review.pgn.importedMany', { n: r.imported, dup: r.duplicates, skipped }) });
      onClose();
    },
    onError: (e) => {
      const code = (e as Error).message;
      setError(t(`review.pgn.error.${code}`, { defaultValue: t('review.pgn.error.generic') }));
    },
  });

  async function pickFile(f: File | undefined) {
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setError(t('review.pgn.error.too_large'));
      return;
    }
    setText(await f.text());
    setFileName(f.name);
  }

  const submit = () => {
    setError(null);
    if (!text.trim()) {
      setError(t('review.pgn.error.empty'));
      return;
    }
    mut.mutate(text);
  };

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t('review.pgn.title')}</h2>
          <p className="text-xs text-chesscom-500">{t('review.pgn.hint')}</p>
        </div>
        <button onClick={onClose} className="btn-ghost p-1" aria-label={t('review.pgn.close')}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setFileName(null); setError(null); }}
        placeholder={t('review.pgn.placeholder')}
        spellCheck={false}
        rows={8}
        className="input w-full resize-y font-mono text-xs"
      />

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void pickFile(e.dataTransfer.files[0]); }}
        className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-chesscom-300 px-3 py-2 text-sm dark:border-chesscom-600"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pgn,application/x-chess-pgn,text/plain"
          className="hidden"
          onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary text-sm">
          <FileUp className="h-4 w-4" /> {t('review.pgn.upload')}
        </button>
        <span className="truncate text-xs text-chesscom-500">{fileName ?? t('review.pgn.drop')}</span>
      </div>

      {error && <div className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}

      <div className="flex justify-end">
        <button onClick={submit} disabled={mut.isPending} className={cn('btn-primary', mut.isPending && 'opacity-70')}>
          <Upload className="h-4 w-4" />
          {mut.isPending ? t('review.importing') : t('review.pgn.submit')}
        </button>
      </div>
    </div>
  );
}
