// Source cards (issue #88, D8): one source as a card (srcItem), the rows it sits in, Read / Cite / "more like this", the explore card and the ranked-sources listing.
// A classic script: it attaches to window.NACards (see cards-base.js, loaded first). tool and netErr come from the page through NACards.host.
(function(){
'use strict';
var C=window.NACards,el=C.el,safeUrl=C.safeUrl,link=C.link,TIERS=C.TIERS,REDUCED=C.REDUCED;
var tool=function(){return C.host.tool.apply(null,arguments)};
var netErr=function(e){return C.host.netErr(e)};

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
  if(o.program&&o.programStatus&&typeof o.programStatus==='object'&&o.programStatus.former===true){sep();r.appendChild(el('span','prog-status','Former program'))}
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
  joinNames(nm,shown,more,function(p){var l=link(p.name,p.url);if(l.nodeType===1&&p.url)l.className='nm';return l});
  row.appendChild(av);row.appendChild(nm);return row;
}
// The one joiner for names ("A & B", "A, B, C & 1 more"): bylineRow and speakerLines share it. mk(p) returns the node for one name.
function joinNames(nm,shown,more,mk){
  shown.forEach(function(p,i){
    if(i>0)nm.appendChild(document.createTextNode(i===shown.length-1&&more<1?' & ':', '));
    nm.appendChild(mk(p));
  });
  if(more>0)nm.appendChild(document.createTextNode(' & '+more+' more'));
}
// One console.warn per kind of malformed field per page load (the field is skipped, the rest of the item still draws).
var WARNED={};
function warnOnce(kind){if(WARNED[kind])return;WARNED[kind]=1;try{console.warn('console: skipped a malformed '+kind)}catch(e){}}
// Consumer gate for speakers (issue #166): not an array, or an entry with no name, drops the entry; a link that is not http(s) drops only the link. Role is the stored heading, "Speakers" when blank.
function cleanSpeakers(raw){
  if(raw==null)return [];
  if(!Array.isArray(raw)){warnOnce('speakers');return []}
  var out=[];
  raw.forEach(function(s){
    if(!s||typeof s!=='object'||typeof s.name!=='string'||!s.name.trim()||(s.role!=null&&typeof s.role!=='string')||(s.title!=null&&typeof s.title!=='string')){warnOnce('speakers entry');return}
    var c={name:s.name.trim(),title:typeof s.title==='string'?s.title.trim():'',role:typeof s.role==='string'&&s.role.trim()?s.role.trim():'Speakers',url:null};
    if(s.url!=null){c.url=typeof s.url==='string'?safeUrl(s.url):null;if(!c.url)warnOnce('speaker link')}
    if(s.photo!=null&&!(typeof s.photo==='string'&&safeUrl(s.photo)))warnOnce('speaker photo');
    out.push(c);
  });
  return out;
}
// Role-grouped lines under an event or recording: "Moderator: A. Name", "Speakers: B, C & 2 more". A New America person links to their page; an outside speaker is name and title only. null when there are none.
function speakerLines(raw){
  var list=cleanSpeakers(raw);if(!list.length)return null;
  var box=el('div','speakers'),groups=[];
  list.forEach(function(s){
    var g=groups.filter(function(x){return x.role===s.role})[0];
    if(!g){g={role:s.role,people:[]};groups.push(g)}
    g.people.push(s);
  });
  groups.forEach(function(g){
    var row=el('div','sp-row'),nm=el('span','sp-names');
    row.appendChild(el('span','sp-role',g.role+': '));
    joinNames(nm,g.people.slice(0,BY_MAX),Math.max(0,g.people.length-BY_MAX),function(p){
      var w=el('span','sp'),l=link(p.name,p.url);if(l.nodeType===1)l.className='nm';w.appendChild(l);
      if(p.title)w.appendChild(el('span','sp-title',' ('+p.title+')'));
      return w;
    });
    row.appendChild(nm);box.appendChild(row);
  });
  return box;
}
// The source's image (issue #166): http(s) url and whole positive width and height, else it is skipped. The stored alt stays (empty means decorative); a failed load hides the box and leaves the text.
function imageBlock(o){
  var im=o&&o.image;if(im==null)return null;
  function dim(n){return typeof n==='number'&&isFinite(n)&&Math.floor(n)===n&&n>0}
  var u=typeof im==='object'&&typeof im.url==='string'?safeUrl(im.url):null;
  if(!u||!dim(im.width)||!dim(im.height)||(im.alt!=null&&typeof im.alt!=='string')){warnOnce('image');return null}
  var box=el('div','src-img'),a=el('img');
  a.setAttribute('src',u);a.setAttribute('alt',im.alt||'');a.setAttribute('width',String(im.width));a.setAttribute('height',String(im.height));
  a.setAttribute('loading','lazy');a.setAttribute('referrerpolicy','no-referrer');
  a.referrerPolicy='no-referrer';
  a.onerror=function(){box.className='src-img gone';box.setAttribute('hidden','')};
  box.appendChild(a);return box;
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
  if(o.downloads!=null&&!Array.isArray(o.downloads))warnOnce('downloads');
  if(Array.isArray(o.downloads))o.downloads.forEach(function(d){var du=d&&typeof d==='object'&&typeof d.url==='string'?safeUrl(d.url):null;if(!du||typeof d.title!=='string'||!d.title.trim()){warnOnce('download');return}if(du===pu)return;var da=el('a','pdf-pill',typeof d.kind==='string'&&d.kind.trim()?d.kind.trim():'File');da.href=du;da.target='_blank';da.rel='noopener';da.setAttribute('aria-label','Open '+d.title.trim()+' (new tab)');meta.appendChild(da)});
  if(o.charts!=null&&!Array.isArray(o.charts))warnOnce('charts');
  if(Array.isArray(o.charts))o.charts.forEach(function(c){var cu=c&&typeof c==='object'&&typeof c.url==='string'?safeUrl(c.url):null;if(!cu||typeof c.title!=='string'||!c.title.trim()){warnOnce('chart');return}var ca=el('a','pdf-pill','Chart');ca.href=cu;ca.target='_blank';ca.rel='noopener';ca.setAttribute('aria-label','Open chart '+c.title.trim()+' (new tab)');meta.appendChild(ca)});
  if(o.chapters>0)meta.appendChild(el('span','chap-note',o.chapters+(o.chapters===1?' chapter':' chapters')));
  if(typeof o.similarity==='number')meta.appendChild(el('span','sim',Math.round(o.similarity*100)+'% similar'));
  var dl=dateLabel(o.date),tm=el('time','date',dl||'Undated');if(dl)tm.setAttribute('datetime',String(o.date).slice(0,10));meta.appendChild(tm);
  card.appendChild(meta);
  var img=imageBlock(o);if(img)card.appendChild(img);
  var h=el('h3','src-title');h.appendChild(link(o.title||'(untitled)',o.url));
  if(o.external)h.appendChild(el('span','badge','(coverage)'));
  card.appendChild(h);
  if(o.why&&typeof o.why==='string'&&o.why.trim())card.appendChild(el('p','summary',o.why.trim()));
  var dek=typeof o.blurb==='string'&&o.blurb.trim()?o.blurb.trim():(typeof o.abstract==='string'&&o.abstract.trim()?o.abstract.trim():'');
  if(dek)card.appendChild(el('p','dek',dek));
  if(o.funders&&o.funders.length){var fr=el('div','fund-row');fr.appendChild(el('span','fund-lab','Funded by'));o.funders.forEach(function(f){fr.appendChild(el('span','tl-chip',f))});card.appendChild(fr)}
  var ref=video?videoRef(o):null;if(ref)card.appendChild(playBox(ref,o.title||'this video'));
  var sps=speakerLines(o.speakers);if(sps)card.appendChild(sps);
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
Object.assign(C,{renderCorpus:renderCorpus,warnOnce:warnOnce,srcItem:srcItem,srcsHead:srcsHead,speakerLines:speakerLines,videoRef:videoRef,playBox:playBox,item:item,wireActs:wireActs,renderExplore:renderExplore,moreSources:moreSources});
})();
