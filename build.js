const fs=require('fs');
const qr=fs.readFileSync('node_modules/qrcode-generator/qrcode.js','utf8');
const mq=fs.readFileSync('node_modules/mqtt/dist/mqtt.min.js','utf8');
const xl=fs.readFileSync('src/importer.js','utf8');
const dq=JSON.stringify(JSON.parse(fs.readFileSync('data/기말고사100.json','utf8')));
for(const s of [qr,mq,xl]) if(/<\/script/i.test(s)) throw new Error('script close inside lib');
let h=fs.readFileSync('src/template.html','utf8');
h=h.replace('/*__QR__*/',()=>qr).replace('/*__MQTT__*/',()=>mq).replace('/*__IMPORTER__*/',()=>xl).replace('/*__DEFAULTQ__*/[]',()=>dq.replace(/</g,'\\u003c'));
fs.writeFileSync('index.html',h);console.log('built',h.length);
