import {resample} from "./resample.mjs?v=14";

const limit=(value,min,max)=>Math.max(min,Math.min(max,value));

function boxBlurInPlace(src,tmp,w,h,r){
  const d=2*r+1;
  for(let y=0;y<h;y++){
    const row=y*w;
    let sum=0;
    for(let x=-r;x<=r;x++)sum+=src[row+limit(x,0,w-1)];
    for(let x=0;x<w;x++){
      tmp[row+x]=sum/d;
      sum+=src[row+limit(x+r+1,0,w-1)]-src[row+limit(x-r,0,w-1)];
    }
  }
  for(let x=0;x<w;x++){
    let sum=0;
    for(let y=-r;y<=r;y++)sum+=tmp[limit(y,0,h-1)*w+x];
    for(let y=0;y<h;y++){
      src[y*w+x]=sum/d;
      sum+=tmp[limit(y+r+1,0,h-1)*w+x]-tmp[limit(y-r,0,h-1)*w+x];
    }
  }
}

export function upscaleDetail(pixels,w,h,width,height,enhance,clarity){
  const output=resample(pixels,w,h,width,height,enhance);
  if(!enhance||width<3||height<3)return output;

  // Keep luminance premultiplied so outside pixels cannot outline transparent artwork.
  const light=new Uint8Array(width*height);
  for(let i=0;i<light.length;i++){
    const p=i*4;
    light[i]=Math.round((.2126*output[p]+.7152*output[p+1]+.0722*output[p+2])*output[p+3]/255);
  }
  const step=limit(Math.round(Math.min(width/w,height/h)*.75),1,3);
  const span=step*width;
  function sample(x,y){
    const u=Math.floor(x),v=Math.floor(y),dx=x-u,dy=y-v,i=v*width+u;
    return (light[i]*(1-dx)+light[i+1]*dx)*(1-dy)+(light[i+width]*(1-dx)+light[i+width+1]*dx)*dy;
  }

  // Follow strong edges along the tangent, then recover contrast across the edge.
  for(let y=step;y<height-step;y++){
    for(let x=step;x<width-step;x++){
      const i=y*width+x,p=i*4;
      if(output[p+3]<250)continue;
      const center=light[i],left=light[i-step],right=light[i+step],top=light[i-span],bottom=light[i+span];
      const gx=right-left,gy=bottom-top,strength=Math.hypot(gx,gy);
      if(strength<14)continue;
      const nx=gx/strength,ny=gy/strength;
      const tangent=(sample(x-ny*step*.85,y+nx*step*.85)+sample(x+ny*step*.85,y-nx*step*.85))*.5;
      const normal=(sample(x-nx*step*.9,y-ny*step*.9)+sample(x+nx*step*.9,y+ny*step*.9))*.5;
      const low=Math.min(center,left,right,top,bottom),high=Math.max(center,left,right,top,bottom);
      const corrected=limit(center+limit((tangent-center)*.6,-9,9)+(center-normal)*.55,low,high);
      const minChannel=Math.min(output[p],output[p+1],output[p+2]);
      const maxChannel=Math.max(output[p],output[p+1],output[p+2]);
      const delta=Math.round(limit(corrected-center,Math.max(-15,-minChannel),Math.min(15,255-maxChannel)));
      output[p]+=delta;
      output[p+1]+=delta;
      output[p+2]+=delta;
    }
  }

  if(clarity&&width>=8&&height>=8){
    // Kejelasan: kontras lokal radius besar. Penajam tepi di atas dijepit ke
    // rentang tetangga dekat, jadi pada gambar bergradasi halus koreksinya
    // nyaris nol. Pass ini membandingkan tiap piksel dengan rata-rata
    // lingkungan lebarnya dan memulihkan kontras skala menengah yang hilang
    // saat pembesaran. Luminansi premultiplied, sama seperti penajam tepi.
    const lum=new Float32Array(width*height);
    for(let i=0;i<lum.length;i++){
      const p=i*4;
      lum[i]=(.2126*output[p]+.7152*output[p+1]+.0722*output[p+2])*output[p+3]/255;
    }
    const radius=limit(Math.round(Math.max(width,height)/170),4,24);
    const blurred=new Float32Array(lum),scratch=new Float32Array(lum.length);
    boxBlurInPlace(blurred,scratch,width,height,radius);
    boxBlurInPlace(blurred,scratch,width,height,radius);
    for(let i=0;i<lum.length;i++){
      const p=i*4;
      if(output[p+3]<250)continue;
      const delta=Math.round(limit((lum[i]-blurred[i])*.5,-80,80));
      if(!delta)continue;
      output[p]+=delta;
      output[p+1]+=delta;
      output[p+2]+=delta;
    }
  }
  return output;
}
