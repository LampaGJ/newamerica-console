// One function per mark the console draws beyond the line chart (issue #212). Every function reads the specification only: it places marks, it never derives a number that is shown
// (a shown value is the specification's value through NAChart.fmtU, and the tooltip, the aria-label and the table cell are one string, NAChart.pointText). D3 provides scales, shapes,
// hierarchy and treemap layout; the elements are made directly so the same code runs under a test DOM. Loaded after chart.js, which it reads through window.NAChart.
(function(){
var SANKEY_URL="https://cdnjs.cloudflare.com/ajax/libs/d3-sankey/0.12.3/d3-sankey.min.js";
var SANKEY_SRI="sha384-SM54CE5h+qdDI046d2Y5ym7wq1kq4uxcQ1cqGq5/+5jrE5tPLeDJSq711Q8sIska";
var N=window.NAChart,T=window.NAChartTheme,svgEl=N.svgEl,el=N.el,r1=N.r1,look=N.look,fmtU=N.fmtU,unitsOf=N.unitsOf,pt=N.pt;
// The picture is a labelled group, not an image, because its points are keyboard stops with labels of their own (an image's children are not exposed to assistive technology).
function rootSvg(W,H,label,extra){return svgEl("svg",{viewBox:"0 0 "+W+" "+H,width:"100%",role:"group","aria-label":label,"class":"chart-svg"+(extra?" "+extra:""),style:"max-width:"+W+"px;height:auto"})}
function short(t,n){return t.length>n?t.slice(0,n-1)+"…":t}
function tickStyle(){return"fill:"+T.muted+";font-size:"+T.fontSize+"px"}
function cmp(a,b){return a<b?-1:a>b?1:0}
// Nice zero-based ticks for a value range (the same step rule as the two-axis chart): a, b and the tick values.
function domainOf(units,lo,hi){
  lo=Math.min(0,lo);hi=Math.max(0,hi);
  var st=N.niceStep(hi-lo||1,4,!/dollar/i.test(units)),a=Math.floor(lo/st)*st,b=Math.ceil(hi/st)*st;if(a===b)b=a+st;
  var n=Math.round((b-a)/st),ticks=[];for(var i=0;i<=n;i++)ticks.push(+(a+i*st).toPrecision(12));
  return{a:ticks[0],b:ticks[n],ticks:ticks};
}
function extent(ss,withBands){var v=[];ss.forEach(function(s){s.points.forEach(function(p){v.push(p.value)});if(withBands)(s.band||[]).forEach(function(b){v.push(b.lower,b.upper)})});return[Math.min.apply(null,v),Math.max.apply(null,v)]}
// The shared start of a picture: the svg, its patterns, the plot group and the keyboard counter.
function begin(spec,W,H,m,o,label){
  var svg=rootSvg(W,H,label||spec.title),uid=N.uidOf(spec,o.part);
  svg.appendChild(N.patternDefs(uid,spec.series));
  var g=svgEl("g",{transform:"translate("+m.left+","+m.top+")"});svg.appendChild(g);
  return{svg:svg,g:g,uid:uid};
}
function rowBox(o,rows,rh){var W=o.narrow?360:640,m={top:16,right:o.narrow?18:30,bottom:34,left:o.narrow?100:150};return{W:W,H:m.top+rows*rh+m.bottom,m:m,iw:W-m.left-m.right,ih:rows*rh}}
function rowLabel(g,text,y,o){var t=svgEl("text",{x:-8,y:r1(y),dy:"0.32em","text-anchor":"end","class":"chart-label",style:"fill:var(--chart-text);font-size:"+T.fontSize+"px"},short(text,o.narrow?13:22));if(text.length>(o.narrow?13:22))t.appendChild(svgEl("title",{},text));g.appendChild(t)}
// Direct value or name labels sit on a halo so they read on any shade.
function haloLabel(g,x,y,text,anchor,color,cls){g.appendChild(svgEl("text",{x:r1(x),y:r1(y),"text-anchor":anchor||"start","class":cls||"chart-label",style:"fill:"+(color||"var(--chart-text)")+";font-size:"+T.fontSize+"px"},text))}
function vAxis(g,x,dom,units,iw,ih){
  var a=svgEl("g",{"class":"chart-axes","aria-hidden":"true"});g.appendChild(a);
  dom.ticks.forEach(function(v){var px=r1(x(v));a.appendChild(svgEl("line",{x1:px,x2:px,y1:0,y2:ih,"class":"chart-grid",style:"stroke:"+(v===0?T.muted:T.grid)}));a.appendChild(svgEl("text",{x:px,y:ih+16,"text-anchor":"middle","class":"chart-vtick",style:tickStyle()},T.axisFormat(units,v)))});
}
function xTicks(g,labels,xOf,y,on){
  if(on===false)return;
  var a=svgEl("g",{"class":"chart-axes","aria-hidden":"true"});g.appendChild(a);
  T.tickLabels(labels).forEach(function(l){a.appendChild(svgEl("text",{x:r1(xOf(l)),y:y,"text-anchor":"middle","class":"chart-xtick",style:tickStyle()},l))});
}
function axisTitle(g,x,y,anchor,t){g.appendChild(svgEl("text",{x:x,y:y,"text-anchor":anchor,"class":"chart-axis-title",style:"fill:"+T.text+";font-size:"+T.fontSize+"px;font-weight:600"},t))}
function mapOf(r){var m={};r.points.forEach(function(p){m[p.label]=p});return m}
function est(r){return!!r.estimate}
// A plain list standing in for a picture that cannot fit: values from largest to smallest, ties by label.
function rankedList(host,spec,why){
  var box=el("div","chart-fallback");box.appendChild(el("p","meta chart-narrow-note",why));
  var rows=[];spec.series.forEach(function(s){s.points.forEach(function(p){rows.push({s:s,p:p})})});
  rows.sort(function(a,b){return b.p.value-a.p.value||cmp(a.p.label,b.p.label)||cmp(a.s.name,b.s.name)});
  var ol=el("ol","chart-ranked");rows.forEach(function(r){ol.appendChild(el("li",null,N.pointText(spec,r.s,r.p)))});box.appendChild(ol);
  if(spec.links){var lo=el("ol","chart-ranked");spec.links.slice().sort(function(a,b){return b.value-a.value||cmp(a.source,b.source)||cmp(a.target,b.target)}).forEach(function(l){lo.appendChild(el("li",null,N.linkText(spec,l)))});box.appendChild(lo)}
  host.appendChild(box);
}
var NARROW_WHY="This chart is too wide for a narrow screen. The values are listed from largest to smallest.";
// ---- Bars: grouped, stacked, and stacked to 100 percent ----
function barSvg(d3,spec,o){
  var B=T.box(o.narrow),W=B.W,m={top:B.m.top+14,right:B.m.right,bottom:B.m.bottom,left:B.m.left},H=o.height||B.H+14,iw=B.iw,ih=H-m.top-m.bottom;
  var labels=N.xAxisLabels(spec.type,spec.series,spec.labels),mode=spec.type==="stacked_bar"?"stacked":spec.type==="stacked_100"?"percent":"grouped",n=spec.series.length,multi=n>1;
  var maps=spec.series.map(mapOf),lo=0,hi=0;
  if(mode==="grouped"){var e=extent(spec.series,true);lo=e[0];hi=e[1]}
  else if(mode==="stacked")labels.forEach(function(l){var pos=0,neg=0;maps.forEach(function(mp){var p=mp[l];if(p){if(p.value>=0)pos+=p.value;else neg+=p.value}});hi=Math.max(hi,pos);lo=Math.min(lo,neg)});
  var dom=mode==="percent"?{a:0,b:100,ticks:[0,25,50,75,100]}:domainOf(spec.units,lo,hi);
  var y=d3.scaleLinear().domain([dom.a,dom.b]).range([ih,0]),x=d3.scaleBand().domain(labels).range([0,iw]).padding(.2);
  var s0=begin(spec,W,H,m,o,o.label),svg=s0.svg,g=s0.g,uid=s0.uid;
  var axes=svgEl("g",{"class":"chart-axes","aria-hidden":"true"});g.appendChild(axes);
  dom.ticks.forEach(function(v){var py=r1(y(v));axes.appendChild(svgEl("line",{x1:0,x2:iw,y1:py,y2:py,"class":"chart-grid",style:"stroke:"+(v===0?T.muted:T.grid)}));axes.appendChild(svgEl("text",{x:-8,y:py,dy:"0.32em","text-anchor":"end","class":"chart-tick-left",style:tickStyle()},mode==="percent"?v+"%":T.axisFormat(spec.units,v)))});
  xTicks(g,labels,function(l){return x(l)+x.bandwidth()/2},ih+20,o.xLabels);
  axisTitle(g,-m.left+4,-4,"start",mode==="percent"?"Share of each year's total (percent)":spec.units);
  var ends=[],bw=x.bandwidth(),base={},neg={},tot={};
  if(mode==="percent")labels.forEach(function(l){tot[l]=0;maps.forEach(function(mp){if(mp[l])tot[l]+=mp[l].value})});
  spec.series.forEach(function(s,k){
    var l=look(s,k),gs=svgEl("g",{"class":"chart-series"});g.appendChild(gs);
    var fill=multi?"url(#"+uid+"-p"+k+")":l.color,lastX=null,lastY=null,lastP=null;
    labels.forEach(function(lab){
      var p=maps[k][lab],sw=mode==="grouped"?bw/n:bw,sx=x(lab)+(mode==="grouped"?k*sw:0);
      if(!p){gs.appendChild(N.gapEl(uid,sx,0,sw,ih,N.gapText(s,lab),o));return}
      var v0,v1;
      if(mode==="grouped"){v0=0;v1=p.value}
      else if(mode==="stacked"){if(p.value>=0){v0=base[lab]||0;v1=v0+p.value;base[lab]=v1}else{v0=neg[lab]||0;v1=v0+p.value;neg[lab]=v1}}
      else{if(!(tot[lab]>0))return;v0=(base[lab]||0);v1=v0+100*p.value/tot[lab];base[lab]=v1}
      var top=Math.min(y(v0),y(v1)),h=Math.abs(y(v1)-y(v0)),cv=N.covOf(s,lab),style="fill:"+fill+";stroke:var(--bg);stroke-width:.5";
      if(est(s)||(cv&&cv.value<1))style="fill:"+fill+";fill-opacity:.6;stroke:"+l.color+";stroke-width:1.5;stroke-dasharray:4 2";
      gs.appendChild(pt(svgEl("rect",{x:r1(sx),y:r1(top),width:r1(sw),height:r1(h),rx:T.radius,"class":"chart-bar chart-pt",style:style}),N.pointText(spec,s,p),o));
      var bd=N.bandOf(s,lab);if(bd&&mode==="grouped")gs.appendChild(N.whisker("v",sx+sw/2,y(bd.upper),y(bd.lower)));
      lastX=sx+sw/2;lastY=top;lastP=p;
    });
    if(lastP)ends.push({color:l.color,x:r1(lastX),y:r1(lastY),text:s.name+" "+T.shortFormat(unitsOf(spec,s),lastP.value)});
  });
  N.endLabels(g,ends,T);
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(l){return x(l)===undefined?undefined:x(l)+bw/2},half:x.step()/2,y:y,iw:iw,ih:ih});
  return svg;
}
// ---- Lollipop: a ranked dot chart, one row per label ----
function lollipopSvg(d3,spec,o){
  var rows=N.xAxisLabels(spec.type,spec.series,spec.labels),n=spec.series.length,rh=Math.max(24,10*n+14),B=rowBox(o,rows.length,rh),e=extent(spec.series,true),dom=domainOf(spec.units,e[0],e[1]);
  var x=d3.scaleLinear().domain([dom.a,dom.b]).range([0,B.iw]),s0=begin(spec,B.W,B.H,B.m,o),svg=s0.svg,g=s0.g,uid=s0.uid,maps=spec.series.map(mapOf);
  vAxis(g,x,dom,spec.units,B.iw,B.ih);
  rows.forEach(function(lab,i){
    var cy=i*rh+rh/2;rowLabel(g,lab,cy,o);
    spec.series.forEach(function(s,k){
      var l=look(s,k),y=r1(cy+(k-(n-1)/2)*10),p=maps[k][lab];
      if(!p){g.appendChild(N.gapEl(uid,0,y-5,B.iw,10,N.gapText(s,lab),o));return}
      var px=r1(x(p.value)),hollow=est(s),dash=T.dash[l.dash];
      g.appendChild(svgEl("line",{x1:r1(x(0)),x2:px,y1:y,y2:y,"class":"chart-stem","stroke-width":2,style:"stroke:"+l.color+(dash?";stroke-dasharray:"+dash:"")}));
      var bd=N.bandOf(s,lab);if(bd)g.appendChild(N.whisker("h",y,x(bd.lower),x(bd.upper)));
      g.appendChild(pt(N.markerEl(l.marker==="none"?"circle":l.marker,px,y,hollow?"fill:var(--bg);stroke:"+l.color+";stroke-width:2":"fill:"+l.color+";stroke:var(--bg);stroke-width:1",1.3,"chart-pt"),N.pointText(spec,s,p),o));
      var right=px+14+36<=B.iw;haloLabel(g,right?px+10:px-10,y+4,T.shortFormat(unitsOf(spec,s),p.value),right?"start":"end","var(--chart-text)","chart-label chart-end");
    });
  });
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(){return undefined},half:0,y:null,iw:B.iw,ih:B.ih});
  return svg;
}
// ---- Dot timeline: one row per series, a dot for each period, larger for a higher value ----
function dotTimelineSvg(d3,spec,o){
  var cols=N.xAxisLabels(spec.type,spec.series,spec.labels),n=spec.series.length,B=rowBox(o,n,38),maxV=Math.max.apply(null,extent(spec.series)),maps=spec.series.map(mapOf);
  var x=d3.scalePoint().domain(cols).range([0,B.iw]).padding(.5),rad=d3.scaleSqrt().domain([0,maxV||1]).range([3,9]),s0=begin(spec,B.W,B.H,B.m,o),svg=s0.svg,g=s0.g,uid=s0.uid;
  spec.series.forEach(function(s,k){var cy=r1(k*38+19);g.appendChild(svgEl("line",{x1:0,x2:r1(B.iw),y1:cy,y2:cy,"class":"chart-grid",style:"stroke:"+T.grid}))});
  xTicks(g,cols,x,B.ih+18);
  spec.series.forEach(function(s,k){
    var l=look(s,k),cy=r1(k*38+19);rowLabel(g,s.name,cy,o);
    cols.forEach(function(lab){
      var p=maps[k][lab],px=r1(x(lab));
      if(!p){g.appendChild(N.gapEl(uid,px-5,cy-9,10,18,N.gapText(s,lab),o));return}
      var r=rad(p.value),hollow=est(s);
      g.appendChild(pt(N.markerEl(l.marker==="none"?"circle":l.marker,px,cy,hollow?"fill:var(--bg);stroke:"+l.color+";stroke-width:2":"fill:"+l.color+";stroke:var(--bg);stroke-width:1",r/4,"chart-pt"),N.pointText(spec,s,p),o));
      if(cols.length<=12)haloLabel(g,px,cy-r-4,T.shortFormat(unitsOf(spec,s),p.value),"middle","var(--chart-text)","chart-label chart-end");
    });
  });
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(l){return cols.indexOf(l)<0?undefined:x(l)},half:cols.length>1?(x(cols[1])-x(cols[0]))/2:B.iw/2,y:null,iw:B.iw,ih:B.ih});
  return svg;
}
// ---- Heatmap: rows are series, columns are labels; shade and the printed number both carry the value ----
function heatmapSvg(d3,spec,o,host){
  var cols=N.xAxisLabels(spec.type,spec.series,spec.labels),n=spec.series.length,B=rowBox(o,n,30);
  if(cols.length*(o.narrow?36:34)>B.iw)return rankedList(host,spec,NARROW_WHY);
  var e=extent(spec.series),shade=d3.scaleLinear().domain([e[0],e[1]===e[0]?e[0]+1:e[1]]).range([.15,1]),cw=B.iw/cols.length,xs=function(l){return cols.indexOf(l)*cw};
  var s0=begin(spec,B.W,B.H,B.m,o),svg=s0.svg,g=s0.g,uid=s0.uid,maps=spec.series.map(mapOf);
  xTicks(g,cols,function(l){return xs(l)+cw/2},B.ih+18);
  spec.series.forEach(function(s,k){
    var cy=k*30;rowLabel(g,s.name,cy+15,o);
    cols.forEach(function(lab){
      var p=maps[k][lab];
      if(!p){g.appendChild(N.gapEl(uid,xs(lab)+1,cy+1,cw-2,28,N.gapText(s,lab),o));return}
      g.appendChild(pt(svgEl("rect",{x:r1(xs(lab)+1),y:cy+1,width:r1(cw-2),height:28,"class":"chart-cell chart-pt",style:"fill:var(--chart-1);fill-opacity:"+r1(shade(p.value)*100)/100+(est(s)?";stroke:var(--chart-1);stroke-width:1.5;stroke-dasharray:4 2":"")}),N.pointText(spec,s,p),o));
      haloLabel(g,xs(lab)+cw/2,cy+19,T.shortFormat(unitsOf(spec,s),p.value),"middle","var(--chart-text)","chart-end");
    });
  });
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(l){return cols.indexOf(l)<0?undefined:xs(l)+cw/2},half:cw/2,y:null,iw:B.iw,ih:B.ih});
  return svg;
}
// ---- Gantt: one row per entity; a bar for each period, thicker for a higher count; a missing period is a visible break ----
function ganttSvg(d3,spec,o,host){
  var cols=N.xAxisLabels(spec.type,spec.series,spec.labels),n=spec.series.length,B=rowBox(o,n,32);
  if(cols.length*(o.narrow?30:26)>B.iw)return rankedList(host,spec,NARROW_WHY);
  var maxV=Math.max.apply(null,extent(spec.series)),thick=d3.scaleLinear().domain([0,maxV||1]).range([4,20]),cw=B.iw/cols.length,xs=function(l){return cols.indexOf(l)*cw};
  var s0=begin(spec,B.W,B.H,B.m,o),svg=s0.svg,g=s0.g,uid=s0.uid,maps=spec.series.map(mapOf);
  xTicks(g,cols,function(l){return xs(l)+cw/2},B.ih+18);
  spec.series.forEach(function(s,k){
    var l=look(s,k),cy=k*32+16;rowLabel(g,s.name,cy,o);
    cols.forEach(function(lab){
      var p=maps[k][lab];
      if(!p){g.appendChild(N.gapEl(uid,xs(lab)+1,cy-9,cw-2,18,N.gapText(s,lab),o));return}
      var h=r1(thick(Math.max(0,p.value)));
      g.appendChild(pt(svgEl("rect",{x:r1(xs(lab)),y:r1(cy-h/2),width:r1(cw),height:h,"class":"chart-gantt chart-pt",style:"fill:"+l.color+";stroke:var(--bg);stroke-width:.5"+(est(s)?";fill-opacity:.6;stroke-dasharray:4 2":"")}),N.pointText(spec,s,p),o));
    });
    haloLabel(g,B.iw,cy-14,T.shortFormat(unitsOf(spec,s),s.points[s.points.length-1].value),"end",l.color,"chart-end");
  });
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(l){return cols.indexOf(l)<0?undefined:xs(l)+cw/2},half:cw/2,y:null,iw:B.iw,ih:B.ih});
  return svg;
}
// ---- Scatter, and connected scatter (joined in the order given) ----
function scatterSvg(d3,spec,o){
  var B=T.box(o.narrow),W=B.W,m={top:B.m.top+14,right:B.m.right+4,bottom:B.m.bottom+8,left:B.m.left},H=B.H+22,iw=W-m.left-m.right,ih=H-m.top-m.bottom,conn=spec.type==="connected_scatter";
  var xs=[],ys=[];spec.series.forEach(function(s){s.points.forEach(function(p){xs.push(p.x);ys.push(p.value)});(s.band||[]).forEach(function(b){ys.push(b.lower,b.upper)})});
  var dx=domainOf(spec.xUnits,Math.min.apply(null,xs),Math.max.apply(null,xs)),dy=domainOf(spec.units,Math.min.apply(null,ys),Math.max.apply(null,ys));
  var x=d3.scaleLinear().domain([dx.a,dx.b]).range([0,iw]),y=d3.scaleLinear().domain([dy.a,dy.b]).range([ih,0]);
  var s0=begin(spec,W,H,m,o),svg=s0.svg,g=s0.g,uid=s0.uid;
  var axes=svgEl("g",{"class":"chart-axes","aria-hidden":"true"});g.appendChild(axes);
  dy.ticks.forEach(function(v){var py=r1(y(v));axes.appendChild(svgEl("line",{x1:0,x2:iw,y1:py,y2:py,"class":"chart-grid",style:"stroke:"+(v===0?T.muted:T.grid)}));axes.appendChild(svgEl("text",{x:-8,y:py,dy:"0.32em","text-anchor":"end","class":"chart-tick-left",style:tickStyle()},T.axisFormat(spec.units,v)))});
  dx.ticks.forEach(function(v){var px=r1(x(v));axes.appendChild(svgEl("line",{x1:px,x2:px,y1:0,y2:ih,"class":"chart-grid",style:"stroke:"+T.grid}));axes.appendChild(svgEl("text",{x:px,y:ih+16,"text-anchor":"middle","class":"chart-vtick",style:tickStyle()},T.axisFormat(spec.xUnits,v)))});
  axisTitle(g,-m.left+4,-16,"start",spec.units+" (up)");axisTitle(g,iw,ih+34,"end",spec.xUnits+" (across)");
  var few=N.total(spec)<=14,ends=[],where={};
  spec.series.forEach(function(s,k){
    var l=look(s,k),gs=svgEl("g",{"class":"chart-series"});g.appendChild(gs);
    if(conn)gs.appendChild(svgEl("path",{d:d3.line()(s.points.map(function(p){return[r1(x(p.x)),r1(y(p.value))]})),fill:"none","stroke-width":2,"stroke-linejoin":"round",style:"stroke:"+l.color+(T.dash[l.dash]?";stroke-dasharray:"+T.dash[l.dash]:"")}));
    s.points.forEach(function(p,i){
      var px=r1(x(p.x)),py=r1(y(p.value)),bd=N.bandOf(s,p.label);if(where[p.label]===undefined)where[p.label]=px;
      if(bd)gs.appendChild(N.whisker("v",px,y(bd.upper),y(bd.lower)));
      gs.appendChild(pt(N.markerEl(l.marker==="none"?"circle":l.marker,px,py,est(s)?"fill:var(--bg);stroke:"+l.color+";stroke-width:2":"fill:"+l.color+";stroke:var(--bg);stroke-width:1",1.2,"chart-pt"),N.pointText(spec,s,p),o));
      if(few||(conn&&(i===0||i===s.points.length-1))){var lt=short(p.label,o.narrow?12:20),flip=px+8+lt.length*6.6>iw;haloLabel(gs,flip?px-8:px+8,py-8,lt,flip?"end":"start",l.color,"chart-label chart-end")}
    });
    if(!few&&!conn){var last=s.points[s.points.length-1];ends.push({color:l.color,x:r1(x(last.x)),y:r1(y(last.value)),text:s.name})}
  });
  N.endLabels(g,ends,T);
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(l){return where[l]},half:8,y:y,iw:iw,ih:ih});
  return svg;
}
// ---- Beeswarm: one row per group; each label a dot at its value, nudged sideways so none overlap (a fixed sweep, no randomness) ----
function beeswarmSvg(d3,spec,o){
  var n=spec.series.length,rad=o.narrow?3.5:4.5,Bx=rowBox(o,1,10),e=extent(spec.series),dom=domainOf(spec.units,e[0],e[1]),x=d3.scaleLinear().domain([dom.a,dom.b]).range([0,Bx.iw]);
  var rows=spec.series.map(function(s){
    var placed=[],order=s.points.slice().sort(function(a,b){return a.value-b.value||cmp(a.label,b.label)});
    order.forEach(function(p){
      var px=x(p.value),off=0,i=0;
      for(;;){
        var cand=i===0?0:(i%2?1:-1)*Math.ceil(i/2)*rad*1.1,ok=placed.every(function(q){var dx=q.x-px,dy=q.y-cand;return dx*dx+dy*dy>=4*rad*rad});
        if(ok){off=cand;break}i++;
      }
      placed.push({x:px,y:off,p:p});
    });
    return placed;
  });
  var half=rows.map(function(r){return r.reduce(function(m,q){return Math.max(m,Math.abs(q.y))},0)+rad+10}),tops=[],acc=0;
  half.forEach(function(h){tops.push(acc+h);acc+=2*h});
  var B=rowBox(o,1,acc);B.ih=acc;B.H=B.m.top+acc+B.m.bottom;
  var s0=begin(spec,B.W,B.H,B.m,o),svg=s0.svg,g=s0.g;
  vAxis(g,x,dom,spec.units,B.iw,B.ih);
  spec.series.forEach(function(s,k){
    var l=look(s,k),cy=r1(tops[k]),gs=svgEl("g",{"class":"chart-series"});g.appendChild(gs);
    gs.appendChild(svgEl("line",{x1:0,x2:r1(B.iw),y1:cy,y2:cy,style:"stroke:"+T.grid+";stroke-dasharray:2 3"}));
    rowLabel(g,s.name,cy,o);
    var top=null;
    rows[k].forEach(function(q){
      gs.appendChild(pt(N.markerEl(l.marker==="none"?"circle":l.marker,r1(q.x),r1(cy+q.y),est(s)?"fill:var(--bg);stroke:"+l.color+";stroke-width:2":"fill:"+l.color+";stroke:var(--bg);stroke-width:1",rad/4,"chart-pt"),N.pointText(spec,s,q.p),o));
      if(!top||q.p.value>top.p.value)top=q;
    });
    if(top)haloLabel(gs,top.x<B.iw-60?top.x+8:top.x-8,cy+top.y-8,short(top.p.label,o.narrow?12:20)+" "+T.shortFormat(unitsOf(spec,s),top.p.value),top.x<B.iw-60?"start":"end",l.color,"chart-label chart-end");
  });
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(){return undefined},half:0,y:null,iw:B.iw,ih:B.ih});
  return svg;
}
// ---- Ridgeline: one filled curve per group over the same bins, all on one scale ----
function ridgelineSvg(d3,spec,o){
  var bins=N.xAxisLabels(spec.type,spec.series,spec.labels),n=spec.series.length,step=o.narrow?46:56,B0=T.box(o.narrow),W=B0.W,m={top:30,right:B0.m.right+6,bottom:B0.m.bottom,left:o.narrow?84:130},iw=W-m.left-m.right,H=m.top+(n+1)*step+m.bottom,ih=H-m.top-m.bottom;
  var maxV=Math.max.apply(null,extent(spec.series)),hs=d3.scaleLinear().domain([0,maxV||1]).range([0,step*1.7]),x=d3.scalePoint().domain(bins).range([0,iw]).padding(.1);
  var s0=begin(spec,W,H,m,o),svg=s0.svg,g=s0.g,uid=s0.uid,maps=spec.series.map(mapOf);
  xTicks(g,bins,x,ih+18);
  spec.series.forEach(function(s,k){
    var l=look(s,k),base=r1((k+1)*step+step*.4),gs=svgEl("g",{"class":"chart-series"}),pts=bins.map(function(lab){var p=maps[k][lab];return p?[r1(x(lab)),r1(base-hs(p.value))]:null});
    g.appendChild(gs);
    gs.appendChild(svgEl("line",{x1:0,x2:r1(iw),y1:base,y2:base,style:"stroke:"+T.grid}));
    var runs=[],cur=null;pts.forEach(function(p,i){if(!p){cur=null;return}if(!cur){cur=[];runs.push(cur)}cur.push(p)});
    runs.forEach(function(run){
      gs.appendChild(svgEl("path",{d:"M"+run[0][0]+","+base+"L"+run.map(function(p){return p.join(",")}).join("L")+"L"+run[run.length-1][0]+","+base+"Z","class":"chart-ridge",style:"fill:"+l.color+";fill-opacity:.4;stroke:"+l.color+";stroke-width:2"+(T.dash[l.dash]?";stroke-dasharray:"+T.dash[l.dash]:"")}));
    });
    bins.forEach(function(lab,i){
      var p=maps[k][lab];
      if(!p){gs.appendChild(N.gapEl(uid,x(lab)-4,base-14,8,14,N.gapText(s,lab),o));return}
      gs.appendChild(pt(svgEl("circle",{cx:pts[i][0],cy:pts[i][1],r:3,"class":"chart-pt",style:est(s)?"fill:var(--bg);stroke:"+l.color+";stroke-width:2":"fill:"+l.color+";stroke:var(--bg);stroke-width:1"}),N.pointText(spec,s,p),o));
    });
    rowLabel(g,s.name,base-4,o);
  });
  // one scale bar for every row, labelled with the tallest value
  g.appendChild(svgEl("line",{x1:r1(iw),x2:r1(iw),y1:0,y2:r1(hs(maxV)),"class":"chart-scalebar",style:"stroke:var(--chart-text);stroke-width:1.5"}));
  haloLabel(g,iw-6,12,"Tallest: "+fmtU(spec.units,maxV),"end","var(--chart-text)","chart-label chart-end");
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(l){return bins.indexOf(l)<0?undefined:x(l)},half:iw/bins.length/2,y:null,iw:iw,ih:ih});
  return svg;
}
// ---- Treemap: one rectangle per label, area for the value, outlined in groups ----
function treemapSvg(d3,spec,o){
  var B=T.box(o.narrow),W=B.W,H=o.narrow?320:380,s=spec.series[0],groups=[];
  s.points.forEach(function(p){if(p.group!==undefined&&groups.indexOf(p.group)<0)groups.push(p.group)});
  var tree=groups.length?{name:"",children:groups.map(function(gr){return{name:gr,children:s.points.filter(function(p){return p.group===gr}).map(function(p){return{name:p.label,value:p.value,p:p}})}})}:{name:"",children:s.points.map(function(p){return{name:p.label,value:p.value,p:p}})};
  var root=d3.hierarchy(tree).sum(function(d){return d.value||0}).sort(function(a,b){return b.value-a.value||cmp(a.data.name,b.data.name)});
  d3.treemap().size([W,H]).paddingInner(2).paddingTop(function(nd){return groups.length&&nd.depth===1?18:0})(root);
  var svg=rootSvg(W,H,spec.title),g=svgEl("g",{});svg.appendChild(g);
  var o2=o;
  root.descendants().forEach(function(nd){
    if(nd.depth===1&&groups.length){
      g.appendChild(svgEl("rect",{x:r1(nd.x0),y:r1(nd.y0),width:r1(nd.x1-nd.x0),height:r1(nd.y1-nd.y0),"class":"chart-group",style:"fill:none;stroke:var(--chart-text);stroke-width:1.5","aria-hidden":"true"}));
      haloLabel(g,nd.x0+4,nd.y0+13,short(nd.data.name,Math.max(4,Math.floor((nd.x1-nd.x0)/7))),"start","var(--chart-text)","chart-label");
    }
  });
  root.leaves().forEach(function(nd){
    var gi=groups.indexOf(nd.data.p.group),w=nd.x1-nd.x0,h=nd.y1-nd.y0;
    g.appendChild(pt(svgEl("rect",{x:r1(nd.x0),y:r1(nd.y0),width:r1(w),height:r1(h),"class":"chart-cell chart-pt",style:"fill:"+(gi<0?"var(--chart-1)":T.color(gi))+";fill-opacity:.35;stroke:"+(gi<0?"var(--chart-1)":T.color(gi))+";stroke-width:1.5"+(est(s)?";stroke-dasharray:4 2":"")}),N.pointText(spec,s,nd.data.p),o2));
    if(w>54&&h>30){haloLabel(g,nd.x0+5,nd.y0+15,short(nd.data.name,Math.max(4,Math.floor(w/7))),"start","var(--chart-text)","chart-end");haloLabel(g,nd.x0+5,nd.y0+29,T.shortFormat(unitsOf(spec,s),nd.data.p.value),"start","var(--chart-text)","chart-end")}
  });
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(){return undefined},half:0,y:null,iw:W,ih:H});
  return svg;
}
// ---- Networks: nodes are the series' points; links come from spec.links ----
function nodesOf(spec){var seen={},out=[];spec.series.forEach(function(s,k){s.points.forEach(function(p){if(!seen[p.label]){seen[p.label]=true;out.push({label:p.label,s:s,k:k,p:p})}})});return out}
function linkWidth(d3,spec,lo,hi){var mx=Math.max.apply(null,spec.links.map(function(l){return Math.max(l.value,l.upper===undefined?0:l.upper)}));return d3.scaleLinear().domain([0,mx||1]).range([lo,hi])}
// Arcs: nodes along a line in the order given; every link an arc above it, with an arrow head at its target; a range as a wider faint arc behind.
function arcsSvg(d3,spec,o,host){
  var nodes=nodesOf(spec),B0=T.box(o.narrow),W=B0.W,m={top:20,right:20,bottom:o.narrow?110:100,left:20},iw=W-m.left-m.right;
  if(nodes.length*(o.narrow?20:16)>iw)return rankedList(host,spec,NARROW_WHY);
  var xs={};nodes.forEach(function(nd,i){xs[nd.label]=r1(nodes.length>1?i*iw/(nodes.length-1):iw/2)});
  var ry=function(a,b){return Math.abs(xs[a]-xs[b])/2*.55},tall=Math.max.apply(null,spec.links.map(function(l){return ry(l.source,l.target)})),H=m.top+tall+m.bottom,by=r1(tall),wid=linkWidth(d3,spec,1.5,8);
  var rad=d3.scaleSqrt().domain([0,Math.max.apply(null,nodes.map(function(nd){return nd.p.value}))||1]).range([4,10]);
  var pv={};nodes.forEach(function(nd){pv[nd.label]=nd.p.value});
  var svg=rootSvg(W,H,spec.title),g=svgEl("g",{transform:"translate("+m.left+","+m.top+")"});svg.appendChild(g);
  g.appendChild(svgEl("line",{x1:0,x2:iw,y1:by,y2:by,style:"stroke:"+T.grid}));
  spec.links.forEach(function(l){
    var a=xs[l.source],b=xs[l.target],r=Math.abs(b-a)/2,sw=a<b?1:0,d=function(){return"M"+a+","+by+"A"+r1(r)+","+r1(ry(l.source,l.target))+" 0 0,"+sw+" "+b+","+by};
    if(l.upper!==undefined)g.appendChild(svgEl("path",{d:d(),fill:"none","class":"chart-link-range","stroke-width":r1(wid(l.upper)),style:"stroke:var(--chart-muted);stroke-opacity:.3","aria-hidden":"true"}));
    g.appendChild(pt(svgEl("path",{d:d(),fill:"none","class":"chart-link chart-pt","stroke-width":r1(wid(l.value)),style:"stroke:var(--chart-1);stroke-opacity:.6"}),N.linkText(spec,l),o));
    var ty=by-r1(rad(pv[l.target]))-1;g.appendChild(svgEl("path",{d:"M"+(b-4)+","+r1(ty-8)+"L"+(b+4)+","+r1(ty-8)+"L"+b+","+r1(ty)+"Z",style:"fill:var(--chart-text)","aria-hidden":"true"}));
  });
  nodes.forEach(function(nd){
    var l=look(nd.s,nd.k),px=xs[nd.label];
    g.appendChild(pt(svgEl("circle",{cx:px,cy:by,r:r1(rad(nd.p.value)),"class":"chart-node chart-pt",style:"fill:"+l.color+";stroke:var(--bg);stroke-width:1.5"}),N.pointText(spec,nd.s,nd.p),o));
    var back=px>iw/2,t=svgEl("text",{x:px,y:by+18,"text-anchor":back?"end":"start","class":"chart-label",transform:"rotate("+(back?-50:50)+" "+px+" "+(by+18)+")",style:"fill:var(--chart-text);font-size:"+T.fontSize+"px"},short(nd.label,18));g.appendChild(t);
  });
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(l){return xs[l]},half:8,y:null,iw:iw,ih:by});
  return svg;
}
// Bipartite: sources on the left, targets on the right, a curve for each link, wider for a higher value.
function bipartiteSvg(d3,spec,o){
  var nodes=nodesOf(spec),from={},to={};spec.links.forEach(function(l){from[l.source]=true;to[l.target]=true});
  var left=nodes.filter(function(nd){return to[nd.label]!==true}),right=nodes.filter(function(nd){return to[nd.label]===true}),rh=26,rows=Math.max(left.length,right.length);
  var W=o.narrow?360:640,m={top:16,right:o.narrow?100:150,bottom:16,left:o.narrow?100:150},iw=W-m.left-m.right,H=m.top+rows*rh+m.bottom,wid=linkWidth(d3,spec,1.5,10),pos={};
  left.forEach(function(nd,i){pos[nd.label]={x:0,y:r1(i*rh+rh/2)}});right.forEach(function(nd,i){pos[nd.label]={x:r1(iw),y:r1(i*rh+rh/2)}});
  var svg=rootSvg(W,H,spec.title),g=svgEl("g",{transform:"translate("+m.left+","+m.top+")"});svg.appendChild(g);
  var colorOf={};left.forEach(function(nd,i){colorOf[nd.label]=T.color(i)});
  spec.links.forEach(function(l){
    var a=pos[l.source],b=pos[l.target],mx=r1(iw/2),d="M"+a.x+","+a.y+"C"+mx+","+a.y+" "+mx+","+b.y+" "+b.x+","+b.y;
    if(l.upper!==undefined)g.appendChild(svgEl("path",{d:d,fill:"none","class":"chart-link-range","stroke-width":r1(wid(l.upper)),style:"stroke:var(--chart-muted);stroke-opacity:.3","aria-hidden":"true"}));
    g.appendChild(pt(svgEl("path",{d:d,fill:"none","class":"chart-link chart-pt","stroke-width":r1(wid(l.value)),style:"stroke:"+colorOf[l.source]+";stroke-opacity:.6"}),N.linkText(spec,l),o));
  });
  function column(list,side){list.forEach(function(nd){
    var p=pos[nd.label],l=look(nd.s,nd.k);
    g.appendChild(pt(svgEl("rect",{x:p.x-5,y:r1(p.y-8),width:10,height:16,"class":"chart-node chart-pt",style:"fill:"+(side==="left"?colorOf[nd.label]:l.color)+";stroke:var(--bg);stroke-width:1"}),N.pointText(spec,nd.s,nd.p),o));
    g.appendChild(svgEl("text",{x:side==="left"?p.x-10:p.x+10,y:p.y,dy:"0.32em","text-anchor":side==="left"?"end":"start","class":"chart-label",style:"fill:var(--chart-text);font-size:"+T.fontSize+"px"},short(nd.label,o.narrow?13:22)));
  })}
  column(left,"left");column(right,"right");
  if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(){return undefined},half:0,y:null,iw:iw,ih:rows*rh});
  return svg;
}
// Sankey: needs the pinned d3-sankey add-on, loaded the first time one is drawn (same pattern as D3 in chart.js).
var skp=null;
function loadSankey(d3){
  if(d3.sankey)return Promise.resolve(d3);
  if(skp)return skp;
  skp=new Promise(function(res,rej){
    var s=document.createElement("script");
    s.src=SANKEY_URL;s.integrity=SANKEY_SRI;s.crossOrigin="anonymous";s.referrerPolicy="no-referrer";
    s.onload=function(){res(window.d3)};
    s.onerror=function(){skp=null;rej(new Error("d3-sankey did not load"))};
    document.head.appendChild(s);
  });
  return skp;
}
function sankeySvg(d3,spec,o,host){
  if(o.narrow)return rankedList(host,spec,NARROW_WHY);
  return loadSankey(d3).then(function(D){
    var nodes=nodesOf(spec),W=640,H=380,m={top:10,right:130,bottom:10,left:10},iw=W-m.left-m.right,ih=H-m.top-m.bottom;
    var graph={nodes:nodes.map(function(nd){return{name:nd.label}}),links:spec.links.map(function(l){return{source:l.source,target:l.target,value:l.value,l:l}})};
    var lay;
    try{lay=D.sankey().nodeId(function(d){return d.name}).nodeWidth(14).nodePadding(12).extent([[0,0],[iw,ih]])(graph)}
    catch(e){if(window.console)console.warn("sankey not drawn: "+e.message);return rankedList(host,spec,"The flows could not be drawn, so the values are listed from largest to smallest.")}
    var svg=rootSvg(W,H,spec.title),g=svgEl("g",{transform:"translate("+m.left+","+m.top+")"});svg.appendChild(g);
    var by={};nodes.forEach(function(nd,i){by[nd.label]=i});
    var path=D.sankeyLinkHorizontal();
    lay.links.forEach(function(lk){
      var l=lk.l,sn=nodes[by[l.source]],col=look(sn.s,sn.k).color;
      if(l.upper!==undefined&&l.value>0)g.appendChild(svgEl("path",{d:path(lk),fill:"none","class":"chart-link-range","stroke-width":r1(Math.max(1,lk.width*l.upper/l.value)),style:"stroke:var(--chart-muted);stroke-opacity:.3","aria-hidden":"true"}));
      g.appendChild(pt(svgEl("path",{d:path(lk),fill:"none","class":"chart-link chart-pt","stroke-width":r1(Math.max(1,lk.width)),style:"stroke:"+col+";stroke-opacity:.45"}),N.linkText(spec,l),o));
    });
    lay.nodes.forEach(function(nd){
      var src=nodes[by[nd.name]],l=look(src.s,src.k),right=nd.x0>iw/2;
      g.appendChild(pt(svgEl("rect",{x:r1(nd.x0),y:r1(nd.y0),width:r1(nd.x1-nd.x0),height:r1(Math.max(1,nd.y1-nd.y0)),"class":"chart-node chart-pt",style:"fill:"+l.color+";stroke:var(--bg);stroke-width:1"}),N.pointText(spec,src.s,src.p),o));
      haloLabel(g,right?nd.x0-6:nd.x1+6,(nd.y0+nd.y1)/2+4,short(nd.name,20)+" "+T.shortFormat(unitsOf(spec,src.s),src.p.value),right?"end":"start","var(--chart-text)","chart-label chart-end");
    });
    if(spec.annotations&&!o.noNotes)N.annotate(g,spec,{xOf:function(){return undefined},half:0,y:null,iw:iw,ih:ih});
    host.appendChild(svg);
  });
}
// ---- Panels (small multiples): one picture per panel, stacked, the x labels drawn once under the last ----
function panelsDiv(d3,host,spec,o){
  var box=el("div","chart-panels-stack");host.appendChild(box);
  N.setsOf(spec).forEach(function(set,i){
    var last=i===spec.panels.length-1,part=el("div","chart-panel"),label=set.title+" ("+set.units+")";
    part.appendChild(el("p","chart-panel-title",set.title));
    var sub=Object.assign({},set,{annotations:i===0?spec.annotations:undefined}),po={narrow:o.narrow,rove:o.rove,seq:o.seq,height:o.narrow?210:230,xLabels:last,label:label,part:"p"+i};
    var svg=set.type==="line"||set.type==="area"?N.lineSvg(d3,sub,po):barSvg(d3,sub,po);
    o.seq=po.seq;part.appendChild(svg);box.appendChild(part);
  });
}
var MARKS={bar:barSvg,stacked_bar:barSvg,stacked_100:barSvg,lollipop:lollipopSvg,dot_timeline:dotTimelineSvg,heatmap:heatmapSvg,gantt:ganttSvg,scatter:scatterSvg,connected_scatter:scatterSvg,beeswarm:beeswarmSvg,ridgeline:ridgelineSvg,treemap:treemapSvg,arcs:arcsSvg,bipartite:bipartiteSvg,sankey:sankeySvg};
// Draws spec into host. Returns a promise only when an add-on has to load first (Sankey).
function draw(d3,host,spec,o){
  o=o||{};
  if(o.narrow===undefined)o.narrow=host.clientWidth>0&&host.clientWidth<480;
  o.rove=N.total(spec)>80;
  if(spec.panels)return panelsDiv(d3,host,spec,o);
  if(spec.type==="line"||spec.type==="area")return host.appendChild(N.lineSvg(d3,spec,o));
  var f=MARKS[spec.type];
  if(!f)throw new Error("no mark for "+spec.type);
  var out=f(d3,spec,o,host);
  if(out&&typeof out.then==="function")return out;
  if(out)host.appendChild(out);
}
window.NAChartMarks={draw:draw,pointText:N.pointText,SANKEY_URL:SANKEY_URL};
})();
