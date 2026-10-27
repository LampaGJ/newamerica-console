// Card building blocks shared by the card files (issue #88, D8): the DOM helpers, the minimal markdown, the chip row and the "Explore on the site" block.
// A classic script like chart.js: it attaches to window.NACards and the next files (cards-sources.js, cards-answers.js, cards-research.js, cards-kinds.js) read from it.
// The page (console.js) fills NACards.host with tool, netErr and fill, because the cards call the server and the question box through the page.
(function(){
'use strict';
var C=window.NACards=window.NACards||{};
var TIERS={1:'Authoritative',2:'Analysis',3:'Supporting',4:'Peripheral'};
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function safeUrl(u){return /^https?:\/\//i.test(u||'')?u:null}
function link(txt,u){var h=safeUrl(u);if(!h)return document.createTextNode(txt);var a=el('a',null,txt);a.href=h;a.target='_blank';a.rel='noopener noreferrer';return a}
var REDUCED=function(){return matchMedia("(prefers-reduced-motion: reduce)").matches};
var fill=function(t){C.host.fill(t)};
function chips(list){
  var box=el("div","chips");
  list.forEach(function(x){var b=el("button","chip",x);b.type="button";b.onclick=function(){fill(x)};box.appendChild(b)});
  return box;
}
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
C.host={};
Object.assign(C,{TIERS:TIERS,el:el,safeUrl:safeUrl,link:link,REDUCED:REDUCED,inline:inline,md:md,chips:chips,siteBlocks:siteBlocks});
})();
