// Answer cards (issue #88, D8): the written answer with its Sources list, the help card, the themes card and the thumbs-up / thumbs-down pill.
// A classic script: it attaches to window.NACards (see cards-base.js, loaded first, and cards-sources.js). tool and netErr come from the page through NACards.host.
(function(){
'use strict';
var C=window.NACards,el=C.el,link=C.link,md=C.md,chips=C.chips,siteBlocks=C.siteBlocks,srcsHead=C.srcsHead,srcItem=C.srcItem,wireActs=C.wireActs;
var tool=function(){return C.host.tool.apply(null,arguments)};
var netErr=function(e){return C.host.netErr(e)};

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
Object.assign(C,{renderAnswer:renderAnswer,renderHelp:renderHelp,renderThroughlines:renderThroughlines,ratingPill:ratingPill});
})();
