import {BANKS} from './cards-data.js';
export const MODES={show:'Показывай',explain:'Объясняй',draw:'Рисуй'};
export const CATEGORIES=Object.values(MODES);
export const TASK_TYPES=['','Два глагола в начальной форме','Три существительных','Сложное необычное слово','Личность или фильм','Два прилагательных'];
export const CARDS=Object.entries(BANKS).flatMap(([mode,groups])=>Object.entries(groups).flatMap(([number,lines])=>lines.split('\n').map((line,i)=>({id:`${mode}-${number}-${i+1}`,mode,number:+number,items:line.split(' | '),text:line.replaceAll(' | ','\n'),cat:TASK_TYPES[+number]}))));
const cardById=new Map(CARDS.map(c=>[c.id,c]));
const names=['Красные крокодилы','Зелёные крокодилы','Синие крокодилы','Жёлтые крокодилы'];
const colors=['#ef6452','#42ad75','#4a78d1','#efb63f'];
export const COLUMN_MODES=['show','draw','explain','show','draw','explain'];
export const STARTS=[{row:4,col:0},{row:0,col:0},{row:4,col:5},{row:0,col:5}];
export const GOALS=[{row:0,col:5},{row:4,col:5},{row:0,col:0},{row:4,col:0}];
const same=(a,b)=>!!a&&!!b&&a.row===b.row&&a.col===b.col;
export function fieldAt(cell){return {...cell,mode:COLUMN_MODES[cell.col],number:cell.row+1};}
export function fieldFor(team){return fieldAt(team.cell||STARTS[team.lane]);}
export function movesFor(team){
 if(!team.cell)return [fieldAt(STARTS[team.lane])];
 const {row,col}=team.cell;
 return [{row:row-1,col,direction:'up',arrow:'↑'},{row:row+1,col,direction:'down',arrow:'↓'},{row,col:col-1,direction:'left',arrow:'←'},{row,col:col+1,direction:'right',arrow:'→'}].filter(p=>p.row>=0&&p.row<5&&p.col>=0&&p.col<6).map(fieldAt);
}
export function prepareTurn(s){s.phase='ready';s.task=null;s.activeCard=null;s.outcome=null;s.end=0;s.destination=s.teams[s.turn].cell?null:{...STARTS[s.teams[s.turn].lane]};}
export function choose(s,row,col){
 if(s.phase!=='ready'||!Number.isInteger(row)||!Number.isInteger(col)||!movesFor(s.teams[s.turn]).some(p=>p.row===row&&p.col===col))throw Error('Можно выбрать только соседнюю клетку вверх, вниз, влево или вправо.');
 s.destination={row,col};
}
function shuffled(items){const out=[...items];for(let i=out.length-1;i>0;i--){const range=i+1,limit=Math.floor(4294967296/range)*range;let value;do{value=crypto.getRandomValues(new Uint32Array(1))[0]}while(value>=limit);const j=value%range;[out[i],out[j]]=[out[j],out[i]]}return out;}
export function fresh(token){
 const decks={};for(const mode of Object.keys(MODES))for(let n=1;n<=5;n++)decks[`${mode}-${n}`]=shuffled(CARDS.filter(c=>c.mode===mode&&c.number===n).map(c=>c.id));
 return {schema:4,host:token,revision:0,created:Date.now(),teams:names.map((name,lane)=>({name,color:colors[lane],lane,pos:0,cell:null,finished:false,owner:null})),phase:'lobby',turn:0,round:1,end:0,score:0,skips:0,index:0,decks,activeCard:null,task:null,destination:null,used:0,history:[],outcome:null};
}
export function next(s){s.turn=(s.turn+1)%s.teams.length;if(s.turn===0)s.round++;s.score=0;s.skips=0;prepareTurn(s);}
export function start(s){
 if(!s.destination)throw Error('Сначала выберите соседнюю клетку.');
 choose(s,s.destination.row,s.destination.col);
 const task=fieldAt(s.destination),bucket=s.decks[`${task.mode}-${task.number}`];
 if(!bucket.length)throw Error('Эта стопка закончилась: все 150 карточек уже сыграны. Создайте новую комнату для новой колоды.');
 s.activeCard=bucket.pop();s.task=task;s.used++;s.index++;s.score=0;s.skips=0;s.outcome=null;s.phase='playing';s.end=Date.now()+60000;
}
export function finish(s,outcome){
 if(s.phase!=='playing')return;const team=s.teams[s.turn],from=team.cell?{...team.cell}:null;
 s.score=outcome==='yes'?1:0;s.skips=outcome==='skip'?1:0;s.outcome=outcome;
 if(s.score){team.cell={row:s.task.row,col:s.task.col};team.pos++;team.finished=same(team.cell,GOALS[team.lane]);}
 s.history.unshift({team:team.name,score:s.score,number:s.task.number,mode:MODES[s.task.mode],from,to:team.cell?{...team.cell}:null,outcome,round:s.round});s.history=s.history.slice(0,20);s.phase=team.finished?'winner':'result';
}
export function settle(s){if(s.phase==='playing'&&Date.now()>=s.end)finish(s,'timeout');}
export function view(s,token){
 const {host,decks,activeCard,...publicState}=s,v=structuredClone(publicState),team=s.teams[s.turn];
 const task=s.task||(s.destination?fieldAt(s.destination):null);
 v.isHost=host===token;v.myTeam=s.teams.findIndex(t=>t.owner===token);
 v.teams=v.teams.map(({owner,...t})=>({...t,joined:!!owner,entry:{...STARTS[t.lane]},goal:{...GOALS[t.lane]}}));
 v.card=s.phase==='playing'&&team.owner===token?structuredClone(cardById.get(activeCard)):null;
 v.mode=task?MODES[task.mode]:'Выберите клетку';v.modeKey=task?.mode||null;v.number=task?.number||null;v.taskType=task?TASK_TYPES[task.number]:null;
 v.moves=s.phase==='ready'?movesFor(team).map(p=>({...p,label:MODES[p.mode]})):[];v.current=fieldFor(team);v.canChoose=s.phase==='ready'&&(v.myTeam===s.turn||v.isHost);
 v.remainingInStack=task?decks[`${task.mode}-${task.number}`].length:null;v.totalCards=CARDS.length;v.remainingCards=CARDS.length-s.used;v.serverNow=Date.now();return v;
}
