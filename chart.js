// Draws the chart addendum the server sends in structuredContent.chart (spec: src/charts/spec.ts on the server). check() mirrors the server's schema as a shape check, so a malformed chart is refused here too; the table under every chart is the accessible version and works without D3.
(function(){
var D3_URL="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
var D3_SRI="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i";
var TYPES=["bar","line","stacked_bar","stacked_100","area","lollipop","dot_timeline","heatmap","gantt","scatter","connected_scatter","beeswarm","ridgeline","treemap","arcs","bipartite","sankey"],V1_TYPES=["bar","line","stacked_bar"],SHARED=["bar","stacked_bar","stacked_100"],SUBSET=["line","area"],PANEL_TYPES=["bar","line","stacked_bar","stacked_100","area"],NETWORK=["arcs","bipartite","sankey"],MAX_NODES=40,AXES=["left","right"],COLORS=["green","red","blue","orange","gray"],DASHES=["solid","dashed","dotted"],MARKERS=["circle","square","diamond","none"],RECIPES=["ranking","count-over-time","two-measure","money","tenure-timeline","matrix","relationship","distribution","flow","network"];
var SVGNS="http://www.w3.org/2000/svg";
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function str(v,max){return typeof v==="string"&&v.length>0&&v.length<=max}
function https(u){return typeof u==="string"&&/^https?:\/\/\S+$/i.test(u)}
function oneOf(v,list){return v===undefined||list.indexOf(v)>=0}
// true when sub is ref with some labels left out, the rest in the same order
function subset(sub,ref){var j=0;for(var i=0;i<sub.length;i++){while(j<ref.length&&ref[j]!==sub[i])j++;if(j===ref.length)return false;j++}return true}
function labelsOf(r){return r.points.map(function(p){return p.label})}
// the series every other series' labels are measured against: the first one on the left axis
function refSeries(s){for(var i=0;i<s.series.length;i++)if(s.series[i].axis!=="right")return s.series[i];return s.series[0]}
function unitsOf(spec,r){return r.unitsLabel||spec.units}
// a spec that uses the two-axis or style fields: drawn by lineSvg, with a keyed legend and a screen-reader list
function styled(s){return s.series.some(function(r){return r.axis!==undefined||r.style!==undefined||r.unitsLabel!==undefined})}
// null when the spec has the server's shape, else one plain reason.
function check(s){
  if(!s||typeof s!=="object")return"not an object";
  if(TYPES.indexOf(s.type)<0)return"unknown type";
  if(s.version!==undefined&&s.version!==2)return"a version of this chart that this page cannot draw";
  if(!str(s.title,200)||!str(s.units,40))return"missing title or units";
  if(typeof s.asOf!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(s.asOf))return"bad as-of date";
  if(!Array.isArray(s.series)||s.series.length<1||s.series.length>12)return"bad series list";
  for(var i=0;i<s.series.length;i++){
    var r=s.series[i];
    if(!r||!str(r.name,80)||!r.source||!str(r.source.label,120)||!https(r.source.url))return"series "+i+" has no name or source link";
    if(!Array.isArray(r.points)||r.points.length<1||r.points.length>120)return"series "+i+" has no points";
    for(var j=0;j<r.points.length;j++){
      var p=r.points[j];
      if(!p||!str(p.label,80)||typeof p.value!=="number"||!isFinite(p.value))return"series "+i+" has a bad point";
      if(p.x!==undefined&&(typeof p.x!=="number"||!isFinite(p.x)))return"series "+i+" has a bad point";
      if(p.group!==undefined&&!str(p.group,80))return"series "+i+" has a bad point";
    }
    if(!oneOf(r.axis,AXES))return"series "+i+" has an unknown axis";
    if(r.unitsLabel!==undefined&&!str(r.unitsLabel,40))return"series "+i+" has bad units";
    if(r.style!==undefined&&(!r.style||typeof r.style!=="object"||!oneOf(r.style.color,COLORS)||!oneOf(r.style.dash,DASHES)||!oneOf(r.style.marker,MARKERS)))return"series "+i+" has a bad style";
    if(r.estimate!==undefined&&typeof r.estimate!=="boolean")return"series "+i+" has a bad estimate flag";
    if(r.band!==undefined){
      if(!Array.isArray(r.band)||r.band.length<1||r.band.length>120)return"series "+i+" has a bad band";
      for(var b=0;b<r.band.length;b++){var bd=r.band[b];if(!bd||!str(bd.label,80)||typeof bd.lower!=="number"||typeof bd.upper!=="number"||!isFinite(bd.lower)||!isFinite(bd.upper))return"series "+i+" has a bad band"}
    }
    if(r.coverage!==undefined){
      if(!Array.isArray(r.coverage)||r.coverage.length<1||r.coverage.length>120)return"series "+i+" has bad coverage";
      for(var c=0;c<r.coverage.length;c++){var cv=r.coverage[c];if(!cv||!str(cv.label,80)||typeof cv.value!=="number"||!(cv.value>=0&&cv.value<=1))return"series "+i+" has bad coverage"}
    }
  }
  if(s.labels!==undefined&&(!Array.isArray(s.labels)||s.labels.length<1||s.labels.length>120||s.labels.some(function(l){return!str(l,80)})))return"bad labels";
  var e=setError(s.type,s.units,s.series,s.labels,"");
  if(e)return e;
  e=shapeError(s);
  if(e)return e;
  var uses2=V1_TYPES.indexOf(s.type)<0||s.xUnits!==undefined||s.links!==undefined||s.series.some(function(r){return r.points.some(function(p){return p.x!==undefined||p.group!==undefined})})||s.labels!==undefined||s.panels!==undefined||s.annotations!==undefined||s.coverageNote!==undefined||s.series.some(function(r){return r.band!==undefined||r.estimate!==undefined||r.coverage!==undefined});
  if(uses2&&s.version!==2)return"a chart that uses version 2 fields must say version 2";
  var xAxis=xAxisLabels(s.type,s.series,s.labels);
  if(s.annotations!==undefined){
    if(!Array.isArray(s.annotations)||s.annotations.length>12)return"bad annotations";
    for(var a=0;a<s.annotations.length;a++){
      var an=s.annotations[a];
      if(!an||!str(an.text,120))return"annotation "+a+" has no text";
      var named,needsValue=false;
      if(an.kind==="point"){named=[an.label];needsValue=true}
      else if(an.kind==="rule")named=[an.label];
      else if(an.kind==="band")named=[an.from,an.to];
      else if(an.kind==="threshold"){named=[];needsValue=true}
      else return"annotation "+a+" has an unknown kind";
      if(needsValue&&(typeof an.value!=="number"||!isFinite(an.value)))return"annotation "+a+" has no value";
      for(var n=0;n<named.length;n++)if(!str(named[n],80)||xAxis.indexOf(named[n])<0)return"annotation "+a+" names a label that is not on the x axis";
    }
  }
  if(s.panels!==undefined){
    if(!Array.isArray(s.panels)||s.panels.length<1||s.panels.length>12||s.labels===undefined)return"bad panels";
    for(var p=0;p<s.panels.length;p++){
      var pn=s.panels[p];
      if(!pn||!str(pn.title,80)||PANEL_TYPES.indexOf(pn.type)<0||!str(pn.units,40)||!Array.isArray(pn.series)||pn.series.length<1||pn.series.length>12)return"panel "+p+" is malformed";
      var pe=setError(pn.type,pn.units,pn.series,s.labels,"panel "+p+": ");
      if(pe)return pe;
    }
    var f=s.panels[0];
    if(s.type!==f.type||s.units!==f.units||JSON.stringify(s.series)!==JSON.stringify(f.series))return"the top level must equal the first panel";
  }
  if(s.coverageNote!==undefined&&!str(s.coverageNote,300))return"bad coverage note";
  if(s.note!==undefined&&!str(s.note,300))return"bad note";
  // the share fields (issue #216): shape only, the server parses the whole plan against the field catalog
  if(s.planHash!==undefined&&!(typeof s.planHash==="string"&&/^[0-9a-f]{64}$/.test(s.planHash)))return"bad chart code";
  if(s.dataStamp!==undefined&&!str(s.dataStamp,200))return"bad data stamp";
  if(s.plan!==undefined){var pe0=planError(s.plan);if(pe0)return pe0}
  return null;
}
// null when a shared plan has the shape the server parses (recipe, measures, dimensions, no reason), else one plain reason. Shape only: the server checks every id against the field catalog when it runs the plan.
function planError(pl){
  if(!pl||typeof pl!=="object"||Array.isArray(pl)||RECIPES.indexOf(pl.recipe)<0)return"bad plan";
  if(Object.prototype.hasOwnProperty.call(pl,"reason"))return"a shared plan carries no reason";
  if(!Array.isArray(pl.measures)||pl.measures.length<1||pl.measures.length>6||!Array.isArray(pl.dimensions)||pl.dimensions.length>4)return"bad plan";
  return null;
}
// The x axis of one set: its labels, else the labels of the first left-axis series (bar, line and the like), else every label any series has (heatmap, gantt and the other marks that do not share labels). Mirrors xAxisLabels in src/charts/spec.ts.
function xAxisLabels(type,series,labels){
  if(labels)return labels;
  if(SHARED.indexOf(type)>=0||SUBSET.indexOf(type)>=0){for(var i=0;i<series.length;i++)if(series[i].axis!=="right")return labelsOf(series[i]);return labelsOf(series[0])}
  var seen=[];series.forEach(function(r){r.points.forEach(function(p){if(seen.indexOf(p.label)<0)seen.push(p.label)})});return seen;
}
// The per-type data shape of the version 2 marks. Mirrors checkShape in src/charts/spec.ts.
function shapeError(s){
  var scatter=s.type==="scatter"||s.type==="connected_scatter",network=NETWORK.indexOf(s.type)>=0;
  for(var i=0;i<s.series.length;i++)for(var j=0;j<s.series[i].points.length;j++){
    var p=s.series[i].points[j];
    if(scatter&&p.x===undefined)return"a scatter point needs its horizontal position x";
    if(!scatter&&p.x!==undefined)return"x belongs to scatter points only";
    if(s.type!=="treemap"&&p.group!==undefined)return"group belongs to treemap points only";
    if((s.type==="stacked_100"||s.type==="treemap")&&p.value<0)return"a share of a whole or a cell size is never below zero";
  }
  if(s.xUnits!==undefined&&!str(s.xUnits,40))return"bad xUnits";
  if(scatter&&s.xUnits===undefined)return"a scatter says what its horizontal position counts";
  if(!scatter&&s.xUnits!==undefined)return"xUnits belongs to scatter only";
  if(s.type==="treemap"&&s.series.length!==1)return"a treemap draws one series";
  if(!network&&s.links!==undefined)return"links belong to arcs, bipartite and sankey only";
  if(network&&s.links===undefined)return s.type+" needs links";
  if(!network)return null;
  if(!Array.isArray(s.links)||s.links.length<1||s.links.length>200)return"bad links";
  var nodes=[];s.series.forEach(function(r){r.points.forEach(function(p){if(nodes.indexOf(p.label)<0)nodes.push(p.label)})});
  if(nodes.length>MAX_NODES)return"a network has at most "+MAX_NODES+" nodes";
  var from={};
  for(var k=0;k<s.links.length;k++){
    var l=s.links[k];
    if(!l||!str(l.source,80)||!str(l.target,80)||typeof l.value!=="number"||!isFinite(l.value)||l.value<0)return"link "+k+" is malformed";
    if(l.lower!==undefined&&(typeof l.lower!=="number"||!isFinite(l.lower))||l.upper!==undefined&&(typeof l.upper!=="number"||!isFinite(l.upper)))return"link "+k+" is malformed";
    if(nodes.indexOf(l.source)<0||nodes.indexOf(l.target)<0)return"a link joins two labels that are points of the series";
    if(l.source===l.target)return"a link joins two different nodes";
    if((l.lower===undefined)!==(l.upper===undefined))return"a link range needs both lower and upper";
    if(l.lower!==undefined&&l.lower>l.upper)return"a link has its lower value above its upper value";
    from[l.source]=true;
  }
  if(s.type==="bipartite"&&s.links.some(function(l){return from[l.target]}))return"in a bipartite network no node is both a source and a target";
  if(s.type==="sankey"&&hasCycle(s.links))return"sankey flows must not loop back on themselves";
  return null;
}
function hasCycle(links){
  var next={},state={};
  links.forEach(function(l){(next[l.source]=next[l.source]||[]).push(l.target)});
  function visit(n){if(state[n]===1)return true;if(state[n]===2)return false;state[n]=1;var m=next[n]||[];for(var i=0;i<m.length;i++)if(visit(m[i]))return true;state[n]=2;return false}
  return Object.keys(next).some(visit);
}
// Axis, units, label, gap and band rules for one set of series (the chart, or one panel); null when they hold. Mirrors checkSet in src/charts/spec.ts.
function setError(type,units,series,labels,where){
  var right=series.filter(function(r){return r.axis==="right"}),left=series.filter(function(r){return r.axis!=="right"});
  if(right.length&&!left.length)return where+"a right axis needs a left-axis series";
  if(right.length&&type!=="line")return where+"a right axis is drawn on line charts only";
  if(left.some(function(r){return r.unitsLabel!==undefined&&r.unitsLabel!==units}))return where+"a left-axis series is in the chart units";
  if(right.some(function(r){return r.unitsLabel===undefined||r.unitsLabel===units||r.unitsLabel!==right[0].unitsLabel}))return where+"the right axis needs one set of units of its own";
  var ref=xAxisLabels(type,series,labels),sharing=SHARED.indexOf(type)>=0||SUBSET.indexOf(type)>=0;
  for(var k=0;k<series.length;k++){
    var r=series[k],own=labelsOf(r),gaps=[];
    for(var g=0;g<(r.coverage||[]).length;g++)if(r.coverage[g].value===0)gaps.push(r.coverage[g].label);
    var filled=ref.filter(function(l){return own.indexOf(l)>=0||gaps.indexOf(l)>=0});
    var ok=!sharing||(SUBSET.indexOf(type)>=0?subset(own,ref):(own.join("\u0000")===ref.join("\u0000")||(gaps.length>0&&subset(own,ref)&&filled.length===ref.length)));
    if(!ok)return where+"series do not share their labels";
    for(var c=0;c<(r.coverage||[]).length;c++)if(ref.indexOf(r.coverage[c].label)<0)return where+"coverage names a label that is not on the x axis";
    if(r.band!==undefined){
      if(type==="stacked_bar"||type==="stacked_100")return where+"a band is not drawn on a stacked bar";
      for(var b=0;b<r.band.length;b++){if(r.band[b].lower>r.band[b].upper)return where+"a band has its lower value above its upper value";if(own.indexOf(r.band[b].label)<0)return where+"a band names a label the series does not have"}
    }
  }
  return null;
}
function grouped(n){return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,",")}
function fmtU(units,v){return/dollar/i.test(units)?(Math.abs(v)>=1e6?"$"+(v/1e6).toFixed(1)+" million":"$"+grouped(v)):grouped(v)}
function fmt(spec,v){return fmtU(spec.units,v)}
var MARKER_WORD={circle:"round markers",square:"square markers",diamond:"diamond markers",none:"no markers"};
// Non-colour cues for series that share a bar or area: a pattern fill per series index (the specification cannot carry one), named in the legend.
var PATTERN_WORD=["a solid fill","diagonal stripes","dots","crosshatch","horizontal stripes","vertical stripes","reverse diagonal stripes","large dots"];
var FAMILY={line:"line",area:"line",connected_scatter:"line",bar:"bar",stacked_bar:"bar",stacked_100:"bar",lollipop:"dot",scatter:"dot",beeswarm:"dot",dot_timeline:"dot",heatmap:"heatmap",gantt:"gantt",treemap:"treemap",ridgeline:"ridge",arcs:"network",bipartite:"network",sankey:"network"};
function look(r,k){var st=r.style||{};return{color:st.color?window.NAChartTheme.named(st.color):window.NAChartTheme.color(k),dash:st.dash||"solid",marker:st.marker||"circle"}}
// The legend line in words, so a reader never needs the colour: name, units, axis, then the dash and marker (lines), the pattern (bars), the marker (dots) or how the shape is read.
function keyWords(spec,r,k){
  var l=look(r,k),dual=spec.series.some(function(x){return x.axis==="right"}),head=r.name+" ("+unitsOf(spec,r)+(dual?", "+(r.axis==="right"?"right":"left")+" axis":"")+"): ",est=r.estimate?", an estimate":"",f=FAMILY[spec.type]||"line",t;
  if(f==="line")t=l.dash+" line with "+MARKER_WORD[l.marker]+(spec.type==="area"?", filled below":"")+(spec.type==="connected_scatter"?", joined in the order given":"");
  else if(f==="bar")t="bars with "+PATTERN_WORD[k%8];
  else if(f==="dot")t=(spec.type==="lollipop"?MARKER_WORD[l.marker==="none"?"circle":l.marker]+" on a "+l.dash+" stem":spec.type==="dot_timeline"?MARKER_WORD[l.marker==="none"?"circle":l.marker]+", larger for higher values":MARKER_WORD[l.marker==="none"?"circle":l.marker]+(spec.type==="beeswarm"?", one for each label":", not joined"));
  else if(f==="heatmap")t="a row of shaded cells, darker for higher values; hatching means no figure";
  else if(f==="gantt")t="bars for each period, thicker for higher values; hatching means no figure";
  else if(f==="treemap")t="rectangles, larger for higher values, each labelled";
  else if(f==="ridge")t="its own ridge, taller for higher values, all on one scale";
  else t="labelled points joined by links, wider for higher values";
  return head+t+est;
}
var d3p=null;
function loadD3(){
  if(window.d3)return Promise.resolve(window.d3);
  if(d3p)return d3p;
  d3p=new Promise(function(res,rej){
    var s=document.createElement("script");
    s.src=D3_URL;s.integrity=D3_SRI;s.crossOrigin="anonymous";s.referrerPolicy="no-referrer";
    s.onload=function(){res(window.d3)};
    s.onerror=function(){d3p=null;rej(new Error("D3 did not load"))};
    document.head.appendChild(s);
  });
  return d3p;
}
function lookup(r){var m={};r.points.forEach(function(p){m[p.label]=p.value});return m}
function bandOf(r,label){var b=r.band||[];for(var i=0;i<b.length;i++)if(b[i].label===label)return b[i];return null}
function covOf(r,label){var c=r.coverage||[];for(var i=0;i<c.length;i++)if(c[i].label===label)return c[i];return null}
// ---- One string per point, built once: the tooltip, the point's aria-label and the table cell all read it (issue #212). ----
// The value as the specification gives it, then its horizontal position (scatter), its range, the estimate flag and how much of the data is there.
function cellText(spec,r,p){
  var u=unitsOf(spec,r),t=fmtU(u,p.value),b=bandOf(r,p.label),c=covOf(r,p.label);
  if(spec.xUnits!==undefined&&p.x!==undefined)t+=", with "+fmtU(spec.xUnits,p.x)+" "+spec.xUnits;
  if(b)t+=" (range "+fmtU(u,b.lower)+" to "+fmtU(u,b.upper)+")";
  if(r.estimate)t+=" (estimate)";
  if(c&&c.value>0&&c.value<1)t+=" (based on "+Math.round(c.value*100)+" percent of the data)";
  return t;
}
function pointText(spec,r,p){return r.name+", "+p.label+(p.group!==undefined?" ("+p.group+")":"")+": "+cellText(spec,r,p)}
function gapText(r,label){return r.name+", "+label+": no figure"}
function linkValue(spec,l){return fmtU(spec.units,l.value)+(l.lower!==undefined?" (range "+fmtU(spec.units,l.lower)+" to "+fmtU(spec.units,l.upper)+")":"")}
function linkText(spec,l){return l.source+" to "+l.target+": "+linkValue(spec,l)}
// The sets a specification draws: its panels, or itself.
function setsOf(spec){return spec.panels?spec.panels.map(function(p){return{type:p.type,title:p.title,units:p.units,asOf:spec.asOf,version:2,labels:spec.labels,series:p.series}}):[spec]}
function rowLabels(set){return xAxisLabels(set.type,set.series,set.labels)}
function setTable(set,cap){
  var t=el("table","chart-tbl"),cp=el("caption",null,cap);t.appendChild(cp);
  var hr=el("tr");hr.appendChild(el("td"));
  set.series.forEach(function(s){var h=el("th",null,s.name+" ("+unitsOf(set,s)+")");h.scope="col";hr.appendChild(h)});
  var th=el("thead");th.appendChild(hr);t.appendChild(th);
  var tb=el("tbody"),maps=set.series.map(function(s){var m={};s.points.forEach(function(p){m[p.label]=p});return m});
  rowLabels(set).forEach(function(lab){
    var r=el("tr"),h=el("th",null,lab);h.scope="row";r.appendChild(h);
    set.series.forEach(function(s,k){var p=maps[k][lab];r.appendChild(el("td",null,p===undefined?"no figure":cellText(set,s,p)))});
    tb.appendChild(r);
  });
  t.appendChild(tb);return t;
}
function linksTable(spec){
  var t=el("table","chart-tbl chart-links"),hr=el("tr");t.appendChild(el("caption",null,"Links"));
  ["From","To","Value ("+spec.units+")"].forEach(function(x){var h=el("th",null,x);h.scope="col";hr.appendChild(h)});
  var th=el("thead");th.appendChild(hr);t.appendChild(th);
  var tb=el("tbody");
  spec.links.forEach(function(l){var r=el("tr");r.appendChild(el("td",null,l.source));r.appendChild(el("td",null,l.target));r.appendChild(el("td",null,linkValue(spec,l)));tb.appendChild(r)});
  t.appendChild(tb);return t;
}
// The hidden data table: one table (a v1 chart's is unchanged), one per panel for small multiples, plus the links of a network.
function table(spec){
  if(!spec.panels&&!spec.links)return setTable(spec,spec.title);
  var box=el("div","chart-tables");
  if(spec.panels)setsOf(spec).forEach(function(s){box.appendChild(setTable(s,s.title))});else box.appendChild(setTable(spec,spec.title));
  if(spec.links)box.appendChild(linksTable(spec));
  return box;
}
// One visually hidden list per series for screen readers (the picture itself is one image with the finding as its label).
function srList(spec){
  var ul=el("ul","sr-only"),v2=spec.version===2;
  setsOf(spec).forEach(function(set){
    set.series.forEach(function(s){
      var have={};s.points.forEach(function(p){have[p.label]=true});
      var miss=v2?rowLabels(set).filter(function(l){return!have[l]}):[];
      ul.appendChild(el("li",null,s.name+", in "+unitsOf(set,s)+": "+s.points.map(function(p){return p.label+" "+cellText(set,s,p)}).join("; ")+"."+(miss.length?" No figure for "+miss.join(", ")+".":"")));
    });
  });
  if(spec.links)ul.appendChild(el("li",null,"Links: "+spec.links.map(function(l){return linkText(spec,l)}).join("; ")+"."));
  (spec.annotations||[]).forEach(function(a,i){ul.appendChild(el("li",null,"Note "+(i+1)+": "+a.text))});
  return ul;
}
function legendEl(spec){
  var kl=el("ul","chart-legend chart-keyed");
  setsOf(spec).forEach(function(set){set.series.forEach(function(s,k){
    var l=look(s,k),li=el("li"),bars=FAMILY[spec.type]==="bar"||(spec.panels&&FAMILY[set.type]==="bar"),key=bars?el("span","chart-sw pat-"+(k%8)):el("span","chart-key dash-"+l.dash+" mark-"+l.marker);
    key.style.color=l.color;if(bars)key.style.backgroundColor=l.color;key.setAttribute("aria-hidden","true");
    li.appendChild(key);li.appendChild(document.createTextNode(" "+keyWords(set,s,k)));kl.appendChild(li);
  })});
  return kl;
}
// ---- Shared by every mark ----
function svgEl(tag,attrs,txt){var e=document.createElementNS(SVGNS,tag);for(var k in attrs)if(Object.prototype.hasOwnProperty.call(attrs,k)&&attrs[k]!=null)e.setAttribute(k,String(attrs[k]));if(txt!=null)e.textContent=txt;return e}
function r1(n){return Math.round(n*10)/10}
function hash(str){var h=5381;for(var i=0;i<str.length;i++)h=((h<<5)+h+str.charCodeAt(i))|0;return(h>>>0).toString(36)}
// A stable id prefix for one picture's patterns: the same chart gets the same ids on every run and every machine.
function uidOf(spec,part){return"c"+hash(spec.title+"|"+spec.type+"|"+(part||""))}
// The hatch for a gap and one pattern per series index, as SVG patterns inside one defs element.
function patternDefs(uid,series){
  var d=svgEl("defs",{}),gap=svgEl("pattern",{id:uid+"-gap",width:6,height:6,patternUnits:"userSpaceOnUse",patternTransform:"rotate(45)"});
  gap.appendChild(svgEl("line",{x1:0,y1:0,x2:0,y2:6,style:"stroke:var(--chart-muted);stroke-width:2"}));d.appendChild(gap);
  series.forEach(function(s,k){
    var p=svgEl("pattern",{id:uid+"-p"+k,width:8,height:8,patternUnits:"userSpaceOnUse"}),c=look(s,k).color,i=k%8,ov="stroke:var(--bg);stroke-width:1.6;fill:none";
    p.appendChild(svgEl("rect",{width:8,height:8,style:"fill:"+c}));
    if(i===1||i===3)p.appendChild(svgEl("path",{d:"M-1,9L9,-1",style:ov}));
    if(i===6||i===3)p.appendChild(svgEl("path",{d:"M-1,-1L9,9",style:ov}));
    if(i===4)p.appendChild(svgEl("path",{d:"M0,4H8",style:ov}));
    if(i===5)p.appendChild(svgEl("path",{d:"M4,0V8",style:ov}));
    if(i===2)p.appendChild(svgEl("circle",{cx:4,cy:4,r:1.4,style:"fill:var(--bg)"}));
    if(i===7)p.appendChild(svgEl("circle",{cx:4,cy:4,r:2.4,style:"fill:var(--bg)"}));
    d.appendChild(p);
  });
  return d;
}
// Make one drawn node a keyboard stop with the shared text as its label and its tooltip. With more than 80 points only the first is a tab stop (arrow keys move on).
function pt(node,text,o){
  var first=!o.seq;o.seq=(o.seq||0)+1;
  node.setAttribute("tabindex",(!o.rove||first)?"0":"-1");node.setAttribute("role","img");node.setAttribute("aria-label",text);
  node.appendChild(svgEl("title",{},text));return node;
}
// A marker of the series' shape at (px, py); sc scales it. At scale 1 these are the markers the line chart has always drawn.
function markerEl(kind,px,py,style,sc,cls){
  var a=4*sc,b=5.5*sc;
  if(kind==="square")return svgEl("rect",{x:r1(px-a),y:r1(py-a),width:r1(2*a),height:r1(2*a),style:style,"class":cls});
  if(kind==="diamond")return svgEl("path",{d:"M"+px+","+r1(py-b)+"L"+r1(px+b)+","+py+"L"+px+","+r1(py+b)+"L"+r1(px-b)+","+py+"Z",style:style,"class":cls});
  return svgEl("circle",{cx:px,cy:py,r:r1(a),style:style,"class":cls});
}
// A gap: hatching where a series has no figure, named, and a keyboard stop like any point.
function gapEl(uid,x,y,w,h,text,o){
  return pt(svgEl("rect",{x:r1(x),y:r1(y),width:r1(w),height:r1(h),"class":"chart-gap chart-pt",style:"fill:url(#"+uid+"-gap);stroke:var(--chart-muted);stroke-width:.5;stroke-dasharray:2 2"}),text,o);
}
// A range stays a range: a whisker from lower to upper at a position. dir "v" for a vertical whisker at x, "h" for a horizontal one at y.
function whisker(dir,pos,a,b){
  var g=svgEl("g",{"class":"chart-whisker","aria-hidden":"true"}),st="stroke:var(--chart-text);stroke-width:1.5";
  if(dir==="v"){g.appendChild(svgEl("line",{x1:r1(pos),x2:r1(pos),y1:r1(a),y2:r1(b),style:st}));g.appendChild(svgEl("line",{x1:r1(pos-4),x2:r1(pos+4),y1:r1(a),y2:r1(a),style:st}));g.appendChild(svgEl("line",{x1:r1(pos-4),x2:r1(pos+4),y1:r1(b),y2:r1(b),style:st}))}
  else{g.appendChild(svgEl("line",{x1:r1(a),x2:r1(b),y1:r1(pos),y2:r1(pos),style:st}));g.appendChild(svgEl("line",{x1:r1(a),x2:r1(a),y1:r1(pos-4),y2:r1(pos+4),style:st}));g.appendChild(svgEl("line",{x1:r1(b),x2:r1(b),y1:r1(pos-4),y2:r1(pos+4),style:st}))}
  return g;
}
// Labelled points, vertical rules, shaded bands and thresholds, each a numbered badge on the picture and the same number in the list under it.
// c: xOf(label) gives a centre or undefined, half is half a step, y is a value scale or null, iw and ih the plot size.
function annotate(g,spec,c){
  var ag=svgEl("g",{"class":"chart-annotations","aria-hidden":"true"}),sh="stroke:var(--chart-text);stroke-width:1.5;fill:none";
  g.appendChild(ag);
  (spec.annotations||[]).forEach(function(a,i){
    var bx,by,x0,x1,py;
    if(a.kind==="point"){x0=c.xOf(a.label);if(x0===undefined||!c.y)return;py=r1(c.y(a.value));ag.appendChild(svgEl("circle",{cx:r1(x0),cy:py,r:9,"class":"chart-note-shape",style:sh}));bx=x0;by=py-19}
    else if(a.kind==="rule"){x0=c.xOf(a.label);if(x0===undefined)return;ag.appendChild(svgEl("line",{x1:r1(x0),x2:r1(x0),y1:0,y2:r1(c.ih),"class":"chart-note-shape",style:sh+";stroke-dasharray:4 3"}));bx=x0;by=9}
    else if(a.kind==="band"){x0=c.xOf(a.from);x1=c.xOf(a.to);if(x0===undefined||x1===undefined)return;ag.appendChild(svgEl("rect",{x:r1(x0-c.half),y:0,width:r1(x1-x0+2*c.half),height:r1(c.ih),"class":"chart-note-shape",style:"fill:var(--chart-muted);fill-opacity:.14"}));bx=x0-c.half+10;by=9}
    else{if(!c.y)return;py=r1(c.y(a.value));ag.appendChild(svgEl("line",{x1:0,x2:r1(c.iw),y1:py,y2:py,"class":"chart-note-shape",style:sh+";stroke-dasharray:4 3"}));bx=c.iw-10;by=py-10}
    bx=Math.max(9,Math.min(c.iw-9,r1(bx)));by=Math.max(9,r1(by));
    var b=svgEl("g",{"class":"chart-note"});
    b.appendChild(svgEl("circle",{cx:bx,cy:by,r:8,style:"fill:var(--chart-text)"}));
    b.appendChild(svgEl("text",{x:bx,y:by,dy:"0.35em","text-anchor":"middle",style:"fill:var(--bg);font-size:10px;font-weight:700"},String(i+1)));
    ag.appendChild(b);
  });
}
// ---- One shared tick grid for two value axes (principal, issue #190 follow-up): both axes from zero, K intervals, tick i at the same height on both. ----
var NICE=[1,2,2.5,5,10];
// the smallest step from {1, 2, 2.5, 5, 10} x 10^n with step*k >= max; a count of people never gets a fractional step
function niceStep(max,k,integer){
  if(!(max>0))return 1;
  var p=Math.pow(10,Math.floor(Math.log10(max/k)));
  for(var e=0;e<3;e++)for(var i=0;i<NICE.length;i++){var s=+(NICE[i]*p*Math.pow(10,e)).toPrecision(12);if(integer&&Math.round(s)!==s)continue;if(s*k>=max)return s}
  return +(p*1000).toPrecision(12);
}
// K and one step per axis. K (4 or 5) is the one with the lowest total blank fraction over both axes (the sum of 1 - max/(step*K));
// on a tie, the K whose worst axis wastes no more than 40 percent of the height wins, then K = 4. k4 (a short plot, under 150 pixels high) fixes K at 4.
function alignedAxes(maxL,maxR,o){
  o=o||{};
  var fit=function(k){var l=niceStep(maxL,k,o.intL),r=niceStep(maxR,k,o.intR),wl=maxL>0?1-maxL/(l*k):0,wr=maxR>0?1-maxR/(r*k):0;return{k:k,left:l,right:r,waste:Math.max(wl,wr),total:wl+wr}};
  if(o.k4)return fit(4);
  var a=fit(4),b=fit(5);
  if(Math.abs(a.total-b.total)>1e-9)return a.total<b.total?a:b;
  if((a.waste>0.4)!==(b.waste>0.4))return a.waste>0.4?b:a;
  return a;
}
function maxValue(ss){var m=0;ss.forEach(function(s){s.points.forEach(function(p){if(p.value>m)m=p.value})});return m}
function hasNegative(spec){return spec.series.some(function(s){return s.points.some(function(p){return p.value<0})})}
var FALLBACK_NOTE="Some values are below zero, so the two measures are drawn in separate panels, each with its own scale.";
// Contiguous runs of drawn positions (null breaks a run), each a list of {i, p}.
function runsOf(pts){var out=[],cur=null;pts.forEach(function(p,i){if(p===null){cur=null;return}if(!cur){cur=[];out.push(cur)}cur.push({i:i,p:p})});return out}
function polyPath(top,bottom){return"M"+top.map(function(p){return p.join(",")}).join("L")+"L"+bottom.slice().reverse().map(function(p){return p.join(",")}).join("L")+"Z"}
// A line chart with an optional right axis (issue #190), or an area chart. Both axes start at zero and share one set of tick heights (alignedAxes): the gridlines are drawn
// once, from the left axis, and the right axis is labelled at the same heights. D3 provides the point scale and the line paths; the elements are made
// directly so the same function runs under a test DOM. o.width: the picture width in pixels (the layout is a pure function of it, T.layoutBox); o.height: a fixed height (a plot under 150 pixels high gets K = 4). A two-axis spec with a value below zero draws two stacked panels instead.
// A version 2 spec also gets keyboard stops, ranges as bands, estimates drawn hollow, gaps named, annotations and (area) a fill; a version 1 spec is drawn exactly as before.
function lineSvg(d3,spec,o){
  o=o||{};
  var right=spec.series.filter(function(s){return s.axis==="right"});
  if(right.length&&hasNegative(spec))return panelsSvg(d3,spec,o);
  var v2=spec.version===2,T=window.NAChartTheme,ref=rowLabels(spec);
  var left=spec.series.filter(function(s){return s.axis!=="right"});
  var rUnits=right.length?unitsOf(spec,right[0]):null;
  var count=function(u){return!/dollar/i.test(u)};
  // the plot height does not depend on the margins, so the tick count K can be chosen before the margins (which depend on the tick labels)
  var W0=T.widthOf(o.width||T.defaultWidth),B0=T.layoutBox(W0,"dual",{top:18,slim:true}),H=o.height||B0.H,k4=H-B0.m.top-B0.m.bottom<150;
  var ax=right.length?alignedAxes(maxValue(left),maxValue(right),{k4:k4,intL:count(spec.units),intR:count(rUnits)}):alignedAxes(maxValue(left),0,{k4:k4,intL:count(spec.units)});
  var K=ax.k,widest=function(units,step){var n=0;for(var q=0;q<=K;q++)n=Math.max(n,T.axisFormat(units,+(step*q).toPrecision(12)).length);return n};
  var leftTitle=left.map(function(s){return s.name}).join(", ")+" ("+spec.units+")"+(right.length?", left axis":""),rightTitle=right.length?right.map(function(s){return s.name}).join(", ")+" ("+rUnits+"), right axis":"";
  // two axis titles that would meet on one line are stacked, the left one above
  var stack=right.length>0&&T.textWidth(leftTitle)+T.textWidth(rightTitle)+24>W0-8;
  var D=T.layoutBox(W0,"dual",{top:18+(stack?14:0),leftChars:widest(spec.units,ax.left),rightChars:right.length?widest(rUnits,ax.right):0,slim:true}),W=D.W,m=D.m,iw=D.iw,ih=H-m.top-m.bottom;
  var yL=d3.scaleLinear().domain([0,ax.left*K]).range([ih,0]),yR=right.length?d3.scaleLinear().domain([0,ax.right*K]).range([ih,0]):null;
  if(!right.length)ax={k:K,left:ax.left,right:null};
  var x=d3.scalePoint().domain(ref).range([0,iw]).padding(.5);
  var svg=svgEl("svg",{viewBox:"0 0 "+W+" "+H,width:"100%",role:v2?"group":"img","aria-label":o.label||spec.title,"class":"chart-svg",style:"height:auto"});
  var uid=uidOf(spec,o.part);
  if(v2)svg.appendChild(patternDefs(uid,spec.series));
  var g=svgEl("g",{transform:"translate("+m.left+","+m.top+")"});svg.appendChild(g);
  var tickStyle="fill:"+T.muted+";font-size:"+T.fontSize+"px";
  var axes=svgEl("g",{"class":"chart-axes","aria-hidden":"true"});g.appendChild(axes);
  for(var i=0;i<=K;i++){
    var py=r1(ih-(ih*i)/K);
    axes.appendChild(svgEl("line",{x1:0,x2:iw,y1:py,y2:py,"class":"chart-grid",style:"stroke:"+(i===0?T.muted:T.grid)}));
    axes.appendChild(svgEl("text",{x:-8,y:py,dy:"0.32em","text-anchor":"end","class":"chart-tick-left",style:tickStyle},T.axisFormat(spec.units,+(ax.left*i).toPrecision(12))));
    if(yR)axes.appendChild(svgEl("text",{x:iw+8,y:py,dy:"0.32em","text-anchor":"start","class":"chart-tick-right",style:tickStyle},T.axisFormat(rUnits,+(ax.right*i).toPrecision(12))));
  }
  if(o.xLabels!==false)T.fitTicks(ref.map(function(l){return{label:l,x:x(l)}})).ticks.forEach(function(t){axes.appendChild(svgEl("text",{x:r1(t.x),y:ih+20,"text-anchor":"middle","class":v2?"chart-xtick":null,style:tickStyle},t.text))});
  var titleStyle="fill:"+T.text+";font-size:"+T.fontSize+"px;font-weight:600";
  axes.appendChild(svgEl("text",{x:-m.left+4,y:stack?-28:-14,"text-anchor":"start",style:titleStyle,"class":"chart-axis-title"},leftTitle));
  if(right.length)axes.appendChild(svgEl("text",{x:iw+m.right-4,y:-14,"text-anchor":"end",style:titleStyle,"class":"chart-axis-title"},rightTitle));
  var ends=[],c=v2?{spec:spec,o:o,uid:uid,ih:ih,half:ref.length>1?(x(ref[1])-x(ref[0]))/2:iw/2,fill:spec.type==="area"}:null;
  spec.series.forEach(function(s,k){
    var y=s.axis==="right"?yR:yL,l=look(s,k),u=unitsOf(spec,s);
    drawSeries(d3,g,s,l,u,ref,x,y,ends,c);
  });
  endLabels(g,ends,T);
  if(v2&&spec.annotations&&!o.noNotes)annotate(g,spec,{xOf:function(l){return ref.indexOf(l)<0?undefined:x(l)},half:c.half,y:yL,iw:iw,ih:ih});
  return svg;
}
function drawSeries(d3,g,s,l,u,ref,x,y,ends,c){
  var vals=lookup(s);
  var pts=ref.map(function(lab){return vals[lab]===undefined?null:[r1(x(lab)),r1(y(vals[lab]))]});
  var gs=svgEl("g",{"class":"chart-series"});g.appendChild(gs);
  var hollow=!!(c&&s.estimate);
  if(c){
    // a range as a band; an area as a fill down to zero
    var top=ref.map(function(lab){var b=bandOf(s,lab);return b?[r1(x(lab)),r1(y(b.upper))]:null}),low=ref.map(function(lab){var b=bandOf(s,lab);return b?[r1(x(lab)),r1(y(b.lower))]:null});
    runsOf(top).forEach(function(run){gs.appendChild(svgEl("path",{d:polyPath(run.map(function(e){return e.p}),run.map(function(e){return low[e.i]})),"class":"chart-band",style:"fill:"+l.color+";fill-opacity:.18;stroke:none","aria-hidden":"true"}))});
    if(c.fill)runsOf(pts).forEach(function(run){var base=run.map(function(e){return[e.p[0],r1(y(0))]});gs.appendChild(svgEl("path",{d:polyPath(run.map(function(e){return e.p}),base),"class":"chart-area",style:"fill:"+l.color+";fill-opacity:.22;stroke:none","aria-hidden":"true"}))});
  }
  gs.appendChild(svgEl("path",{d:d3.line().defined(function(p){return p!==null})(pts),fill:"none","stroke-width":2.5,"stroke-linejoin":"round",style:"stroke:"+l.color+(window.NAChartTheme.dash[l.dash]?";stroke-dasharray:"+window.NAChartTheme.dash[l.dash]:"")+(hollow?";stroke-opacity:.8":"")}));
  s.points.forEach(function(p){
    var px=r1(x(p.label)),py=r1(y(p.value)),cv=c&&covOf(s,p.label),fill="fill:"+l.color+";stroke:var(--bg);stroke-width:1",mk;
    if(hollow||(cv&&cv.value<1))fill="fill:var(--bg);stroke:"+l.color+";stroke-width:2"+(cv&&cv.value<1?";stroke-dasharray:2 2":"");
    if(l.marker==="none"&&!c)return;
    mk=markerEl(l.marker==="none"?"circle":l.marker,px,py,l.marker==="none"?"fill:transparent":fill,1,c?"chart-pt":null);
    if(c)pt(mk,pointText(c.spec,s,p),c.o);else mk.appendChild(svgEl("title",{},s.name+", "+p.label+": "+fmtU(u,p.value)));
    gs.appendChild(mk);
  });
  if(c)ref.forEach(function(lab){if(vals[lab]===undefined)gs.appendChild(gapEl(c.uid,x(lab)-c.half*.45,0,c.half*.9,c.ih,gapText(s,lab),c.o))});
  var last=s.points[s.points.length-1];
  ends.push({color:l.color,x:r1(x(last.label)),y:r1(y(last.value)),text:s.name+" "+window.NAChartTheme.shortFormat(u,last.value)});
}
// direct end labels: above the higher line's last point, below the lower one's, never on top of each other
function endLabels(g,ends,T){
  ends.sort(function(a,b){return a.y-b.y});
  ends.forEach(function(e,i){
    var ly=i===0?e.y-10:Math.max(e.y+18,ends[i-1].ly+14);e.ly=ly;
    g.appendChild(svgEl("text",{x:e.x,y:r1(ly),"text-anchor":"end","class":"chart-end",style:"fill:"+e.color+";font-size:"+T.fontSize+"px;font-weight:600"},e.text));
  });
}
// The fallback for a two-axis spec with a value below zero: one panel per axis group, stacked, each with its own nice scale through zero, and a line saying so.
function panelsSvg(d3,spec,o){
  o=o||{};
  var T=window.NAChartTheme,ph=130,gap=44,top=40;
  var groups=[spec.series.filter(function(s){return s.axis!=="right"}),spec.series.filter(function(s){return s.axis==="right"})];
  // each panel's scale first: the margin at the left comes from the widest tick label of either panel
  var scales=groups.map(function(ss){
    var u=unitsOf(spec,ss[0]),lo=0,hi=0;
    ss.forEach(function(s){s.points.forEach(function(p){if(p.value<lo)lo=p.value;if(p.value>hi)hi=p.value})});
    var st=niceStep(hi-lo||1,4,!/dollar/i.test(u)),a=Math.floor(lo/st)*st,b=Math.ceil(hi/st)*st;if(a===b)b=a+st;
    var ticks=[];for(var t=a;t<=b+st/2;t+=st)ticks.push(+t.toPrecision(12));
    return{u:u,a:a,b:b,ticks:ticks};
  });
  var chars=0;scales.forEach(function(sc){sc.ticks.forEach(function(v){chars=Math.max(chars,T.axisFormat(sc.u,v).length)})});
  var D=T.layoutBox(o.width||T.defaultWidth,"plot",{leftChars:chars}),W=D.W,m=D.m,iw=D.iw;
  var ref=labelsOf(refSeries(spec)),x=d3.scalePoint().domain(ref).range([0,iw]).padding(.5);
  var H=top+2*ph+gap+34;
  var svg=svgEl("svg",{viewBox:"0 0 "+W+" "+H,width:"100%",role:"img","aria-label":spec.title+". "+FALLBACK_NOTE,"class":"chart-svg chart-panels",style:"height:auto"});
  svg.appendChild(svgEl("text",{x:4,y:14,"class":"chart-fallback",style:"fill:"+T.muted+";font-size:"+T.fontSize+"px"},FALLBACK_NOTE));
  var tickStyle="fill:"+T.muted+";font-size:"+T.fontSize+"px",k0=0;
  groups.forEach(function(ss,gi){
    var sc=scales[gi],u=sc.u;
    var y=d3.scaleLinear().domain([sc.a,sc.b]).range([ph,0]);
    var g=svgEl("g",{transform:"translate("+m.left+","+(top+gi*(ph+gap))+")","class":"chart-panel"});svg.appendChild(g);
    var axes=svgEl("g",{"class":"chart-axes","aria-hidden":"true"});g.appendChild(axes);
    sc.ticks.forEach(function(v){var py=r1(y(v));axes.appendChild(svgEl("line",{x1:0,x2:iw,y1:py,y2:py,"class":"chart-grid",style:"stroke:"+(v===0?T.muted:T.grid)}));axes.appendChild(svgEl("text",{x:-8,y:py,dy:"0.32em","text-anchor":"end",style:tickStyle},T.axisFormat(u,v)))});
    axes.appendChild(svgEl("text",{x:-m.left+4,y:-8,"text-anchor":"start","class":"chart-axis-title",style:"fill:"+T.text+";font-size:"+T.fontSize+"px;font-weight:600"},ss.map(function(s){return s.name}).join(", ")+" ("+u+")"));
    if(gi===1)T.fitTicks(ref.map(function(l){return{label:l,x:x(l)}})).ticks.forEach(function(t){axes.appendChild(svgEl("text",{x:r1(t.x),y:ph+20,"text-anchor":"middle",style:tickStyle},t.text))});
    var ends=[];
    ss.forEach(function(s){drawSeries(d3,g,s,look(s,k0),u,ref,x,y,ends);k0++});
    endLabels(g,ends,T);
  });
  return svg;
}
// Types a console written before this one can draw; a spec of any other type, or any v2 field, is a "marks" spec: keyed legend, numbered notes, keyboard stops.
function marked(spec){return V1_TYPES.indexOf(spec.type)<0||spec.version===2}
// What the picture is drawn into: tip text on hover and on keyboard focus, and arrow keys between points.
function wireTip(plot,tip){
  if(!plot.addEventListener)return;
  function show(e){var t=e.target,lab=t&&t.getAttribute?t.getAttribute("aria-label"):null,cl=t&&t.getAttribute?(t.getAttribute("class")||""):"";if(lab&&(" "+cl+" ").indexOf(" chart-pt ")>=0)tip.textContent=lab}
  function clear(){tip.textContent=""}
  plot.addEventListener("focusin",show);plot.addEventListener("mouseover",show);plot.addEventListener("focusout",clear);plot.addEventListener("mouseout",clear);
  plot.addEventListener("keydown",function(e){
    var d=(e.key==="ArrowRight"||e.key==="ArrowDown")?1:(e.key==="ArrowLeft"||e.key==="ArrowUp")?-1:0;
    if(!d||!plot.querySelectorAll)return;
    var list=[].slice.call(plot.querySelectorAll(".chart-pt")),i=list.indexOf(e.target);
    if(i<0||!list[i+d])return;
    e.preventDefault();list[i+d].focus();
  });
}
// width: the picture's width in pixels, the container's measured width unless the caller says (a saved picture is laid out at its own width); an unmeasured container gets the default.
function widthOfHost(host,o){return window.NAChartTheme.widthOf((o&&o.width)||host.clientWidth||0)}
function draw(d3,host,spec,o){
  var width=widthOfHost(host,o);
  if(spec.type==="line"&&!spec.panels)return host.appendChild(lineSvg(d3,spec,{width:width,rove:total(spec)>80}));
  if(!window.NAChartMarks)throw new Error("chart-marks.js did not load");
  return window.NAChartMarks.draw(d3,host,spec,{width:width});
}
function total(spec){return setsOf(spec).reduce(function(n,s){return n+s.series.reduce(function(m,r){return m+r.points.length},0)},0)}
// ---- The note lines under every chart, built once: the screen, the picture's caption, the SVG description and the CSV header all read them (issue #216). ----
// Why a figure is missing: coverage 0 means the data has nothing there; any other missing label was not reported.
function gapReason(r,label){var c=covOf(r,label);return c&&c.value===0?"no data":"not reported"}
function sourcesOf(spec){var seen={},out=[];spec.series.forEach(function(r){if(!seen[r.source.url]){seen[r.source.url]=true;out.push(r.source)}});return out}
// The source and as-of line (with the basis), then the coverage note, then one line per range, per gap and per partly covered series.
function noteLines(spec){
  var src=sourcesOf(spec),lines=["Source"+(src.length>1?"s":"")+": "+src.map(function(x){return x.label}).join("; ")+", as of "+spec.asOf+"."+(spec.note?" "+spec.note:"")];
  if(spec.coverageNote)lines.push(spec.coverageNote);
  if(spec.version!==2)return lines;
  setsOf(spec).forEach(function(set){set.series.forEach(function(r){
    var u=unitsOf(set,r),have={},miss,part=[];
    if(r.band&&r.band.length){var lo=r.band[0].lower,hi=r.band[0].upper;r.band.forEach(function(b){if(b.lower<lo)lo=b.lower;if(b.upper>hi)hi=b.upper});lines.push("Range: "+r.name+" is shown as a range, from "+fmtU(u,lo)+" to "+fmtU(u,hi)+".")}
    r.points.forEach(function(p){have[p.label]=true});
    miss=rowLabels(set).filter(function(l){return!have[l]});
    if(miss.length)lines.push(r.name+": no figure for "+miss.map(function(l){return l+" ("+gapReason(r,l)+")"}).join(", ")+".");
    (r.coverage||[]).forEach(function(c){if(c.value>0&&c.value<1)part.push(c.label+" ("+Math.round(c.value*100)+" percent)")});
    if(part.length)lines.push(r.name+": based on part of the data in "+part.join(", ")+".");
  })});
  return lines;
}
// The picture follows its container (issue #226): when the container's width changes by 2 pixels or more it is cleared and laid out again at the new width, after the resizing has paused for 150 ms,
// so dragging a window edge draws once, not on every pixel. The height is held while the new picture is built so nothing below it jumps. Text stays 12 pixels at every width.
function watch(d3,plot,spec){
  if(typeof ResizeObserver!=="function"||!plot.removeChild)return;
  var last=widthOfHost(plot),timer=null,turn=0;
  var ro=new ResizeObserver(function(){
    clearTimeout(timer);
    timer=setTimeout(function(){
      if(plot.isConnected===false){ro.disconnect();return}
      var w=plot.clientWidth;
      if(!w||Math.abs(w-last)<2)return;
      last=w;var mine=++turn;
      plot.style.minHeight=plot.offsetHeight+"px";
      while(plot.firstChild)plot.removeChild(plot.firstChild);
      var release=function(){if(mine===turn)plot.style.minHeight=""};
      try{Promise.resolve(draw(d3,plot,spec,{width:w})).then(release,release)}catch(e){release();plot.textContent="The picture could not load, so the numbers are in the table below."}
    },150);
  });
  ro.observe(plot);
}
// Builds the figure at once (title, plot area, legend, numbers table, source) and draws the picture when D3 arrives; if D3 cannot load the table stays and opens.
function render(spec){
  var bad=check(spec);
  if(bad){if(window.console)console.warn("chart refused: "+bad);return el("p","meta chart-err","The chart could not be shown. The numbers are in the written answer.")}
  var fig=el("figure","chart"),keyed=styled(spec)||marked(spec);
  fig.appendChild(el("figcaption","chart-title",spec.title));
  var plot=el("div","chart-plot");fig.appendChild(plot);
  var tip=el("p","chart-tip");tip.setAttribute("aria-hidden","true");fig.appendChild(tip);wireTip(plot,tip);
  if(keyed){
    fig.appendChild(legendEl(spec));
    fig.appendChild(srList(spec));
  }else if(spec.series.length>1){
    var lg=el("ul","chart-legend");
    spec.series.forEach(function(s,k){var li=el("li");var sw=el("span","chart-sw"+(FAMILY[spec.type]==="bar"?" pat-"+(k%8):""));sw.style.backgroundColor=window.NAChartTheme.color(k);sw.setAttribute("aria-hidden","true");li.appendChild(sw);li.appendChild(document.createTextNode(" "+s.name));lg.appendChild(li)});
    fig.appendChild(lg);
  }
  if(spec.annotations&&spec.annotations.length){var ol=el("ol","chart-notes");spec.annotations.forEach(function(a){ol.appendChild(el("li",null,a.text))});fig.appendChild(ol)}
  var notes=noteLines(spec);
  if(spec.coverageNote)fig.appendChild(el("p","meta chart-cov",spec.coverageNote));
  var det=el("details","chart-numbers");det.appendChild(el("summary",null,"View the numbers"));det.appendChild(table(spec));fig.appendChild(det);
  var srcs=sourcesOf(spec),sp=el("p","meta chart-src");
  sp.appendChild(document.createTextNode("Source"+(srcs.length>1?"s":"")+": "));
  srcs.forEach(function(x,i){
    if(i)sp.appendChild(document.createTextNode("; "));
    var a=el("a",null,x.label);a.href=x.url;a.target="_blank";a.rel="noopener noreferrer";sp.appendChild(a);
  });
  sp.appendChild(document.createTextNode(notes[0].slice(notes[0].indexOf(", as of "+spec.asOf+"."))));
  fig.appendChild(sp);
  notes.slice(spec.coverageNote?2:1).forEach(function(line){fig.appendChild(el("p","meta chart-extra",line))});
  if(window.NAChartExport&&window.NAChartExport.mount)window.NAChartExport.mount(fig,spec);
  loadD3().then(function(d3){var first=draw(d3,plot,spec);watch(d3,plot,spec);return first}).catch(function(){plot.textContent="The picture could not load, so the numbers are in the table below.";det.open=true});
  return fig;
}
window.NAChart={check:check,planError:planError,noteLines:noteLines,gapReason:gapReason,sourcesOf:sourcesOf,render:render,format:fmt,lineSvg:lineSvg,draw:draw,loadD3:loadD3,keyWords:keyWords,alignedAxes:alignedAxes,niceStep:niceStep,
  svgEl:svgEl,el:el,look:look,table:table,srList:srList,endLabels:endLabels,fmtU:fmtU,unitsOf:unitsOf,xAxisLabels:xAxisLabels,lookup:lookup,r1:r1,labelsOf:labelsOf,
  cellText:cellText,pointText:pointText,gapText:gapText,linkText:linkText,linkValue:linkValue,setsOf:setsOf,pt:pt,markerEl:markerEl,gapEl:gapEl,whisker:whisker,annotate:annotate,
  patternDefs:patternDefs,uidOf:uidOf,bandOf:bandOf,covOf:covOf,PATTERN_WORD:PATTERN_WORD,FAMILY:FAMILY,total:total};
})();
