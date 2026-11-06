import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,copyFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {zipSync,strToU8} from 'fflate';
const root=resolve(import.meta.dirname,'..');process.chdir(root);
const go=process.env.GO_BINARY||'go';
const {version}=JSON.parse(readFileSync('package.json','utf8'));
const release=join(root,'release');mkdirSync(release,{recursive:true});
const checksum=[];
for(const [os,arch] of [['windows','amd64'],['linux','amd64'],['linux','arm64']]){
 const folder=join(release,`${os}-${arch}`);mkdirSync(folder,{recursive:true});
 const executable=`booksource-fixer${os==='windows'?'.exe':''}`;
 const output=join(folder,executable);
 const run=spawnSync(go,['build','-trimpath','-ldflags=-s -w','-o',output,'./server'],{stdio:'inherit',env:{...process.env,CGO_ENABLED:'0',GOOS:os,GOARCH:arch}});
 if(run.status!==0)process.exit(run.status||1);
 copyFileSync('README.md',join(folder,'README.md'));
 copyFileSync('README_EN.md',join(folder,'README_EN.md'));
 const inputs={[executable]:[new Uint8Array(readFileSync(output)),{attrs:0o100755<<16,os:3}],'README.md':strToU8(readFileSync('README.md','utf8')),'README_EN.md':strToU8(readFileSync('README_EN.md','utf8')),'THIRD_PARTY_NOTICES.md':strToU8(readFileSync('THIRD_PARTY_NOTICES.md','utf8'))};
 for(const name of readdirSync('licenses'))inputs[`licenses/${name}`]=new Uint8Array(readFileSync(join('licenses',name)));
 const zip=zipSync(inputs,{level:6});
 const zipName=`booksource-fixer-${version}-${os}-${arch}.zip`;writeFileSync(join(release,zipName),zip);
 checksum.push(`${createHash('sha256').update(zip).digest('hex')}  ${zipName}`);
 console.log('Built',zipName);
}
writeFileSync(join(release,'SHA256SUMS.txt'),checksum.join('\n')+'\n');
