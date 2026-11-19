import {vectorize} from "./trace.mjs?v=8";

self.onmessage=event=>{
  const {id,pixels,w,h,settings}=event.data;
  try {
    const result=vectorize(pixels,w,h,settings,value=>self.postMessage({id,progress:value}));
    self.postMessage({id,result});
  } catch (error) {
    self.postMessage({id,error:error.message});
  }
};
