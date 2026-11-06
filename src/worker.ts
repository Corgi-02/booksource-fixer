/// <reference lib="webworker" />
import { zipSync, strToU8 } from 'fflate';
import { analyzeBytes, summarize, entryDetail, buildExports, type Analysis } from './engine';
let analysis: Analysis | undefined;
self.onmessage = async (event: MessageEvent) => {
  const { type, requestId } = event.data;
  try {
    if (type === 'analyze') {
      self.postMessage({type:'progress',value:20});
      analysis = analyzeBytes(new Uint8Array(event.data.bytes), event.data.filename);
      self.postMessage({type:'done',summary:summarize(analysis)});
      return;
    }
    if (!analysis) throw Error('文件尚未诊断完成');
    if (type === 'detail') {
      self.postMessage({type:'response',requestId,value:entryDetail(analysis,event.data.index)}); return;
    }
    if (type === 'export') {
      const {kind,batchSize,confirmed,device} = event.data;
      const files = buildExports(analysis,batchSize,confirmed,device,kind==='report'||kind==='excluded');
      let bytes: Uint8Array; let filename: string;
      if (kind === 'zip') {
        const inputs: Record<string, Uint8Array> = Object.create(null);
        for (const [name,text] of Object.entries(files)) inputs[name]=strToU8(text);
        bytes=zipSync(inputs,{level:6});filename='书源修正结果.zip';
      } else {
        const suffix = kind==='full' ? '_鸿蒙修正版.json' : kind==='report' ? '_诊断报告.json' : '_排除项.json';
        const name=Object.keys(files).find(name=>name.endsWith(suffix));
        if (!name) throw Error('当前没有可下载的此类结果');
        filename=name;bytes=strToU8(files[name]);
      }
      self.postMessage({type:'response',requestId,value:{filename,bytes:bytes.buffer}},[bytes.buffer]);
    }
  } catch(error) {
    self.postMessage({type:requestId?'response':'failed',requestId,error:error instanceof Error?error.message:String(error)});
  }
};
