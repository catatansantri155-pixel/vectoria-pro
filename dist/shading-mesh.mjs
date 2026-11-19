const channels=[0,1,2];
const luma=(pixels,i)=>Math.round(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2]);
const hex=value=>value.toString(16).padStart(2,"0");
const color=(r,g,b)=>"#"+hex(r)+hex(g)+hex(b);

export function hasSmoothShading(pixels,w,h){
  let continuous=0,total=0;
  for(let y=3;y<h-3;y+=4){
    for(let x=3;x<w-3;x+=4){
      const i=(y*w+x)*4;
      if(pixels[i+3]<250)continue;
      total++;
      const horizontal=trend(i,12),vertical=trend(i,w*12);
      if(horizontal||vertical)continuous++;
    }
  }
  return total>=40&&continuous/total>.12;

  function trend(i,step){
    return channels.some(c=>{
      const a=pixels[i+c]-pixels[i+c-step],b=pixels[i+c+step]-pixels[i+c];
      return a*b>0&&Math.min(Math.abs(a),Math.abs(b))>=2&&Math.max(Math.abs(a),Math.abs(b))<=22;
    });
  }
}

export function wantsSmoothShading(pixels,w,h,settings){
  if(settings.contourOutput)return false;
  if(settings.mode==="mono"){
    if(settings.monoStyle==="tone")return true;
    if(settings.monoStyle==="ink"||!settings.monoAuto||settings.monoInvert||settings.monoBackground==="transparent")return false;
  }else{
    if(settings.removeWhite||settings.isolatedPaper)return false;
    if(settings.profile==="gradient")return true;
    if(settings.profile!=="auto")return false;
  }
  return hasSmoothShading(pixels,w,h);
}

export function canUseMesh(pixels,w,h){
  if(w<2||h<2)return false;
  for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255)return false;
  return true;
}

export function shadingMesh(pixels,w,h,{detail,gray},progress){
  const scale=Math.min(1,1200/Math.max(w,h));
  const cols=Math.max(2,Math.round(w*scale)),height=Math.max(2,Math.round(h*scale));
  const samples=new Uint8Array(cols*height*3);
  for(let y=0;y<height;y++){
    const fy=Math.min(h-1,Math.max(0,(y+.5)*h/height-.5)),a=Math.floor(fy),b=Math.min(h-1,a+1),v=fy-a;
    for(let x=0;x<cols;x++){
      const fx=Math.min(w-1,Math.max(0,(x+.5)*w/cols-.5)),l=Math.floor(fx),r=Math.min(w-1,l+1),u=fx-l;
      const i=(a*w+l)*4,j=(a*w+r)*4,k=(b*w+l)*4,m=(b*w+r)*4;
      const to=(y*cols+x)*3;
      for(const c of channels){
        const value=(pixels[i+c]*(1-u)+pixels[j+c]*u)*(1-v)+(pixels[k+c]*(1-u)+pixels[m+c]*u)*v;
        samples[to+c]=Math.round(value);
      }
      if(gray){
        const value=luma(samples,to);
        samples[to]=samples[to+1]=samples[to+2]=value;
      }
    }
  }
  const maxSpan=[14,11,8,6,4][detail],verticalError=[20,16,12,9,7][detail],
    horizontalError=[8,6,4,3,2][detail];
  const stride=cols*3,rows=[];
  function addRows(a,b){
    if(b-a<2){rows.push(a);return;}
    let split=false;
    // Test every interior row so a small highlight between sampled rows is still retained.
    for(let y=a+1;y<b&&!split;y++){
      const t=(y-a)/(b-a);
      for(let x=0;x<stride;x++){
        const error=Math.abs(samples[y*stride+x]-((1-t)*samples[a*stride+x]+t*samples[b*stride+x]));
        if(error>verticalError){split=true;break;}
      }
    }
    if(split){
      const middle=(a+b)>>1;
      addRows(a,middle);addRows(middle,b);
    }else rows.push(a);
  }
  for(let y=0;y<height-1;y+=maxSpan)addRows(y,Math.min(height-1,y+maxSpan));
  rows.push(height-1);
  progress(.55);
  let points=0;
  const mesh=rows.map((y,index)=>{
    const row=samples.subarray(y*stride,(y+1)*stride),kept=[0];
    const stack=[[0,cols-1]];
    while(stack.length){
      const [a,b]=stack.pop();
      let worst=horizontalError,chosen=-1;
      for(let x=a+1;x<b;x++){
        const t=(x-a)/(b-a);
        for(const c of channels){
          const error=Math.abs(row[x*3+c]-((1-t)*row[a*3+c]+t*row[b*3+c]));
          if(error>worst){worst=error;chosen=x;}
        }
      }
      if(chosen!==-1)stack.push([chosen,b],[a,chosen]);
      else kept.push(b);
    }
    points+=kept.length;
    if(index%32===0)progress(.55+.42*index/rows.length);
    return {y:(y+.5)*h/height,stops:kept.map(x=>[(x+.5)/cols,color(row[x*3],row[x*3+1],row[x*3+2])])};
  });
  return {w,h,mesh,layers:[],points,objects:mesh.length-1};
}
