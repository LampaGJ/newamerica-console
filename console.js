(function(){
'use strict';
var $=function(id){return document.getElementById(id)};
var TIERS={1:'Authoritative',2:'Analysis',3:'Supporting',4:'Peripheral'};
var PROTO='2025-06-18';
var sess=null,rid=1,busy=null,connKey='';
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k)||'';localStorage.setItem(k,v)}catch(e){return ''}}
// Maintainer only: a link may carry a token (and server) in the URL, preferably the fragment (#token=...), which the
// browser never sends to GitHub Pages or any log. It is stored, sent as a bearer, never shown, and removed
// from the address bar. People need no token while the open preview runs.
(function fromUrl(){
  var p=new URLSearchParams((location.hash||'').replace(/^#/,''));
  var q=new URLSearchParams(location.search);
  var tok=p.get('token')||q.get('token'), srv=p.get('server')||q.get('server');
  if(tok)ls('na.token',tok.trim());
  if(srv)ls('na.server',srv.trim());
  if(tok||srv){try{history.replaceState(null,'',location.pathname)}catch(e){}}
})();
var DEFAULT_SERVER='https://macstudio.tarpan-woodpecker.ts.net/newamerica';
// The token lives only in localStorage (set by #token=); the page ships with none and has no UI for it.
function token(){return ls("na.token")||null}
function base(){return (ls('na.server')||DEFAULT_SERVER).trim().replace(/\/+$/,'')}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function safeUrl(u){return /^https?:\/\//i.test(u||'')?u:null}
function link(txt,u){var h=safeUrl(u);if(!h)return document.createTextNode(txt);var a=el('a',null,txt);a.href=h;a.target='_blank';a.rel='noopener noreferrer';return a}

function netErr(e){
  if(e&&e.kind)return e;
  return {kind:'net',msg:'Cannot reach the server at '+base()+'. Either it is not running, the share link is down, or the server blocked this page (CORS: check NA_CORS_ORIGINS includes '+location.origin+').'};
}
async function http(path,opts){
  var r;
  try{r=await fetch(base()+path,opts)}catch(e){throw netErr(e)}
  if(r.status===401||r.status===403){
    // A stale maintainer token is dropped so the next try goes out anonymously.
    var had=!!token();
    if(had){try{localStorage.removeItem('na.token')}catch(e){}sess=null;connKey=''}
    throw {kind:'auth',msg:had?'The saved maintainer token was rejected and removed. Ask again.':'The server did not accept this request (HTTP '+r.status+').'};
  }
  return r;
}
function hdrs(){
  var h={'Content-Type':'application/json','Accept':'application/json, text/event-stream','mcp-protocol-version':PROTO};
  if(token())h['Authorization']='Bearer '+token();
  if(sess)h['mcp-session-id']=sess;return h;
}
async function rpc(body,isNote,onProgress){
  var r=await http('/mcp',{method:'POST',headers:hdrs(),body:JSON.stringify(body)});
  if(isNote){if(!r.ok&&r.status!==202)throw {kind:'srv',msg:'Server error '+r.status+' on notification.'};return null}
  if(r.status===404&&sess){sess=null;throw {kind:'srv',msg:'Session expired; try again.'}}
  if(r.status===429){var t429=await r.text(),m429='';try{m429=JSON.parse(t429).error.message}catch(e){}throw {kind:'srv',msg:m429||'Too many requests. Try again shortly.'}}
  if(!r.ok)throw {kind:'srv',msg:'Server error '+r.status+' '+(await r.text()).slice(0,200)};
  var sid=r.headers.get('mcp-session-id');if(sid)sess=sid;
  var ct=r.headers.get('content-type')||'',j;
  if(/text\/event-stream/i.test(ct)&&r.body&&r.body.getReader)j=await readSse(r,body,onProgress);
  else{
    var t=await r.text();
    try{j=JSON.parse(t)}catch(e){
      var m=t.match(/^data:\s*(\{.*\})\s*$/m);
      if(!m)throw {kind:'srv',msg:'Unreadable server reply.'};j=JSON.parse(m[1]);
    }
  }
  if(j.error)throw {kind:'srv',msg:'Server: '+(j.error.message||JSON.stringify(j.error))};
  return j.result;
}
// Stream the SSE body: events end at a blank line; progress notifications go to onProgress, the object carrying our id is the reply.
async function readSse(r,body,onProgress){
  var rd=r.body.getReader(),dec=new TextDecoder(),buf='',fin=null;
  function ev(raw){
    var data=raw.split(/\r?\n/).filter(function(l){return /^data:/.test(l)}).map(function(l){return l.replace(/^data:\s?/,'')}).join('\n');
    if(!data)return;
    var o;try{o=JSON.parse(data)}catch(e){return}
    if(o&&o.method==='notifications/progress'&&o.params&&o.params.progressToken===body.id){
      if(onProgress&&typeof o.params.message==='string'&&o.params.message)try{onProgress(o.params.message)}catch(e){}
    }else if(o&&o.id===body.id&&(o.result!==undefined||o.error))fin=o;
  }
  try{
    for(;;){
      var c=await rd.read();
      if(c.done)break;
      buf+=dec.decode(c.value,{stream:true});
      var parts=buf.split(/\r?\n\r?\n/);buf=parts.pop();
      parts.forEach(ev);
    }
    buf+=dec.decode();if(buf.trim())ev(buf);
  }catch(e){throw netErr(e)}
  if(!fin)throw {kind:'srv',msg:'Unreadable server reply.'};
  return fin;
}
async function init(){
  var key=base()+'|'+token();
  if(sess&&key===connKey)return;
  sess=null;connKey=key;
  try{
    await rpc({jsonrpc:'2.0',id:rid++,method:'initialize',params:{protocolVersion:PROTO,capabilities:{},clientInfo:{name:'newamerica-console',version:'0.1'}}});
    await rpc({jsonrpc:'2.0',method:'notifications/initialized'},true);
  }catch(e){sess=null;connKey='';throw e}
}
async function tool(name,args,onProgress){
  await init();
  var id=rid++;
  var res=await rpc({jsonrpc:'2.0',id:id,method:'tools/call',params:{name:name,arguments:args,_meta:{progressToken:id}}},false,onProgress);
  var txt=res&&res.content&&res.content[0]&&res.content[0].text||'';
  if(res&&res.isError)throw {kind:'srv',msg:txt||'Tool error.'};
  return {data:res&&res.structuredContent,text:txt};
}

var locked=false,openUntil,counts=null;
var OFFLINE_MSG="New America research is currently offline",offline=null,healthTimer=null;
function setOffline(off,why){
  if(offline===off)return;offline=off;
  var q=$('q'),g=$('go'),box=$('ask').querySelector('.box'),note=$('offline');
  document.body.classList.toggle('offline',off);
  q.disabled=off||locked;g.disabled=off||locked||!!busy;box.classList.toggle('off',off);
  if(off){q.dataset.ph=q.dataset.ph||q.placeholder;q.placeholder=OFFLINE_MSG;note.textContent=OFFLINE_MSG+(why?' ('+why+')':'')+'. Retrying every 30 seconds.';note.hidden=false}
  else{if(q.dataset.ph)q.placeholder=q.dataset.ph;note.hidden=true;note.textContent=''}
}
// On load (and every 30 s) probe /healthz: a reachable API enables the composer, anything else grays it out.
function health(){
  var d=$('dot');
  return http('/healthz').then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(function(h){
    if(!h||h.ok===false)throw new Error('unhealthy');
    d.className='dot on';
    d.title='Connected: '+h.documents+' documents ('+h.tier1+' major reports and books), synced '+(h.cursor_age_hours!=null?Number(h.cursor_age_hours).toFixed(1)+' h ago':'(unknown)')+(h.watch_running?', watcher running':', watcher stopped');
    openUntil=typeof h.openAccessUntil==='string'?h.openAccessUntil:null;
    counts=h.counts||null;
    gate();
    setOffline(false);
  }).catch(function(e){d.className='dot off';d.title='Offline: cannot reach '+base();setOffline(true,e&&e.message&&/HTTP/.test(e.message)?e.message:'')})
  .finally(function(){clearTimeout(healthTimer);healthTimer=setTimeout(health,30000)});
}
//#fmt-start
// "Oct 31, 2026" from the date part of the healthz value (its own offset, so the day never shifts).
function untilLabel(v){
  var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(v||'');if(!m)return '';
  return new Date(Date.UTC(+m[1],+m[2]-1,+m[3])).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}
// 22500 -> "22.5k", 1200 -> "1.2k", 400 -> "400"; one decimal under 100k, whole thousands above.
function compact(n){
  if(n<1000)return String(n);
  var k=n/1000;
  return (k<100?k.toFixed(1).replace(/\.0$/,''):String(Math.round(k)))+'k';
}
var STAT_LABELS=[['documents','pages'],['programs','programs'],['projects','projects'],['people','contributors'],['topics','topics'],['pdfs','PDFs'],['social','social posts']];
// "Searching 22.5k pages · 60 programs · ..." with zero or missing fields hidden; '' when nothing is left.
function statsLine(c){
  var parts=[];
  STAT_LABELS.forEach(function(p){var n=c&&c[p[0]];if(typeof n==='number'&&n>0)parts.push(compact(n)+' '+p[1])});
  return parts.length?'Searching '+parts.join(' \u00b7 '):'';
}
//#fmt-end
// Note above the input box: window open, or closed (null or past) with the composer disabled unless a maintainer token is stored.
function gate(){
  var open=openUntil!==null&&openUntil!==undefined&&Date.parse(openUntil)>Date.now();
  locked=!open&&!token()&&openUntil!==undefined;
  var pv=$('preview'),d=untilLabel(openUntil)||'Oct 31, 2026';
  // while open, the welcome subhead carries the demo dates; the note above the input only says when it has ended
  pv.hidden=!locked;
  if(locked)pv.textContent='This time-limited demonstration ended on '+d+'.';
  var st=$('stats'),line=statsLine(counts);st.hidden=!line;st.textContent=line;
  var q=$('q'),g=$('go');q.disabled=locked||!!offline;g.disabled=locked||!!offline||!!busy;
  $('ask').querySelector('.box').classList.toggle('off',locked||!!offline);
}

function renderCorpus(c,out){
  var groups=(c&&c.groups)||[];
  if(c&&c.window&&c.window.oldest){out.appendChild(el('p','meta','Covers '+c.window.oldest+' to '+c.window.newest+'.'))}
  if(!groups.length){out.appendChild(el('p',null,'No documents matched. Try different wording.'));return}
  groups.slice().sort(function(a,b){return a.tier-b.tier}).forEach(function(g){
    if(!g.items||!g.items.length)return;
    out.appendChild(el('h2',null,(TIERS[g.tier]||'Other')+' ('+g.items.length+')'));
    g.items.slice().sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''))}).forEach(function(it){out.appendChild(item(it))});
  });
}
function blurbs(parent,o){
  if(o&&typeof o.why==="string"&&o.why.trim())parent.appendChild(el("p","why",o.why.trim()));
  if(o&&typeof o.blurb==="string"&&o.blurb.trim())parent.appendChild(el("p","blurb",o.blurb.trim()));
}
//#rows-start
function numId(v){return typeof v==='number'&&isFinite(v)&&Math.floor(v)===v&&v>0}
// "See more like this (n)" for a positive related_count, '' otherwise (the link is then not rendered); "50+" at the cap (RELATED_CAP, src/mcp/hit.ts:93), where n is a floor not a count.
function moreLabel(n){return typeof n==='number'&&isFinite(n)&&n>=1?'See more like this ('+(n>=50?'50+':Math.floor(n))+')':''}
var TAG_KEYS=['types','programs','topics','issues','projects'],TAG_MAX=6;
// Every taxonomy name on a row, known taxonomies first, then any other key; the row's own program and repeats dropped.
function tagNames(t,skip){
  var seen={},out=[];t=t&&typeof t==='object'?t:{};
  Object.keys(t).sort(function(a,b){var i=TAG_KEYS.indexOf(a),j=TAG_KEYS.indexOf(b);return (i<0?99:i)-(j<0?99:j)||(a<b?-1:a>b?1:0)}).forEach(function(k){
    (Array.isArray(t[k])?t[k]:[]).forEach(function(v){var s=String(typeof v==='string'?v:(v&&(v.name||v.title))||'').trim();if(s&&s!==skip&&!seen[s]){seen[s]=1;out.push(s)}});
  });
  return out;
}
// Muted second line under a source title: "<Program> · <tag> · <tag> … +n"; the program links to its landing page when known.
function progRow(o){
  if(!o)return null;
  var names=tagNames(o.tags,o.program),r=el('div','prog-row'),first=true;
  if(!o.program&&!names.length)return null;
  function sep(){if(!first){var s=el('span','sep',' \u00b7 ');s.setAttribute('aria-hidden','true');r.appendChild(s)}first=false}
  if(o.program){sep();var p=link(o.program,o.programUrl);if(p.nodeType===1)p.className='prog';else{var sp=el('span','prog');sp.appendChild(p);p=sp}r.appendChild(p)}
  names.slice(0,TAG_MAX).forEach(function(n){sep();r.appendChild(el('span','tag-chip',n))});
  if(names.length>TAG_MAX){sep();r.appendChild(el('span','tag-more','+'+(names.length-TAG_MAX)))}
  return r;
}
// Read / Cite and, when related_count > 0, "See more like this (n)" for a numbered document row; null for social posts and rows without an id.
function actsRow(o){
  if(!o||!numId(o.id)||o.kind==='social')return null;
  var box=el('div','acts'),rb=el('button',null,'Read'),cb=el('button',null,'Cite'),lab=moreLabel(o.related_count),mb=null;
  rb.type=cb.type='button';box.appendChild(rb);box.appendChild(cb);
  if(lab){mb=el('button','more-like',lab);mb.type='button';box.appendChild(mb)}
  return {box:box,rb:rb,cb:cb,mb:mb};
}
//#rows-end
function socialBy(o){
  var a=typeof o.author==='string'&&o.author.trim()?o.author.trim():(Array.isArray(o.authors)&&o.authors.length?o.authors.map(function(p){return typeof p==='string'?p:(p&&p.name)||''}).filter(Boolean).join(', '):'');
  return a;
}
function item(it){
  var d=el('article','item');
  if(it.kind==='social'){
    d.appendChild(el('div','meta',(it.date?String(it.date).slice(0,10):'undated')));
    var sh=el('h3');sh.appendChild(link(it.title||'(untitled)',it.url));sh.appendChild(el('span','soc-chip','Social post'));d.appendChild(sh);
    var sb=socialBy(it);if(sb)d.appendChild(el('div','authors','By '+sb));
    blurbs(d,it);
    if(it.abstract)d.appendChild(el('p','abs',it.abstract));
    return d;
  }
  d.appendChild(el('div','meta',(it.date?String(it.date).slice(0,10):'undated')+(it.label?' · '+it.label:'')));
  var h=el('h3');h.appendChild(link(it.title||'(untitled)',it.url));
  if(it.external)h.appendChild(el('span','badge','(coverage)'));
  d.appendChild(h);
  var pr=progRow(it);if(pr)d.appendChild(pr);
  if(it.authors&&it.authors.length){
    var a=el('div','authors');
    it.authors.forEach(function(p){
      var s=el('span','au');
      if(safeUrl(p.photo)){var im=el('img');im.src=p.photo;im.alt='';im.loading='lazy';im.referrerPolicy='no-referrer';s.appendChild(im)}
      s.appendChild(document.createTextNode('By '));
      s.appendChild(link(p.name,p.url));
      if(p.personType)s.appendChild(document.createTextNode(' ('+p.personType+')'));
      a.appendChild(s);
    });d.appendChild(a);
  }
  blurbs(d,it);
  if(it.abstract)d.appendChild(el('p','abs',it.abstract));
  var a=actsRow(it);if(!a)return d;
  var slot=el('div');d.appendChild(a.box);d.appendChild(slot);
  wireActs(it,a,slot);
  return d;
}
var REDUCED=function(){return matchMedia("(prefers-reduced-motion: reduce)").matches};
// Read, Cite and See more like this on one source row; slot holds the Read/Cite output under the row.
function wireActs(it,a,slot){
  var rb=a.rb,cb=a.cb;
  if(a.mb)a.mb.onclick=function(){openExplore(it,a.mb)};
  rb.onclick=async function(){
    if(slot.firstChild&&slot.firstChild.className==='doc'){slot.textContent='';return}
    rb.disabled=true;
    try{
      var r=await tool('get_document',{id:it.id,include:['abstract','sections'],max_chars:6000});
      var pre=el('pre','doc',r.text||JSON.stringify(r.data,null,1));
      slot.textContent='';slot.appendChild(pre);
    }catch(e){e=netErr(e);slot.textContent=e.msg}
    rb.disabled=false;
  };
  cb.onclick=async function(){
    cb.disabled=true;
    try{
      var r=await tool('cite',{ids:[it.id],style:'markdown'});
      var c=r.data&&r.data.citations&&r.data.citations[0]&&r.data.citations[0].citation||r.text;
      var pre=el('pre','cite',c);slot.textContent='';slot.appendChild(pre);
      var ok=false;try{await navigator.clipboard.writeText(c);ok=true}catch(e){}
      cb.textContent=ok?'Copied':'Cite';
      if(!ok){var rg=document.createRange();rg.selectNodeContents(pre);var sl=getSelection();sl.removeAllRanges();sl.addRange(rg)}
    }catch(e){e=netErr(e);slot.textContent=e.msg}
    cb.disabled=false;
  };
}
// The explore card for one source, inserted after the card holding the clicked link (the answer, or an earlier explore card).
// A second click scrolls to that card; after a failed load it removes the error card and retries.
async function openExplore(it,btn){
  if(btn._xp&&btn._xp.isConnected&&!btn._xp.classList.contains("xp-err")){btn._xp.scrollIntoView({block:"start",behavior:REDUCED()?"auto":"smooth"});return}
  if(btn._xp){btn._xp.remove();btn._xp=null}
  var anchor=btn.closest(".card")||btn.closest(".item")||btn.parentNode;
  var card=el("article","card xp");card.setAttribute("aria-busy","true");
  card.appendChild(el("p","meta","Reading \u201c"+(it.title||"this source")+"\u201d and finding sources like it..."));
  anchor.parentNode.insertBefore(card,anchor.nextSibling);btn._xp=card;btn.disabled=true;
  try{var r=await tool("explore",{id:it.id});card.textContent="";renderExplore(r.data||{},card)}
  catch(e){e=netErr(e);card.textContent="";card.classList.add("xp-err");card.appendChild(el("p","meta",e.msg+" Select \u201c"+btn.textContent+"\u201d again to retry."))}
  card.removeAttribute("aria-busy");btn.disabled=false;
  card.scrollIntoView({block:"start",behavior:REDUCED()?"auto":"smooth"});
}
function pdfPill(parent,url,title){
  var pu=safeUrl(url);if(!pu)return;
  var pa=el("a","pdf-pill","PDF");pa.href=pu;pa.target="_blank";pa.rel="noopener";pa.setAttribute("aria-label","Open PDF of "+(title||"this source")+" (new tab)");
  parent.appendChild(document.createTextNode(" "));parent.appendChild(pa);
}
// Detailed summary (title, tier and date, program line, lead, outline, key paragraphs, PDF and chapters), then Related sources rows with the same controls.
function renderExplore(d,card){
  var doc=d.document||{};
  var h=el("h3");h.appendChild(link(doc.title||"(untitled)",doc.url));card.appendChild(h);
  card.appendChild(el("div","meta",[doc.tierName||TIERS[doc.tier]||"",doc.date?String(doc.date).slice(0,10):"undated",doc.label].filter(Boolean).join(" \u00b7 ")));
  var pr=progRow(doc);if(pr)card.appendChild(pr);
  if(d.lead)card.appendChild(el("p","abs",d.lead));
  var ol=(d.outline||[]).slice(0,20);
  if(ol.length){
    card.appendChild(el("h4",null,"Outline"));
    var top=Math.min.apply(null,ol.map(function(x){return x.level||2})),ul=el("ul","xp-outline");
    ol.forEach(function(x){var li=el("li",null,x.text),dep=Math.max(0,Math.min(4,(x.level||2)-top));if(dep)li.style.marginLeft=dep+"rem";ul.appendChild(li)});
    card.appendChild(ul);
  }
  (d.keyParagraphs||[]).forEach(function(p){card.appendChild(el("p","xp-key",p))});
  var ch=d.chapters||{};
  if(safeUrl(d.pdfUrl)||ch.count>0){var m=el("div","meta");pdfPill(m,d.pdfUrl,doc.title);if(ch.count>0)m.appendChild(el("span","chap-note"," "+ch.count+(ch.count===1?" chapter":" chapters")));card.appendChild(m)}
  var rel=d.related||{},items=rel.items||[];
  card.appendChild(el("h4",null,"Related sources"+(items.length?" ("+items.length+")":"")));
  if(rel.matched_by==="lexical")card.appendChild(el("p","meta fine","Matched by title and lead words"+(rel.fallbackReason?" ("+rel.fallbackReason+")":"")+"."));
  if(!items.length){card.appendChild(el("p","meta",rel.note||"Nothing similar was found."));return}
  var list=el("ol","srcs xp-rel");
  items.forEach(function(it){
    var li=el("li"),t=el("div","st");t.appendChild(link(it.title||"(untitled)",it.url));li.appendChild(t);
    var p2=progRow(it);if(p2)li.appendChild(p2);
    var mt=el("div","meta",[it.date?String(it.date).slice(0,4):"undated",it.label].filter(Boolean).join(" \u00b7 "));
    if(typeof it.similarity==="number")mt.appendChild(el("span","sim"," \u00b7 "+Math.round(it.similarity*100)+"% similar"));
    li.appendChild(mt);
    if(it.blurb)li.appendChild(el("p","blurb",it.blurb));
    var a=actsRow(it);if(a){var slot=el("div");li.appendChild(a.box);li.appendChild(slot);wireActs(it,a,slot)}
    list.appendChild(li);
  });
  card.appendChild(list);
}

// The quiet tag above an answer (docs/voice.md): "Themes" on a themes answer, else nothing. The "Answering as a question about <topic>" tag is gone (#116): the topic was the server's stripped residue and read as garbage.
function readAs(d){
  if(!d||d.kind==="help")return "";
  return d.kind==="throughlines"?"Themes":"";
}
function toEnd(n){n.scrollIntoView({block:"end",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"})}
function settle(t,state){
  var sh=t.body.parentNode,fin=false;
  function go(){if(fin)return;fin=true;sh.classList.remove("anim");toEnd(t.card)}
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){t.card.dataset.state=state;go();return}
  sh.classList.add("anim");t.card.dataset.state=state;
  sh.addEventListener("transitionend",function(e){if(e.target===sh&&e.propertyName==="grid-template-rows")go()});
  setTimeout(go,700);
}
function turn(q){
  var w=$("welcome");if(w)w.remove();
  var u=el("div","msg user",q);
  var a=el("article","msg assistant");a.dataset.state="pending";
  var stage=el("div","stage"),shell=el("div","body"),body=el("div","fold"),dots=el("div","dots");
  dots.setAttribute("aria-hidden","true");for(var i=0;i<3;i++)dots.appendChild(el("i"));
  shell.appendChild(body);a.appendChild(dots);a.appendChild(stage);a.appendChild(shell);
  // restart a short fade-up whenever the stage text changes (text itself updates immediately)
  new MutationObserver(function(){stage.classList.remove("swap");void stage.offsetWidth;stage.classList.add("swap")}).observe(stage,{childList:true});
  $("out").appendChild(u);$("out").appendChild(a);
  toEnd(a);
  return {card:a,stage:stage,body:body};
}
function fill(text){var q=$("q");q.value=text;grow();q.focus()}
function chips(list){
  var box=el("div","chips");
  list.forEach(function(x){var b=el("button","chip",x);b.type="button";b.onclick=function(){fill(x)};box.appendChild(b)});
  return box;
}
//#starters-start
// t: "r" research question (g = issue area; k = "g" general, a newcomer could ask it without knowing New America's catalogue, or "s" specific, it names a report, person, survey, index or program) or "i" institution question (g = category). live:false holds a question out of the rotation until its fix lands (none held now: funding went live with #117 and #119).
var STARTERS=[
{t:"r",k:"s",g:"thriving-families",q:"How did Vermont get universal child care, and could other states copy it?"},
{t:"r",k:"s",g:"thriving-families",q:"What do parents of young children say they need most, in New America's National Parent Survey?"},
{t:"r",k:"g",g:"thriving-families",q:"What does New America recommend for running a cash assistance program well?"},
{t:"r",k:"g",g:"thriving-families",q:"What does New America say about child care costs?"},
{t:"r",k:"g",g:"thriving-families",q:"How could paid family leave work in the United States?"},
{t:"r",k:"s",g:"technology-democracy",q:"What did New America say about Apple's privacy changes, and why did it call them concerning?"},
{t:"r",k:"g",g:"technology-democracy",q:"What has New America written about artificial intelligence since 2020?"},
{t:"r",k:"g",g:"technology-democracy",q:"What does New America recommend to protect college students' data privacy?"},
{t:"r",k:"g",g:"technology-democracy",q:"What does New America say about how social media affects democracy?"},
{t:"r",k:"g",g:"technology-democracy",q:"How should the government deal with the power of big tech companies?"},
{t:"r",k:"s",g:"democratic-futures",q:"What did Political Reform find in its new polling on ballot initiatives in states without them?"},
{t:"r",k:"s",g:"democratic-futures",q:"What does Mark Schmitt argue in Democracy Reforms Go Better Together?"},
{t:"r",k:"g",g:"democratic-futures",q:"How could American elections work better, according to New America?"},
{t:"r",k:"g",g:"democratic-futures",q:"What does New America say about why Americans feel so divided?"},
{t:"r",k:"s",g:"education-work",q:"What does Varying Degrees 2025 show about where Americans agree and disagree on higher education?"},
{t:"r",k:"s",g:"education-work",q:"What went wrong when a for-profit college replaced its instructors with a chatbot?"},
{t:"r",k:"g",g:"education-work",q:"What does New America say about the cost of college and student debt?"},
{t:"r",k:"g",g:"education-work",q:"How do apprenticeships help people get good jobs?"},
{t:"r",k:"s",g:"global-security",q:"What does New America say about the risk of data centers becoming targets, and how to protect them?"},
{t:"r",k:"g",g:"global-security",q:"Why do so few women work in cybersecurity?"},
{t:"r",k:"g",g:"global-security",q:"What does New America say about how war is changing?"},
{t:"r",k:"g",g:"global-security",q:"How is technology changing national security?"},
{t:"i",g:"history",q:"How did New America begin?"},
{t:"i",g:"history",q:"How has New America's focus changed since it began?"},
{t:"i",g:"operations",q:"What does a National Fellow at New America actually do for a year?"},
{t:"i",g:"operations",q:"Where should a newcomer start reading New America's work?"},
{t:"i",g:"influence",q:"Which New America reports has Congress cited?"},
{t:"i",g:"influence",q:"Who has covered New America in the news?"},
{t:"i",g:"people",q:"Who at the Political Reform program should a reporter call about multiparty politics and proportional representation?"},
{t:"i",g:"people",q:"Who at New America should I talk to about Wagner Group and Future of Proxy Warfare?"},
{t:"i",g:"funding",q:"How has New America's disclosed funding changed since it began publishing its funders in 2018?"},
{t:"i",g:"funding",q:"Which reports did the Bill & Melinda Gates Foundation help pay for at New America?"}
];
var STARTER_KEY="na.starters";
// Five chips per load, a pure function of the visit counter n (no random numbers, so tests replay it). Normal load: 3 research questions from 3 areas plus 2 institution questions from 2 categories; with fewer than 3 live categories: 4 research plus 1.
function startersPick(pool,n){
  var live=pool.filter(function(s){return s.live!==false});
  function groups(t){var o=[];live.forEach(function(s){if(s.t===t&&o.indexOf(s.g)<0)o.push(s.g)});return o}
  function ask(t,g,i,k){var m=live.filter(function(s){return s.t===t&&s.g===g&&(!k||s.k===k)});if(!m.length)m=live.filter(function(s){return s.t===t&&s.g===g});return m[i%m.length].q}
  var ga=groups("r"),gc=groups("i");
  var ni=gc.length>=3?2:Math.min(gc.length,1),nr=Math.min(5-ni,ga.length),out=[],j;
  // Weighted to general questions, the kind a newcomer asks: of every 3 research chips 1 is specific (2 of 3, 3 of 4), and the specific slot moves with the visit counter.
  var ns=Math.floor(nr/3),first=n%nr;
  for(j=0;j<nr;j++)out.push(ask("r",ga[(n*nr+j)%ga.length],Math.floor(n/ga.length),((j-first+nr)%nr)<ns?"s":"g"));
  for(j=0;j<ni;j++)out.push(ask("i",gc[(n*ni+j)%gc.length],Math.floor(n/gc.length)));
  return out;
}
// The visit counter: read, advance and keep in localStorage; a blocked or garbled store means set 0.
function startersVisit(){try{var n=parseInt(ls(STARTER_KEY),10);if(!(n>=0))n=0;ls(STARTER_KEY,String(n+1));return n}catch(e){return 0}}
//#starters-end
function welcome(){
  var w=el("section","welcome");w.id="welcome";
  w.appendChild(el("h2",null,"What would you like to know?"));
  w.appendChild(el("p","meta","Ask about New America and its work using plain words in this time-limited demo running through "+(untilLabel(openUntil)||"Oct 31, 2026")+". Type help to see what I can do."));
  w.appendChild(chips(startersPick(STARTERS,startersVisit())));$("out").appendChild(w);
}
var AUTO=window.CSS&&CSS.supports&&CSS.supports("field-sizing","content");
function grow(){var q=$("q");if(AUTO){q.style.height="";return}q.style.height="auto";q.style.height=Math.min(q.scrollHeight,112)+"px"}
// Minimal markdown: paragraphs, bullets, **bold**; [n] becomes a superscript link to Sources entry n. All text is escaped via textContent.
function inline(parent,s,cites){
  var re=/(!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\)|\*\*[^*]+\*\*|\[\d+\])/g,parts=s.split(re);
  parts.forEach(function(p){
    if(!p)return;
    var im=p.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if(im){if(safeUrl(im[2])){var i=el("img","av");i.src=im[2];i.alt=im[1]||"";i.loading="lazy";i.referrerPolicy="no-referrer";parent.appendChild(i)}return}
    var lk=p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if(lk){if(safeUrl(lk[2]))parent.appendChild(link(lk[1],lk[2]));else parent.appendChild(document.createTextNode(lk[1]));return}
    if(/^\*\*.+\*\*$/.test(p)){parent.appendChild(el("strong",null,p.slice(2,-2)));return}
    var m=p.match(/^\[(\d+)\]$/);
    if(m&&cites[m[1]]){var sup=el("sup"),a=el("a",null,"["+m[1]+"]");a.href="#src-"+m[1];a.onclick=function(ev){ev.preventDefault();var t=document.getElementById("src-"+m[1]);if(t)t.scrollIntoView({block:"center",behavior:"smooth"})};sup.appendChild(a);parent.appendChild(sup);return}
    parent.appendChild(document.createTextNode(p));
  });
}
function md(text,cites){
  var box=el("div","md"),lines=String(text).replace(/\r/g,"").split("\n"),ul=null,para=[];
  function flush(){if(para.length){var p=el("p");inline(p,para.join(" "),cites);box.appendChild(p);para=[]}}
  lines.forEach(function(l){
    var b=l.match(/^\s*[-*]\s+(.*)$/),h=l.match(/^#{1,6}\s+(.*)$/);
    if(b){flush();if(!ul){ul=el("ul");box.appendChild(ul)}var li=el("li");inline(li,b[1],cites);ul.appendChild(li);return}
    ul=null;
    if(h){flush();var hh=el("h4");inline(hh,h[1],cites);box.appendChild(hh);return}
    if(!l.trim()){flush();return}
    para.push(l.trim());
  });
  flush();return box;
}
function renderAnswer(d,q,out){
  var cites={};(d.citations||[]).forEach(function(c){cites[c.n]=c});
  // drop the model's own trailing Sources list; the structured one below is authoritative
  var body=String(d.answer||"").replace(/\n+[ \t]*(?:#{1,6}[ \t]*)?\**[ \t]*Sources[ \t]*:?[ \t]*\**[ \t]*:?[ \t]*\n[\s\S]*$/i,"");
  var card=el("article","card");
  card.appendChild(md(body,cites));
  if(d.citations&&d.citations.length){
    card.appendChild(el("h4",null,"Sources"));
    var ol=el("ol","srcs");
    d.citations.forEach(function(c){
      var li=el("li");li.id="src-"+c.n;li.value=c.n;
      var h=el("div","st");h.appendChild(link(c.title||"(untitled)",c.url));li.appendChild(h);
      var soc=c.kind==="social",cpr=soc?null:progRow(c);if(cpr)li.appendChild(cpr);
      var mt=el("div","meta",[soc?"":c.label,c.date?String(c.date).slice(0,10):""].filter(Boolean).join(" · "));
      if(soc)mt.insertBefore(el("span","soc-chip","Social post"),mt.firstChild);
      var pu=safeUrl(c.pdfUrl);
      if(pu){var pa=el("a","pdf-pill","PDF");pa.href=pu;pa.target="_blank";pa.rel="noopener";pa.setAttribute("aria-label","Open PDF of "+(c.title||"this source")+" (new tab)");mt.appendChild(document.createTextNode(" "));mt.appendChild(pa)}
      if(c.chapters>0){mt.appendChild(el("span","chap-note"," "+c.chapters+(c.chapters===1?" chapter":" chapters")))}
      li.appendChild(mt);
      if(c.funders&&c.funders.length){var fr=el("div","fund-row");fr.appendChild(el("span","fund-lab","Funded by"));c.funders.forEach(function(f){fr.appendChild(el("span","tl-chip",f))});li.appendChild(fr)}
      var au=(c.authorDetails||[]);
      if(au.length){var a=el("div","authors");au.forEach(function(p){var s=el("span","au");if(safeUrl(p.photo)){var im=el("img");im.src=p.photo;im.alt="";im.loading="lazy";im.referrerPolicy="no-referrer";s.appendChild(im)}s.appendChild(link(p.name,p.url));a.appendChild(s)});li.appendChild(a)}
      else if(soc){var sb=socialBy(c);if(sb)li.appendChild(el("div","meta","By "+sb))}
      else if(c.authors&&c.authors.length)li.appendChild(el("div","meta","By "+c.authors.join(", ")));
      blurbs(li,c);
      var ca=actsRow(c);if(ca){var cs=el("div");li.appendChild(ca.box);li.appendChild(cs);wireActs(c,ca,cs)}
      ol.appendChild(li);
    });card.appendChild(ol);
  }
  var u=d.usage||{};
  card.appendChild(el("div","meta fine",(d.model||"model")+" · "+(u.input_tokens||0)+" in / "+(u.output_tokens||0)+" out tokens"));
  out.appendChild(card);
}
function renderHelp(d,text,out){
  var card=el("article","card");
  card.appendChild(md(text||"",{}));
  var ex=((d&&d.examples)||[]).concat(d&&d.throughlinesExample?[d.throughlinesExample]:[]);
  if(ex.length){card.appendChild(el("h4",null,"Tap an example to fill the box"));card.appendChild(chips(ex))}
  out.appendChild(card);
}
function yearSpan(y){if(!y||y[0]==null)return "undated";return y[0]===y[1]?String(y[0]):y[0]+"\u2013"+y[1]}
// "Explore on the site" (programs, topics and issues, then the site's index pages), then "Related themes", appended to a themes, people or agent answer.
function siteBlocks(d,card){
  var rel=d.related||{},ps=rel.programs||[],ts=rel.terms||[],ix=rel.indexes||[];
  if(ps.length||ts.length||ix.length){
    card.appendChild(el("h4",null,"Explore on the site"));
    [["Programs",ps],["Topics and issues",ts],["",ix]].forEach(function(p){if(!p[1].length)return;var row=el("div","fund-row");if(p[0])row.appendChild(el("span","fund-lab",p[0]));p[1].forEach(function(x){row.appendChild(link(x.name,x.url));row.appendChild(document.createTextNode(" "))});card.appendChild(row)});
  }
  var disc=d.discovered||[];
  if(disc.length){
    card.appendChild(el("h4",null,"Related themes"));
    var ul=el("ul","tl-reps");
    disc.forEach(function(g){var li=el("li");li.appendChild(el("strong",null,g.label));if(g.sentence)li.appendChild(document.createTextNode(" \u2014 "+g.sentence+" "));if(g.representative){li.appendChild(document.createTextNode(" "));li.appendChild(link(g.representative.title||"(untitled)",g.representative.url))}ul.appendChild(li)});
    card.appendChild(ul);
  }
}
// "Seen in: A, B and N more" from a theme's top programs and its program count; '' when it names none (same rule as seenIn in src/mcp/tools/throughlines.ts).
function seenIn(c){
  var names=(c.programs||[]).slice(0,2).map(function(p){return p.name});
  if(!names.length)return "";
  var more=Math.max(c.programCount||0,(c.programs||[]).length)-names.length;
  if(more>0)return "Seen in: "+names.join(", ")+" and "+more+" more";
  return "Seen in: "+(names.length===1?names[0]:names[0]+" and "+names[1]);
}
function renderThroughlines(d,out){
  var card=el("article","card tl");
  card.appendChild(el("h3",null,d.topic&&(d.ranking==="topic"||d.ranking==="lexical")?"Ideas on "+d.topic+" that recur across New America\u2019s work":d.program?"Ideas that recur across New America\u2019s work, including "+d.program:"Ideas that recur across New America\u2019s work"));
  if(d.note)card.appendChild(el("p","meta",d.note));
  var list=d.clusters||[];
  if(!list.length)card.appendChild(el("p",null,"No theme matched."));
  list.forEach(function(c){
    var s=el("section","tl-cluster");
    s.appendChild(el("h4",null,c.label||("Theme "+c.id+" (not yet named)")));
    if(c.sentence)s.appendChild(el("p","tl-sentence",c.sentence));
    var seen=seenIn(c);if(seen)s.appendChild(el("div","meta",seen));
    var ul=el("ul","tl-reps");
    (c.representatives||[]).slice(0,2).forEach(function(r){
      var li=el("li");li.appendChild(link(r.title||"(untitled)",r.url));
      if(r.date)li.appendChild(el("span","tl-year",String(r.date).slice(0,4)));
      ul.appendChild(li);
    });
    s.appendChild(ul);card.appendChild(s);
  });
  siteBlocks(d,card);
  out.appendChild(card);
}
function renderFunders(d,out){
  var card=el("article","card fd"),pubs=d.publications||[],items=d.items||[];
  card.appendChild(el("h3",null,d.funder?"Publications crediting "+((d.matched||[]).join(", ")||d.funder):"Who funded the work"+(d.groupBy&&d.groupBy!=="funder"?" (by "+d.groupBy+")":"")));
  if(d.note)card.appendChild(el("p","meta",d.note));
  else card.appendChild(el("p","meta",d.total+(d.total===1?" publication names":" publications name")+" a funder in its own credit lines. Some funded work names no funder, so the real numbers are higher."));
  if(pubs.length){
    var ol=el("ol","fd-pubs");
    pubs.forEach(function(p){
      var li=el("li"),h=el("div","st");h.appendChild(link(p.title||"(untitled)",p.url));li.appendChild(h);
      li.appendChild(el("div","meta",[p.label,p.date?String(p.date).slice(0,10):"",p.program].filter(Boolean).join(" \u00b7 ")));
      if(p.sentence)li.appendChild(el("div","meta fd-credit","\u201c"+p.sentence+"\u201d"));
      ol.appendChild(li);
    });
    card.appendChild(ol);
  }else if(items.length){
    var ul=el("ol","fd-rank");
    items.forEach(function(it){
      var li=el("li");li.appendChild(el("strong",null,it.key));
      li.appendChild(el("span","meta"," \u00b7 "+it.publications+(it.publications===1?" publication":" publications")+" \u00b7 "+yearSpan(it.years)));
      if(it.top&&it.top.length){var row=el("div","fund-row");it.top.forEach(function(t){row.appendChild(el("span","tl-chip",t))});li.appendChild(row)}
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }
  if(d.links&&d.links.length){
    card.appendChild(el("h4",null,"Where New America publishes its funding"));
    var lu=el("ul");
    d.links.forEach(function(l){var li=el("li");li.appendChild(link(l.label,l.url));li.appendChild(document.createTextNode(" \u2014 "+l.note));lu.appendChild(li)});
    card.appendChild(lu);
  }
  out.appendChild(card);
}
// Source labels and the footer come from the card (the server's source registry, src/citations/sources.ts); the page keeps no copy.
// who_cites sends labels; citation_report carries each label on its totals row
function citeLabel(d,s){var t=(d.totals||[]).find(function(x){return x.source===s});return (d.labels&&d.labels[s])||(t&&t.label)||s}
function citeFooter(card,d){if(!d.footer)return;card.appendChild(el("p","meta fd-credit",d.footer.checked));card.appendChild(el("p","meta fd-credit",d.footer.notCovered))}
function renderWhoCites(d,out){
  var card=el("article","card fd"),doc=d.document||{},items=d.items||[],srcs=d.sources||[];
  var h=el("h3",null,"Who cites ");h.appendChild(link(doc.title||"(untitled)",doc.url));card.appendChild(h);
  card.appendChild(el("p","meta",d.total+(d.total===1?" citation":" citations")+(TIERS[doc.tier]?" \u00b7 "+TIERS[doc.tier]:"")));
  var row=el("div","fund-row");
  srcs.forEach(function(s){row.appendChild(el("span","tl-chip",citeLabel(d,s.source)+" "+((d.counts||{})[s.source]||0)+(s.status==="ok"?"":" ("+String(s.status).replace("_"," ")+")")))});
  card.appendChild(row);
  srcs.forEach(function(s){if(s.note&&s.note!=="not requested"&&s.status!=="skipped")card.appendChild(el("p","meta",citeLabel(d,s.source)+": "+s.note))});
  if(d.note)card.appendChild(el("p","meta",d.note));
  if(items.length){
    var ol=el("ol","fd-pubs");
    items.forEach(function(it){
      var li=el("li"),t=el("div","st");t.appendChild(link(it.title||"(untitled)",it.url));t.appendChild(el("span","tl-chip",citeLabel(d,it.source)));
      if(it.match==="inferred")t.appendChild(el("span","tl-chip","inferred"));li.appendChild(t);
      li.appendChild(el("div","meta",[it.venue,it.author,it.date?String(it.date).slice(0,10):"",it.cited_by_count!=null?"cited by "+it.cited_by_count:""].filter(Boolean).join(" \u00b7 ")));
      ol.appendChild(li);
    });
    card.appendChild(ol);
  }
  if(items.some(function(i){return i.match==="inferred"}))card.appendChild(el("p","meta fd-credit","In the News matches are inferred from shared title words (at least "+Math.round((d.inferredThreshold||0)*100)+"%). Check one before quoting it."));
  citeFooter(card,d);
  out.appendChild(card);
}
// The News block of the citation report (server: NewsSchema, src/mcp/tools/citations.ts), parsed before it is rendered: absent is fine, a malformed block throws instead of drawing an empty section.
function parseNews(n){
  if(n==null)return null;
  var ok=typeof n==="object"&&typeof n.summary==="string"&&n.summary&&Array.isArray(n.items)&&n.items.every(function(i){return i&&typeof i==="object"&&typeof i.title==="string"&&typeof i.url==="string"&&(i.outlet==null||typeof i.outlet==="string")&&(i.date==null||typeof i.date==="string")&&(i.featured==null||typeof i.featured==="string")});
  if(!ok)throw new Error("The news section of the report came back in an unexpected shape.");
  return n;
}
function renderCitationReport(d,out){
  var card=el("article","card fd"),docs=d.documents||[],news=parseNews(d.news);
  card.appendChild(el("h3",null,"Who cites New America"+(d.since?" since "+d.since:"")));
  if(d.note)card.appendChild(el("p","meta",d.note));
  var times=function(n){return n===1?"once":n+" times"};
  // News first: the server's one sentence, then the newest stories (outlet, linked headline, date, featured person or program).
  if(news){
    var sec=el("section","cite-kind");sec.appendChild(el("h4",null,"In the news"));sec.appendChild(el("p",null,news.summary));
    var nl=el("ul","fd-pubs");
    news.items.forEach(function(it){
      var li=el("li"),t=el("div","st");
      if(it.outlet)t.appendChild(el("strong",null,it.outlet+": "));
      t.appendChild(link(it.title,it.url));li.appendChild(t);
      var meta=[it.date?String(it.date).slice(0,10):"",it.featured?"Featuring "+it.featured:""].filter(Boolean).join(" · ");
      if(meta)li.appendChild(el("div","meta",meta));
      nl.appendChild(li);
    });
    sec.appendChild(nl);card.appendChild(sec);
  }
  card.appendChild(el("h4",null,"Most-cited documents"));
  if(docs.length){
    var ol=el("ol","fd-rank");
    docs.forEach(function(x){
      var li=el("li");li.appendChild(link(x.title||"(untitled)",x.url));
      var by=Object.keys(x.bySource||{}).map(function(k){return citeLabel(d,k)}).join(", ");
      li.appendChild(el("span","meta"," · cited "+times(x.total)+(by?", by "+by:"")));
      ol.appendChild(li);
    });
    card.appendChild(ol);
  }else card.appendChild(el("p","meta","No citation is matched to a listed document yet."));
  // Other places New America is cited: one sentence per source that has a mention; none for a zero, and In the News has its own section.
  var rest=(d.totals||[]).filter(function(t){return t.rows>0&&!(t.source==="in_the_news"&&news)});
  if(rest.length){
    card.appendChild(el("h4",null,"Elsewhere"));
    var eu=el("ul");rest.forEach(function(t){eu.appendChild(el("li",null,t.label+" cites New America's work "+times(t.rows)+"."))});card.appendChild(eu);
  }
  // A card without state (an older one) counts as checked: nothing is listed as not checked.
  var unchecked=(d.totals||[]).filter(function(t){return t.state==="not_checked"});
  if(unchecked.length)card.appendChild(el("p","meta","Not checked yet: "+unchecked.map(function(t){return t.label}).join(", ")+"."));
  citeFooter(card,d);
  out.appendChild(card);
}
function renderPeople(d,out){
  var card=el("article","card pp"),list=d.people||[];
  card.appendChild(el("h3",null,"Who works on "+(d.topic||"this topic")));
  if(d.note)card.appendChild(el("p","meta",d.note));
  else card.appendChild(el("p","meta","Ranked from "+d.corpusSize+(d.corpusSize===1?" publication":" publications")+" on the topic. Bylines only."));
  var ol=el("ol","pp-list");
  list.forEach(function(p){
    var li=el("li","pp-person"),h=el("div","pp-head");
    if(safeUrl(p.photoUrl)){var im=el("img","pp-av");im.src=p.photoUrl;im.alt="";im.loading="lazy";im.referrerPolicy="no-referrer";h.appendChild(im)}
    else h.appendChild(el("span","pp-av pp-av--none",(p.name||"?").charAt(0)));
    var who=el("div");var nm=el("strong");nm.appendChild(link(p.name,p.bioUrl));who.appendChild(nm);
    var meta=[p.role,p.program].filter(Boolean).join(" · ");
    if(meta)who.appendChild(el("div","meta",meta));
    h.appendChild(who);li.appendChild(h);
    if(p.why)li.appendChild(el("div","pp-why",p.why));
    if(p.latest){var lt=el("div","meta");lt.appendChild(document.createTextNode("Latest: "));lt.appendChild(link(p.latest.title||"(untitled)",p.latest.url));if(p.latest.date)lt.appendChild(document.createTextNode(" · "+String(p.latest.date).slice(0,10)));li.appendChild(lt)}
    ol.appendChild(li);
  });
  if(list.length)card.appendChild(ol);
  siteBlocks(d,card);
  out.appendChild(card);
}
function evWhen(s){if(!s)return "Date not listed";var t=String(s);return t.slice(0,10)+(t.length>10?" "+t.slice(11,16):"")}
function renderEvents(d,out){
  var card=el("article","card ev"),list=d.events||[],w=d.window||{};
  card.appendChild(el("h3",null,d.upcoming?"Upcoming events ("+(w.label||"upcoming")+")":"No upcoming events"+(w.label&&w.label!=="upcoming"?" "+w.label:"")));
  if(d.note)card.appendChild(el("p","meta",d.note));
  var ol=el("ol","ev-list");
  list.forEach(function(e){
    var li=el("li"),h=el("div","st");h.appendChild(link(e.title||"(untitled)",e.url));
    if(e.format)h.appendChild(el("span","tl-chip ev-fmt",e.format==="in-person"?"In person":e.format.charAt(0).toUpperCase()+e.format.slice(1)));
    li.appendChild(h);
    li.appendChild(el("div","meta",[evWhen(e.event_start),e.program].filter(Boolean).join(" · ")));
    if(e.abstract)li.appendChild(el("p","ev-abs",e.abstract));
    if(safeUrl(e.registrationUrl)){var r=el("div","meta");r.appendChild(link("Register",e.registrationUrl));li.appendChild(r)}
    ol.appendChild(li);
  });
  if(list.length)card.appendChild(ol);
  card.appendChild(el("p","meta fine","Times are the site’s local time (Eastern)."));
  out.appendChild(card);
}
function moreSources(card,q){
  var det=el("details","more"),sm=el("summary",null,"Show all sources"),slot=el("div");
  det.appendChild(sm);det.appendChild(slot);card.appendChild(det);
  var loaded=false;
  det.ontoggle=async function(){
    if(!det.open||loaded)return;
    slot.textContent="Loading the ranked sources...";
    try{var c=await tool("build_corpus",{request:q,max_docs:20});slot.textContent="";renderCorpus(c.data||{groups:[]},slot);loaded=true}
    catch(e){e=netErr(e);slot.textContent=e.msg}
  };
}
//#history-start
// The conversation window: the last 8 turns, in this browser's localStorage only (never the URL, never a log). It rides only on
// the answer call; the server re-applies the same caps (src/mcp/conversation.ts HistorySchema).
var HIST_KEY="na.history",HIST_TURNS=8,HIST_CHARS=1500,HIST_TOTAL=8000,HIST_CITES=12,HIST_TITLE=200;
function histFit(h){
  h=h.filter(function(t){return t&&(t.role==="user"||t.role==="assistant")&&typeof t.text==="string"&&t.text.trim()}).map(function(t){
    var o={role:t.role,text:t.text.slice(0,HIST_CHARS)};if(typeof t.ts==="string")o.ts=t.ts;
    var cs=Array.isArray(t.citations)?t.citations.filter(function(c){return c&&typeof c.id==="number"&&Math.floor(c.id)===c.id}).slice(0,HIST_CITES).map(function(c){return {id:c.id,title:String(c.title||"").slice(0,HIST_TITLE)}}):[];
    if(cs.length)o.citations=cs;return o;
  }).slice(-HIST_TURNS);
  function total(){return h.reduce(function(n,t){return n+t.text.length},0)}
  while(h.length&&total()>HIST_TOTAL)h=h.slice(1);
  return h;
}
function histLoad(){try{var h=JSON.parse(ls(HIST_KEY)||"[]");return Array.isArray(h)?histFit(h):[]}catch(e){return []}}
function histAdd(q,text,cites){
  var ts=new Date().toISOString(),h=histLoad();
  h.push({role:"user",text:q,ts:ts});
  if(text)h.push({role:"assistant",text:text,ts:ts,citations:cites||[]});
  ls(HIST_KEY,JSON.stringify(histFit(h)));return histLoad();
}
function histClear(){try{localStorage.removeItem(HIST_KEY)}catch(e){}}
function answerArgs(q){var h=histLoad();return h.length?{request:q,history:h}:{request:q}}
//#history-end
// "New conversation" sits at the end of the transcript, only once a chat exists; it is moved there after each answer
function newChatShown(){
  var b=$("newchat");
  if(!b){b=el("button","newchat","New conversation");b.id="newchat";b.type="button";b.onclick=newChat}
  var row=b.parentNode||el("p","newchat-row");if(!b.parentNode)row.appendChild(b);
  b.hidden=histLoad().length===0;row.hidden=b.hidden;$("out").appendChild(row);
}
function canHash(){return !!(window.crypto&&crypto.subtle&&window.TextEncoder)}
async function sha256Hex(text){
  var buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return Array.prototype.map.call(new Uint8Array(buf),function(b){return ("0"+b.toString(16)).slice(-2)}).join("");
}
function ratingPill(card,ctx){
  if(!canHash())return;
  card.classList.add("has-rate");
  var pill=el("div","rate");pill.setAttribute("role","group");pill.setAttribute("aria-label","Rate this answer");
  var up=el("button","rate-btn rate-up");up.type="button";up.setAttribute("aria-label","Good answer");up.setAttribute("aria-pressed","false");up.appendChild(el("span","ico ico--up"));
  var down=el("button","rate-btn rate-down");down.type="button";down.setAttribute("aria-label","Poor answer");down.setAttribute("aria-pressed","false");down.appendChild(el("span","ico ico--down"));
  var thanks=el("span","rate-thanks");thanks.setAttribute("role","status");
  var err=null;
  pill.appendChild(up);pill.appendChild(down);pill.appendChild(thanks);
  async function rate(btn,rating){
    if(btn.disabled)return;
    up.disabled=down.disabled=true;
    if(err){err.remove();err=null}
    try{
      if(!ctx.sha)ctx.sha=await sha256Hex(ctx.text||"");
      await tool("rate_answer",{request:ctx.request,rating:rating,answer_sha256:ctx.sha});
      btn.setAttribute("aria-pressed","true");pill.classList.add("rated");
      thanks.textContent="Thanks";
    }catch(e){
      e=netErr(e);up.disabled=down.disabled=false;
      err=el("div","meta rate-err",e.msg);card.insertBefore(err,pill);
    }
  }
  up.onclick=function(){rate(up,"up")};
  down.onclick=function(){rate(down,"down")};
  card.appendChild(pill);
}
// The chart is an addendum after the written answer, placed before the rating pill so the pill stays last.
function addChart(d,card){
  if(!d||d.chart===undefined||d.chart===null||!card||!window.NAChart)return;
  var f=window.NAChart.render(d.chart);
  card.insertBefore(f,card.querySelector(".rate"));
}
async function run(){
  var q=$("q").value.trim();if(!q)return;
  if(busy){busy.stage.textContent="Still working on: "+busy.q;return}
  if(offline){health();return}
  if(locked)return;
  $("q").value="";grow();var t=turn(q);
  t.stage.textContent="Reading New America\u2019s publications and writing an answer (can take up to a minute)...";
  busy={q:q,stage:t.stage};$("go").disabled=true;$("ask").querySelector(".box").classList.add("busy");document.body.classList.add("pending");
  var out=t.body,t0=Date.now(),ctr=el("span","elapsed"),tick=null;
  function paint(){
    ctr.textContent=" \u00b7 "+Math.floor((Date.now()-t0)/1000)+" s";
    if(ctr.parentNode!==t.stage)t.stage.appendChild(ctr);
  }
  paint();tick=setInterval(paint,1000);
  try{
    var r=await tool("answer",answerArgs(q),function(msg){t.stage.textContent=msg;t.stage.appendChild(ctr)});
    clearInterval(tick);ctr.remove();
    var d=r.data||{};
    t.stage.textContent=readAs(d);
    if(d.kind==="help"){renderHelp(d,r.text,out);ratingPill(out.lastChild,{request:q,text:r.text||""})}
    else if(d.kind==="funders"){renderFunders(d,out);ratingPill(out.lastChild,{request:q,text:r.text||""})}
    else if(d.kind==="who_cites"){renderWhoCites(d,out);ratingPill(out.lastChild,{request:q,text:r.text||""})}
    else if(d.kind==="citation_report"){renderCitationReport(d,out);ratingPill(out.lastChild,{request:q,text:r.text||""})}
    else if(d.kind==="throughlines"){renderThroughlines(d,out);ratingPill(out.lastChild,{request:q,text:r.text||""})}
    else if(d.kind==="people"){renderPeople(d,out);ratingPill(out.lastChild,{request:q,text:r.text||""})}
    else if(d.kind==="events"){renderEvents(d,out);ratingPill(out.lastChild,{request:q,text:r.text||""})}
    else if(d.kind==="off_topic"){var oc=el("article","card");oc.appendChild(md(String(d.answer||""),{}));out.appendChild(oc)}
    else if(d.kind&&d.kind!=="answer"&&!d.answer){var gc=el("article","card");gc.appendChild(md(r.text||"",{}));out.appendChild(gc);ratingPill(gc,{request:q,text:r.text||""})}
    else{
      renderAnswer(d,q,out);
      var card=out.lastChild;
      var sh=card.querySelector("ol.srcs");
      if(sh&&sh.previousSibling)sh.previousSibling.textContent="Sources ("+(d.citations||[]).length+")";
      moreSources(card,q);
      siteBlocks(d,card);
      ratingPill(card,{request:q,text:String(d.answer||"")});
    }
    addChart(d,out.lastChild);
    histAdd(q,d.answer?String(d.answer):String(r.text||""),d.citations);newChatShown();
    settle(t,"done");
  }catch(e){
    clearInterval(tick);ctr.remove();
    e=netErr(e);
    if(e.kind==="srv"&&/unavailable/i.test(e.msg)){
      t.stage.textContent="The written answer is unavailable ("+e.msg+"). Showing the ranked sources instead.";
      try{var c=await tool("build_corpus",{request:q,max_docs:20});renderCorpus(c.data||{groups:[]},out);settle(t,"done")}
      catch(e2){e2=netErr(e2);t.stage.textContent="";out.appendChild(el("p","meta",e2.msg));settle(t,"error")}
    }else{t.stage.textContent="";out.appendChild(el("p","meta",e.msg));settle(t,"error")}
  }
  finally{clearInterval(tick);busy=null;$("go").disabled=!!offline;$("ask").querySelector(".box").classList.remove("busy");document.body.classList.remove("pending")}
}
$("ask").onsubmit=function(ev){ev.preventDefault();run()};
function newChat(){if(busy)return;histClear();$("out").textContent="";welcome();newChatShown();$("q").focus()}
$("q").oninput=grow;
$("q").onkeydown=function(ev){if(ev.key==="Enter"&&!ev.shiftKey&&!ev.isComposing){ev.preventDefault();run()}};
(function(){var f=document.querySelector(".composer"),r=document.documentElement;function m(){r.style.setProperty("--composer-h",f.offsetHeight+"px")}m();if(window.ResizeObserver)new ResizeObserver(m).observe(f);else window.addEventListener("resize",m)})();
gate();welcome();newChatShown();
health();
})();
