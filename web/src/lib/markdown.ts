// Tiny markdown renderer used by the changelog modal and the coach panel.
// Handles: headings (#..######), bullet lists (-), numbered lists, bold (**),
// italic (*), inline code (`), and links ([text](url)).
// Outputs sanitized HTML — escapes `< > & " '` everywhere except where we
// intentionally insert tags ourselves.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(s: string): string { return s.replace(/[&<>"']/g, (ch) => ESC[ch]!); }

function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-ink-100 px-1 py-0.5 text-[12px] dark:bg-ink-700">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="text-accent-600 underline" href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(md: string): string {
  if (!md) return '';
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList: 'ul' | 'ol' | null = null;

  function closeList() {
    if (inList) { out.push(`</${inList}>`); inList = null; }
  }

  for (const raw of lines) {
    const line = escapeHtml(raw);
    if (/^\s*$/.test(raw)) { closeList(); continue; }
    if (/^#{1,6}\s/.test(raw)) {
      closeList();
      const m = raw.match(/^(#{1,6})\s+(.*)$/)!;
      const lvl = m[1]!.length;
      const sizeClass = lvl === 1 ? 'text-xl font-bold mt-3 mb-2'
        : lvl === 2 ? 'text-lg font-semibold mt-3 mb-1'
        : 'text-base font-semibold mt-2 mb-1';
      out.push(`<h${lvl} class="${sizeClass}">${inline(escapeHtml(m[2]!))}</h${lvl}>`);
    } else if (/^\s*-\s+/.test(raw)) {
      if (inList !== 'ul') { closeList(); out.push('<ul class="ml-5 list-disc space-y-1 mb-2">'); inList = 'ul'; }
      out.push(`<li>${inline(escapeHtml(raw.replace(/^\s*-\s+/, '')))}</li>`);
    } else if (/^\s*\d+\.\s+/.test(raw)) {
      if (inList !== 'ol') { closeList(); out.push('<ol class="ml-5 list-decimal space-y-1 mb-2">'); inList = 'ol'; }
      out.push(`<li>${inline(escapeHtml(raw.replace(/^\s*\d+\.\s+/, '')))}</li>`);
    } else {
      closeList();
      out.push(`<p class="mb-2 leading-relaxed">${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

// Strip markdown formatting for TTS. Leaves the underlying words intact and
// removes markers (asterisks, backticks, list bullets, link URLs).
export function stripMarkdown(md: string): string {
  if (!md) return '';
  return md
    .replace(/```[\s\S]*?```/g, ' ')                 // fenced code blocks → drop
    .replace(/`([^`]+)`/g, '$1')                       // inline code → bare text
    .replace(/\*\*(.+?)\*\*/g, '$1')                   // bold
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '$1')    // italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')           // link → just label
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')                // headings → just text
    .replace(/^\s*[-*+]\s+/gm, '')                     // bullets → drop marker
    .replace(/^\s*\d+\.\s+/gm, '')                     // numbered list marker
    .replace(/[ \t]+/g, ' ')                           // collapse runs of spaces
    .replace(/\n{3,}/g, '\n\n')                        // collapse blank-line runs
    .trim();
}

// Strip reasoning/thinking blocks emitted by some models (gpt-oss, deepseek-r1,
// qwq, and similar). Closed blocks are removed entirely; an unclosed leading
// block (still streaming) is hidden until it closes — so the user sees the
// final answer instead of the chain-of-thought.
const REASONING_BLOCK = /<(thinking|reasoning|think|analysis)>[\s\S]*?<\/\1>/gi;
const REASONING_PIPE  = /<\|(?:start_)?reasoning\|>[\s\S]*?<\|(?:end_)?reasoning\|>/gi;
const OPEN_REASONING_HEAD = /^[\s\S]*?<(?:thinking|reasoning|think|analysis)>([\s\S]*)$/i;

export function stripReasoning(text: string): string {
  if (!text) return '';
  let s = text.replace(REASONING_BLOCK, '').replace(REASONING_PIPE, '');
  // If a reasoning block opened but never closed (still streaming), hide
  // everything from the opener onward.
  const m = s.match(/<(thinking|reasoning|think|analysis)>/i);
  if (m) s = s.slice(0, m.index);
  return s.trim();
}
