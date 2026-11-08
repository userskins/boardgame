import {fresh,settle,view,next,start,finish,choose,prepareTurn} from './rules.js?v=free4';
import {BROKERS,RoomRelay} from './relay.js?v=443v2';
let current=null,generation=0,wakeLock=null;
const pending=new Map(),seen=new Map();
const randomId=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join('');
const root=room=>'kroko/portfolio/free4/'+room+'/';
function notify(message){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('kroko-connection',{detail:message}));}
function readyPaths(s=current){return s?[...s.paths.values()].filter(p=>p.ready&&p.subscribed):[];}
function save(){if(current?.host)try{localStorage.setItem('kroko-free4-host-'+current.room,JSON.stringify(current.game))}catch(e){}}
function hostResult(token,body){const s=current.game;if(Date.now()-s.created>86400000)throw Error('Комната устарела. Создайте новую.');const before=s.phase;settle(s);let changed=before!==s.phase;if(changed){s.revision++;save()}if(body){perform(s,token,body);changed=true}if(changed)save();return {code:current.room,state:view(s,token)};}
function receive(topic,m,relay){
 if(!current||!m||typeof m.id!=='string')return;
 if(current.host){
  if(topic!==root(current.room)+'ask'||typeof m.token!=='string'||!/^[a-zA-Z0-9_-]{12,100}$/.test(m.token)||m.id.length>100)return;
  const key=m.token+':'+m.id;let answer=seen.get(key);
  if(!answer){try{answer={id:m.id,...hostResult(m.token,m.body)}}catch(e){answer={id:m.id,error:e.message}}seen.set(key,answer);if(seen.size>200)seen.delete(seen.keys().next().value);}
  relay.publish(root(current.room)+'reply/'+m.token,answer);
 }else if(topic===root(current.room)+'reply/'+current.token){const p=pending.get(m.id);if(p){clearTimeout(p.timer);clearInterval(p.retry);pending.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve({code:m.code,state:m.state})}}
}
export function closeRoom(){generation++;for(const p of pending.values()){clearTimeout(p.timer);clearInterval(p.retry);p.reject(Error('Вы вышли из комнаты'))}pending.clear();seen.clear();if(current)for(const relay of current.paths.values())relay.close();clearInterval(current?.heartbeat);current=null;wakeLock?.release().catch(()=>{});wakeLock=null;}
async function connectPath(s,key){
 if(s.paths.get(key)?.ready&&s.paths.get(key)?.subscribed)return s.paths.get(key);if(s.connecting.has(key))return s.connecting.get(key);
 const gen=generation;const promise=(async()=>{
  s.paths.get(key)?.close();const relay=new RoomRelay(BROKERS[key],{onMessage:(topic,m)=>receive(topic,m,relay)});s.paths.set(key,relay);
  await relay.connect();if(gen!==generation){relay.close();throw Error('Комната закрыта')}
  await relay.subscribe(root(s.room)+(s.host?'ask':'reply/'+s.token));relay.subscribed=true;return relay;
 })().finally(()=>s.connecting.delete(key));s.connecting.set(key,promise);return promise;
}
async function connectSession(){
 const s=current;if(!s)throw Error('Комната закрыта');const wasReady=readyPaths(s).length>0;
 const attempts=Object.keys(BROKERS).map(key=>connectPath(s,key));
 if(wasReady){attempts.forEach(p=>p.catch(()=>{}));return}
 notify('Подключаем службу связи…');
 try{await Promise.any(attempts)}catch(e){throw Error('Службы связи недоступны. Проверьте интернет или попробуйте другую сеть.');}
 notify(s.host?'Проверяем обмен сообщениями…':'Ожидаем главный экран…');
}
async function openSession(room,token,initial){
 if(current?.room===room&&current.token===token){await connectSession();return}
 closeRoom();let stored=null;try{stored=JSON.parse(localStorage.getItem('kroko-free4-host-'+room))}catch(e){}
 const host=!!initial||stored?.host===token;current={room,token,host,game:initial||(host?stored:null),paths:new Map(),connecting:new Map(),heartbeat:null};
 await connectSession();if(host){save();current.heartbeat=setInterval(()=>{if(current?.host)hostResult(current.token)},500);await keepAwake();}
}
async function keepAwake(){if(!current?.host||document.visibilityState!=='visible'||wakeLock)return;try{wakeLock=await navigator.wakeLock?.request('screen');wakeLock?.addEventListener('release',()=>{wakeLock=null})}catch(e){}}
if(typeof document!=='undefined'){document.addEventListener('click',keepAwake);document.addEventListener('visibilitychange',keepAwake)}
async function verifyRoute(){
 const room=current.room;const checks=Object.entries(BROKERS).map(async([key,config])=>{
  if(!current?.paths.get(key)?.subscribed)await connectPath(current,key);
  const token='check-'+randomId(),id=randomId();let resolveReply,timer;
  const answer=new Promise(resolve=>{resolveReply=resolve});
  const probe=new RoomRelay(config,{onMessage:(topic,m)=>{if(m?.id===id&&m.code===room)resolveReply();}});
  try{await probe.connect();await probe.subscribe(root(room)+'reply/'+token);probe.publish(root(room)+'ask',{id,token,body:null});await Promise.race([answer,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Нет обмена сообщениями')),6000)})]);}
  finally{clearTimeout(timer);probe.close();}
 });
 try{await Promise.any(checks)}catch(e){throw Error('Служба связи открылась, но сообщения не проходят. Попробуйте другую сеть.');}
}
export async function roomRequest(path,token,body){
 if(path==='/api/create'){
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const room='S'+Array.from(crypto.getRandomValues(new Uint8Array(5)),v=>alphabet[v%32]).join('');
  const game=fresh(token);game.displayHost=true;try{await openSession(room,token,game);await verifyRoute();return hostResult(token)}catch(e){closeRoom();throw e;}
 }
 const room=new URL(path,location.href).searchParams.get('room')?.toUpperCase();
 if(!/^S[A-Z2-9]{5}$/.test(room||''))throw Error('Создайте новую комнату в обновлённой игре и введите её код из 6 символов');
 await openSession(room,token);if(current.host)return hostResult(token,body);
 return new Promise((resolve,reject)=>{
  const id=randomId();const send=()=>{for(const relay of readyPaths())try{relay.publish(root(room)+'ask',{id,token,body:body||null})}catch(e){}};
  const timer=setTimeout(()=>{const p=pending.get(id);if(p)clearInterval(p.retry);pending.delete(id);if(current)for(const relay of current.paths.values())relay.close();reject(Error('Главный экран не отвечает. Проверьте новый код и оставьте вкладку ведущего открытой.'))},15000);
  const retry=setInterval(send,1800);pending.set(id,{resolve,reject,timer,retry});send();
 });
}

export function perform(s,token,b){
 if(!b)return;const isHost=s.host===token,active=s.teams[s.turn]?.owner===token;
 if(b.action==='join'){
  if(s.displayHost&&isHost)throw Error('Главный экран не занимает команду. Подключитесь с телефона.');
  if(s.phase!=='lobby')throw Error('Игра уже началась. Вернитесь с телефона своей команды.');
  if(!Number.isInteger(b.team)||b.team<0||b.team>=s.teams.length)throw Error('Выберите команду');
  if(s.teams[b.team].owner&&s.teams[b.team].owner!==token)throw Error('Эта команда уже занята');
  s.teams.forEach(t=>{if(t.owner===token)t.owner=null});s.teams[b.team].owner=token;
  if(typeof b.name==='string'&&b.name.trim())s.teams[b.team].name=b.name.trim().slice(0,28);
 }else if(b.action==='launch'&&isHost&&s.phase==='lobby'){
  const joined=s.teams.filter(t=>t.owner);if(joined.length<2)throw Error('Нужно минимум две команды на разных телефонах');
  s.teams=joined;prepareTurn(s);
 }else if(b.action==='choose'&&(active||isHost)&&s.phase==='ready'){
  if(b.index!==s.index)throw Error('Ход уже сменился');choose(s,b.row,b.col);
 }else if(b.action==='start'&&(active||(isHost&&s.displayHost))&&s.phase==='ready')start(s);
 else if(['yes','skip'].includes(b.action)&&active&&s.phase==='playing'){
  if(b.index!==s.index)throw Error('Карточка уже сменилась');
  if(Date.now()>=s.end){settle(s);throw Error('Время уже вышло')}
  finish(s,b.action);
 }else if(b.action==='next'&&(active||isHost)&&s.phase==='result')next(s);
 else if(b.action==='reset'&&isHost){s.teams.forEach(t=>{t.pos=0;t.cell=null;t.finished=false});s.turn=0;s.round=1;s.score=0;s.skips=0;prepareTurn(s);s.history=[];}
 else throw Error('Сейчас это действие недоступно');
 s.revision++;
}
