import test from 'node:test';
import assert from 'node:assert/strict';
import {addPlayers,clone,createTournament,emptyDB,finish,recordScore} from '../domain.js';
import {factsForEvent,fallbackResult,formatTelegram,modelRequest,standings,SYSTEM_PROMPT} from '../supabase/functions/tt-commentator/commentary.js';

function tournamentFixture(){
  const db=emptyDB(),ids=addPlayers(db,'Игорь, Саша, Юра, Рома');
  const first=createTournament(db,ids,'Первый турнир',ids);
  recordScore(first,11,5);recordScore(first,7,11);finish(first);
  const current=createTournament(db,ids,'Кубок кухни',ids);
  return {db,ids,current};
}

test('start facts include players and the defending champion',()=>{
  const {db,ids,current}=tournamentFixture();
  const event={event_type:'tournament_started',payload:{tournament:clone(current)}};
  const facts=factsForEvent(event,db);
  assert.equal(facts.player_count,4);
  assert.deepEqual(facts.players.map(p=>p.name),['Игорь','Саша','Юра','Рома']);
  assert.equal(facts.defending_champion.id,ids[0]);
  assert.match(formatTelegram(event,facts,fallbackResult(facts)),/ТУРНИР НАЧАЛСЯ.*Игорь, Саша, Юра, Рома/s);
});

test('match score is deterministic while AI only supplies the comment',()=>{
  const {db,ids,current}=tournamentFixture();
  const match=recordScore(current,11,9);
  const event={event_type:'match_completed',payload:{tournament:clone(current),match:clone(match)}};
  const facts=factsForEvent(event,db);
  assert.equal(facts.score_line,'Игорь 11:9 Саша');
  assert.equal(facts.context.defending_champion,false);
  assert.equal(facts.score.close,true);
  assert.equal(formatTelegram(event,facts,{comment:'Проверочный комментарий.'}),'Игорь 11:9 Саша\nПроверочный комментарий.');
  const request=modelRequest(facts,[]);
  assert.equal(request.response_format.type,'json_schema');
  assert.ok(!JSON.stringify(request).includes('TELEGRAM'));
  assert.equal(ids.includes(facts.winner.id),true);
});

test('final message names the real champion and includes every small-tournament player',()=>{
  const {db,current}=tournamentFixture();
  recordScore(current,11,4);recordScore(current,11,8);finish(current);
  const event={event_type:'tournament_completed',payload:{tournament:clone(current)}};
  const facts=factsForEvent(event,db),result=fallbackResult(facts),text=formatTelegram(event,facts,result);
  assert.equal(facts.champion.id,standings(current)[0].id);
  assert.equal(facts.players.length,4);
  assert.match(text,new RegExp(`ЧЕМПИОН — ${facts.champion.name}`));
  for(const name of current.ids.map(id=>current.names[id]))assert.ok(text.includes(name));
});

test('voided result formatting clearly marks cancellation',()=>{
  const {db,current}=tournamentFixture(),match=recordScore(current,11,6);
  const event={event_type:'match_voided',payload:{tournament:clone(current),match:{...match,voidedAt:new Date().toISOString()}}};
  const facts=factsForEvent(event,db);
  assert.equal(formatTelegram(event,facts,{}),'❌ РЕЗУЛЬТАТ ОТМЕНЁН\nИгорь 11:6 Саша');
});
test('commentator prompt requests varied dark sports humor without invented facts',()=>{
  assert.match(SYSTEM_PROMPT,/чёрный юмор/);
  assert.match(SYSTEM_PROMPT,/только факты/);
  assert.match(SYSTEM_PROMPT,/не повторяй|не повторяй их конструкции/);
  assert.match(SYSTEM_PROMPT,/не желай людям реальной смерти/i);
  assert.match(SYSTEM_PROMPT,/Никогда не повторяй цифры счёта/);
});
