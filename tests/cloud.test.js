import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDB} from '../domain.js';

async function client(){return import(`../cloud.js?test=${Math.random()}`);}
function answer(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}
test('viewer can load shared data and cannot save without session',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return answer([{revision:0,payload:emptyDB()}]);});
  const c=await client();assert.deepEqual(await c.readCloud(),emptyDB());assert.equal(c.isOrganizer(),false);await assert.rejects(c.writeCloud({...emptyDB(),revision:1}),/организатор/);assert.equal(calls.length,1);assert.equal(calls[0].options.cache,'no-store');assert.ok(!calls[0].url.includes('password'));
});
test('wrong password never unlocks writes; success supplies session to each write and logout clears it',async t=>{
  const calls=[];let rejectPassword=true;
  t.mock.method(globalThis,'fetch',async(url,options)=>{const body=options.body?JSON.parse(options.body):null;calls.push({url,body});if(url.endsWith('tt_login'))return answer(rejectPassword?{error:'invalid_password'}:{token:'a'.repeat(64),expires_at:new Date(Date.now()+60000).toISOString()});return answer(1);});
  const c=await client();await assert.rejects(c.loginOrganizer('test-only'),/Неверный/);assert.equal(c.isOrganizer(),false);rejectPassword=false;await c.loginOrganizer('test-only');assert.equal(c.isOrganizer(),true);await c.writeCloud({...emptyDB(),revision:1});const write=calls.find(x=>x.url.endsWith('tt_write'));assert.equal(write.body.session_token,'a'.repeat(64));assert.equal(write.body.expected_revision,0);assert.equal(write.body.new_payload.revision,1);assert.ok(!JSON.stringify(write).includes('test-only'));await c.logoutOrganizer();assert.equal(c.isOrganizer(),false);await assert.rejects(c.writeCloud({...emptyDB(),revision:2}));
});
test('conflicting revision is rejected; authorization failure ends organizer session',async t=>{
  let status=409,code='40001';t.mock.method(globalThis,'fetch',async url=>url.endsWith('tt_login')?answer({token:'a'.repeat(64),expires_at:new Date(Date.now()+60000).toISOString()}):answer({code},status));
  const c=await client();await c.loginOrganizer('test-only');await assert.rejects(c.writeCloud({...emptyDB(),revision:1}),e=>e.conflict===true);status=403;code='42501';await assert.rejects(c.writeCloud({...emptyDB(),revision:1}),e=>e.auth===true);assert.equal(c.isOrganizer(),false);
});
test('network and missing setup errors do not create a local replacement league',async t=>{
  t.mock.method(globalThis,'fetch',async()=>answer({code:'PGRST205'},404));const c=await client();await assert.rejects(c.readCloud(),e=>e.setup===true);globalThis.fetch=async()=>{throw Error('offline');};await assert.rejects(c.readCloud(),/Нет связи/);
});
test('expired organizer session cannot save; login throttling is readable',async t=>{
  let throttled=false;t.mock.method(globalThis,'fetch',async()=>answer(throttled?{error:'wait'}:{token:'a'.repeat(64),expires_at:new Date(Date.now()-10000).toISOString()}));const c=await client();await c.loginOrganizer('test-only');assert.equal(c.isOrganizer(),false);await assert.rejects(c.writeCloud({...emptyDB(),revision:1}));throttled=true;await assert.rejects(c.loginOrganizer('test-only'),/Подождите/);
});
