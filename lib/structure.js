// Reads a blueprint page's phases and guide checklists, for the admin progress breakdown.
// { phases: [{ label, title, panels: [id] }], panels: { id: { name, items: [{ key, text }] } }, loose: [{ key, text }] }
const decode = (s) => String(s || '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&middot;/g, '·').replace(/&rarr;/g, '→')
  .replace(/\s+/g, ' ').trim();
const itemsIn = (html) => [...html.matchAll(/<li[^>]*data-check="([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/li>/g)]
  .map((m) => ({ key: m[1], text: decode(m[2]).slice(0, 200) }));

export function parseStructure(html) {
  html = String(html || '');
  const panels = {};
  for (const m of html.matchAll(/<aside class="spanel" id="panel-([\w-]+)"[^>]*>([\s\S]*?)<\/aside>/g)) {
    const title = (m[2].match(/<div class="sp-title">([\s\S]*?)<\/div>/) || [])[1];
    const items = itemsIn(m[2]);
    if (items.length) panels[m[1]] = { name: decode(title) || m[1], items };
  }
  const phases = [...html.matchAll(/<div class="phase[^"]*"([^>]*)>\s*<span class="ph">([\s\S]*?)<\/span>\s*<h3>([\s\S]*?)<\/h3>/g)]
    .map((m) => ({
      label: decode(m[2]),
      title: decode(m[3]),
      panels: ((m[1].match(/data-panels="([^"]*)"/) || [])[1] || '').split(/\s+/).filter((id) => panels[id]),
    }));
  const inPanels = new Set(Object.values(panels).flatMap((p) => p.items.map((i) => i.key)));
  const loose = itemsIn(html).filter((i) => !inPanels.has(i.key));
  return { phases, panels, loose };
}
