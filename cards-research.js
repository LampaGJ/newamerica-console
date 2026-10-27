// Research cards (issue #88, D8): who funded the work, who cites New America (and the news), who works on a topic, and the events list.
// A classic script: it attaches to window.NACards (see cards-base.js, loaded first, and cards-sources.js).
(function(){
'use strict';
var C=window.NACards,el=C.el,safeUrl=C.safeUrl,link=C.link,TIERS=C.TIERS,siteBlocks=C.siteBlocks,warnOnce=C.warnOnce,speakerLines=C.speakerLines,videoRef=C.videoRef,playBox=C.playBox;

function yearSpan(y){if(!y||y[0]==null)return "undated";return y[0]===y[1]?String(y[0]):y[0]+"\u2013"+y[1]}
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
    // Outlets with the most stories (the server ranks them), then the note on audio and video sites and on outlets this answer does not name.
    var outs=Array.isArray(news.outlets)?news.outlets:[];
    if(outs.length){
      sec.appendChild(el("p","meta","Outlets with the most stories:"));
      var ool=el("ol","fd-rank");
      outs.forEach(function(o){ool.appendChild(el("li",null,o.outlet+": "+o.stories+(o.stories===1?" story":" stories")))});
      sec.appendChild(ool);
    }
    var av=news.audioVideo;
    if(av&&av.stories>0){
      var sites=(av.sites||[]).slice(0,4).map(function(x){return x.outlet+" "+x.stories}).join(", ");
      sec.appendChild(el("p","meta","Another "+av.stories+(av.stories===1?" item comes":" items come")+" from audio and video sites"+(sites?" ("+sites+((av.sites||[]).length>4?" and others":"")+")":"")+". They are left out of this ranking."));
    }
    if(news.unnamed>0)sec.appendChild(el("p","meta",news.unnamed+(news.unnamed===1?" more story comes":" more stories come")+" from outlets this answer does not name."));
    sec.appendChild(el("p","meta","The most recent:"));
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
  // A tier filter hid some cited documents: say what the list shows and list the top of the rest.
  var outside=d.outsideTiers;
  if(outside&&outside.count>0){
    var oKinds=Array.isArray(d.tiers)&&d.tiers.length===1&&d.tiers[0]===1?"reports and books":"some kinds of material";
    card.appendChild(el("p","meta","This list shows "+oKinds+" only. "+outside.count+(outside.count===1?" more document is":" more documents are")+" cited in other kinds of material:"));
    var oul=el("ul");
    (outside.documents||[]).forEach(function(x){
      var li=el("li");li.appendChild(link(x.title||"(untitled)",x.url));
      var by=Object.keys(x.bySource||{}).map(function(k){return citeLabel(d,k)}).join(", ");
      li.appendChild(el("span","meta"," · cited "+times(x.total)+(by?", by "+by:"")));
      oul.appendChild(li);
    });
    card.appendChild(oul);
  }
  // Other places New America is cited: one sentence per source that has a mention; none for a zero, and In the News has its own section.
  // A news question leaves the other sources out. A source whose records match fewer documents than rows says so instead of "cites ... N times" (server: citationReportMarkdown).
  var rest=d.focus==="news"?[]:(d.totals||[]).filter(function(t){return t.rows>0&&!(t.source==="in_the_news"&&news)});
  if(rest.length){
    card.appendChild(el("h4",null,"Elsewhere"));
    var eu=el("ul");rest.forEach(function(t){
      eu.appendChild(el("li",null,t.matchedAll>=t.rows||typeof t.matchedAll!=="number"
        ?t.label+" cites New America's work "+times(t.rows)+"."
        :t.label+" has "+t.rows+(t.rows===1?" record that mentions":" records that mention")+" New America. "+(t.documentsAll===0?"None names a specific New America document.":t.documentsAll+" New America "+(t.documentsAll===1?"document is":"documents are")+" named in them.")));
    });card.appendChild(eu);
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
  var cur=Array.isArray(d.curated)?d.curated.filter(function(c){return c&&typeof c==='object'&&c.curated===true&&typeof c.name==='string'&&c.name.trim()}):[];
  if(Array.isArray(d.curated)&&cur.length<d.curated.length)warnOnce('curated expert');
  if(cur.length){
    if(typeof d.curatedNote==='string'&&d.curatedNote.trim())card.appendChild(el("p","meta",d.curatedNote.trim()));
    var cl=el("ul","pp-list pp-curated");
    cur.forEach(function(c){
      var ci=el("li","pp-person"),ch=el("div","pp-head");
      if(typeof c.photoUrl==='string'&&safeUrl(c.photoUrl)){var cim=el("img","pp-av");cim.src=c.photoUrl;cim.alt="";cim.loading="lazy";cim.referrerPolicy="no-referrer";ch.appendChild(cim)}
      else ch.appendChild(el("span","pp-av pp-av--none",c.name.trim().charAt(0)));
      var cw=el("div"),cn=el("strong");cn.appendChild(link(c.name.trim(),c.url));cw.appendChild(cn);
      if(typeof c.title==='string'&&c.title.trim())cw.appendChild(el("div","meta",c.title.trim()));
      ch.appendChild(cw);ci.appendChild(ch);cl.appendChild(ci);
    });
    card.appendChild(cl);
  }
  if(d.note)card.appendChild(el("p","meta",d.note));
  else card.appendChild(el("p","meta",(cur.length?"Other people, ranked from ":"Ranked from ")+d.corpusSize+(d.corpusSize===1?" publication":" publications")+" on the topic. Bylines only."));
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
    li.appendChild(el("div","meta",[evWhen(e.event_start),typeof e.location==='string'?e.location:'',e.program].filter(Boolean).join(" · ")));
    var sp=speakerLines(e.speakers);if(sp)li.appendChild(sp);
    if(e.abstract)li.appendChild(el("p","ev-abs",e.abstract));
    var rec=e.recording&&typeof e.recording==='object'?e.recording:null,rr=rec?videoRef({videoId:rec.videoId,start:rec.start}):null;
    // isPast is decided by the server (injected clock); the console never reads the time. Upcoming: registration, no player. Past: the recording, no registration link. A payload with no isPast (an older server) keeps the old behaviour.
    if(e.isPast!==false&&rr)li.appendChild(playBox(rr,String(rec.title||e.title||'this event')));
    if(e.isPast!==true&&safeUrl(e.registrationUrl)){var r=el("div","meta");r.appendChild(link(typeof e.registrationLabel==='string'&&e.registrationLabel.trim()?e.registrationLabel.trim():"Register",e.registrationUrl));li.appendChild(r)}
    ol.appendChild(li);
  });
  if(list.length)card.appendChild(ol);
  card.appendChild(el("p","meta fine","Times are the site’s local time (Eastern)."));
  out.appendChild(card);
}
Object.assign(C,{renderFunders:renderFunders,renderWhoCites:renderWhoCites,renderCitationReport:renderCitationReport,renderPeople:renderPeople,renderEvents:renderEvents});
})();
