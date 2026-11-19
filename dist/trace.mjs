const DIRECTIONS = [[1,0],[0,1],[-1,0],[0,-1]];
const CELL = [[0,0],[-1,0],[-1,-1],[0,-1]];
const ORIGIN = [[0,0],[1,0],[1,1],[0,1]];
const hex = rgb => "#"+rgb.map(value=>value.toString(16).padStart(2,"0")).join("");

const colorDistance=(r,g,b,[pr,pg,pb])=>(pr-r)**2*.28+(pg-g)**2*.53+(pb-b)**2*.19;

function paletteFor(pixels, wanted, detail) {
  const histogram = new Map();
  for(let i=0;i<pixels.length;i+=4) {
    if(pixels[i+3]<128) continue;
    const r=pixels[i],g=pixels[i+1],b=pixels[i+2];
    const key=(r>>3)*1024+(g>>3)*32+(b>>3);
    const entry=histogram.get(key);
    if(entry){entry[0]+=r;entry[1]+=g;entry[2]+=b;entry[3]++;}
    else histogram.set(key,[r,g,b,1]);
  }
  function describe(entries){
    const low=[255,255,255],high=[0,0,0],sum=[0,0,0];
    let total=0;
    for(const entry of entries){
      for(let channel=0;channel<3;channel++){
        const average=entry[channel]/entry[3];
        low[channel]=Math.min(low[channel],average);
        high[channel]=Math.max(high[channel],average);
        sum[channel]+=entry[channel];
      }
      total+=entry[3];
    }
    const spread=high.map((value,i)=>(value-low[i])*[.9,1,.78][i]);
    const channel=spread.indexOf(Math.max(...spread));
    return {entries,channel,total,weight:entries.length>1?spread[channel]*Math.sqrt(total):0,color:sum.map(value=>Math.round(value/total))};
  }
  if(!histogram.size) return [];
  const boxes=[describe([...histogram.values()])];
  while(boxes.length<wanted){
    boxes.sort((a,b)=>b.weight-a.weight);
    const box=boxes[0];
    if(!box.weight) break;
    const {entries,channel}=box;
    entries.sort((a,b)=>a[channel]/a[3]-b[channel]/b[3]);
    let count=0,split=1;
    for(;split<entries.length-1;split++){
      count+=entries[split-1][3];
      if(count>=box.total/2) break;
    }
    boxes.splice(0,1,describe(entries.slice(0,split)),describe(entries.slice(split)));
  }
  const colors=boxes.sort((a,b)=>b.total-a.total).map(box=>box.color);
  const entries=[...histogram.values()];
  for(let pass=0;pass<4;pass++){
    const totals=colors.map(()=>[0,0,0,0]);
    for(const [rs,gs,bs,count] of entries){
      let best=Infinity,index=0;
      for(let i=0;i<colors.length;i++){
        const distance=colorDistance(rs/count,gs/count,bs/count,colors[i]);
        if(distance<best){best=distance;index=i;}
      }
      totals[index][0]+=rs;totals[index][1]+=gs;totals[index][2]+=bs;totals[index][3]+=count;
    }
    for(let i=0;i<colors.length;i++){
      const total=totals[i];
      if(total[3])colors[i]=total.slice(0,3).map(value=>Math.round(value/total[3]));
    }
  }
  const separation=[16,13,10,7,4][detail]**2;
  return colors.filter(([r,g,b],index)=>!colors.slice(0,index).some(color=>colorDistance(r,g,b,color)<separation));
}
function dropWhite(pixels,w,h) {
  const visited=new Uint8Array(w*h),queue=new Int32Array(w*h);
  let read=0,write=0;
  function consider(index){
    if(visited[index]) return;
    visited[index]=1;
    const offset=index*4;
    const r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2];
    if(pixels[offset+3]<128 || (Math.min(r,g,b)>=231&&Math.max(r,g,b)-Math.min(r,g,b)<=19)){
      pixels[offset+3]=0;
      queue[write++]=index;
    }
  }
  for(let x=0;x<w;x++){consider(x);consider((h-1)*w+x);}
  for(let y=0;y<h;y++){consider(y*w);consider(y*w+w-1);}
  while(read<write){
    const p=queue[read++],x=p%w;
    if(x)consider(p-1);
    if(x<w-1)consider(p+1);
    if(p>=w)consider(p-w);
    if(p<(h-1)*w)consider(p+w);
  }
}
function classify(pixels,colors,threshold) {
  const labels=new Uint8Array(pixels.length/4);
  const lookup=new Uint8Array(32768);
  lookup.fill(255);
  for(let i=0;i<labels.length;i++){
    const j=i*4;
    if(pixels[j+3]<128 || !colors.length) continue;
    const r=pixels[j],g=pixels[j+1],b=pixels[j+2];
    if(threshold!==null){if(r*.213+g*.715+b*.072<threshold) labels[i]=1;continue;}
    const key=(r>>3)*1024+(g>>3)*32+(b>>3);
    if(lookup[key]===255){
      let best=Infinity,bestIndex=0;
      for(let c=0;c<colors.length;c++){
        const distance=colorDistance(r,g,b,colors[c]);
        if(distance<best){best=distance;bestIndex=c;}
      }
      lookup[key]=bestIndex+1;
    }
    labels[i]=lookup[key];
  }
  return labels;
}
function removeSpecks(labels,w,h,noise,colorCount) {
  const min=[1,3,8,17,36,76][noise];
  if(min===1)return labels;
  const cleaned=labels.slice(),seen=new Uint8Array(labels.length),region=new Int32Array(labels.length);
  const neighbours=new Uint32Array(colorCount+1);
  for(let seed=0;seed<labels.length;seed++){
    const label=labels[seed];
    if(!label||seen[seed])continue;
    seen[seed]=1;
    region[0]=seed;
    let length=1;
    neighbours.fill(0);
    function visit(index){
      const next=labels[index];
      if(next!==label){neighbours[next]++;return;}
      if(!seen[index]){seen[index]=1;region[length++]=index;}
    }
    for(let i=0;i<length;i++){
      const p=region[i],col=p%w;
      if(col)visit(p-1);
      if(col<w-1)visit(p+1);
      if(p>=w)visit(p-w);
      if(p<(h-1)*w)visit(p+w);
    }
    if(length>=min)continue;
    let target=0;
    for(let c=1;c<neighbours.length;c++){
      if(neighbours[c]>neighbours[target])target=c;
    }
    for(let i=0;i<length;i++)cleaned[region[i]]=target;
  }
  return cleaned;
}
function simplify(points,tolerance) {
  if(points.length<=5)return points;
  const open=[...points,points[0]];
  const keep=new Uint8Array(open.length);
  const middle=Math.floor((open.length-1)/2);
  keep[0]=keep[middle]=keep[open.length-1]=1;
  const stack=[[0,middle],[middle,open.length-1]];
  while(stack.length){
    const [a,b]=stack.pop();
    let best=tolerance*tolerance,chosen=-1;
    const [x,y]=open[a],dx=open[b][0]-x,dy=open[b][1]-y;
    const length=dx*dx+dy*dy;
    for(let i=a+1;i<b;i++){
      const px=open[i][0]-x,py=open[i][1]-y;
      const t=length?Math.max(0,Math.min(1,(px*dx+py*dy)/length)):0;
      const distance=(px-dx*t)**2+(py-dy*t)**2;
      if(distance>best){chosen=i;best=distance;}
    }
    if(chosen>=0){keep[chosen]=1;stack.push([a,chosen],[chosen,b]);}
  }
  const result=points.filter((_,i)=>keep[i]);
  return result.length>=3?result:points;
}
function traceEdges(labels,w,h,colors,detail,progress) {
  const edges=new Uint8Array(labels.length);
  for(let i=0;i<labels.length;i++){
    const label=labels[i],x=i%w;
    if(!label)continue;
    if(i<w||labels[i-w]!==label)edges[i]|=1;
    if(x===w-1||labels[i+1]!==label)edges[i]|=2;
    if(i>=labels.length-w||labels[i+w]!==label)edges[i]|=4;
    if(!x||labels[i-1]!==label)edges[i]|=8;
  }
  const layers=colors.map(color=>({fill:hex(color),rings:[]}));
  const tolerance=[1.65,1.15,.72,.50,.31][detail];
  let pointsTotal=0,contours=0,objects=0;
  for(let i=0;i<edges.length;i++){
    if(i%Math.max(w,Math.floor(h/8)*w)===0)progress(.56+.40*i/edges.length);
    for(let side=0;side<4&&edges[i];side++){
      if(!(edges[i]&(1<<side))) continue;
      const label=labels[i];
      let index=i,direction=side,x=i%w+ORIGIN[side][0],y=Math.floor(i/w)+ORIGIN[side][1];
      const initialX=x,initialY=y,vertices=[[x,y]];
      let area=0,closed=false;
      while(index>=0){
        edges[index]&=~(1<<direction);
        const [dx,dy]=DIRECTIONS[direction];
        area+=x*(y+dy)-y*(x+dx);
        x+=dx;y+=dy;
        if(x===initialX&&y===initialY){closed=true;break;}
        let next=-1;
        for(const turn of [1,0,3,2]){
          const d=(direction+turn)%4;
          const cx=x+CELL[d][0],cy=y+CELL[d][1];
          if(cx<0||cx>=w||cy<0||cy>=h)continue;
          const candidate=cy*w+cx;
          if(labels[candidate]===label&&(edges[candidate]&(1<<d))){next=candidate;if(d!==direction)vertices.push([x,y]);direction=d;break;}
        }
        index=next;
      }
      if(!closed||vertices.length<3||area===0)continue;
      const ring=simplify(vertices,tolerance);
      pointsTotal+=ring.length;
      if(pointsTotal>360000)throw Error("Gambar terlalu kompleks. Kurangi warna atau detail, atau naikkan pembersihan bintik.");
      if(area>0)objects++;
      layers[label-1].rings.push(ring);
      contours++;
    }
  }
  return {layers:layers.filter(layer=>layer.rings.length),points:pointsTotal,contours,objects,w,h};
}
export function vectorize(pixels,w,h,settings,progress=()=>{}) {
  if(settings.removeWhite) dropWhite(pixels,w,h);
  progress(.17);
  const monochrome=settings.mode==="mono";
  const colors=monochrome?[[26,32,49]]:paletteFor(pixels,settings.colors,settings.detail);
  progress(.35);
  const labels=classify(pixels,colors,monochrome?settings.threshold:null);
  progress(.54);
  return traceEdges(removeSpecks(labels,w,h,settings.noise,colors.length),w,h,colors,settings.detail,progress);
}
