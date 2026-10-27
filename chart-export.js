// @pocTriage: browser-side chart export builders for the console (issue #216, docs/plans/chart-pipeline.spec.md section chart-share-export); they only format a specification the server already parsed, read no file and write no data, not an ad-hoc data script.
// Keep, share and download a chart (issue #226: a picture can be saved as SVG, PNG or JPG at a size the visitor picks; the chart is laid out again at that size, not stretched). The pure builders at the top take plain values: they never read the page address, storage or the document, so the same text
// is built on the screen, in the picture's caption, in the SVG description and in the CSV header (the note lines come from NAChart.noteLines, chart.js), and a test runs them in Node.
// The glue at the bottom (mount, the downloads) is the only part that touches the page. A link made here carries a fresh fragment holding the chart's plan and nothing else:
// never a token or a server, never the visitor's question or the plan's free-text reason. console.js reads #token= from the same fragment and removes only that key.
(function(){
'use strict';
var MAX=4000,MAX_ENCODED=5400,MAX_PASTE=20000;
// the plain system font stack a saved picture uses, so it looks the same on any machine
var FONT="system-ui, -apple-system, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif";
// a saved picture is between 320 and 8192 pixels wide; a PNG or JPG is also kept to 16,000,000 pixels in all (width x height), because iPhone Safari cannot draw a larger canvas
var MIN_WIDTH=320,MAX_WIDTH=8192,MAX_RASTER_PIXELS=16000000;
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
// With size ({width, height} in pixels) the file is also made to open on its own: it gets that size, a plain system font, a background of the page colour and the few style rules the page's
// stylesheet gave the text, so nothing outside the file is needed. The viewBox stays, so it is still a picture that scales without loss.
function svgDocument(markup,spec,getVar,size){
  var m=svgMetaText(spec),body=String(markup).replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g,function(all,name,fallback){
    var v=getVar(name);return v&&String(v).trim()?String(v).trim():(fallback&&fallback.trim()?fallback.trim():"#000");
  });
  var open=/<svg\b[^>]*>/.exec(body);
  if(!open)return body;
  var tag=open[0],extra="";
  if(!/\sxmlns=/.test(tag))tag=tag.replace(/^<svg/,'<svg xmlns="http://www.w3.org/2000/svg"');
  if(size){
    var bg=String(getVar("--bg")||"").trim()||"#fff",vb=/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(tag);
    tag=tag.replace(/\swidth="[^"]*"/,"").replace(/\sheight="[^"]*"/,"").replace(/\sstyle="[^"]*"/,"").replace(/\sclass="[^"]*"/,"").replace(/\srole="[^"]*"/,' role="img"').replace(/^<svg/,'<svg width="'+size.width+'" height="'+size.height+'" font-family="'+FONT+'"');
    extra="<style>.chart-end{paint-order:stroke;stroke:"+bg+";stroke-width:3px}.chart-label,.chart-xtick,.chart-vtick{font-variant-numeric:tabular-nums}</style>"+(vb?'<rect x="0" y="0" width="'+vb[1]+'" height="'+vb[2]+'" fill="'+bg+'"/>':"");
  }
  return body.slice(0,open.index)+tag+"<title>"+xml(m.title)+"</title><desc>"+xml(m.desc)+"</desc><metadata>"+xml(m.metadata)+"</metadata>"+extra+body.slice(open.index+open[0].length);
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
// ---- Size: what width a saved picture gets, and how the chart is laid out for it (pure; the page glue below calls them) ----
// A typed width: whole pixels from 320 to 8192, else a plain message.
function parseWidth(text){
  var t=String(text).trim(),msg="Enter a width between "+MIN_WIDTH+" and "+MAX_WIDTH+" pixels.";
  if(!/^\d{1,5}$/.test(t))return{ok:false,message:msg};
  var n=+t;
  return n<MIN_WIDTH||n>MAX_WIDTH?{ok:false,message:msg}:{ok:true,width:n};
}
// The output width of a size choice: "1", "2" or "4" times the width on the screen (never past 8192), or "custom" with the typed text.
function requestedWidth(choice,screenWidth,customText){
  if(choice==="custom")return parseWidth(customText);
  var k=choice==="2"?2:choice==="4"?4:1,w=Math.round(k*screenWidth);
  return w>MAX_WIDTH?{ok:true,width:MAX_WIDTH,message:"That is wider than the largest size, so the picture is "+MAX_WIDTH+" pixels wide."}:{ok:true,width:w};
}
// The chart is laid out at layoutWidth and then scaled by scale to the output width. A larger picture keeps the layout of the screen and scales it, so text is the same size relative to the chart;
// a smaller one is laid out again at its own width, so its labels are thinned to fit and text stays 12 pixels.
function layoutPlan(screenWidth,outWidth){var L=Math.min(screenWidth,outWidth);return{layoutWidth:L,scale:outWidth/L,width:outWidth}}
// The pixel size of a PNG or JPG: the layout is layoutWidth x layoutHeight (the caption included); when width x height would pass 16,000,000 pixels the width is lowered to fit and a plain message says so.
function rasterSize(layoutWidth,layoutHeight,outWidth){
  var h=Math.ceil(outWidth/layoutWidth*layoutHeight);
  if(outWidth*h<=MAX_RASTER_PIXELS)return{width:outWidth,height:h,capped:false};
  var w=Math.floor(Math.sqrt(MAX_RASTER_PIXELS*layoutWidth/layoutHeight));
  while(w>1&&w*Math.ceil(w/layoutWidth*layoutHeight)>MAX_RASTER_PIXELS)w--;
  return{width:w,height:Math.ceil(w/layoutWidth*layoutHeight),capped:true,message:"That size is too large for the browser to draw, so the picture is "+w+" pixels wide."};
}
// Several pictures (small panels) stacked into one file: parts = [{title, markup, width, height}] in order; every part keeps its own viewBox.
function stackSvgs(parts,width){
  var y=0,out=[];
  parts.forEach(function(p){
    if(p.title){out.push('<text x="4" y="'+(y+13)+'" style="fill:var(--chart-text);font-size:12px;font-weight:600">'+xml(p.title)+'</text>');y+=20}
    out.push(String(p.markup).replace(/^<svg\b[^>]*>/,'<svg x="0" y="'+y+'" width="'+p.width+'" height="'+p.height+'" viewBox="0 0 '+p.width+' '+p.height+'">'));
    y+=p.height+8;
  });
  return{markup:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+y+'" width="100%" role="group">'+out.join("")+'</svg>',height:y};
}
// ---- The page glue: the only part that touches the document, the clipboard and the download. Tests do not run it; the PNG draw is a manual check. ----
function fileStem(spec){return(spec.planHash?spec.planHash.slice(0,8)+"-":"")+plain(spec.title).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48)}
function download(name,type,data){
  var url=URL.createObjectURL(new Blob([data],{type:type})),a=document.createElement("a");
  a.href=url;a.download=name;document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url)},1000);
}
function plotOf(fig){return fig.querySelector?fig.querySelector(".chart-plot"):null}
// the width of the picture on the screen, in pixels (an unmeasured one counts as the default width)
function screenWidth(fig){var p=plotOf(fig);return window.NAChartTheme.widthOf(p&&p.clientWidth)}
// Lays the chart out again at width and gives back its markup and size: {markup, width, height}, or null when it cannot be drawn. A chart of several panels becomes one stacked picture.
function laidOut(spec,width,done){
  var N=chart();
  N.loadD3().then(function(d3){
    var host=document.createElement("div");
    return Promise.resolve(N.draw(d3,host,spec,{width:width})).then(function(){return host});
  }).then(function(host){
    var svgs=[].slice.call(host.querySelectorAll("svg")),titles=[].slice.call(host.querySelectorAll(".chart-panel-title")),ser=new XMLSerializer();
    if(!svgs.length)return done(null);
    var parts=svgs.map(function(v,i){
      var vb=/^0 0 ([\d.]+) ([\d.]+)$/.exec(v.getAttribute("viewBox")||"")||[];
      return{title:svgs.length>1&&titles[i]?titles[i].textContent:"",markup:ser.serializeToString(v),width:+vb[1]||width,height:+vb[2]||0};
    });
    if(parts.length===1)return done({markup:parts[0].markup,width:parts[0].width,height:parts[0].height});
    var st=stackSvgs(parts,width);done({markup:st.markup,width:width,height:st.height});
  }).catch(function(){done(null)});
}
function cssValue(name){return getComputedStyle(document.documentElement).getPropertyValue(name)}
// The standalone file for a laid-out picture at an output size.
function fileOf(lay,spec,outWidth){return svgDocument(lay.markup,spec,cssValue,{width:outWidth,height:Math.round(lay.height*outWidth/lay.width)})}
function svgFile(fig,spec,outWidth,done){
  var plan=layoutPlan(screenWidth(fig),outWidth);
  laidOut(spec,plan.layoutWidth,function(lay){done(lay?fileOf(lay,spec,outWidth):null)});
}
// A PNG or JPG: the chart laid out at the layout width, drawn at the scale to the output width, with the caption under it. done(blob, message, width) where message is set when the size was lowered, and width is the width it was made at.
function rasterFile(fig,spec,type,outWidth,done){
  var plan=layoutPlan(screenWidth(fig),outWidth),L=plan.layoutWidth;
  laidOut(spec,L,function(lay){
    if(!lay)return done(null);
    var pad=16,lh=18,cv=document.createElement("canvas"),ctx=cv.getContext("2d");
    if(!ctx)return done(null);
    ctx.font="13px "+FONT;
    var lines0=wrapLines(function(t){return ctx.measureText(t).width},captionLines(spec),L-2*pad),total=lay.height+pad+lines0.length*lh+pad,size=rasterSize(L,total,outWidth),k=size.width/L;
    var file=svgDocument(lay.markup,spec,cssValue,{width:size.width,height:Math.round(lay.height*k)}),img=new Image();
    img.onload=function(){
      var font=(13*k)+"px "+FONT,lines;
      cv.width=size.width;ctx.font=font;
      lines=wrapLines(function(t){return ctx.measureText(t).width},captionLines(spec),cv.width-2*pad*k);
      cv.height=Math.ceil(lay.height*k+pad*k+lines.length*lh*k+pad*k);
      ctx.fillStyle=cssValue("--bg").trim()||"#fff";ctx.fillRect(0,0,cv.width,cv.height);
      ctx.drawImage(img,0,0,size.width,Math.round(lay.height*k));
      ctx.fillStyle=cssValue("--chart-text").trim()||"#000";ctx.textBaseline="top";
      lines.forEach(function(l,i){ctx.font=i===0?"bold "+font:font;ctx.fillText(l,pad*k,lay.height*k+pad*k+i*lh*k)});
      cv.toBlob(function(b){done(b,size.message,size.width)},type,type==="image/jpeg"?0.92:undefined);
    };
    img.onerror=function(){done(null)};
    img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(file);
  });
}
function button(label,onclick){var b=document.createElement("button");b.type="button";b.className="chart-btn";b.textContent=label;b.onclick=onclick;return b}
function option(value,label){var o=document.createElement("option");o.value=value;o.textContent=label;return o}
// The download group: a size, then one button for each format. The sizes are 1, 2 and 4 times the picture on the screen, or a width typed in pixels.
function downloadGroup(fig,spec,say){
  var box=document.createElement("div"),lead=document.createElement("span"),lab=document.createElement("label"),pick=document.createElement("select"),
    wl=document.createElement("label"),typed=document.createElement("input");
  box.className="chart-download";box.setAttribute("role","group");box.setAttribute("aria-label","Download picture");
  lead.className="chart-download-lead";lead.textContent="Download picture";
  lab.className="chart-size";lab.appendChild(document.createTextNode("Size "));
  var opts=[option("1",""),option("2",""),option("4",""),option("custom","Choose a width")];
  opts.forEach(function(o){pick.appendChild(o)});pick.value="1";lab.appendChild(pick);
  wl.className="chart-size";wl.hidden=true;wl.appendChild(document.createTextNode("Width in pixels "));
  typed.type="number";typed.min=String(MIN_WIDTH);typed.max=String(MAX_WIDTH);typed.step="1";typed.value="1200";typed.className="chart-width";wl.appendChild(typed);
  function words(){
    var w=screenWidth(fig),n=function(k){return Math.min(MAX_WIDTH,Math.round(k*w))};
    opts[0].textContent="Same as on screen ("+n(1)+" pixels wide)";opts[1].textContent="Twice as large ("+n(2)+" pixels wide)";opts[2].textContent="Four times as large ("+n(4)+" pixels wide)";
  }
  words();
  pick.onfocus=words;pick.onpointerdown=words;
  pick.onchange=function(){wl.hidden=pick.value!=="custom";typed.setAttribute("aria-invalid","false");say("")};
  function go(format){
    var want=requestedWidth(pick.value,screenWidth(fig),typed.value);
    typed.setAttribute("aria-invalid",want.ok?"false":"true");
    if(!want.ok){say(want.message);return}
    say(want.message||"");
    var stem=fileStem(spec)+"-"+want.width+"px";
    if(format==="svg")return svgFile(fig,spec,want.width,function(f){if(!f){say("The picture is not ready yet.");return}download(stem+".svg","image/svg+xml",f)});
    var type=format==="png"?"image/png":"image/jpeg";
    rasterFile(fig,spec,type,want.width,function(b,note,made){
      if(!b){say("The picture could not be made at this size. Try a smaller size.");return}
      if(note)say(note);
      download(fileStem(spec)+"-"+(made||want.width)+"px."+format,type,b);
    });
  }
  box.appendChild(lead);box.appendChild(lab);box.appendChild(wl);
  box.appendChild(button("SVG",function(){go("svg")}));box.appendChild(button("PNG",function(){go("png")}));box.appendChild(button("JPG",function(){go("jpg")}));
  return box;
}
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
  bar.appendChild(downloadGroup(fig,spec,say));
  bar.appendChild(button("Download numbers (CSV)",function(){download(fileStem(spec)+".csv","text/csv;charset=utf-8",csvText(spec))}));
  fig.appendChild(bar);fig.appendChild(status);
}
window.NAChartExport={parseWidth:parseWidth,requestedWidth:requestedWidth,layoutPlan:layoutPlan,rasterSize:rasterSize,stackSvgs:stackSvgs,MIN_WIDTH:MIN_WIDTH,MAX_WIDTH:MAX_WIDTH,MAX_RASTER_PIXELS:MAX_RASTER_PIXELS,csvText:csvText,svgMetaText:svgMetaText,svgDocument:svgDocument,captionLines:captionLines,wrapLines:wrapLines,shareLink:shareLink,payloadFromHash:payloadFromHash,payloadFromPaste:payloadFromPaste,stampNote:stampNote,mount:mount,MAX_SHARED_CHARS:MAX};
})();
