// @pocTriage: browser-side chart export builders for the console (issue #216, docs/plans/chart-pipeline.spec.md section chart-share-export); they only format a specification the server already parsed, read no file and write no data, not an ad-hoc data script.
// Keep, share and download a chart. The pure builders at the top take plain values: they never read the page address, storage or the document, so the same text
// is built on the screen, in the picture's caption, in the SVG description and in the CSV header (the note lines come from NAChart.noteLines, chart.js), and a test runs them in Node.
// The glue at the bottom (mount, pasteBox, the downloads) is the only part that touches the page. A link made here carries a fresh fragment holding the chart's plan and nothing else:
// never a token or a server, never the visitor's question or the plan's free-text reason. console.js reads #token= from the same fragment and removes only that key.
(function(){
'use strict';
var MAX=4000,MAX_ENCODED=5400,MAX_PASTE=20000;
var TOO_LONG="That link is too long to be one of ours.",UNREADABLE="That link could not be read. Check that you copied all of it.";
function chart(){return window.NAChart}
function plain(t){return String(t).replace(/\s+/g," ").trim()}
// ---- Encoding: base64url of UTF-8 text, and stable JSON (keys in code-point order, undefined dropped) so one chart always makes the same link ----
function b64(text){
  var bin=encodeURIComponent(text).replace(/%([0-9A-F]{2})/g,function(m,h){return String.fromCharCode(parseInt(h,16))});
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function unb64(code){
  if(!/^[A-Za-z0-9_-]+$/.test(code))throw new Error("not base64url");
  var bin=atob(code.replace(/-/g,"+").replace(/_/g,"/"));
  return decodeURIComponent(bin.split("").map(function(ch){return"%"+("0"+ch.charCodeAt(0).toString(16)).slice(-2)}).join(""));
}
function ordered(v){
  if(Array.isArray(v))return v.map(ordered);
  if(v&&typeof v==="object"){var o={};Object.keys(v).sort().forEach(function(k){if(v[k]!==undefined)o[k]=ordered(v[k])});return o}
  return v;
}
function canonical(v){return JSON.stringify(ordered(v))}
// The plan as it is shared: a copy without its free-text reason.
function sharedOf(plan){var o={};Object.keys(plan).forEach(function(k){if(k!=="reason")o[k]=plan[k]});return o}
// ---- The share link ----
// origin and pathname are arguments; anything after a ? or # in them is dropped, so a page address that held #token=... can never leak into a link.
function shareLink(origin,pathname,plan,stamp){
  if(typeof origin!=="string"||typeof pathname!=="string"||!plan||typeof plan!=="object")return null;
  var payload={plan:sharedOf(plan)};
  if(typeof stamp==="string"&&stamp.length>0)payload.dataStamp=stamp;
  var text=canonical(payload);
  if(text.length>MAX)return null;
  var params=new URLSearchParams();params.set("plan",b64(text));
  return origin.split(/[?#]/)[0]+pathname.split(/[?#]/)[0]+"#"+params.toString();
}
function failed(message){return{ok:false,message:message}}
// Decode and check one encoded payload. Length first (before any decode or parse), then the shape: a plan and an optional stamp, nothing else.
function readCode(code){
  if(code.length>MAX_ENCODED)return failed(TOO_LONG);
  var text,obj;
  try{text=unb64(code)}catch(e){return failed(UNREADABLE)}
  if(text.length>MAX)return failed(TOO_LONG);
  try{obj=JSON.parse(text)}catch(e){return failed(UNREADABLE)}
  if(!obj||typeof obj!=="object"||Array.isArray(obj))return failed(UNREADABLE);
  var keys=Object.keys(obj);
  for(var i=0;i<keys.length;i++)if(keys[i]!=="plan"&&keys[i]!=="dataStamp")return failed(UNREADABLE);
  if(chart().planError(obj.plan))return failed(UNREADABLE);
  if(obj.dataStamp!==undefined&&!(typeof obj.dataStamp==="string"&&obj.dataStamp.length>=1&&obj.dataStamp.length<=200))return failed(UNREADABLE);
  var out={ok:true,plan:obj.plan};
  if(obj.dataStamp!==undefined)out.dataStamp=obj.dataStamp;
  return out;
}
function fragmentOf(text){var i=text.indexOf("#");return i<0?null:text.slice(i+1)}
// The page's fragment: only the plan key is read. null when there is no plan key (a #token=... fragment alone is not ours to open).
function payloadFromHash(hash){
  if(typeof hash!=="string")return null;
  if(hash.length>MAX_PASTE)return failed(TOO_LONG);
  var code=new URLSearchParams(hash.replace(/^#/,"")).get("plan");
  return code===null?null:readCode(code.trim());
}
// What a visitor pastes: the whole link, the fragment, "plan=...", or the raw code.
function payloadFromPaste(text){
  if(typeof text!=="string")return failed(UNREADABLE);
  if(text.length>MAX_PASTE)return failed(TOO_LONG);
  var t=text.trim(),frag=fragmentOf(t),code;
  if(frag!==null)code=new URLSearchParams(frag).get("plan");
  else if(/^plan=/.test(t))code=new URLSearchParams(t).get("plan");
  else code=t;
  return code===null||code===""?failed(UNREADABLE):readCode(code.trim());
}
// The note shown when the figures changed after the link was made. The old stamp is never shown or kept; a link with no stamp claims nothing.
function stampNote(linkStamp,spec){
  if(typeof linkStamp!=="string"||!linkStamp||!spec||spec.dataStamp===linkStamp)return null;
  return"The figures have been updated since this chart was saved. This chart uses the figures as of "+spec.asOf+".";
}
// ---- The numbers (CSV) ----
function textCell(v){
  var s=String(v);
  if(/^[=+@\t\r]/.test(s)||(/^-/.test(s)&&!/^-?\d+(\.\d+)?$/.test(s)))s="'"+s;
  return/[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function numCell(v){return v===undefined||v===null?"":String(v)}
function mapOf(r){var m={};r.points.forEach(function(p){m[p.label]=p});return m}
function bandMap(r){var m={};(r.band||[]).forEach(function(b){m[b.label]=b});return m}
// The columns of a specification: one value column per series, plus low and high for a range, a reason for gaps, a position for scatter points and a group for treemap points.
function columns(spec){
  var C=chart(),cols=[],multi=!!spec.panels;
  C.setsOf(spec).forEach(function(set){set.series.forEach(function(r){
    var name=(multi?set.title+": ":"")+r.name,u=C.unitsOf(set,r),m=mapOf(r),labels=C.xAxisLabels(set.type,set.series,set.labels),gap=labels.some(function(l){return!m[l]});
    cols.push({head:name+" ("+u+")",why:"The value of "+r.name+" in "+u+(r.estimate?" (an estimate)":"")+"; empty where there is no figure.",cell:function(l){return m[l]?numCell(m[l].value):""}});
    if(r.band){var bm=bandMap(r);
      cols.push({head:name+" low ("+u+")",why:"The lower end of the range for "+r.name+"; empty where it has no range.",cell:function(l){return bm[l]?numCell(bm[l].lower):""}});
      cols.push({head:name+" high ("+u+")",why:"The upper end of the range for "+r.name+"; empty where it has no range.",cell:function(l){return bm[l]?numCell(bm[l].upper):""}});
    }
    if(r.points.some(function(p){return p.x!==undefined}))cols.push({head:name+" position ("+(spec.xUnits||"horizontal")+")",why:"Where each point of "+r.name+" sits along the horizontal axis.",cell:function(l){return m[l]&&m[l].x!==undefined?numCell(m[l].x):""}});
    if(r.points.some(function(p){return p.group!==undefined}))cols.push({head:name+" group",why:"The group each cell of "+r.name+" belongs to.",text:true,cell:function(l){return m[l]&&m[l].group!==undefined?m[l].group:""}});
    if(gap||(r.coverage||[]).some(function(c){return c.value===0}))cols.push({head:name+" reason",why:"Why "+r.name+" has no figure in that row; empty where it has one. A missing figure is never written as zero.",text:true,cell:function(l){return m[l]?"":C.gapReason(r,l)}});
  })});
  return cols;
}
function csvText(spec){
  var C=chart(),cols=columns(spec),labels=C.xAxisLabels(spec.type,spec.series,spec.labels),notes=C.noteLines(spec),out=[];
  out.push("# "+plain(spec.title));
  out.push("# Basis: "+(spec.note?plain(spec.note):"not stated"));
  out.push("# Figures as of: "+spec.asOf);
  C.sourcesOf(spec).forEach(function(s){out.push("# Source: "+plain(s.label)+", "+s.url)});
  if(spec.planHash)out.push("# Chart code: "+spec.planHash);
  if(spec.dataStamp)out.push("# Figures version: "+spec.dataStamp);
  notes.slice(1).forEach(function(n){out.push("# "+plain(n))});
  out.push('# Column "Label": The label of each row (a year, a name or a group).');
  cols.forEach(function(c){out.push('# Column "'+c.head.replace(/"/g,"'")+'": '+plain(c.why))});
  out.push(["Label"].concat(cols.map(function(c){return textCell(c.head)})).join(","));
  labels.forEach(function(l){out.push([textCell(l)].concat(cols.map(function(c){var v=c.cell(l);return c.text?textCell(v):v})).join(","))});
  if(spec.links&&spec.links.length){
    out.push("");out.push("# Links between the items above, one per row; empty where there is no range.");
    out.push("From,To,Value ("+spec.units+"),Low,High");
    spec.links.forEach(function(k){out.push([textCell(k.source),textCell(k.target),numCell(k.value),numCell(k.lower),numCell(k.upper)].join(","))});
  }
  return out.join("\n")+"\n";
}
// ---- The picture (SVG and PNG) ----
function xml(t){return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
// The words stored inside the picture file: its title, a description with the basis, as-of date, sources and notes, and the chart code, as-of date and figures version.
function svgMetaText(spec){
  var meta=[];
  if(spec.planHash)meta.push("Chart code: "+spec.planHash);
  meta.push("Figures as of: "+spec.asOf);
  if(spec.dataStamp)meta.push("Figures version: "+spec.dataStamp);
  return{title:plain(spec.title),desc:chart().noteLines(spec).map(plain).join(" "),metadata:meta.join(". ")+"."};
}
// The live picture's markup as a stand-alone file: every CSS variable colour replaced by its value (getVar gives the value of a name such as --chart-1), and the title, description and metadata added.
function svgDocument(markup,spec,getVar){
  var m=svgMetaText(spec),body=String(markup).replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,function(all,name,fallback){
    var v=getVar(name);return v&&String(v).trim()?String(v).trim():(fallback&&fallback.trim()?fallback.trim():"#000");
  });
  var open=/<svg\b[^>]*>/.exec(body);
  if(!open)return body;
  var tag=open[0];
  if(!/\sxmlns=/.test(tag))tag=tag.replace(/^<svg/,'<svg xmlns="http://www.w3.org/2000/svg"');
  return body.slice(0,open.index)+tag+"<title>"+xml(m.title)+"</title><desc>"+xml(m.desc)+"</desc><metadata>"+xml(m.metadata)+"</metadata>"+body.slice(open.index+open[0].length);
}
// The caption under a PNG: the title, then the same note lines the screen shows.
function captionLines(spec){return[plain(spec.title)].concat(chart().noteLines(spec).map(plain))}
// Break lines into rows no wider than width, measured with measure(text) (the canvas's measureText in the page).
function wrapLines(measure,lines,width){
  var out=[];
  lines.forEach(function(line){
    var cur="";
    String(line).split(" ").forEach(function(w){var t=cur?cur+" "+w:w;if(cur&&measure(t)>width){out.push(cur);cur=w}else cur=t});
    if(cur)out.push(cur);
  });
  return out;
}
// ---- The page glue: the only part that touches the document, the clipboard and the download. Tests do not run it; the PNG draw is a manual check. ----
function fileStem(spec){return(spec.planHash?spec.planHash.slice(0,8)+"-":"")+plain(spec.title).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48)}
function download(name,type,data){
  var url=URL.createObjectURL(new Blob([data],{type:type})),a=document.createElement("a");
  a.href=url;a.download=name;document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url)},1000);
}
function liveSvg(fig){var s=fig.querySelector&&fig.querySelector(".chart-plot svg");return s||null}
function svgFile(fig,spec){
  var svg=liveSvg(fig);if(!svg)return null;
  var css=getComputedStyle(document.documentElement);
  return svgDocument(new XMLSerializer().serializeToString(svg),spec,function(n){return css.getPropertyValue(n)});
}
function pngFile(fig,spec,done){
  var file=svgFile(fig,spec);if(!file)return done(null);
  var css=getComputedStyle(document.documentElement),vb=(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(file)||[]),w=+vb[1]||640,h=+vb[2]||340,k=2,pad=16*k;
  var img=new Image();
  img.onload=function(){
    var cv=document.createElement("canvas"),ctx=cv.getContext("2d"),font=(13*k)+"px system-ui, sans-serif",lines;
    cv.width=w*k;ctx.font=font;
    lines=wrapLines(function(t){return ctx.measureText(t).width},captionLines(spec),cv.width-2*pad);
    var lh=18*k;cv.height=h*k+pad+lines.length*lh+pad;
    ctx.fillStyle=css.getPropertyValue("--bg").trim()||"#fff";ctx.fillRect(0,0,cv.width,cv.height);
    ctx.drawImage(img,0,0,w*k,h*k);
    ctx.fillStyle=css.getPropertyValue("--chart-text").trim()||"#000";ctx.textBaseline="top";
    lines.forEach(function(l,i){ctx.font=i===0?"bold "+font:font;ctx.fillText(l,pad,h*k+pad+i*lh)});
    cv.toBlob(function(b){done(b)},"image/png");
  };
  img.onerror=function(){done(null)};
  img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(file);
}
function button(label,onclick){var b=document.createElement("button");b.type="button";b.className="chart-btn";b.textContent=label;b.onclick=onclick;return b}
// The controls under one figure.
function mount(fig,spec){
  var bar=document.createElement("div"),status=document.createElement("p");
  bar.className="chart-actions";status.className="meta chart-status";status.setAttribute("role","status");
  function say(t){status.textContent=t}
  if(spec.plan&&spec.dataStamp)bar.appendChild(button("Copy link to this chart",function(){
    var link=shareLink(location.origin,location.pathname,spec.plan,spec.dataStamp);
    if(!link){say("This chart is too large to share as a link.");return}
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(link).then(function(){say("Link copied.")},function(){say("Copy this link: "+link)});
    else say("Copy this link: "+link);
  }));
  bar.appendChild(button("Download picture (SVG)",function(){var f=svgFile(fig,spec);if(!f){say("The picture is not ready yet.");return}download(fileStem(spec)+".svg","image/svg+xml",f)}));
  bar.appendChild(button("Download picture (PNG)",function(){pngFile(fig,spec,function(b){if(!b){say("The picture is not ready yet.");return}download(fileStem(spec)+".png","image/png",b)})}));
  bar.appendChild(button("Download numbers (CSV)",function(){download(fileStem(spec)+".csv","text/csv;charset=utf-8",csvText(spec))}));
  fig.appendChild(bar);fig.appendChild(status);
}
// The paste box: onOpen({plan, dataStamp}) is called with a link that read; anything else shows its plain message and draws nothing.
function pasteBox(onOpen){
  var form=document.createElement("form"),label=document.createElement("label"),input=document.createElement("input"),go=document.createElement("button"),msg=document.createElement("p");
  form.className="chart-paste";label.className="sr";label.textContent="Paste a chart link";input.type="text";input.autocomplete="off";input.setAttribute("aria-label","Paste a chart link");
  go.type="submit";go.textContent="Open this chart";msg.className="meta";msg.setAttribute("role","status");
  form.appendChild(label);form.appendChild(input);form.appendChild(go);form.appendChild(msg);
  form.onsubmit=function(ev){
    ev.preventDefault();
    var r=payloadFromPaste(input.value);
    if(!r.ok){msg.textContent=r.message;return}
    msg.textContent="";input.value="";onOpen(r);
  };
  return form;
}
window.NAChartExport={csvText:csvText,svgMetaText:svgMetaText,svgDocument:svgDocument,captionLines:captionLines,wrapLines:wrapLines,shareLink:shareLink,payloadFromHash:payloadFromHash,payloadFromPaste:payloadFromPaste,stampNote:stampNote,mount:mount,pasteBox:pasteBox,MAX_SHARED_CHARS:MAX};
})();
