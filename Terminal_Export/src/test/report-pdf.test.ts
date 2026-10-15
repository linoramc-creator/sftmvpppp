import { downloadAnalysisPdf } from '@/lib/reportPdf';
import { expect, it, vi } from 'vitest';

it('exports saved news as escaped key points without external article links or source references', () => {
  let html = '';
  const target = { document: { write: (value: string) => { html = value; }, close: vi.fn() } } as unknown as Window;
  downloadAnalysisPdf('## Noticias\n#### Acuerdo · 2026-10-15\n- Inversión de 120 millones. ([Fuente](https://www.reuters.com/story))\n- La aprobación sigue pendiente (Reuters).\n<script>alert(1)</script>\n## Fuentes\nhttps://publisher.example/article', 'TEST', target);
  expect(html).toContain('<h4>Acuerdo · 2026-10-15</h4>');
  expect(html).toContain('120 millones');
  expect(html).toContain('La aprobación sigue pendiente');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).not.toMatch(/href=|reuters\.com|publisher\.example|\(Reuters\)|<h2>Fuentes/);
});
