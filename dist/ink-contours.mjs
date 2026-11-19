// Edges are ordered top, right, bottom, left. Each pair keeps ink on its right.
const EDGES=[
  [],[0,3],[1,0],[1,3],[2,1],[0,3,2,1],[2,0],[2,3],
  [3,2],[0,2],[1,0,3,2],[1,2],[3,1],[0,1],[3,0],[]
];
const CONNECT_FIVE=[0,1,2,3];
const CONNECT_TEN=[1,2,3,0];

export function isoRings(field,w,h,progress){
  const stride=w+2,next=new Map();
  for(let y=0;y<=h;y++){
    for(let x=0;x<=w;x++){
      const cell=y*stride+x;
      const a=field[cell],b=field[cell+1],c=field[cell+stride+1],d=field[cell+stride];
      const mask=(a>0?1:0)|(b>0?2:0)|(c>0?4:0)|(d>0?8:0);
      if(mask===0||mask===15)continue;
      const edges=mask===5&&a*c>b*d?CONNECT_FIVE:mask===10&&b*d>a*c?CONNECT_TEN:EDGES[mask];
      const ids=[cell*2,(cell+1)*2+1,(cell+stride)*2,cell*2+1];
      for(let i=0;i<edges.length;i+=2)next.set(ids[edges[i]],ids[edges[i+1]]);
      if(next.size>1200000)throw Error("Kontur terlalu rumit. Kurangi detail gambar atau bagi gambar menjadi beberapa bagian.");
    }
    if(y%32===0)progress(.4+.4*y/h);
  }

  function point(edge){
    const vertical=edge%2,cell=Math.floor(edge/2);
    const a=field[cell],b=field[cell+(vertical?stride:1)],offset=a/(a-b);
    const x=cell%stride-.5,y=Math.floor(cell/stride)-.5;
    return [Math.max(0,Math.min(w,x+(vertical?0:offset))),Math.max(0,Math.min(h,y+(vertical?offset:0)))];
  }
  const rings=[];
  for(const start of next.keys()){
    const ring=[];
    let edge=start;
    do{
      const p=point(edge);
      const previous=ring.at(-1);
      if(!previous||p[0]!==previous[0]||p[1]!==previous[1])ring.push(p);
      const to=next.get(edge);
      next.delete(edge);
      edge=to;
    }while(edge!==start&&edge!==undefined);
    if(edge!==start||ring.length<3)continue;
    const [firstX,firstY]=ring[0],last=ring.at(-1);
    if(last[0]===firstX&&last[1]===firstY)ring.pop();
    if(ring.length>=3)rings.push(ring);
  }
  return rings;
}
