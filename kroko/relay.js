// MQTT 3.1.1 over secure WebSocket: small room-message relay, no UDP or LAN discovery.
export const BROKERS={S:{url:'wss://public.cloud.shiftr.io',username:'public',password:'public'},T:{url:'wss://demo.tbmq.io/mqtt',username:'demo'}};
const encoder=new TextEncoder(),decoder=new TextDecoder();
const str=s=>{const b=encoder.encode(s);return [b.length>>8,b.length&255,...b]};
function packet(type,body){let n=body.length,out=[type];do{let b=n%128;n=Math.floor(n/128);if(n)b|=128;out.push(b)}while(n);return new Uint8Array([...out,...body])}
export class RoomRelay{
 constructor(config,{onMessage=()=>{},onClose=()=>{}}={}){this.config=typeof config==='string'?{url:config}:config;this.url=this.config.url;this.onMessage=onMessage;this.onClose=onClose;this.ws=null;this.seq=0;this.acks=new Map();this.buffer=new Uint8Array();this.ping=null;this.ready=false;this.lastPacket=0;}
 async connect(){
  return new Promise((resolve,reject)=>{
   let finished=false;const timer=setTimeout(()=>finish(Error('Сервис комнат не отвечает. Проверьте интернет.')),10000);
   const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);if(error){this.close();reject(error)}else resolve(this)};
   try{this.ws=new WebSocket(this.url,'mqtt')}catch(e){finish(e);return}this.ws.binaryType='arraybuffer';
   this.ws.onopen=()=>{const id='kroko-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),n=>n.toString(16).padStart(2,'0')).join('');const {username,password}=this.config;let flags=2,payload=[...str(id)];if(username!==undefined){flags|=128;payload.push(...str(username))}if(password!==undefined){flags|=64;payload.push(...str(password))}this.send(0x10,[...str('MQTT'),4,flags,0,30,...payload]);};
   this.ws.onmessage=e=>{
    try{this.lastPacket=Date.now();const bytes=new Uint8Array(e.data);const joined=new Uint8Array(this.buffer.length+bytes.length);joined.set(this.buffer);joined.set(bytes,this.buffer.length);this.buffer=joined;
     while(this.buffer.length>1){let size=0,mul=1,i=1,b;do{if(i>=this.buffer.length)return;b=this.buffer[i++];size+=(b&127)*mul;mul*=128;if(i>5)throw Error('Invalid MQTT frame')}while(b&128);
      if(this.buffer.length<i+size)return;const type=this.buffer[0],body=this.buffer.slice(i,i+size);this.buffer=this.buffer.slice(i+size);
      if((type>>4)===2){if(body[1]!==0){finish(Error('Сервис комнат отклонил соединение'));return}this.ready=true;this.ping=setInterval(()=>{if(Date.now()-this.lastPacket>45000){this.ws.close();return}if(this.ready)this.send(0xc0,[])},15000);finish();}
      else if((type>>4)===9){const id=(body[0]<<8)|body[1],ack=this.acks.get(id);if(ack){clearTimeout(ack.timer);this.acks.delete(id);body[2]===128?ack.reject(Error('Не удалось открыть канал комнаты')):ack.resolve();}}
      else if((type>>4)===3){let p=2+((body[0]<<8)|body[1]);const topic=decoder.decode(body.slice(2,p));const qos=(type>>1)&3;if(qos){const id=body.slice(p,p+2);p+=2;if(qos===1)this.send(0x40,[...id]);}const text=decoder.decode(body.slice(p));if(text.length<20000){try{this.onMessage(topic,JSON.parse(text))}catch(e){}}}
     }
    }catch(e){finish(e)}
   };
   this.ws.onerror=()=>finish(Error('Не удалось подключиться к сервису комнат'));
   this.ws.onclose=()=>{clearInterval(this.ping);this.ready=false;for(const ack of this.acks.values()){clearTimeout(ack.timer);ack.reject(Error('Соединение с комнатой прервалось'))}this.acks.clear();finish(Error('Соединение с комнатой прервалось'));this.onClose();};
  });
 }
 send(type,body){if(this.ws?.readyState===1)this.ws.send(packet(type,body));else throw Error('Нет соединения с комнатой');}
 subscribe(topic){return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.acks.delete(id);reject(Error('Не удалось открыть канал комнаты'))},7000);this.acks.set(id,{resolve,reject,timer});this.send(0x82,[id>>8,id&255,...str(topic),0]);});}
 publish(topic,data){if(!this.ready)throw Error('Соединение с комнатой восстанавливается');this.send(0x30,[...str(topic),...encoder.encode(JSON.stringify(data))]);}
 close(){this.ready=false;clearInterval(this.ping);if(this.ws){this.ws.onclose=null;try{this.ws.close()}catch(e){}}for(const ack of this.acks.values()){clearTimeout(ack.timer);ack.reject(Error('Канал комнаты закрыт'))}this.acks.clear();}
}
