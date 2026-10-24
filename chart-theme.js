// The one place a chart's look is decided: every chart type reads these values, and every colour is a CSS token from console.css (--chart-*), so the light and dark themes switch with no redraw.
(function(){
var NAMED={green:1,red:1,blue:1,orange:1,gray:1};
function grouped(n){return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,",")}
function trim(n){return String(Math.round(n*10)/10)}
var T=window.NAChartTheme={
  width:640,height:320,margin:{top:12,right:16,bottom:44,left:64},radius:2,fontSize:12,maxXLabels:10,
  // the line chart with a right axis (issue #190): room above for the axis titles and on the right for the second axis
  dual:{width:640,height:340,margin:{top:30,right:60,bottom:34,left:64}},
  color:function(i){return"var(--chart-"+(i%6+1)+")"},
  // a spec's named colour hint as its token; each token has a light and a dark value chosen for contrast on that theme's background
  named:function(c){return NAMED[c]?"var(--chart-"+c+")":"var(--chart-1)"},
  // dash patterns by name; solid draws no dasharray
  dash:{solid:null,dashed:"7 4",dotted:"2 3"},
  text:"var(--chart-text)",muted:"var(--chart-muted)",grid:"var(--chart-grid)",
  // Money as $48M, counts as 1,200; a count axis never shows a fraction.
  tickFormat:function(d3,units){
    if(/dollar/i.test(units))return function(v){return"$"+d3.format("~s")(v).replace("G","B")};
    var f=d3.format(",");return function(v){return Math.floor(v)===v?f(v):""};
  },
  // The same compact ticks without d3.format: $40M, $1.5B, $750K; counts with thousands commas.
  axisFormat:function(units,v){
    if(!/dollar/i.test(units))return grouped(v);
    var a=Math.abs(v);return a>=1e9?"$"+trim(v/1e9)+"B":a>=1e6?"$"+trim(v/1e6)+"M":a>=1e3?"$"+trim(v/1e3)+"K":"$"+grouped(v);
  },
  // An end label's value: $37.2M for money, 196 for a count.
  shortFormat:function(units,v){return/dollar/i.test(units)?"$"+(Math.abs(v)>=1e6?(v/1e6).toFixed(1)+"M":grouped(v)):grouped(v)},
  // Show at most maxXLabels category labels, evenly spaced, whatever the number of points: every year up to ten years, every second year beyond.
  tickLabels:function(labels){var k=Math.ceil(labels.length/T.maxXLabels);return labels.filter(function(_,i){return i%k===0})},
  styleAxis:function(sel){
    sel.selectAll("text").style("fill",T.muted).style("font-size",T.fontSize+"px");
    sel.selectAll("line,path").style("stroke",T.grid);
    return sel;
  }
};
})();
