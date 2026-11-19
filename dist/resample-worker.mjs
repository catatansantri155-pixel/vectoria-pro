import {resample} from "./resample.mjs?v=14";
self.onmessage=({data:{pixels,w,h,width,height,sharp}})=>{
  try{
    const output=resample(pixels,w,h,width,height,sharp);
    self.postMessage({output},[output.buffer]);
  }catch(error){self.postMessage({error:error.message});}
};
