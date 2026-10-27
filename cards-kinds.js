// The card kinds (issue #88, D21 and D14): one row per kind of answer the server can send, so adding a card kind is one row here.
// A row is { draw(d, r, q, out) -> the card to rate or null, rate: 'text' | 'answer' | null }. d is the structured answer, r the whole reply (r.text is its text), q the question, out the answer body.
// rate says what the rating pill sends as the answer text: the reply text, the written answer, or nothing (no pill). The pill is added by drawCard, once, for every row.
// A kind with no row is drawn as a plain text card when it has no written answer (the fallback below), and as a written answer otherwise, exactly as before.
// A classic script: it attaches to window.NACards (see cards-base.js, loaded first, then the other cards files).
(function(){
'use strict';
var C=window.NACards,el=C.el,md=C.md;
// One card appended to out by a renderer that takes (d, out): the card is out's last child.
function appended(render){return function(d,r,q,out){render(d,out);return out.lastChild}}
var KINDS={
  help:{draw:function(d,r,q,out){C.renderHelp(d,r.text,out);return out.lastChild},rate:'text'},
  funders:{draw:appended(function(d,out){C.renderFunders(d,out)}),rate:'text'},
  who_cites:{draw:appended(function(d,out){C.renderWhoCites(d,out)}),rate:'text'},
  citation_report:{draw:appended(function(d,out){C.renderCitationReport(d,out)}),rate:'text'},
  throughlines:{draw:appended(function(d,out){C.renderThroughlines(d,out)}),rate:'text'},
  people:{draw:appended(function(d,out){C.renderPeople(d,out)}),rate:'text'},
  events:{draw:appended(function(d,out){C.renderEvents(d,out)}),rate:'text'},
  off_topic:{draw:function(d,r,q,out){var oc=el("article","card");oc.appendChild(md(String(d.answer||""),{}));out.appendChild(oc);return null},rate:null},
  answer:{draw:drawAnswer,rate:'answer'}
};
function drawAnswer(d,r,q,out){
  C.renderAnswer(d,q,out);
  var card=out.lastChild;
  C.moreSources(card,q);
  C.siteBlocks(d,card);
  return card;
}
// A kind this page does not know, with no written answer: the reply's own text in a plain card.
var OTHER={draw:function(d,r,q,out){var gc=el("article","card");gc.appendChild(md(r.text||"",{}));out.appendChild(gc);return gc},rate:'text'};
function rowFor(d){
  var k=d.kind;
  if(typeof k==="string"&&Object.prototype.hasOwnProperty.call(KINDS,k))return KINDS[k];
  return k&&!d.answer?OTHER:KINDS.answer;
}
function drawCard(d,r,q,out){
  var row=rowFor(d),card=row.draw(d,r,q,out);
  if(row.rate&&card)C.ratingPill(card,{request:q,text:row.rate==='answer'?String(d.answer||""):r.text||""});
}
Object.assign(C,{KINDS:KINDS,OTHER:OTHER,rowFor:rowFor,drawCard:drawCard});
})();
