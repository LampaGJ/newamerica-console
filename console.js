(function(){
'use strict';
var $=function(id){return document.getElementById(id)};
// The card renderers live in cards-*.js (issue #88, D8) and share window.NACards; this file is the page: the ask form, the server calls, sign-in, history and scrolling.
var C=window.NACards,el=C.el,md=C.md,chips=C.chips,renderCorpus=C.renderCorpus,REDUCED=C.REDUCED;
var PROTO='2025-06-18';
var sess=null,rid=1,busy=null,connKey='';
// GitHub sign-in (issue #100): who is the signed-in login (null when nobody), and needSignIn once the server has answered 401 to a request that carried no token.
var who=null,needSignIn=false;
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
  // A shared chart link keeps its #plan= key: only token and server are removed from the fragment (issue #216).
  p.delete('token');p.delete('server');
  var rest=p.toString();
  if(tok||srv){try{history.replaceState(null,'',location.pathname+(rest?'#'+rest:''))}catch(e){}}
})();
var DEFAULT_SERVER='https://macstudio.tarpan-woodpecker.ts.net/newamerica';
// The token lives only in localStorage (set by #token=); the page ships with none and has no UI for it.
function token(){return ls("na.token")||null}
function base(){return (ls('na.server')||DEFAULT_SERVER).trim().replace(/\/+$/,'')}

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
    if(!had&&r.status===401){needSignIn=true;who=null;sess=null;connKey='';signUi()}
    throw {kind:'auth',msg:had?'The saved maintainer token was rejected and removed. Ask again.':(r.status===401?'Please sign in with GitHub to ask questions.':'The server did not accept this request (HTTP '+r.status+').')};
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
    return me().then(function(){gate();setOffline(false)});
  }).catch(function(e){d.className='dot off';d.title='Offline: cannot reach '+base();setOffline(true,e&&e.message&&/HTTP/.test(e.message)?e.message:'')})
  .finally(function(){clearTimeout(healthTimer);healthTimer=setTimeout(health,30000)});
}
//#fmt-start
// "Nov 14, 2026" from the date part of the healthz value (its own offset, so the day never shifts).
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
  locked=!open&&!token()&&!who&&openUntil!==undefined;
  var pv=$('preview'),d=untilLabel(openUntil)||'Nov 14, 2026';
  // while open, the welcome subhead carries the demo dates; the note above the input only says when it has ended
  pv.hidden=!locked;
  if(locked)pv.textContent='This time-limited demonstration ended on '+d+'.';
  var st=$('stats'),line=statsLine(counts);st.hidden=!line;st.textContent=line;
  var q=$('q'),g=$('go');q.disabled=locked||!!offline;g.disabled=locked||!!offline||!!busy;
  $('ask').querySelector('.box').classList.toggle('off',locked||!!offline);
  signUi();
}
// Who is signed in: the server reads the session cookie (same site as the page; from another site the answer is no one). Never rejects.
function me(){
  return fetch(base()+'/auth/me').then(function(r){return r.ok?r.json():null}).then(function(j){who=j&&j.signedIn===true&&typeof j.login==='string'?j.login:null;if(who)needSignIn=false}).catch(function(){who=null});
}
// One "Sign in with GitHub" button when nobody is signed in, no token is stored, and the window is closed or the server said 401; "Signed in as" and a sign-out button after.
function signUi(){
  var s=$('signin'),w=$('whoami');if(!s||!w)return;
  var show=!who&&!token()&&(locked||needSignIn);
  s.hidden=!show;if(show)$('signin-btn').href=base()+'/auth/login';
  w.hidden=!who;if(who)$('who-name').textContent='Signed in as '+who+'.';
}


// The quiet tag above an answer (docs/voice.md): "Themes" on a themes answer, else nothing. The "Answering as a question about <topic>" tag is gone (#116): the topic was the server's stripped residue and read as garbage.
function readAs(d){
  if(!d||d.kind==="help")return "";
  return d.kind==="throughlines"?"Themes":"";
}
// Where to scroll so a new answer starts at its first line. Pure: numbers in, "top" | "nearest" | "none" out.
// height = the block to show (card, or question plus card); vh = visible viewport height (above the sticky composer); scrolled = the reader scrolled this turn.
// A block taller than the view starts at the top of the view; one that fits is kept in view with nearest; a reader who moved away is left alone.
function revealPlan(height,vh,scrolled){
  if(scrolled)return "none";
  return height>vh?"top":"nearest";
}
var userScrolled=false;
(function(){
  function mark(){userScrolled=true}
  addEventListener("wheel",mark,{passive:true});addEventListener("touchmove",mark,{passive:true});
  addEventListener("keydown",function(e){
    var t=e.target&&e.target.tagName;if(t==="TEXTAREA"||t==="INPUT")return;
    if(/^(PageUp|PageDown|Home|End|ArrowUp|ArrowDown| )$/.test(e.key))mark();
  });
})();
// Thin DOM glue: bring card (and, with first, the question above it) into view without ever jumping to the end of a tall answer.
function reveal(card,first){
  var from=first||card,r0=from.getBoundingClientRect(),r1=card.getBoundingClientRect();
  var comp=document.querySelector(".composer"),vh=innerHeight-(comp?comp.getBoundingClientRect().height:0);
  var plan=revealPlan(r1.bottom-r0.top,vh,userScrolled);
  if(plan==="none")return;
  (plan==="top"?from:card).scrollIntoView({block:plan==="top"?"start":"nearest",behavior:REDUCED()?"auto":"smooth"});
}
function settle(t,state){
  var sh=t.body.parentNode,fin=false;
  function go(){if(fin)return;fin=true;sh.classList.remove("anim");reveal(t.card)}
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
  userScrolled=false;reveal(a,u);
  return {card:a,stage:stage,body:body};
}
// The cards call the server and fill the question box through the page.
C.host.tool=tool;C.host.netErr=netErr;C.host.fill=fill;
function fill(text){var q=$("q");q.value=text;grow();q.focus()}
//#starters-start
// t: "r" research question (g = issue area; k = "g" general, a newcomer could ask it without knowing New America's catalogue, or "s" specific, it names a report, person, survey, index or program) or "i" institution question (g = category). live:false holds a question out of the rotation until its fix lands (none held now: funding went live with #117 and #119).
var STARTERS=[
{t:"r",k:"s",g:"thriving-families",q:"How did Vermont expand child care to most of its families, and could other states copy it?"},
{t:"r",k:"s",g:"thriving-families",q:"What do parents of young children say they need most, in New America's National Parent Survey?"},
{t:"r",k:"g",g:"thriving-families",q:"What does New America recommend for running a cash assistance program well?"},
{t:"r",k:"g",g:"thriving-families",q:"What does New America say about child care costs?"},
{t:"r",k:"g",g:"thriving-families",q:"How could paid family leave work in the United States?"},
{t:"r",k:"s",g:"technology-democracy",q:"What did New America say about Apple's privacy changes, and why did it call them concerning?"},
{t:"r",k:"g",g:"technology-democracy",q:"What has New America written about artificial intelligence since 2020?"},
{t:"r",k:"g",g:"technology-democracy",q:"What does New America recommend to protect college students' data privacy?"},
{t:"r",k:"g",g:"technology-democracy",q:"What does New America say about how social media affects democracy?"},
{t:"r",k:"g",g:"technology-democracy",q:"How should the government deal with the power of big tech companies?"},
{t:"r",k:"s",g:"democratic-futures",q:"What did Political Reform's 2026 polling find about ballot initiatives in states without them?"},
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
{t:"i",g:"funding",q:"How has New America's funding changed over the years it has published its funders?"},
{t:"i",g:"funding",q:"Which New America reports did the Gates Foundation support?"}
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
  w.appendChild(el("p","meta","Ask about New America and its work using plain words in this time-limited demo running through "+(untilLabel(openUntil)||"Nov 14, 2026")+"."));
  w.appendChild(chips(startersPick(STARTERS,startersVisit())));$("out").appendChild(w);
}
var AUTO=window.CSS&&CSS.supports&&CSS.supports("field-sizing","content");
function grow(){var q=$("q");if(AUTO){q.style.height="";return}q.style.height="auto";q.style.height=Math.min(q.scrollHeight,112)+"px"}
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
// The chart is an addendum after the written answer, placed before the rating pill so the pill stays last.
function addChart(d,card){
  if(!d||d.chart===undefined||d.chart===null||!card||!window.NAChart)return;
  var f=window.NAChart.render(d.chart);
  card.insertBefore(f,card.querySelector(".rate"));
  // Next charts to try (issue #218): each chip asks chart_answer for its plan, the same way a shared link does, so the cache and the limits apply.
  var chips=chartChips(d.suggestions,function(s){openShared({plan:s.plan},s.label)});
  if(chips)card.insertBefore(chips,card.querySelector(".rate"));
}
//#gallery-start
// One chip for each suggested chart under a chart. Its link is built by NAChartExport.shareLink from a fresh fragment that holds the plan alone (never a token or a server);
// a plain click opens the chart in place through onOpen (a chart_answer call, so the cache and the limits apply), a modified or middle click follows the link. No question text is involved.
// A plan too long for a link still gets a button.
function chartChips(list,onOpen){
  if(!Array.isArray(list)||!list.length)return null;
  var X=window.NAChartExport,box=el("div","chart-chips");box.setAttribute("role","group");box.setAttribute("aria-label","Charts you could try next");
  list.forEach(function(s){
    if(!s||typeof s.label!=="string"||!s.label||!s.plan||typeof s.plan!=="object")return;
    var href=X?X.shareLink(location.origin,location.pathname,s.plan):null,b=href?el("a","chart-chip",s.label):el("button","chart-chip",s.label);
    if(href)b.href=href;else b.type="button";
    b.onclick=function(ev){if(ev&&(ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.altKey||ev.button>0))return;if(ev)ev.preventDefault();onOpen(s)};
    box.appendChild(b);
  });
  return box.children.length?box:null;
}
//#gallery-end
// A chart opened from a shared link (issue #216): the same chart_answer pipeline as a question, called with the link's plan. If the figures changed since the link was made, a plain note says so.
async function openShared(shared,title){
  var t=turn(title||"Open a shared chart"),out=t.body;
  t.stage.textContent="Drawing the chart from the link...";
  try{
    var r=await tool("chart_answer",{plan:shared.plan}),d=r.data||{},card=el("article","card");
    t.stage.textContent="";
    if(d.kind==="chart_answer"&&d.chart){
      card.appendChild(md(String(r.text||"").split("\n\n")[0],{}));
      var note=window.NAChartExport&&window.NAChartExport.stampNote(shared.dataStamp,d.chart);
      if(note)card.appendChild(el("p","meta chart-stale",note));
      out.appendChild(card);addChart(d,card);
    }else{card.appendChild(md(String(r.text||"That chart could not be drawn."),{}));out.appendChild(card)}
    settle(t,"done");
  }catch(e){
    e=netErr(e);t.stage.textContent="";
    out.appendChild(el("p","meta",e.kind==="srv"&&/not valid/i.test(e.msg)?"That link could not be read. Check that you copied all of it.":e.msg));settle(t,"error");
  }
}
// A page opened on a #plan= link draws that chart at once.
(function openFromLink(){
  var X=window.NAChartExport;
  if(!X)return;
  var r=X.payloadFromHash(location.hash||"");
  if(!r)return;
  if(r.ok)openShared(r);else $("out").appendChild(el("p","meta",r.message));
})();
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
    C.drawCard(d,r,q,out);
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
$('signout').addEventListener('click',function(){fetch(base()+'/auth/logout',{method:'POST'}).catch(function(){}).then(function(){location.reload()})});
health();
})();
