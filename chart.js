// Draws the chart addendum the server sends in structuredContent.chart (spec: src/charts/spec.ts on the server). check() mirrors the server's schema as a shape check, so a malformed chart is refused here too; the table under every chart is the accessible version and works without D3.
(function(){
var D3_URL="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
var D3_SRI="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i";
var TYPES=["bar","line","stacked_bar"],AXES=["left","right"],COLORS=["green","red","blue","orange","gray"],DASHES=["solid","dashed","dotted"],MARKERS=["circle","square","diamond","none"];
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
  if(!str(s.title,200)||!str(s.units,40))return"missing title or units";
  if(typeof s.asOf!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(s.asOf))return"bad as-of date";
  if(!Array.isArray(s.series)||s.series.length<1||s.series.length>8)return"bad series list";
  for(var i=0;i<s.series.length;i++){
    var r=s.series[i];
    if(!r||!str(r.name,80)||!r.source||!str(r.source.label,120)||!https(r.source.url))return"series "+i+" has no name or source link";
    if(!Array.isArray(r.points)||r.points.length<1||r.points.length>60)return"series "+i+" has no points";
    for(var j=0;j<r.points.length;j++){var p=r.points[j];if(!p||!str(p.label,80)||typeof p.value!=="number"||!isFinite(p.value))return"series "+i+" has a bad point"}
    if(!oneOf(r.axis,AXES))return"series "+i+" has an unknown axis";
    if(r.unitsLabel!==undefined&&!str(r.unitsLabel,40))return"series "+i+" has bad units";
    if(r.style!==undefined&&(!r.style||typeof r.style!=="object"||!oneOf(r.style.color,COLORS)||!oneOf(r.style.dash,DASHES)||!oneOf(r.style.marker,MARKERS)))return"series "+i+" has a bad style";
  }
  var right=s.series.filter(function(r){return r.axis==="right"}),left=s.series.filter(function(r){return r.axis!=="right"});
  if(right.length&&!left.length)return"a right axis needs a left-axis series";
  if(right.length&&s.type!=="line")return"a right axis is drawn on line charts only";
  if(left.some(function(r){return r.unitsLabel!==undefined&&r.unitsLabel!==s.units}))return"a left-axis series is in the chart units";
  if(right.some(function(r){return r.unitsLabel===undefined||r.unitsLabel===s.units||r.unitsLabel!==right[0].unitsLabel}))return"the right axis needs one set of units of its own";
  var ref=labelsOf(refSeries(s));
  for(var k=0;k<s.series.length;k++){
    var own=labelsOf(s.series[k]);
    if(s.type==="line"?!subset(own,ref):own.join("\u0000")!==ref.join("\u0000"))return"series do not share their labels";
  }
  if(s.note!==undefined&&!str(s.note,300))return"bad note";
  return null;
}
function grouped(n){return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,",")}
function fmtU(units,v){return/dollar/i.test(units)?(Math.abs(v)>=1e6?"$"+(v/1e6).toFixed(1)+" million":"$"+grouped(v)):grouped(v)}
function fmt(spec,v){return fmtU(spec.units,v)}
var MARKER_WORD={circle:"round markers",square:"square markers",diamond:"diamond markers",none:"no markers"};
function look(r,k){var st=r.style||{};return{color:st.color?window.NAChartTheme.named(st.color):window.NAChartTheme.color(k),dash:st.dash||"solid",marker:st.marker||"circle"}}
// The legend line in words, so a reader never needs the colour: name, units, axis, dash and marker.
function keyWords(spec,r,k){var l=look(r,k),dual=spec.series.some(function(x){return x.axis==="right"});return r.name+" ("+unitsOf(spec,r)+(dual?", "+(r.axis==="right"?"right":"left")+" axis":"")+"): "+l.dash+" line with "+MARKER_WORD[l.marker]}
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
function table(spec){
  var t=el("table","chart-tbl"),cap=el("caption",null,spec.title);t.appendChild(cap);
  var hr=el("tr");hr.appendChild(el("td"));
  spec.series.forEach(function(s){var h=el("th",null,s.name+" ("+unitsOf(spec,s)+")");h.scope="col";hr.appendChild(h)});
  var th=el("thead");th.appendChild(hr);t.appendChild(th);
  var tb=el("tbody"),maps=spec.series.map(lookup);
  refSeries(spec).points.forEach(function(p){
    var r=el("tr"),h=el("th",null,p.label);h.scope="row";r.appendChild(h);
    spec.series.forEach(function(s,k){var v=maps[k][p.label];r.appendChild(el("td",null,v===undefined?"no figure":fmtU(unitsOf(spec,s),v)))});
    tb.appendChild(r);
  });
  t.appendChild(tb);return t;
}
// One visually hidden list per series for screen readers (the picture itself is one image with the finding as its label).
function srList(spec){
  var ul=el("ul","sr-only");
  spec.series.forEach(function(s){ul.appendChild(el("li",null,s.name+", in "+unitsOf(spec,s)+": "+s.points.map(function(p){return p.label+" "+fmtU(unitsOf(spec,s),p.value)}).join("; ")+"."))});
  return ul;
}
function draw(d3,host,spec){
  if(spec.type==="line"&&styled(spec)){host.appendChild(lineSvg(d3,spec,{narrow:host.clientWidth>0&&host.clientWidth<480}));return}
  var T=window.NAChartTheme,W=T.width,H=T.height,m=T.margin,iw=W-m.left-m.right,ih=H-m.top-m.bottom;
  var labels=spec.series[0].points.map(function(p){return p.label});
  var stacked=spec.type==="stacked_bar",line=spec.type==="line";
  var tops=labels.map(function(_,i){return stacked?d3.sum(spec.series,function(s){return s.points[i].value}):d3.max(spec.series,function(s){return s.points[i].value})});
  var y=d3.scaleLinear().domain([0,d3.max(tops)||1]).nice().range([ih,0]);
  var x=line?d3.scalePoint().domain(labels).range([0,iw]).padding(.5):d3.scaleBand().domain(labels).range([0,iw]).padding(.2);
  var svg=d3.select(host).append("svg").attr("viewBox","0 0 "+W+" "+H).attr("width","100%").attr("role","img").attr("aria-label",spec.title).style("max-width",W+"px").style("height","auto");
  var g=svg.append("g").attr("transform","translate("+m.left+","+m.top+")");
  var fy=T.tickFormat(d3,spec.units);
  T.styleAxis(g.append("g").call(d3.axisLeft(y).ticks(5).tickSize(-iw).tickFormat(fy)).call(function(a){a.select(".domain").remove()}));
  T.styleAxis(g.append("g").attr("transform","translate(0,"+ih+")").call(d3.axisBottom(x).tickValues(T.tickLabels(labels)).tickSizeOuter(0)));
  if(line){
    spec.series.forEach(function(s,k){
      var pts=s.points.map(function(p){return[x(p.label),y(p.value)]});
      g.append("path").attr("d",d3.line()(pts)).attr("fill","none").style("stroke",T.color(k)).attr("stroke-width",2.5);
      g.selectAll(null).data(pts).enter().append("circle").attr("cx",function(p){return p[0]}).attr("cy",function(p){return p[1]}).attr("r",3.5).style("fill",T.color(k));
    });
  }else{
    var base=labels.map(function(){return 0}),bw=x.bandwidth()/(stacked?1:spec.series.length);
    spec.series.forEach(function(s,k){
      g.selectAll(null).data(s.points).enter().append("rect")
        .attr("x",function(p){return x(p.label)+(stacked?0:k*bw)})
        .attr("width",bw)
        .attr("y",function(p,i){return y(p.value+(stacked?base[i]:0))})
        .attr("height",function(p){return ih-y(p.value)})
        .attr("rx",T.radius).style("fill",T.color(k));
      if(stacked)s.points.forEach(function(p,i){base[i]+=p.value});
    });
  }
}
function svgEl(tag,attrs,txt){var e=document.createElementNS(SVGNS,tag);for(var k in attrs)if(Object.prototype.hasOwnProperty.call(attrs,k)&&attrs[k]!=null)e.setAttribute(k,String(attrs[k]));if(txt!=null)e.textContent=txt;return e}
function r1(n){return Math.round(n*10)/10}
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
// on a tie, the K whose worst axis wastes no more than 40 percent of the height wins, then K = 4. narrow (phone width) fixes K at 4.
function alignedAxes(maxL,maxR,o){
  o=o||{};
  var fit=function(k){var l=niceStep(maxL,k,o.intL),r=niceStep(maxR,k,o.intR),wl=maxL>0?1-maxL/(l*k):0,wr=maxR>0?1-maxR/(r*k):0;return{k:k,left:l,right:r,waste:Math.max(wl,wr),total:wl+wr}};
  if(o.narrow)return fit(4);
  var a=fit(4),b=fit(5);
  if(Math.abs(a.total-b.total)>1e-9)return a.total<b.total?a:b;
  if((a.waste>0.4)!==(b.waste>0.4))return a.waste>0.4?b:a;
  return a;
}
function maxValue(ss){var m=0;ss.forEach(function(s){s.points.forEach(function(p){if(p.value>m)m=p.value})});return m}
function hasNegative(spec){return spec.series.some(function(s){return s.points.some(function(p){return p.value<0})})}
var FALLBACK_NOTE="Some values are below zero, so the two measures are drawn in separate panels, each with its own scale.";
// A line chart with an optional right axis (issue #190). Both axes start at zero and share one set of tick heights (alignedAxes): the gridlines are drawn
// once, from the left axis, and the right axis is labelled at the same heights. D3 provides the point scale and the line paths; the elements are made
// directly so the same function runs under a test DOM. o.narrow: phone width (K = 4). A two-axis spec with a value below zero draws two stacked panels instead.
function lineSvg(d3,spec,o){
  o=o||{};
  var right=spec.series.filter(function(s){return s.axis==="right"});
  if(right.length&&hasNegative(spec))return panelsSvg(d3,spec);
  var T=window.NAChartTheme,D=T.dual,W=D.width,H=D.height,m=D.margin,iw=W-m.left-m.right,ih=H-m.top-m.bottom;
  var ref=labelsOf(refSeries(spec));
  var left=spec.series.filter(function(s){return s.axis!=="right"});
  var rUnits=right.length?unitsOf(spec,right[0]):null;
  var count=function(u){return!/dollar/i.test(u)};
  var ax=right.length?alignedAxes(maxValue(left),maxValue(right),{narrow:o.narrow,intL:count(spec.units),intR:count(rUnits)}):null;
  var yL,yR=null,K;
  if(ax){K=ax.k;yL=d3.scaleLinear().domain([0,ax.left*K]).range([ih,0]);yR=d3.scaleLinear().domain([0,ax.right*K]).range([ih,0])}
  else{var one=alignedAxes(maxValue(left),0,{narrow:o.narrow,intL:count(spec.units)});K=one.k;yL=d3.scaleLinear().domain([0,one.left*K]).range([ih,0]);ax={k:K,left:one.left,right:null}}
  var x=d3.scalePoint().domain(ref).range([0,iw]).padding(.5);
  var svg=svgEl("svg",{viewBox:"0 0 "+W+" "+H,width:"100%",role:"img","aria-label":spec.title,"class":"chart-svg",style:"max-width:"+W+"px;height:auto"});
  var g=svgEl("g",{transform:"translate("+m.left+","+m.top+")"});svg.appendChild(g);
  var tickStyle="fill:"+T.muted+";font-size:"+T.fontSize+"px";
  var axes=svgEl("g",{"class":"chart-axes","aria-hidden":"true"});g.appendChild(axes);
  for(var i=0;i<=K;i++){
    var py=r1(ih-(ih*i)/K);
    axes.appendChild(svgEl("line",{x1:0,x2:iw,y1:py,y2:py,"class":"chart-grid",style:"stroke:"+(i===0?T.muted:T.grid)}));
    axes.appendChild(svgEl("text",{x:-8,y:py,dy:"0.32em","text-anchor":"end","class":"chart-tick-left",style:tickStyle},T.axisFormat(spec.units,+(ax.left*i).toPrecision(12))));
    if(yR)axes.appendChild(svgEl("text",{x:iw+8,y:py,dy:"0.32em","text-anchor":"start","class":"chart-tick-right",style:tickStyle},T.axisFormat(rUnits,+(ax.right*i).toPrecision(12))));
  }
  T.tickLabels(ref).forEach(function(l){axes.appendChild(svgEl("text",{x:r1(x(l)),y:ih+20,"text-anchor":"middle",style:tickStyle},l))});
  var titleStyle="fill:"+T.text+";font-size:"+T.fontSize+"px;font-weight:600";
  axes.appendChild(svgEl("text",{x:-m.left+4,y:-14,"text-anchor":"start",style:titleStyle,"class":"chart-axis-title"},left.map(function(s){return s.name}).join(", ")+" ("+spec.units+")"+(right.length?", left axis":"")));
  if(right.length)axes.appendChild(svgEl("text",{x:iw+m.right-4,y:-14,"text-anchor":"end",style:titleStyle,"class":"chart-axis-title"},right.map(function(s){return s.name}).join(", ")+" ("+rUnits+"), right axis"));
  var ends=[];
  spec.series.forEach(function(s,k){
    var y=s.axis==="right"?yR:yL,l=look(s,k),u=unitsOf(spec,s);
    drawSeries(d3,g,s,l,u,ref,x,y,ends);
  });
  endLabels(g,ends,T);
  return svg;
}
function drawSeries(d3,g,s,l,u,ref,x,y,ends){
  var vals=lookup(s);
  var pts=ref.map(function(lab){return vals[lab]===undefined?null:[r1(x(lab)),r1(y(vals[lab]))]});
  var gs=svgEl("g",{"class":"chart-series"});g.appendChild(gs);
  gs.appendChild(svgEl("path",{d:d3.line().defined(function(p){return p!==null})(pts),fill:"none","stroke-width":2.5,"stroke-linejoin":"round",style:"stroke:"+l.color+(window.NAChartTheme.dash[l.dash]?";stroke-dasharray:"+window.NAChartTheme.dash[l.dash]:"")}));
  s.points.forEach(function(p){
    var px=r1(x(p.label)),py=r1(y(p.value)),fill="fill:"+l.color+";stroke:var(--bg);stroke-width:1",mk;
    if(l.marker==="none")return;
    if(l.marker==="square")mk=svgEl("rect",{x:r1(px-4),y:r1(py-4),width:8,height:8,style:fill});
    else if(l.marker==="diamond")mk=svgEl("path",{d:"M"+px+","+r1(py-5.5)+"L"+r1(px+5.5)+","+py+"L"+px+","+r1(py+5.5)+"L"+r1(px-5.5)+","+py+"Z",style:fill});
    else mk=svgEl("circle",{cx:px,cy:py,r:4,style:fill});
    mk.appendChild(svgEl("title",{},s.name+", "+p.label+": "+fmtU(u,p.value)));
    gs.appendChild(mk);
  });
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
function panelsSvg(d3,spec){
  var T=window.NAChartTheme,D=T.dual,W=D.width,m=D.margin,iw=W-m.left-m.right,ph=130,gap=44,top=40;
  var ref=labelsOf(refSeries(spec)),x=d3.scalePoint().domain(ref).range([0,iw]).padding(.5);
  var groups=[spec.series.filter(function(s){return s.axis!=="right"}),spec.series.filter(function(s){return s.axis==="right"})];
  var H=top+2*ph+gap+34;
  var svg=svgEl("svg",{viewBox:"0 0 "+W+" "+H,width:"100%",role:"img","aria-label":spec.title+". "+FALLBACK_NOTE,"class":"chart-svg chart-panels",style:"max-width:"+W+"px;height:auto"});
  svg.appendChild(svgEl("text",{x:4,y:14,"class":"chart-fallback",style:"fill:"+T.muted+";font-size:"+T.fontSize+"px"},FALLBACK_NOTE));
  var tickStyle="fill:"+T.muted+";font-size:"+T.fontSize+"px",k0=0;
  groups.forEach(function(ss,gi){
    var u=unitsOf(spec,ss[0]),lo=0,hi=0;
    ss.forEach(function(s){s.points.forEach(function(p){if(p.value<lo)lo=p.value;if(p.value>hi)hi=p.value})});
    var st=niceStep(hi-lo||1,4,!/dollar/i.test(u)),a=Math.floor(lo/st)*st,b=Math.ceil(hi/st)*st;if(a===b)b=a+st;
    var y=d3.scaleLinear().domain([a,b]).range([ph,0]);
    var g=svgEl("g",{transform:"translate("+m.left+","+(top+gi*(ph+gap))+")","class":"chart-panel"});svg.appendChild(g);
    var axes=svgEl("g",{"class":"chart-axes","aria-hidden":"true"});g.appendChild(axes);
    for(var t=a;t<=b+st/2;t+=st){var v=+t.toPrecision(12),py=r1(y(v));axes.appendChild(svgEl("line",{x1:0,x2:iw,y1:py,y2:py,"class":"chart-grid",style:"stroke:"+(v===0?T.muted:T.grid)}));axes.appendChild(svgEl("text",{x:-8,y:py,dy:"0.32em","text-anchor":"end",style:tickStyle},T.axisFormat(u,v)))}
    axes.appendChild(svgEl("text",{x:-m.left+4,y:-8,"text-anchor":"start","class":"chart-axis-title",style:"fill:"+T.text+";font-size:"+T.fontSize+"px;font-weight:600"},ss.map(function(s){return s.name}).join(", ")+" ("+u+")"));
    if(gi===1)T.tickLabels(ref).forEach(function(l){axes.appendChild(svgEl("text",{x:r1(x(l)),y:ph+20,"text-anchor":"middle",style:tickStyle},l))});
    var ends=[];
    ss.forEach(function(s){drawSeries(d3,g,s,look(s,k0),u,ref,x,y,ends);k0++});
    endLabels(g,ends,T);
  });
  return svg;
}
// Builds the figure at once (title, plot area, legend, numbers table, source) and draws the picture when D3 arrives; if D3 cannot load the table stays and opens.
function render(spec){
  var bad=check(spec);
  if(bad){if(window.console)console.warn("chart refused: "+bad);return el("p","meta chart-err","The chart could not be shown.")}
  var fig=el("figure","chart"),keyed=styled(spec);
  fig.appendChild(el("figcaption","chart-title",spec.title));
  var plot=el("div","chart-plot");fig.appendChild(plot);
  if(keyed){
    var kl=el("ul","chart-legend chart-keyed");
    spec.series.forEach(function(s,k){var l=look(s,k),li=el("li"),key=el("span","chart-key dash-"+l.dash+" mark-"+l.marker);key.style.color=l.color;key.setAttribute("aria-hidden","true");li.appendChild(key);li.appendChild(document.createTextNode(" "+keyWords(spec,s,k)));kl.appendChild(li)});
    fig.appendChild(kl);
    fig.appendChild(srList(spec));
  }else if(spec.series.length>1){
    var lg=el("ul","chart-legend");
    spec.series.forEach(function(s,k){var li=el("li");var sw=el("span","chart-sw");sw.style.background=window.NAChartTheme.color(k);sw.setAttribute("aria-hidden","true");li.appendChild(sw);li.appendChild(document.createTextNode(" "+s.name));lg.appendChild(li)});
    fig.appendChild(lg);
  }
  var det=el("details","chart-numbers");det.appendChild(el("summary",null,"View the numbers"));det.appendChild(table(spec));fig.appendChild(det);
  var src=spec.series[0].source,sp=el("p","meta chart-src");
  sp.appendChild(document.createTextNode("Source: "));
  var a=el("a",null,src.label);a.href=src.url;a.target="_blank";a.rel="noopener noreferrer";sp.appendChild(a);
  sp.appendChild(document.createTextNode(", as of "+spec.asOf+"."+(spec.note?" "+spec.note:"")));
  fig.appendChild(sp);
  loadD3().then(function(d3){draw(d3,plot,spec)}).catch(function(){plot.textContent="The picture could not load, so the numbers are in the table below.";det.open=true});
  return fig;
}
window.NAChart={check:check,render:render,format:fmt,lineSvg:lineSvg,keyWords:keyWords,alignedAxes:alignedAxes,niceStep:niceStep};
})();
