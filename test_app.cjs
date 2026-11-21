const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map();
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.handlers={};this._text='';this.classList={toggle(){},add(){}};}
 set id(v){this._id=v;elements.set(v,this);}get id(){return this._id;}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 append(n){this.children.push(n);}replaceChildren(){this.children=[];this._text='';}setAttribute(k,v){this.attrs[k]=v;}addEventListener(k,v){this.handlers[k]=v;}
}
const buttons=['main','mini','nano'].map(p=>{const e=new Element('button');e.dataset.pool=p;return e;});
const data=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
for(const p of Object.values(data.pools))p.blocks.fetched_at=Math.floor(Date.now()/1000);
const document={documentElement:new Element('html'),getElementById(id){return elements.get(id)||null;},createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t),querySelectorAll:()=>buttons};
const selected=process.argv[3];
const html=selected?require('node:child_process').execFileSync('python3',['-c',`import server;print(server.chain_page('${selected}').decode())`],{cwd:__dirname,encoding:'utf8'}):fs.readFileSync(__dirname+'/static/index.html','utf8');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'Unique page IDs');
for(const id of ids){const e=new Element();e.id=id;}
for(const p of Object.values(data.pools)){for(const k of ['info','blocks','shares'])p[k].fetched_at=Math.floor(Date.now()/1000);p.info.data.timestamp=Math.floor(Date.now()/1000);}
const sandbox={document,matchMedia:()=>({matches:false}),localStorage:{getItem(){return null;},setItem(){}},AbortSignal,Date,console,setInterval(){},fetch:async()=>({ok:true,json:async()=>data})};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(__dirname+'/static/app.js','utf8'),sandbox);
setImmediate(()=>{
 if(selected){
  assert.equal(elements.get(`${selected}-share-strip`).children.length,60);
  assert.equal(elements.get(`${selected}-ledger`).children.length,Math.min(20,data.pools[selected].blocks.data.length));
  assert.equal(elements.get('status').textContent,`${selected[0].toUpperCase()+selected.slice(1)} sidechain live`);
  for(const other of ['main','mini','nano'].filter(k=>k!==selected)){
   assert.equal(elements.has(`chain-${other}`),false);
   data.pools[other].info.error='Unrelated outage';
  }
  vm.runInContext('render()',sandbox);
  assert.equal(elements.get(`${selected}-warning`).hidden,true);
  vm.runInContext('disconnected=true;render()',sandbox);
  assert.match(elements.get(`${selected}-warning`).textContent,/Connection lost/);
  console.log(`PASS: /${selected} renders only its chain, ignores other chains' outages, and shows connection failures.`);
  return;
 }

 for(const key of ['main','mini','nano']){
  assert.equal(elements.get(`${key}-ledger`).children.length,Math.min(20,data.pools[key].blocks.data.length));
  assert.equal(elements.get(`${key}-share-strip`).children.length,60);
  assert.equal(elements.get(`${key}-miners`).textContent,data.pools[key].info.data.miners.toLocaleString());
  assert.equal(elements.get(`${key}-source`).href,data.pools[key].source+'/');
  assert.equal(elements.get(`${key}-reward-chart`).children.filter(c=>c.tag==='rect').length,Math.min(30,data.pools[key].blocks.data.length));
  assert.match(html,new RegExp(`href="#chain-${key}"`));
 }
 assert.equal(elements.get('status').textContent,'All sidechains live');
 sandbox.detail={outputs:[{index:0,amount_atomic:1},{index:1,amount_atomic:123456789012}],reward_atomic:123456789013};
 vm.runInContext('expandedPayout=`nano/${snapshot.pools.nano.blocks.data[0].id}`;payoutDetails.set(expandedPayout,{data:detail});render()',sandbox);
 assert.equal(elements.get('nano-ledger').children.length,Math.min(20,data.pools.nano.blocks.data.length)+1);
 assert.equal(elements.get('main-ledger').children.length,Math.min(20,data.pools.main.blocks.data.length));
 assert.match(elements.get('nano-ledger').children[1].textContent,/0.000000000001 XMR/);
 data.pools.mini.blocks.error='Test outage';vm.runInContext('render()',sandbox);
 assert.equal(elements.get('mini-warning').hidden,false);
 assert.equal(elements.get('main-warning').hidden,true);
 vm.runInContext('disconnected=true;render()',sandbox);for(const key of ['main','mini','nano'])assert.match(elements.get(`${key}-warning`).textContent,/Connection lost/);
 elements.get('theme').handlers.click();assert.equal(document.documentElement.dataset.theme,'dark');
 console.log('PASS: three complete chain dashboards, unique IDs, correct per-chain data/charts/links, isolated expandable payouts, per-chain stale and disconnected states, theme toggle.');
});
