'use strict';
const $ = id => document.getElementById(id);
let expandedPayout = null;
const payoutDetails = new Map();
const names = {main: 'Main', mini: 'Mini', nano: 'Nano'};
const chains = Object.keys(names).filter(key => document.getElementById(`chain-${key}`));
let snapshot = null, pending = false, disconnected = false;
const format = (n, decimals = 0) => n == null ? 'Unavailable' : n.toLocaleString(undefined, {maximumFractionDigits: decimals});
const rate = n => n == null ? 'Unavailable' : `${format(n / (n >= 1e6 ? 1e6 : 1e3), 2)} ${n >= 1e6 ? 'MH/s' : 'kH/s'}`;
const when = t => new Date(t * 1000).toLocaleString('en-GB', {timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}) + ' UTC';
function age(t) { const seconds = Math.max(0, Math.floor(Date.now()/1000-t)); return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds/60)}m ago` : seconds < 86400 ? `${Math.floor(seconds/3600)}h ago` : `${Math.floor(seconds/86400)}d ago`; }
function fresh(part) { return !!part && part.data != null && !part.error && Date.now()/1000-part.fetched_at < 120; }
function observerFresh(pool) { return fresh(pool?.info) && Date.now()/1000-pool.info.data.timestamp < 300; }
function node(tag, text, parent) { const n = document.createElement(tag); if (text != null) n.textContent = text; if (parent) parent.append(n); return n; }
function link(text, href, parent) { const a = node('a', text, parent); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
async function togglePayouts(pool, block) {
  const key = `${pool}/${block.id}`;
  if (expandedPayout === key) { expandedPayout=null;render();return; }
  expandedPayout=key;
  if (payoutDetails.get(key)?.data) { render();return; }
  payoutDetails.set(key,{loading:true});render();
  try {
    const response=await fetch(`/api/payouts/${key}`,{cache:'no-store',signal:AbortSignal.timeout(18000)});
    const data=await response.json();
    if (!response.ok) throw Error(data.error || 'Payouts unavailable. Please try again.');
    payoutDetails.set(key,{data});
  } catch(error) { payoutDetails.set(key,{error:error.message || 'Payouts unavailable. Please try again.'}); }
  render();
}
function payoutRow(block, key, ledger) {
  const tr=node('tr',null,ledger), td=node('td',null,tr);td.colSpan=6;td.className='payout-detail';td.id=`payout-${block.id}`;
  const state=payoutDetails.get(key);
  if (!state || state.loading) { node('p','Loading and verifying payouts…',td).setAttribute('role','status');return; }
  if (state.error) {
    node('p',state.error,td).setAttribute('role','status');
    const retry=node('button','Retry payouts',td);retry.type='button';retry.addEventListener('click',()=>{expandedPayout=null;togglePayouts(key.split('/')[0],block);});return;
  }
  const data=state.data;
  node('h3',`Block #${format(block.height)} · ${format(data.outputs.length)} payouts`,td);
  node('p',`${format(data.reward_atomic/1e12,12)} XMR total · All output amounts add up to this block's reward.`,td);
  const list=node('ol',null,td);list.className='payout-list';list.setAttribute('aria-label',`Individual payouts for block ${block.height}`);
  for (const output of data.outputs) {
    const li=node('li',null,list);node('span',`Output #${output.index}`,li);node('strong',`${format(output.amount_atomic/1e12,12)} XMR`,li);
  }
}
function render() {
  if (!snapshot) return;
  for (const key of chains) {
    const p = snapshot.pools[key], info = p.info?.data;
    $(`rate-${key}`).textContent = rate(info?.hashrate);
    $(`caption-${key}`).textContent = info ? `${format(info.miners)} miners in window${observerFresh(p) && !disconnected ? '' : ' · stale'}` : 'Awaiting observer';
  }
  const healthy=chains.map(key=>snapshot.pools[key]).filter(p=>observerFresh(p)&&['info','shares','blocks'].every(k=>fresh(p[k]))).length;
  $('status').textContent=disconnected?'Connection lost':chains.length===1?(healthy===1?`${names[chains[0]]} sidechain live`:`${names[chains[0]]} sidechain unavailable`):healthy===3?'All sidechains live':`${healthy} of 3 sidechains live`;
  $('status').classList.toggle('bad',disconnected||healthy!==chains.length);
  const fetched=chains.map(key=>snapshot.pools[key]).flatMap(p=>['info','shares','blocks'].map(k=>p[k]?.fetched_at)).filter(Boolean);
  $('updated').textContent=fetched.length?`Oldest refresh ${age(Math.min(...fetched))} · 30s cycle`:'Refreshes every 30 seconds';
  for(const key of chains) renderChain(key);
}
function renderChain(selected) {
  const $=id=>document.getElementById(`${selected}-${id}`);
  function metric(id, value, unit) { $(id).textContent = value; if (unit) node('small', unit, $(id)); }
  function svg(tag, attrs, text) { const n = document.createElementNS('http://www.w3.org/2000/svg',tag); for (const [k,v] of Object.entries(attrs)) n.setAttribute(k,v); if (text) n.textContent=text; $('reward-chart').append(n); return n; }
  const pool = snapshot.pools[selected], info = pool.info?.data;
  const shares = pool.shares?.data || [], blocks = pool.blocks?.data || [];
  const warnings = [];
  if (disconnected) warnings.push('Connection lost. Displayed values may be stale. Retrying automatically.');
  for (const k of ['info','shares','blocks']) if (!fresh(pool[k])) warnings.push(`${{info:'Pool stats', shares:'Shares', blocks:'Payouts'}[k]} ${pool[k]?.data ? 'are stale' : 'are unavailable'}.`);
  if (fresh(pool.info) && !observerFresh(pool)) warnings.push('The observer sidechain tip is more than 5 minutes old.');
  $('warning').hidden = warnings.length === 0;
  $('warning').textContent = warnings.join(' ');
  $('pool-label').textContent = names[selected]; $('source').href = pool.source + '/';
  metric('window-shares', format(info?.shares));
  $('uncle-count').textContent = info ? `Plus ${format(info.uncles)} uncle shares in window` : 'PPLNS window unavailable';
  metric('miners', format(info?.miners));
  metric('effort', format(info?.effort, 1), info?.effort != null ? '%' : '');
  const latest = blocks[0];
  metric('reward', latest ? format(latest.reward_atomic/1e12, 4) : 'Unavailable', latest ? 'XMR' : '');
  $('reward-age').textContent = latest ? `Block ${format(latest.height)} · ${age(latest.timestamp)}` : 'Waiting for observer';
  $('share-target').textContent = info ? `${info.block_time}s target` : 'Awaiting data';
  $('latest-share').textContent = shares[0] ? `#${format(shares[0].height)}` : 'Unavailable';
  $('share-strip').replaceChildren();
  for (const share of [...shares].reverse()) {
    const label = `Share ${share.height} · ${when(share.timestamp)}`;
    const a = link('', `${pool.source}/share/${share.id}`, $('share-strip'));
    a.title = label; a.setAttribute('aria-label', label);
  }
  $('share-start').textContent = shares.length ? when(shares.at(-1).timestamp) : 'No shares available';
  $('share-note').textContent = shares.length ? `${shares.length} latest observed shares, oldest to newest. Select a share to inspect it.` : 'Shares will appear when the observer responds.';
  const plotted = blocks.slice(0,30).reverse();
  $('reward-total').textContent = plotted.length ? `${format(plotted.reduce((n,b)=>n+b.reward_atomic,0)/1e12,4)} XMR` : 'Unavailable';
  $('reward-context').textContent = `across ${plotted.length} recent blocks`;
  $('reward-start').textContent = plotted.length ? when(plotted[0].timestamp) : 'No blocks available';
  $('reward-chart').replaceChildren();
  if (plotted.length) {
    const max = Math.max(...plotted.map(b=>b.reward_atomic/1e12)) * 1.12 || 1;
    for (let i=0;i<3;i++) { const y=120-i*50; svg('line',{x1:38,x2:600,y1:y,y2:y}); svg('text',{x:0,y:y+3}, format(max*i/2.4,2)); }
    plotted.forEach((b,i)=>{ const h=b.reward_atomic/1e12/max*120; const bar=svg('rect',{x:40+i*560/plotted.length,y:120-h,width:Math.max(2,560/plotted.length-5),height:h,rx:2}); const title=document.createElementNS(bar.namespaceURI,'title');title.textContent=`Block ${b.height}: ${format(b.reward_atomic/1e12,6)} XMR · ${when(b.timestamp)}`;bar.append(title); });
  }
  $('ledger').replaceChildren();
  for (const b of blocks.slice(0,20)) {
    const tr=node('tr',null,$('ledger'));
    link(`#${format(b.height)}`,`${pool.source}/share/${b.id}`,node('td',null,tr));
    const time=node('time',when(b.timestamp),node('td',null,tr)); time.dateTime=new Date(b.timestamp*1000).toISOString();
    node('td',`${format(b.reward_atomic/1e12,6)} XMR`,tr);
    const outputCell=node('td',null,tr), payoutButton=node('button',`${format(b.outputs)} payouts`,outputCell);
    const payoutKey=`${selected}/${b.id}`, currentPool=selected;
    payoutButton.type='button';payoutButton.className='payout-toggle';
    payoutButton.setAttribute('aria-expanded',String(expandedPayout===payoutKey));
    payoutButton.setAttribute('aria-label',`Show ${b.outputs} payouts for block ${b.height}`);
    payoutButton.addEventListener('click',()=>togglePayouts(currentPool,b));
    node('td',info && observerFresh(pool) && !disconnected ? format(Math.max(0,info.main_height-b.height+1)) : 'Unavailable',tr);
    link('View block ↗',`${pool.source}/share/${b.id}`,node('td',null,tr));
    if (expandedPayout===payoutKey) payoutRow(b,payoutKey,$('ledger'));
  }
  if (!blocks.length) { const td=node('td',fresh(pool.blocks) ? 'No blocks recorded yet. New payouts will appear automatically.' : 'No payout data available. Retrying automatically.',node('tr',null,$('ledger')));td.colSpan=6; }
}
async function refresh() {
  if (pending) return;
  pending=true;
  try { const response=await fetch('/api/stats',{cache:'no-store',signal:AbortSignal.timeout(15000)}); if (!response.ok) throw Error('Unavailable'); const next=await response.json(); if (!next.pools || !chains.every(k=>next.pools[k]?.source)) throw Error('Invalid data'); snapshot=next;disconnected=false;render(); }
  catch { disconnected=true; if (snapshot) render(); else { $('status').textContent='Connection unavailable';$('status').classList.add('bad');for(const key of chains){const warning=$(`${key}-warning`);warning.hidden=false;warning.textContent='Unable to load live data. Retrying automatically.';} } }
  finally { pending=false; }
}
function setTheme(theme) { document.documentElement.dataset.theme=theme; $('theme').textContent=theme==='dark'?'Light mode':'Dark mode'; }
let initial=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
try { initial=localStorage.getItem('p2pool-theme')||initial; } catch {}
setTheme(initial);
$('theme').addEventListener('click',()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';setTheme(t);try{localStorage.setItem('p2pool-theme',t);}catch{}});
refresh();setInterval(refresh,30000);setInterval(()=>{if(snapshot)render();},10000);
