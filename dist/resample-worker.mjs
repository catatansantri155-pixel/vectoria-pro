import {upscaleDetail} from "./upscale-detail.mjs?v=2";
self.onmessage=({data:{pixels,w,h,width,height,sharp,clarity}})=>{
  try{
    const output=upscaleDetail(pixels,w,h,width,height,sharp,clarity);
    self.postMessage({output},[output.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
