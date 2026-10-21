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
  // Up to two videos that directly cover the question lead the listing (a ranking rule; their tier is unchanged).
  var lead=[];groups.forEach(function(g){(g.items||[]).forEach(function(it){if(it&&it.direct===true&&lead.length<2)lead.push(it)})});
  if(lead.length){out.appendChild(el('h2',null,'Videos that cover your question ('+lead.length+')'));lead.forEach(function(it){out.appendChild(item(it))})}
  groups.slice().sort(function(a,b){return a.tier-b.tier}).forEach(function(g){
    var items=(g.items||[]).filter(function(it){return lead.indexOf(it)<0});
    if(!items.length)return;
    out.appendChild(el('h2',null,(TIERS[g.tier]||'Other')+' ('+items.length+')'));
    items.slice().sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''))}).forEach(function(it){out.appendChild(item(it))});
  });
}
//#rows-start
function numId(v){return typeof v==='number'&&isFinite(v)&&Math.floor(v)===v&&v>0}
// "n more like this" for a positive related_count, '' otherwise (the link is then not rendered); "50+" at the cap (RELATED_CAP, src/mcp/hit.ts:93), where n is a floor not a count.
function moreLabel(n){return typeof n==='number'&&isFinite(n)&&n>=1?(n>=50?'50+':Math.floor(n))+' more like this':''}
var TAG_KEYS=['types','programs','topics','issues','projects'],TAG_MAX=6;
// Every taxonomy name on a row, known taxonomies first, then any other key; the row's own program and repeats dropped.
// Topic and issue tags link to their newamerica.org index page (the server's TERM_LANDING pattern, src/mcp/related-on-site.ts); other tags have none.
var TAG_LANDING={topics:'https://www.newamerica.org/topics/',issues:'https://www.newamerica.org/issues/'};
function tagNames(t,skip){return tagItems(t,skip).map(function(x){return x.name})}
function tagItems(t,skip){
  var seen={},out=[];t=t&&typeof t==='object'?t:{};
  Object.keys(t).sort(function(a,b){var i=TAG_KEYS.indexOf(a),j=TAG_KEYS.indexOf(b);return (i<0?99:i)-(j<0?99:j)||(a<b?-1:a>b?1:0)}).forEach(function(k){
    (Array.isArray(t[k])?t[k]:[]).forEach(function(v){var s=String(typeof v==='string'?v:(v&&(v.name||v.title))||'').trim();var slug=v&&typeof v.slug==='string'&&/^[a-z0-9-]+$/.test(v.slug)?v.slug:'';if(s&&s!==skip&&!seen[s]){seen[s]=1;out.push({name:s,href:TAG_LANDING[k]&&slug?TAG_LANDING[k]+slug+'/':''})}});
  });
  return out;
}
// Muted second line under a source title: "<Program> · <tag> · <tag> … +n"; the program links to its landing page when known.
function progRow(o){
  if(!o)return null;
  var names=tagItems(o.tags,o.program),r=el('div','prog-row'),first=true;
  if(!o.program&&!names.length)return null;
  function sep(){if(!first){var s=el('span','sep',' \u00b7 ');s.setAttribute('aria-hidden','true');r.appendChild(s)}first=false}
  if(o.program){sep();var p=link(o.program,o.programUrl);if(p.nodeType===1)p.className='prog';else{var sp=el('span','prog');sp.appendChild(p);p=sp}r.appendChild(p)}
  names.slice(0,TAG_MAX).forEach(function(n){sep();var c;if(n.href){c=el('a','tag-chip tag-link',n.name);c.href=n.href;c.target='_blank';c.rel='noopener'}else c=el('span','tag-chip',n.name);r.appendChild(c)});
  if(names.length>TAG_MAX){sep();r.appendChild(el('span','tag-more','+'+(names.length-TAG_MAX)))}
  return r;
}
// Read / Cite and, when related_count > 0, "n more like this" for a numbered document row; null for social posts, videos and rows without an id.
function actsRow(o){
  if(!o||!numId(o.id)||o.kind==='social'||o.kind==='video')return null;
  var box=el('div','acts'),rb=el('button','primary','Read'),cb=el('button',null,'Cite'),lab=moreLabel(o.related_count),mb=null;
  rb.type=cb.type='button';box.appendChild(rb);box.appendChild(cb);
  if(lab){mb=el('button','more-like');mb.type='button';var cnt=lab.slice(0,lab.indexOf(' '));mb.appendChild(el('span','count',cnt));mb.appendChild(document.createTextNode(lab.slice(cnt.length)));box.appendChild(mb)}
  return {box:box,rb:rb,cb:cb,mb:mb};
}
var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// "Oct 7, 2026" for an ISO date (or date-time); '' when it is not one.
function dateLabel(d){var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(d||''));return m&&+m[2]>=1&&+m[2]<=12?MONTHS[+m[2]-1]+' '+(+m[3])+', '+m[1]:''}
// The people on a source as {name,url,photo}: structured authors first, then plain names, then a social post's single author. Videos carry the channel name only, so they get none.
function srcPeople(o){
  if(!o||o.kind==='video')return [];
  var raw=Array.isArray(o.authorDetails)&&o.authorDetails.length?o.authorDetails:Array.isArray(o.authors)&&o.authors.length?o.authors:(typeof o.author==='string'&&o.author.trim()?[o.author.trim()]:[]);
  return raw.map(function(p){return typeof p==='string'?{name:p}:p}).filter(function(p){return p&&typeof p.name==='string'&&p.name.trim()});
}
function initials(n){var w=String(n).replace(/[^\p{L}\p{N}\s'-]/gu,' ').split(/\s+/).filter(Boolean);return ((w[0]||'').charAt(0)+(w.length>1?w[w.length-1].charAt(0):'')).toUpperCase()}
// Overlapping round headshots (photo, else initials) then the names: "A & B", "A, B, C & 1 more". Names link when the author has a page.
var BY_MAX=3;
function bylineRow(people){
  if(!people.length)return null;
  var row=el('div','byline'),av=el('span','avatars'),nm=el('div','names'),shown=people.slice(0,BY_MAX),more=people.length-shown.length;
  av.setAttribute('aria-hidden','true');
  shown.forEach(function(p){
    var pu=safeUrl(p.photo),a;
    if(pu){a=el('img','avatar');a.src=pu;a.alt='';a.loading='lazy';a.referrerPolicy='no-referrer';a.onerror=function(){a.removeAttribute('src');a.className='avatar ini'}}
    else a=el('span','avatar ini',initials(p.name));
    av.appendChild(a);
  });
  if(more>0)av.appendChild(el('span','avatar rest','+'+more));
  shown.forEach(function(p,i){
    if(i>0)nm.appendChild(document.createTextNode(i===shown.length-1&&more<1?' & ':', '));
    var l=link(p.name,p.url);if(l.nodeType===1&&p.url)l.className='nm';nm.appendChild(l);
  });
  if(more>0)nm.appendChild(document.createTextNode(' & '+more+' more'));
  row.appendChild(av);row.appendChild(nm);return row;
}
// Topic and issue chips as soft pills: linked ones go to their newamerica.org page; at most TAG_MAX, then "+n".
function chipList(o){
  // the content type already shows as the card's format tag, so it is not repeated as a chip
  var names=tagItems(o&&o.tags,o&&o.program).filter(function(n){return n.name!==(o&&o.label)});if(!names.length)return null;
  var ul=el('ul','topics');
  names.slice(0,TAG_MAX).forEach(function(n){var li=el('li'),c;if(n.href){c=el('a','tag-chip tag-link',n.name);c.href=n.href;c.target='_blank';c.rel='noopener'}else c=el('span','tag-chip',n.name);li.appendChild(c);ul.appendChild(li)});
  if(names.length>TAG_MAX){var m=el('li');m.appendChild(el('span','tag-more','+'+(names.length-TAG_MAX)));ul.appendChild(m)}
  return ul;
}
// Embedded player (issue #148): a video card or an event recording gets a Play button that swaps itself for the iframe on click; nothing is embedded on render.
// The id and start come from the server (Zod, src/mcp/player.ts) and are shape-checked again here before any url is built.
var VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
// {id,start} or null: a hit carries youtubeId (videoId is its numeric citation key), a citation or recording carries videoId as the 11-character id; start is a whole number of seconds, 0 or more, and absent means 0.
function videoRef(o){
  if(!o||typeof o!=='object')return null;
  var id=typeof o.youtubeId==='string'?o.youtubeId:(typeof o.videoId==='string'?o.videoId:'');
  if(!VIDEO_ID.test(id))return null;
  var s=o.start==null?0:o.start;
  if(typeof s!=='number'||!isFinite(s)||Math.floor(s)!==s||s<0)return null;
  return {id:id,start:s};
}
function embedSrc(ref){return 'https://www.youtube-nocookie.com/embed/'+ref.id+'?start='+ref.start+'&autoplay=1&rel=0'}
function watchHref(ref){return 'https://www.youtube.com/watch?v='+ref.id+(ref.start>0?'&t='+ref.start+'s':'')}
function clockLabel(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60;return (h?h+':'+(m<10?'0':''):'')+m+':'+(r<10?'0':'')+r}
// The Play button (its text "Play from m:ss", or "Play" with no start) and the plain "Watch on YouTube" link; the button replaces itself with the iframe.
function playBox(ref,title){
  var box=el('div','player'),slot=el('div','player-slot'),label=ref.start>0?'Play from '+clockLabel(ref.start):'Play',btn=el('button','play-btn',label);
  btn.type='button';
  btn.setAttribute('aria-label',label+': '+title);
  btn.onclick=function(){
    var f=el('iframe','player-frame');
    f.setAttribute('src',embedSrc(ref));f.setAttribute('title',title+' (recording)');f.setAttribute('allow','autoplay; encrypted-media; picture-in-picture');
    f.setAttribute('allowfullscreen','');f.setAttribute('loading','lazy');
    slot.textContent='';slot.appendChild(f);
  };
  slot.appendChild(btn);box.appendChild(slot);
  var w=el('a','yt-link','Watch on YouTube');w.href=watchHref(ref);w.target='_blank';w.rel='noopener noreferrer';box.appendChild(w);
  return box;
}
// One source as a card: meta row (index, program, format, date), title, summary and excerpt, chips, byline and actions.
// Returns {root,card,acts,slot}: root holds the card and, under it, slot for Read/Cite output; the caller wires acts with wireActs. n is the citation number (null for an unnumbered row); tag is the root element (li in a list).
function srcItem(o,n,tag){
  var root=el(tag||'div','src-item'),card=el('article','src-card'),social=o.kind==='social',video=o.kind==='video';
  if(n!=null){root.id='src-'+n;root.value=n}
  var meta=el('div','src-meta');
  if(n!=null){var ix=el('span','idx',String(n));ix.setAttribute('aria-label','Source '+n);meta.appendChild(ix)}
  if(o.program&&!social&&!video){var p=link(o.program,o.programUrl);if(p.nodeType===1)p.className='program';else{var ps=el('span','program');ps.appendChild(p);p=ps}meta.appendChild(p)}
  var fmt=social?'Social post':video?(o.label||'Video'):(o.label||'');
  if(fmt)meta.appendChild(el('span','format',fmt));
  if(video&&o.popular===true)meta.appendChild(el('span','tag-pop','Popular'));
  var pu=safeUrl(o.pdfUrl);
  if(pu){var pa=el('a','pdf-pill','PDF');pa.href=pu;pa.target='_blank';pa.rel='noopener';pa.setAttribute('aria-label','Open PDF of '+(o.title||'this source')+' (new tab)');meta.appendChild(pa)}
  if(o.chapters>0)meta.appendChild(el('span','chap-note',o.chapters+(o.chapters===1?' chapter':' chapters')));
  if(typeof o.similarity==='number')meta.appendChild(el('span','sim',Math.round(o.similarity*100)+'% similar'));
  var dl=dateLabel(o.date),tm=el('time','date',dl||'Undated');if(dl)tm.setAttribute('datetime',String(o.date).slice(0,10));meta.appendChild(tm);
  card.appendChild(meta);
  var h=el('h3','src-title');h.appendChild(link(o.title||'(untitled)',o.url));
  if(o.external)h.appendChild(el('span','badge','(coverage)'));
  card.appendChild(h);
  if(o.why&&typeof o.why==='string'&&o.why.trim())card.appendChild(el('p','summary',o.why.trim()));
  var dek=typeof o.blurb==='string'&&o.blurb.trim()?o.blurb.trim():(typeof o.abstract==='string'&&o.abstract.trim()?o.abstract.trim():'');
  if(dek)card.appendChild(el('p','dek',dek));
  if(o.funders&&o.funders.length){var fr=el('div','fund-row');fr.appendChild(el('span','fund-lab','Funded by'));o.funders.forEach(function(f){fr.appendChild(el('span','tl-chip',f))});card.appendChild(fr)}
  var ref=video?videoRef(o):null;if(ref)card.appendChild(playBox(ref,o.title||'this video'));
  var chips=chipList(o);if(chips)card.appendChild(chips);
  var by=bylineRow(srcPeople(o)),acts=actsRow(o);
  if(by||acts){var foot=el('div','src-foot');if(by)foot.appendChild(by);if(acts)foot.appendChild(acts.box);card.appendChild(foot)}
  root.appendChild(card);
  var slot=el('div','src-slot');if(acts)root.appendChild(slot);
  return {root:root,card:card,acts:acts,slot:slot};
}
// "Sources" label with the count and a rule under it.
function srcsHead(n){var hd=el('header','sources-head');hd.appendChild(el('h4',null,'Sources'));hd.appendChild(el('span','count',String(n)));return hd}
//#rows-end
function item(it){
  var r=srcItem(it,null,'div');
  if(r.acts)wireActs(it,r.acts,r.slot);
  return r.root;
}
var REDUCED=function(){return matchMedia("(prefers-reduced-motion: reduce)").matches};
// Read, Cite and "n more like this" on one source row; slot holds the Read/Cite output under the row.
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
  var anchor=btn.closest(".card")||btn.closest(".src-item")||btn.closest(".item")||btn.parentNode;
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
  items.forEach(function(it){var r=srcItem(it,null,"li");if(r.acts)wireActs(it,r.acts,r.slot);list.appendChild(r.root)});
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
  w.appendChild(el("p","meta","Ask about New America and its work using plain words in this time-limited demo running through "+(untilLabel(openUntil)||"Oct 31, 2026")+"."));
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
    card.appendChild(srcsHead(d.citations.length));
    var ol=el("ol","srcs");
    d.citations.forEach(function(c){var r=srcItem(c,c.n,"li");if(r.acts)wireActs(c,r.acts,r.slot);ol.appendChild(r.root)});card.appendChild(ol);
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
    var rec=e.recording&&typeof e.recording==='object'?e.recording:null,rr=rec?videoRef({videoId:rec.videoId,start:rec.start}):null;
    if(rr)li.appendChild(playBox(rr,String(rec.title||e.title||'this event')));
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
