// The one place a chart's look is decided: every chart type reads these values, and every colour is a CSS token from console.css (--chart-*), so the light and dark themes switch with no redraw.
(function(){
var T=window.NAChartTheme={
  width:640,height:320,margin:{top:12,right:16,bottom:44,left:64},radius:2,fontSize:12,maxXLabels:10,
  color:function(i){return"var(--chart-"+(i%6+1)+")"},
  text:"var(--chart-text)",muted:"var(--chart-muted)",grid:"var(--chart-grid)",
  // Money as $48M, counts as 1,200; a count axis never shows a fraction.
  tickFormat:function(d3,units){
    if(/dollar/i.test(units))return function(v){return"$"+d3.format("~s")(v).replace("G","B")};
    var f=d3.format(",");return function(v){return Math.floor(v)===v?f(v):""};
  },
  // Show at most maxXLabels category labels, evenly spaced, whatever the number of points.
  tickLabels:function(labels){var k=Math.ceil(labels.length/T.maxXLabels);return labels.filter(function(_,i){return i%k===0})},
  styleAxis:function(sel){
    sel.selectAll("text").style("fill",T.muted).style("font-size",T.fontSize+"px");
    sel.selectAll("line,path").style("stroke",T.grid);
    return sel;
  }
};
})();
