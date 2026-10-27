// The one place a chart's look is decided: every chart type reads these values, and every colour is a CSS token from console.css (--chart-*), so the light and dark themes switch with no redraw.
(function(){
var NAMED={green:1,red:1,blue:1,orange:1,gray:1};
function grouped(n){return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,",")}
function trim(n){return String(Math.round(n*10)/10)}
var T=window.NAChartTheme={
  radius:2,fontSize:12,maxXLabels:10,
  // ---- Layout (issue #226): the picture is laid out for the width it is shown or saved at, never from a preset. Text is always fontSize (12) pixels of that width. ----
  // the narrowest and widest picture a layout accepts, and the width used when a container has not been measured yet (a test DOM, a hidden tab)
  minWidth:200,maxWidth:8192,defaultWidth:640,
  // the width to lay out at: a finite number of pixels inside the limits
  widthOf:function(w){var n=Math.round(+w);return n>=T.minWidth?Math.min(T.maxWidth,n):(n>0?T.minWidth:T.defaultWidth)},
  // how many characters of text fit in px pixels at the generous estimate
  chars:function(px){return Math.max(0,Math.floor(px/(T.fontSize*T.charEm)))},
  // The box a chart with a value axis is drawn in, as a pure function of the width W. Margins come from the font size and from the widest axis label:
  // o.leftChars and o.rightChars (characters of the widest value label on that side), o.top (extra room above for axis titles), o.slim (a short bottom margin).
  // The height grows with the width between 260 and 420 pixels. Returns {W, H, m, iw, ih}.
  layoutBox:function(W,kind,o){
    o=o||{};W=T.widthOf(W);
    var f=T.fontSize,cw=f*T.charEm,H=Math.round(Math.min(420,Math.max(260,W*0.5))),
      m={top:f+(o.top||0),right:o.rightChars?Math.ceil(o.rightChars*cw)+12:16,bottom:o.slim?f*2+10:f*3+8,left:Math.max(36,Math.ceil((o.leftChars||5)*cw)+12)};
    if(kind==="dual")H+=20;
    return{W:W,H:H,m:m,iw:W-m.left-m.right,ih:H-m.top-m.bottom};
  },
  // The box for a chart of labelled rows (names at the left, one row each): the left margin is the longest name (at most 22 characters) up to a third of the width.
  // Returns {W, H, m, iw, ih, chars} where chars is how many characters of a name fit.
  rowBox:function(W,labels,rows,rh){
    W=T.widthOf(W);
    var f=T.fontSize,cw=f*T.charEm,longest=labels.reduce(function(n,l){return Math.max(n,Math.min(22,String(l).length))},4),
      left=Math.max(56,Math.min(Math.ceil(longest*cw)+12,Math.floor(W*0.34))),m={top:f+4,right:Math.max(14,Math.min(30,Math.round(W*0.047))),bottom:f*2+10,left:left};
    return{W:W,H:m.top+rows*rh+m.bottom,m:m,iw:W-m.left-m.right,ih:rows*rh,chars:Math.max(4,Math.floor((left-12)/cw))};
  },
  // the focus ring colour (3:1 against the page in both themes) and the marker and hatch pattern words, once
  focus:"var(--chart-focus)",
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
  // ---- Label fitting (one routine for every horizontal axis; the test DOM has no layout, so widths are estimated, never measured) ----
  // charEm: the average advance of one character of the console's sans-serif at fontSize, as a fraction of the font size. Measured in iOS Simulator Safari: digit strings run to 0.615 em a character,
  // mixed-case words 0.5 to 0.57 em; 0.62 is a deliberately generous figure so an estimate errs toward dropping a label, not overlapping two.
  charEm:0.62,
  // the least clear space between two neighbouring tick labels, in picture units
  minGap:8,
  // the shortest a category name may be cut to (with its ellipsis) before the labels turn or thin out instead
  minChars:6,
  textWidth:function(s){return String(s).length*T.fontSize*T.charEm},
  // items: [{label, x}] in axis order (x ascending, plot units). o: {gap, rotate (a category axis whose labels may turn 45 degrees), plain (numbers: never read as dates, never shortened), min, max (the box edges a label may reach)}.
  // Returns {ticks:[{x, text, title?}], rotate, extra}: the labels to draw, none closer than the gap; extra is the height a turned label needs below the usual one.
  // Order of attempts: dates (compact text, whole years, quarters or months, a nice step 1, 2, 5, 10 ...), then whole names, then names cut with an ellipsis, then turned names, then every nth name.
  fitTicks:function(items,o){
    o=o||{};
    var gap=o.gap==null?T.minGap:o.gap,cw=T.fontSize*T.charEm,MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],NICE=[1,2,5,10,20,50,100];
    function inside(c){return(o.min==null||c.x-T.textWidth(c.text)/2>=o.min)&&(o.max==null||c.x+T.textWidth(c.text)/2<=o.max)}
    function fits(sel,g){for(var i=1;i<sel.length;i++){var a=sel[i-1],b=sel[i];if(a.x+T.textWidth(a.text)/2+g>b.x-T.textWidth(b.text)/2)return false}return true}
    // every kth candidate from the first (as the console always did; the last is shown only when the step lands on it); null when two chosen labels still crowd
    function every(c,k,g){
      var out=[],i;for(i=0;i<c.length;i+=k)out.push(c[i]);
            return fits(out,g)?out:null;
    }
    function cut(t,n){return t.length>n?t.slice(0,Math.max(1,n-1))+"…":t}
    function pack(sel,rotate,extra){return{ticks:sel.map(function(c){var t={x:c.x,text:c.text};if(c.title)t.title=c.title;return t}),rotate:!!rotate,extra:extra||0}}
    if(!items.length)return pack([],false,0);
    var plain=items.map(function(it){return{x:it.x,text:String(it.label),title:null}});
    if(o.plain){
      var pc=plain.filter(inside);
      for(var k0=1;k0<=pc.length;k0++){var r0=every(pc,k0,gap);if(r0)return pack(r0)}
      return pack(pc.slice(0,1));
    }
    // dates: 2019, 2019-03, 2019-03-15
    var ps=items.map(function(it){var m=/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(it.label);return m?{y:+m[1],m:m[2]?+m[2]:0}:null});
    if(ps.every(function(p){return p&&(p.m===0||(p.m>=1&&p.m<=12))})){
      var years=[],ly=null,mons=[],seen={};
      items.forEach(function(it,i){
        var p=ps[i];
        if(p.y!==ly){years.push({x:it.x,text:String(p.y)});ly=p.y}
        if(p.m>0&&!seen[p.y*100+p.m]){seen[p.y*100+p.m]=1;mons.push({x:it.x,y:p.y,m:p.m})}
      });
      var named=function(list){return list.map(function(c,i){return{x:c.x,text:MON[c.m-1]+(i===0||c.m===1?" "+c.y:"")}})};
      var levels=[];
      if(mons.length){levels.push({c:named(mons),ks:[1]});levels.push({c:named(mons.filter(function(c){return c.m%3===1})),ks:[1]})}
      // whole years keep the long-standing cap of maxXLabels labels, whatever room there is (every second year beyond ten)
      var kmin=Math.ceil(years.length/T.maxXLabels);levels.push({c:years,ks:NICE.filter(function(k){return k>=kmin})});
      for(var li=0;li<levels.length;li++){
        var lv=levels[li];if(!lv.c.length)continue;
        for(var ki=0;ki<lv.ks.length;ki++){var rr=every(lv.c,lv.ks[ki],gap);if(rr)return pack(rr)}
      }
      var yy=years[0];return pack([yy]);
    }
    // names: whole, then cut, then turned, then every nth
    var n=plain.length,step=Infinity,i;
    for(i=1;i<n;i++)step=Math.min(step,plain[i].x-plain[i-1].x);
    var whole=every(plain,1,gap);if(whole)return pack(whole);
    var fitCut=function(per){
      var max=Math.floor((per-gap)/cw);if(max<T.minChars)return null;
      return plain.map(function(c){return c.text.length>max?{x:c.x,text:cut(c.text,max),title:c.text}:c});
    };
    var cutAll=step<Infinity?fitCut(step):null;
    if(cutAll&&fits(cutAll,gap))return pack(cutAll);
    if(o.rotate&&step>=T.fontSize*1.2*Math.SQRT2+2){
      // a turned label reaches left of its tick by 0.7 of its width: cut it to what the room at the left of the plot allows (o.room, picture units beyond the plot's left edge)
      var rot=plain.map(function(c){var cap=Math.max(T.minChars,Math.min(18,Math.floor((c.x+(o.room||0))/Math.SQRT1_2/cw)));return c.text.length>cap?{x:c.x,text:cut(c.text,cap),title:c.text}:c}),wid=rot.reduce(function(m,c){return Math.max(m,T.textWidth(c.text))},0);
      return pack(rot,true,Math.ceil(wid*Math.SQRT1_2)+4);
    }
    for(var k=2;k<n;k++){
      var per=(step<Infinity?step:cw)*k,max2=Math.max(T.minChars,Math.floor((per-gap)/cw));
      var sub=[];for(i=0;i<n;i+=k)sub.push(plain[i]);
      sub=sub.map(function(c){return c.text.length>max2?{x:c.x,text:cut(c.text,max2),title:c.text}:c});
      if(fits(sub,gap))return pack(sub);
    }
    return pack(plain.slice(0,1));
  },
  styleAxis:function(sel){
    sel.selectAll("text").style("fill",T.muted).style("font-size",T.fontSize+"px");
    sel.selectAll("line,path").style("stroke",T.grid);
    return sel;
  }
};
})();
