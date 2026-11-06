import {test} from 'node:test';
import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';

test('actual worker protocol analyzes, returns details and creates a valid ZIP',async()=>{
 const messages:any[]=[];
 const worker={postMessage:(message:any)=>messages.push(message),onmessage:null as any};
 (globalThis as any).self=worker;
 await import('../src/worker.ts');
 const bytes=new TextEncoder().encode('[{"bookSourceName":"😀","bookSourceUrl":"local","huge":900719925474099312345}, {"theme":"dark"}]');
 await worker.onmessage({data:{type:'analyze',filename:'worker.json',bytes:bytes.buffer}});
 assert.equal(messages.at(-1).summary.counts.valid,1);
 await worker.onmessage({data:{type:'detail',index:1,requestId:1}});
 assert.ok(messages.at(-1).value.fixed.includes('900719925474099312345'));
 await worker.onmessage({data:{type:'export',kind:'zip',batchSize:1,confirmed:true,requestId:2,device:{version:'manual-test',result:'导入成功（用户记录）'}}});
 const last=messages.at(-1);assert.equal(last.type,'response');assert.equal(last.error,undefined);
 const entries=unzipSync(new Uint8Array(last.value.bytes));
 assert.equal(Object.keys(entries).length,4);
 assert.ok(strFromU8(entries['worker_鸿蒙修正版.json']).includes('900719925474099312345'));
 assert.equal(JSON.parse(strFromU8(entries['worker_排除项.json']))[0].theme,'dark');
 const report=JSON.parse(strFromU8(entries['worker_诊断报告.json']));
 assert.equal(report.input.sha256.length,64);
 assert.ok(report.toolVersion);
 assert.ok(report.ruleVersion);
 assert.equal(report.validation.device.version,'manual-test');
 delete (globalThis as any).self;
});
