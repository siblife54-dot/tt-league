import test from 'node:test';
import assert from 'node:assert/strict';
import {balancePlan,balanceProgress,startBalance,continueTournament,nextPair,emptyDB,addPlayers,createTournament,recordScore,levels,standings,finish,league,removeTournament,undoLast,validScore,validateDB,report,clone,h2h,awards,progress} from '../domain.js';
function fixture(n=6){const db=emptyDB();const ids=addPlayers(db,Array.from({length:n},(_,i)=>`Игрок ${i+1}`).join(','));const t=createTournament(db,ids,'Проверка',ids);return {db,ids,t};}
function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
test('opening matches and immediate transitions reproduce user example',()=>{const {t,ids}=fixture();recordScore(t,11,5);recordScore(t,7,11);recordScore(t,11,9);const lv=levels(t);assert.deepEqual(ids.filter(id=>lv[id]==='Gold'),[ids[0],ids[3],ids[4]]);assert.deepEqual(ids.filter(id=>lv[id]==='Silver'),[ids[1],ids[2],ids[5]]);
  // The user selects Silver in their illustrative example; transition semantics are independent of queue tie-breaks.
  t.current={a:ids[1],b:ids[2],reason:'Пример пользователя',cross:false};recordScore(t,5,11);assert.equal(levels(t)[ids[2]],'Gold');assert.equal(levels(t)[ids[1]],'Bronze');assert.equal(t.current.a,ids[0]);assert.equal(t.current.b,ids[3]);recordScore(t,11,7);assert.equal(levels(t)[ids[3]],'Silver');assert.equal(levels(t)[ids[0]],'Gold');
});
test('score validates deuce, rejects incomplete, tied and excessive endings',()=>{for(const [a,b] of [[11,0],[11,9],[12,10],[14,12],[30,28]]){assert.ok(validScore(a,b));assert.ok(validScore(b,a));}for(const [a,b] of [[11,10],[10,8],[12,8],[0,0],[-1,11],[11.5,2],[999,0],[NaN,11]])assert.ok(!validScore(a,b));});
test('technical pass awards no points and does not permanently pin player in Gold',()=>{const {t,ids}=fixture(5);recordScore(t,11,5);recordScore(t,11,5);const bye=ids[4];assert.equal(levels(t)[bye],'Gold');assert.equal(standings(t).find(p=>p.id===bye).games,0);assert.equal(standings(t).find(p=>p.id===bye).points,0);for(let i=0;i<20;i++){const pair=t.current;if(pair.a===bye||pair.b===bye){recordScore(t,pair.a===bye?5:11,pair.b===bye?5:11);assert.equal(levels(t)[bye],'Silver');return;}recordScore(t,11,5);}assert.fail('Bye participant must be scheduled');});
test('undo restores pair, score, levels and replay validation',()=>{const {db,t}=fixture(7);for(let i=0;i<12;i++)recordScore(t,i%2?11:6,i%2?6:11);const prior=clone(t);recordScore(t,11,9);undoLast(t);assert.deepEqual(levels(t),levels(prior));assert.deepEqual(standings(t),standings(prior));assert.equal(t.current.a,prior.current.a);assert.equal(t.current.b,prior.current.b);assert.equal(t.voided.length,1);recordScore(t,8,11);validateDB(db);});
test('finish and deletion recompute points, H2H, titles and retain profiles',()=>{const {db,t,ids}=fixture(4);for(let i=0;i<12;i++)recordScore(t,11,5);finish(t);assert.equal(league(db).reduce((s,p)=>s+p.points,0),37);assert.throws(()=>finish(t));const other=createTournament(db,ids,'Второй',ids);for(let i=0;i<8;i++)recordScore(other,3,11);finish(other);assert.equal(league(db).reduce((s,p)=>s+p.tournaments,0),8);removeTournament(db,t.id);assert.equal(league(db).reduce((s,p)=>s+p.points,0),37);assert.equal(league(db).reduce((s,p)=>s+p.titles,0),1);removeTournament(db,other.id);assert.equal(league(db).reduce((s,p)=>s+p.points,0),0);assert.equal(h2h(db,ids[0],ids[1]).matches.length,0);assert.equal(db.players.length,4);});
test('Markdown contains all match ids, levels, distinct tournament/season points and tournament identity',()=>{const {db,t}=fixture(5);for(let i=0;i<10;i++)recordScore(t,11,7);finish(t);const md=report(db,t);assert.ok(md.includes(t.id));for(const m of t.matches)assert.ok(md.includes(m.id));for(const text of ['Gold','Очки турнира','Сезон до','Технический проход','Редакция'.toLowerCase(),'Личные встречи'])assert.ok(md.includes(text),text);assert.equal(awards(t).filter(a=>a.title==='Чемпион').length,1);});
test('imports reject invalid scores, duplicate player ids, corrupt points and current pair',()=>{const {db,t}=fixture();recordScore(t,11,4);assert.deepEqual(validateDB(db),db);for(const damage of [d=>d.players.push(d.players[0]),d=>d.tournaments[0].matches[0].points=99,d=>d.tournaments[0].matches[0].scoreA=10,d=>d.tournaments[0].current.a='missing']){const bad=clone(db);damage(bad);assert.throws(()=>validateDB(bad));}});
test('no finish before opening; active tournament uniqueness; profiles survive rename/archive',()=>{const {db,t,ids}=fixture();assert.throws(()=>finish(t));assert.throws(()=>createTournament(db,ids,'duplicate'));const added=addPlayers(db,'Игрок 1, Новый');assert.equal(added[0],ids[0]);assert.equal(db.players.length,7);});
test('PostgreSQL JSONB key reordering preserves a valid league',()=>{const {db,t}=fixture(5);for(let i=0;i<10;i++)recordScore(t,11,5);finish(t);const jsonb=JSON.parse(JSON.stringify(db,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v));assert.deepEqual(standings(validateDB(jsonb).tournaments[0]),standings(t));});
test('random tournaments 4–32: valid pairs, no starvation, valid snapshots and unique final places',()=>{for(let n=4;n<=32;n++)for(let seed=1;seed<=35;seed++){const {db,t}=fixture(n),random=rng(seed);for(let i=0;i<100;i++){assert.notEqual(t.current.a,t.current.b);assert.ok(t.ids.includes(t.current.a)&&t.ids.includes(t.current.b));const aWins=random()>.5;recordScore(t,aWins?11:Math.floor(random()*10),aWins?Math.floor(random()*10):11);const lv=levels(t);assert.equal(Object.keys(lv).length,n);if(i>2*n){const {last}=progress(t);assert.ok(Math.max(...t.ids.map(id=>t.matches.length-1-last[id]))<=2*n,`waiting n=${n}, seed=${seed}`);}}finish(t);const rs=standings(t);assert.deepEqual(rs.map(p=>p.place),Array.from({length:n},(_,i)=>i+1));assert.equal(rs.reduce((s,p)=>s+p.games,0),200);assert.equal(rs.reduce((s,p)=>s+p.points,0),t.matches.reduce((s,m)=>s+m.points,0));validateDB(db);}});


test('nine players finish, export, reload and deletion keep season totals valid',()=>{
  const {db,t,ids}=fixture(9);
  for(let i=0;i<4;i++)recordScore(t,11,5);
  assert.equal(levels(t)[ids[8]],'Gold');
  assert.equal(standings(t).find(p=>p.id===ids[8]).games,0);
  for(let i=0;i<30;i++)recordScore(t,11,6);
  finish(t);
  assert.equal(standings(t)[8].seasonPoints,0);
  assert.equal(league(db).reduce((s,p)=>s+p.points,0),47);
  validateDB(JSON.parse(JSON.stringify(db)));
  assert.ok(!/undefined|NaN/.test(report(db,t)));
  removeTournament(db,t.id);
  assert.ok(league(db).every(p=>p.points===0&&p.games===0));
});
test('participant boundaries allow 32 and reject 33',()=>{
  const {db,t}=fixture(32);validateDB(db);
  for(let i=0;i<16;i++)recordScore(t,11,5);
  finish(t);
  const extra=addPlayers(db,'Extra')[0];
  assert.throws(()=>createTournament(db,[...t.ids,extra],'Too many'),/32/);
  const invalid=clone(db);invalid.tournaments[0].ids.push(extra);
  assert.throws(()=>validateDB(invalid));
});

test('balance completes for every size, survives reload/undo and can repeat',()=>{
 for(let n=4;n<=32;n++){
  const {db,t}=fixture(n);
  for(let i=0;i<n+7;i++)recordScore(t,11,6);
  for(let round=0;round<2;round++){
   const plan=startBalance(t);assert.equal(n*plan.target%2,0);
   validateDB(db);
   let played=0;
   while(t.current){
    assert.ok(played++<100);
    const counts=progress(t).games;
    assert.ok(counts[t.current.a]<plan.target&&counts[t.current.b]<plan.target);
    recordScore(t,11,5);validateDB(db);
   }
   assert.equal(played,plan.remaining);
   assert.ok(Object.values(progress(t).games).every(v=>v===plan.target));
   assert.equal(balanceProgress(t).remaining,0);
   if(played){undoLast(t);assert.ok(t.current);validateDB(db);recordScore(t,11,5);validateDB(db);}
   continueTournament(t);assert.ok(t.current);validateDB(db);
   recordScore(t,11,5);
  }
  startBalance(t);while(t.current)recordScore(t,11,5);finish(t);validateDB(db);
 }
});
test('balance raises unreachable maximum and handles already equal counts',()=>{
 const {t,ids}=fixture(4);
 // Schedule feasibility depends only on counts; construct the 10/10/10/8 example.
 t.matches=[];
 const pairs=[[0,1,3],[0,2,3],[0,3,4],[1,2,5],[1,3,2],[2,3,2]];
 for(const [a,b,count] of pairs)for(let i=0;i<count;i++)t.matches.push({a:ids[a],b:ids[b],levelA:'Gold',levelB:'Gold',winner:ids[a]});
 assert.deepEqual(Object.values(progress(t).games),[10,10,10,8]);
 assert.deepEqual(balancePlan(t),{target:11,remaining:3});
 const {t:even}=fixture(4);recordScore(even,11,5);recordScore(even,11,5);
 assert.deepEqual(startBalance(even),{target:1,remaining:0});assert.equal(even.current,null);
 continueTournament(even);assert.ok(even.current);
});
test('normal queue keeps game counts within one after opening',()=>{
 for(const n of [4,5,6,9,16,31,32]){
  const {t}=fixture(n);
  for(let i=0;i<100;i++){recordScore(t,11,5);const counts=Object.values(progress(t).games);assert.ok(Math.max(...counts)-Math.min(...counts)<=1);}
 }
});
test('legacy scheduling history remains readable after switching queues',()=>{
 const {db,t}=fixture(9);delete t.queueFrom;
 for(let i=0;i<20;i++){t.current=nextPair(t);recordScore(t,11,5);delete t.queueFrom;}
 t.current=nextPair(t);validateDB(db);
 startBalance(t);validateDB(db);
 while(t.current){recordScore(t,11,5);validateDB(db);}
 continueTournament(t);recordScore(t,11,5);validateDB(db);
});
