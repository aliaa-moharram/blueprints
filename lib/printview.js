// The print-ready version of a blueprint, for "Download PDF": the browser's own Save as PDF gives the sharpest
// result and costs nothing on the server. Every implementation guide is added at the end as an appendix, every
// collapsed section is opened, interactive controls are hidden, and the print dialog opens once images load.
const PRINT_CSS = `
@page{size:A4;margin:14mm 12mm}
@media print{
  html{zoom:.64}
  html,body{background:#fff !important}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .bp-print-bar{display:none !important}
  .journey,.phase,.prod,.pstable tr,.maptable tr,.figcard,.calc,.sp-diagram,.sp-tablewrap,.ev,.bp-print-guide .sp-check li{break-inside:avoid}
  h2,h3,.sec-head,.jtitle{break-after:avoid}
  .guide-btn,.sp-close,.sp-wide,.sp-zoom,.sp-resize,.sp-nav,.figbtn::after{display:none !important}
  a{color:inherit}
}
.bp-print-appendix{max-width:1100px;margin:0 auto;padding:30px 24px}
.bp-print-appendix > h2{font:800 26px/1.2 "Archivo",system-ui,sans-serif;margin:0 0 6px}
.bp-print-appendix > p{color:#5b636e;margin:0 0 20px}
.bp-print-guide{border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;margin:0 0 22px;break-before:page}
.bp-print-guide .sp-head{position:static !important}
.bp-print-guide .sp-body{overflow:visible !important;max-height:none !important}
.bp-print-bar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:999;background:#1c2024;color:#fff;border-radius:999px;padding:10px 12px 10px 18px;display:flex;gap:12px;align-items:center;font:600 14px system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.3)}
.bp-print-bar button{font:700 14px system-ui,sans-serif;border:0;border-radius:999px;padding:8px 14px;background:#3dd68c;color:#0f2a1e;cursor:pointer}
`;
const PRINT_SCRIPT = `
(function(){
  function prepare(){
    var panels=[].slice.call(document.querySelectorAll('aside.spanel'));
    if(panels.length){
      var app=document.createElement('section'); app.className='bp-print-appendix';
      app.innerHTML='<h2>Implementation guides</h2><p>Every guide from the blueprint, in the order of the plan.</p>';
      var order=[]; [].forEach.call(document.querySelectorAll('tr[data-row-panel]'),function(r){var id=r.getAttribute('data-row-panel'); if(order.indexOf(id)<0) order.push(id);});
      panels.sort(function(a,b){var x=order.indexOf(a.id.replace('panel-','')),y=order.indexOf(b.id.replace('panel-',''));return (x<0?99:x)-(y<0?99:y);});
      panels.forEach(function(p){var g=document.createElement('div'); g.className='bp-print-guide'; var h=p.querySelector('.sp-head'), b=p.querySelector('.sp-body'); if(h) g.appendChild(h.cloneNode(true)); if(b) g.appendChild(b.cloneNode(true)); app.appendChild(g); p.remove();});
      var foot=document.querySelector('footer'); if(foot) foot.parentNode.insertBefore(app,foot); else document.body.appendChild(app);
    }
    [].forEach.call(document.querySelectorAll('.bp-print-appendix details'),function(d){d.open=true;});
    var ov=document.getElementById('ov'); if(ov) ov.remove();
    var bar=document.createElement('div'); bar.className='bp-print-bar';
    bar.innerHTML='<span>Choose “Save as PDF” in the print dialog</span><button type="button">Print or save as PDF</button>';
    bar.querySelector('button').onclick=function(){window.print();};
    document.body.appendChild(bar);
  }
  function ready(){
    var imgs=[].slice.call(document.images).filter(function(i){return !i.complete;});
    var fonts=document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve();
    return Promise.all([fonts].concat(imgs.map(function(i){return new Promise(function(r){i.onload=i.onerror=r;});})));
  }
  window.addEventListener('load',function(){prepare(); ready().then(function(){setTimeout(function(){window.print();},300);});});
})();
`;

// An A4 page is only about 700 CSS pixels wide, which would trigger the page's small-screen layout. Those rules
// are dropped here, and the page is zoomed to fit (see PRINT_CSS), so the PDF keeps the desktop layout.
function dropSmallScreenRules(css) {
  let out = '', i = 0;
  const re = /@media[^{]*\(\s*max-width\s*:\s*(\d+)px\s*\)[^{]*\{/g;
  let m;
  while ((m = re.exec(css))) {
    if (Number(m[1]) > 1100) continue;
    let depth = 1, j = re.lastIndex;
    while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
    out += css.slice(i, m.index); i = j; re.lastIndex = j;
  }
  return out + css.slice(i);
}

export function printView(html, title) {
  let out = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (all, attrs, css) => `<style${attrs}>${dropSmallScreenRules(css)}</style>`);
  if (title) out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title.replace(/[<>&"]/g, '')}</title>`);
  out = out.replace(/<\/head>/i, `<style>${PRINT_CSS}</style>\n<meta name="robots" content="noindex, nofollow">\n</head>`);
  const at = out.toLowerCase().lastIndexOf('</body>');
  const tag = `<script>${PRINT_SCRIPT}</script>\n`;
  return at === -1 ? out + tag : out.slice(0, at) + tag + out.slice(at);
}
