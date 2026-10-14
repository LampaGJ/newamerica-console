(function(){
'use strict';
var $=function(id){return document.getElementById(id)};
var TIERS={1:'Authoritative',2:'Analysis',3:'Supporting',4:'Peripheral'};
var PROTO='2025-06-18';
var sess=null,rid=1,busy=null,connKey='';
function ls(k,v){try{if(v===undefined)return localStorage.getItem(k)||'';localStorage.setItem(k,v)}catch(e){return ''}}
$('server').value=ls('na.server');$('token').value=ls('na.token');
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

function renderCorpus(c){
  var out=$('out');out.textContent='';
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
  d.appendChild(el('div','meta',(it.date||'undated')+(it.label?' · '+it.label:'')+(it.program?' · '+it.program:'')));
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

$('ask').onsubmit=async function(ev){
  ev.preventDefault();
  var q=$('q').value.trim();if(!q)return;
  if(busy){setStatus('Still working on: '+busy,'busy');return}
  save();
  if(!base()){$('settings').open=true;setStatus('Enter the server URL and token in Settings first.','err');return}
  busy=q;$('out').textContent='';
  setStatus('Resolving terms...','busy');
  try{
    var t=await tool('resolve_terms',{request:q});
    var terms=Array.isArray(t.data)?t.data:(t.data&&(t.data.terms||t.data.result))||[];
    var names=terms.map(function(x){return x.name}).filter(Boolean);
    var tl='Terms: '+(names.length?names.join(' · '):'(none matched)');
    setStatus(tl+' · building corpus...','busy');
    var c=await tool('build_corpus',{request:q,max_docs:20});
    renderCorpus(c.data||{groups:[]});
    var n=((c.data&&c.data.groups)||[]).reduce(function(s,g){return s+(g.items||[]).length},0);
    setStatus(tl+' · '+n+' documents');
  }catch(e){e=netErr(e);setStatus(e.msg,'err')}
  finally{busy=null}
};
if(base()&&$('token').value)freshness();
})();
