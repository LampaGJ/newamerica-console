// Draws the chart addendum the server sends in structuredContent.chart (spec: src/charts/spec.ts on the server). check() mirrors the server's schema as a shape check, so a malformed chart is refused here too; the table under every chart is the accessible version and works without D3.
(function(){
var D3_URL="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
var D3_SRI="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i";
var TYPES=["bar","line","stacked_bar"];
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
function str(v,max){return typeof v==="string"&&v.length>0&&v.length<=max}
function https(u){return typeof u==="string"&&/^https?:\/\/\S+$/i.test(u)}
// null when the spec has the server's shape, else one plain reason.
function check(s){
  if(!s||typeof s!=="object")return"not an object";
  if(TYPES.indexOf(s.type)<0)return"unknown type";
  if(!str(s.title,200)||!str(s.units,40))return"missing title or units";
  if(typeof s.asOf!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(s.asOf))return"bad as-of date";
  if(!Array.isArray(s.series)||s.series.length<1||s.series.length>8)return"bad series list";
  var labels=null;
  for(var i=0;i<s.series.length;i++){
    var r=s.series[i];
    if(!r||!str(r.name,80)||!r.source||!str(r.source.label,120)||!https(r.source.url))return"series "+i+" has no name or source link";
    if(!Array.isArray(r.points)||r.points.length<1||r.points.length>60)return"series "+i+" has no points";
    for(var j=0;j<r.points.length;j++){var p=r.points[j];if(!p||!str(p.label,80)||typeof p.value!=="number"||!isFinite(p.value))return"series "+i+" has a bad point"}
    var key=r.points.map(function(p){return p.label}).join("\u0000");
    if(labels===null)labels=key;else if(key!==labels)return"series do not share their labels";
  }
  if(s.note!==undefined&&!str(s.note,300))return"bad note";
  return null;
}
function grouped(n){return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,",")}
function fmt(spec,v){return/dollar/i.test(spec.units)?(Math.abs(v)>=1e6?"$"+(v/1e6).toFixed(1)+" million":"$"+grouped(v)):grouped(v)}
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
function table(spec){
  var t=el("table","chart-tbl"),cap=el("caption",null,spec.title);t.appendChild(cap);
  var hr=el("tr");hr.appendChild(el("td"));
  spec.series.forEach(function(s){var h=el("th",null,s.name+" ("+spec.units+")");h.scope="col";hr.appendChild(h)});
  var th=el("thead");th.appendChild(hr);t.appendChild(th);
  var tb=el("tbody");
  spec.series[0].points.forEach(function(p,i){
    var r=el("tr"),h=el("th",null,p.label);h.scope="row";r.appendChild(h);
    spec.series.forEach(function(s){r.appendChild(el("td",null,fmt(spec,s.points[i].value)))});
    tb.appendChild(r);
  });
  t.appendChild(tb);return t;
}
function draw(d3,host,spec){
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
// Builds the figure at once (title, plot area, legend, numbers table, source) and draws the picture when D3 arrives; if D3 cannot load the table stays and opens.
function render(spec){
  var bad=check(spec);
  if(bad){if(window.console)console.warn("chart refused: "+bad);return el("p","meta chart-err","The chart could not be shown.")}
  var fig=el("figure","chart");
  fig.appendChild(el("figcaption","chart-title",spec.title));
  var plot=el("div","chart-plot");fig.appendChild(plot);
  if(spec.series.length>1){
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
window.NAChart={check:check,render:render,format:fmt};
})();
