(function(){
'use strict';
var $=function(id){return document.getElementById(id)};
var TIERS={1:'Authoritative',2:'Analysis',3:'Supporting',4:'Peripheral'};
var PROTO='2025-06-18';
var sess=null,rid=1,busy=null,connKey='';
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k)||'';localStorage.setItem(k,v)}catch(e){return ''}}
// A shareable link may carry the token (and server) in the URL: prefer the fragment (#token=...), which the
// browser never sends to GitHub Pages or any log; ?token= is accepted too. Both are stored and then removed
// from the address bar, so a copied URL afterwards does not leak the token.
(function fromUrl(){
  var p=new URLSearchParams((location.hash||'').replace(/^#/,''));
  var q=new URLSearchParams(location.search);
  var tok=p.get('token')||q.get('token'), srv=p.get('server')||q.get('server');
  if(tok)ls('na.token',tok.trim());
  if(srv)ls('na.server',srv.trim());
  if(tok||srv){try{history.replaceState(null,'',location.pathname)}catch(e){}}
})();
$('server').value=ls('na.server')||'https://macstudio.tarpan-woodpecker.ts.net/newamerica';$('token').value=ls('na.token');
if(!$('server').value)$('settings').open=true;
function save(){ls('na.server',$('server').value.trim());ls('na.token',$('token').value.trim())}
$('server').onchange=$('token').onchange=function(){save();sess=null};
function base(){return $('server').value.trim().replace(/\/+$/,'')}
function setStatus(t,cls){var s=$('status');s.className=cls||'';s.textContent=t||''}
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
  if(r.status===401||r.status===403)throw {kind:'auth',msg:'The server rejected the token (HTTP '+r.status+'). Check the token in Settings.'};
  return r;
}
function hdrs(){
  var h={'Authorization':'Bearer '+$('token').value.trim(),'Content-Type':'application/json','Accept':'application/json, text/event-stream','mcp-protocol-version':PROTO};
  if(sess)h['mcp-session-id']=sess;return h;
}
async function rpc(body,isNote){
  var r=await http('/mcp',{method:'POST',headers:hdrs(),body:JSON.stringify(body)});
  if(isNote){if(!r.ok&&r.status!==202)throw {kind:'srv',msg:'Server error '+r.status+' on notification.'};return null}
  if(r.status===404&&sess){sess=null;throw {kind:'srv',msg:'Session expired; try again.'}}
  if(!r.ok)throw {kind:'srv',msg:'Server error '+r.status+' '+(await r.text()).slice(0,200)};
  var sid=r.headers.get('mcp-session-id');if(sid)sess=sid;
  var t=await r.text(),j;
  try{j=JSON.parse(t)}catch(e){
    var m=t.match(/^data:\s*(\{.*\})\s*$/m);
    if(!m)throw {kind:'srv',msg:'Unreadable server reply.'};j=JSON.parse(m[1]);
  }
  if(j.error)throw {kind:'srv',msg:'Server: '+(j.error.message||JSON.stringify(j.error))};
  return j.result;
}
async function init(){
  var key=base()+'|'+$('token').value;
  if(sess&&key===connKey)return;
  sess=null;connKey=key;
  try{
    await rpc({jsonrpc:'2.0',id:rid++,method:'initialize',params:{protocolVersion:PROTO,capabilities:{},clientInfo:{name:'newamerica-console',version:'0.1'}}});
    await rpc({jsonrpc:'2.0',method:'notifications/initialized'},true);
  }catch(e){sess=null;connKey='';throw e}
}
async function tool(name,args){
  await init();
  var res=await rpc({jsonrpc:'2.0',id:rid++,method:'tools/call',params:{name:name,arguments:args}});
  var txt=res&&res.content&&res.content[0]&&res.content[0].text||'';
  if(res&&res.isError)throw {kind:'srv',msg:txt||'Tool error.'};
  return {data:res&&res.structuredContent,text:txt};
}

$('test').onclick=async function(){
  save();var o=$('testout');o.textContent='Testing...';
  try{
    var r=await http('/healthz');var h=await r.json();
    var s='healthz OK: '+h.documents+' documents, '+h.tier1+' tier-1, cursor '+(h.cursor_age_hours!=null?Number(h.cursor_age_hours).toFixed(1)+'h':'?')+' old'+(h.watch_running?', watcher running':', watcher stopped');
    sess=null;connKey='';await init();o.textContent=s+'; MCP session OK.';
  }catch(e){e=netErr(e);o.textContent=e.msg}
};

function freshness(){
  http('/healthz').then(function(r){return r.json()}).then(function(h){
    if(h&&h.cursor_age_hours>48)setStatus('Index is '+Math.round(h.cursor_age_hours)+' hours behind newamerica.org; newer items may be missing.','busy');
  }).catch(function(){});
}

function renderCorpus(c,out){
  var groups=(c&&c.groups)||[];
  if(c&&c.window&&c.window.oldest){out.appendChild(el('p','meta','Covers '+c.window.oldest+' to '+c.window.newest+'.'))}
  if(!groups.length){out.appendChild(el('p',null,'No documents matched. Try different wording.'));return}
  groups.slice().sort(function(a,b){return a.tier-b.tier}).forEach(function(g){
    if(!g.items||!g.items.length)return;
    out.appendChild(el('h2',null,'Tier '+g.tier+' '+(TIERS[g.tier]||'')+' ('+g.items.length+')'));
    g.items.slice().sort(function(a,b){return String(b.date||'').localeCompare(String(a.date||''))}).forEach(function(it){out.appendChild(item(it))});
  });
}
function item(it){
  var d=el('article','item');
  d.appendChild(el('div','meta',(it.date?String(it.date).slice(0,10):'undated')+(it.label?' · '+it.label:'')+(it.program?' · '+it.program:'')));
  var h=el('h3');h.appendChild(link(it.title||'(untitled)',it.url));
  if(it.external)h.appendChild(el('span','badge','(coverage)'));
  d.appendChild(h);
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
  var t=it.tags||{},tg=el('div','tags');
  ['types','programs','topics','issues','projects'].forEach(function(k){(t[k]||[]).forEach(function(v){tg.appendChild(el('span',null,typeof v==='string'?v:(v.name||v.title||'')))})});
  if(tg.childNodes.length)d.appendChild(tg);
  if(it.abstract)d.appendChild(el('p','abs',it.abstract));
  var acts=el('div','acts'),rb=el('button',null,'Read'),cb=el('button',null,'Cite');
  rb.type=cb.type='button';acts.appendChild(rb);acts.appendChild(cb);d.appendChild(acts);
  var slot=el('div');d.appendChild(slot);
  rb.onclick=async function(){
    if(slot.firstChild&&slot.firstChild.className==='doc'){slot.textContent='';return}
    rb.disabled=true;
    try{
      var r=await tool('get_document',{id:it.id,include:['abstract','sections'],max_chars:6000});
      var pre=el('pre','doc',r.text||JSON.stringify(r.data,null,1));
      slot.textContent='';slot.appendChild(pre);
    }catch(e){e=netErr(e);setStatus(e.msg,'err')}
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
    }catch(e){e=netErr(e);setStatus(e.msg,'err')}
    cb.disabled=false;
  };
  return d;
}

var answerOff=false;
function interp(d){return d&&d.interpreted&&d.interpreted.length?" · Interpreted as: "+d.interpreted.join("; "):""}
function turn(q){
  var t=el("section","turn"),b=el("div","q",q),body=el("div","res");
  t.appendChild(b);t.appendChild(body);$("out").appendChild(t);
  t.scrollIntoView({block:"start",behavior:"smooth"});return body;
}
// Minimal markdown: paragraphs, bullets, **bold**; [n] becomes a superscript link to Sources entry n. All text is escaped via textContent.
function inline(parent,s,cites){
  var re=/(\*\*[^*]+\*\*|\[\d+\])/g,parts=s.split(re);
  parts.forEach(function(p){
    if(!p)return;
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
  var body=String(d.answer||"").replace(/\n+#{0,6}\s*\**Sources\**:?\s*\n[\s\S]*$/i,"");
  var card=el("article","card");
  card.appendChild(md(body,cites));
  if(d.citations&&d.citations.length){
    card.appendChild(el("h4",null,"Sources"));
    var ol=el("ol","srcs");
    d.citations.forEach(function(c){
      var li=el("li");li.id="src-"+c.n;li.value=c.n;
      var h=el("div","st");h.appendChild(link(c.title||"(untitled)",c.url));li.appendChild(h);
      li.appendChild(el("div","meta",[c.label,c.date?String(c.date).slice(0,10):""].filter(Boolean).join(" · ")));
      var au=(c.authorDetails||[]);
      if(au.length){var a=el("div","authors");au.forEach(function(p){var s=el("span","au");if(safeUrl(p.photo)){var im=el("img");im.src=p.photo;im.alt="";im.loading="lazy";im.referrerPolicy="no-referrer";s.appendChild(im)}s.appendChild(link(p.name,p.url));a.appendChild(s)});li.appendChild(a)}
      else if(c.authors&&c.authors.length)li.appendChild(el("div","meta","By "+c.authors.join(", ")));
      ol.appendChild(li);
    });card.appendChild(ol);
  }
  var u=d.usage||{};
  card.appendChild(el("div","meta fine",(d.model||"model")+" · "+(u.input_tokens||0)+" in / "+(u.output_tokens||0)+" out tokens"));
  out.appendChild(card);
}
async function run(kind){
  var q=$("q").value.trim();if(!q)return;
  if(busy){setStatus("Still working on: "+busy,"busy");return}
  save();
  if(!base()){$("settings").open=true;setStatus("Enter the server URL and token in Settings first.","err");return}
  busy=q;$("q").value="";var out=turn(q);
  $("go").disabled=$("answer").disabled=true;
  try{
    if(kind==="answer"){
      setStatus("Reading the corpus and writing an answer (can take up to a minute)...","busy");
      var r=await tool("answer",{request:q});
      renderAnswer(r.data||{},q,out);
      setStatus("Answered"+interp(r.data));
    }else{
      setStatus("Resolving terms...","busy");
      var t=await tool("resolve_terms",{request:q});
      var terms=Array.isArray(t.data)?t.data:(t.data&&(t.data.terms||t.data.result))||[];
      var names=terms.map(function(x){return x.name}).filter(Boolean);
      var tl="Terms: "+(names.length?names.join(" · "):"(none matched)");
      setStatus(tl+" · building corpus...","busy");
      var c=await tool("build_corpus",{request:q,max_docs:20});
      renderCorpus(c.data||{groups:[]},out);
      var n=((c.data&&c.data.groups)||[]).reduce(function(s,g){return s+(g.items||[]).length},0);
      setStatus(tl+" · "+n+" documents"+interp(c.data));
    }
  }catch(e){
    e=netErr(e);
    if(kind==="answer"&&/unavailable/i.test(e.msg)){answerOff=true;$("answer").hidden=true;out.appendChild(el("p","meta",e.msg))}
    setStatus(e.msg,"err");
  }
  finally{busy=null;$("go").disabled=$("answer").disabled=false}
}
$("ask").onsubmit=function(ev){ev.preventDefault();run("ask")};
$("answer").onclick=function(){run("answer")};
$("q").onkeydown=function(ev){if(ev.key==="Enter"&&(ev.metaKey||ev.ctrlKey)){ev.preventDefault();run("ask")}};
if(base()&&$('token').value)freshness();
})();
