import { useCallback, useEffect, useState } from 'react';

export type HighlightColor = 'yellow' | 'purple' | 'green';

export type TextHighlight = {
  id: string;
  chapter: number;
  paragraph: number;
  quote: string;
  note: string;
  color: HighlightColor;
  createdAt: number;
};

const storageKey = (bookId: string) => 'mokuji.highlights.v1:' + bookId;

function readHighlights(bookId: string): TextHighlight[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(bookId)) || '[]');
    return Array.isArray(raw) ? (raw as TextHighlight[]) : [];
  } catch {
    return [];
  }
}

function writeHighlights(bookId: string, list: TextHighlight[]) {
  try {
    localStorage.setItem(storageKey(bookId), JSON.stringify(list));
  } catch {}
}

export function useReaderHighlights(bookId: string) {
  const [highlights, setHighlights] = useState<TextHighlight[]>(() => readHighlights(bookId));
  useEffect(() => {
    setHighlights(readHighlights(bookId));
  }, [bookId]);

  const addHighlight = useCallback(
    (entry: { chapter: number; paragraph: number; quote: string; color?: HighlightColor; note?: string }) => {
      const cleanQuote = entry.quote.trim().slice(0, 400);
      if (!cleanQuote) return null;
      const created: TextHighlight = {
        id: 'hl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
        chapter: entry.chapter,
        paragraph: entry.paragraph,
        quote: cleanQuote,
        note: (entry.note || '').trim(),
        color: entry.color || 'yellow',
        createdAt: Date.now(),
      };
      setHighlights(prev => {
        const dup = prev.find(h => h.chapter === created.chapter && h.paragraph === created.paragraph && h.quote === created.quote);
        const next = dup
          ? prev.map(h => (h.id === dup.id ? { ...h, color: created.color, note: created.note || h.note } : h))
          : [created, ...prev];
        writeHighlights(bookId, next);
        return next;
      });
      return created;
    },
    [bookId],
  );

  const updateHighlightNote = useCallback(
    (id: string, note: string) => {
      setHighlights(prev => {
        const next = prev.map(h => (h.id === id ? { ...h, note: note.trim() } : h));
        writeHighlights(bookId, next);
        return next;
      });
    },
    [bookId],
  );

  const removeHighlight = useCallback(
    (id: string) => {
      setHighlights(prev => {
        const next = prev.filter(h => h.id !== id);
        writeHighlights(bookId, next);
        return next;
      });
    },
    [bookId],
  );

  return { highlights, addHighlight, updateHighlightNote, removeHighlight };
}
