const LEVELS=['Gold','Silver','Bronze'];

export function transition(level,win){
  if(level==='Common')return win?'Gold':'Silver';
  const i=LEVELS.indexOf(level);
  return LEVELS[Math.max(0,Math.min(2,i+(win?-1:1)))];
}

export function levels(t){
  const out=Object.fromEntries(t.ids.map(id=>[id,'Common']));
  for(let i=0;i<t.matches.length;i++){
    const m=t.matches[i];
    out[m.a]=transition(m.levelA,m.winner===m.a);
    out[m.b]=transition(m.levelB,m.winner===m.b);
    if(t.ids.length%2&&i+1===Math.floor(t.ids.length/2))out[t.draw.at(-1)]='Gold';
  }
  return out;
}

export function standings(t){
  const lv=levels(t);
  const rows=t.ids.map(id=>({id,name:t.names[id],level:lv[id],games:0,wins:0,losses:0,points:0,scored:0,conceded:0}));
  const byId=Object.fromEntries(rows.map(r=>[r.id,r]));
  for(const m of t.matches){
    const a=byId[m.a],b=byId[m.b];
    if(!a||!b)continue;
    a.games++;b.games++;a.scored+=m.scoreA;a.conceded+=m.scoreB;b.scored+=m.scoreB;b.conceded+=m.scoreA;
    byId[m.winner].wins++;
    byId[m.winner===m.a?m.b:m.a].losses++;
    byId[m.winner].points+=m.points;
  }
  for(const r of rows){r.rate=r.games?r.wins/r.games:0;r.diff=r.games?(r.scored-r.conceded)/r.games:0;}
  rows.sort((a,b)=>b.points-a.points||b.rate-a.rate||b.diff-a.diff||t.draw.indexOf(a.id)-t.draw.indexOf(b.id));
  return rows.map((r,i)=>({...r,place:i+1,seasonPoints:t.status==='completed'?(t.rules.season[i]??0):0}));
}

function priorTournaments(state,t){
  return (state?.tournaments||[]).filter(x=>x.status==='completed'&&x.id!==t.id&&String(x.startedAt)<String(t.startedAt)).sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt)));
}

function leagueRows(state,tournaments){
  const players=state?.players||[];
  const map=Object.fromEntries(players.map(p=>[p.id,{id:p.id,name:p.name,points:0,titles:0,tournaments:0,games:0,wins:0,losses:0}]));
  for(const t of tournaments)for(const r of standings(t)){
    const p=map[r.id]||{id:r.id,name:r.name,points:0,titles:0,tournaments:0,games:0,wins:0,losses:0};
    map[r.id]=p;p.points+=r.seasonPoints;p.titles+=r.place===1?1:0;p.tournaments++;p.games+=r.games;p.wins+=r.wins;p.losses+=r.losses;
  }
  return Object.values(map).sort((a,b)=>b.points-a.points||b.titles-a.titles||b.wins-a.wins||String(a.name).localeCompare(String(b.name),'ru'));
}

function champion(t){return t?standings(t)[0]:null;}
function lastChampion(prior){return champion(prior.at(-1));}
function pairMatches(tournaments,a,b){return tournaments.flatMap(t=>t.matches.filter(m=>m.a===a&&m.b===b||m.a===b&&m.b===a));}
function winsBy(matches,id){return matches.filter(m=>m.winner===id).length;}
function currentWinStreak(t,id){let n=0;for(let i=t.matches.length-1;i>=0;i--){const m=t.matches[i];if(m.a!==id&&m.b!==id)continue;if(m.winner!==id)break;n++;}return n;}
function longestWinStreak(t,id){let best=0,now=0;for(const m of t.matches){if(m.a!==id&&m.b!==id)continue;now=m.winner===id?now+1:0;best=Math.max(best,now);}return best;}
function percent(wins,games){return games?Math.round(1000*wins/games)/10:0;}
function scoreFor(m,id){return id===m.a?[m.scoreA,m.scoreB]:[m.scoreB,m.scoreA];}
function compact(value){return JSON.parse(JSON.stringify(value));}

export function factsForEvent(event,state){
  const t=event.payload.tournament;
  const prior=priorTournaments(state,t);
  const holder=lastChampion(prior);
  const history=leagueRows(state,prior);
  const historyById=Object.fromEntries(history.map((r,i)=>[r.id,{...r,rank:i+1}]));

  if(event.event_type==='tournament_started'){
    return compact({
      event:'tournament_started',title:t.title,player_count:t.ids.length,
      players:t.ids.map(id=>({id,name:t.names[id],previous_tournaments:historyById[id]?.tournaments||0,titles:historyById[id]?.titles||0})),
      defending_champion:holder?{id:holder.id,name:t.names[holder.id]||holder.name}:null,
    });
  }

  if(event.event_type==='match_completed'){
    const m=event.payload.match;
    const loser=m.winner===m.a?m.b:m.a;
    const allPrevious=pairMatches(prior,m.a,m.b);
    const todayPrevious=t.matches.slice(0,-1).filter(x=>x.a===m.a&&x.b===m.b||x.a===m.b&&x.b===m.a);
    const previous=[...allPrevious,...todayPrevious];
    const latestPrevious=previous.at(-1);
    const row=standings(t).find(r=>r.id===m.winner);
    const loserScore=m.winner===m.a?m.scoreB:m.scoreA;
    const winnerScore=m.winner===m.a?m.scoreA:m.scoreB;
    return compact({
      event:'match_completed',title:t.title,match_number:t.matches.length,
      score_line:`${t.names[m.a]} ${m.scoreA}:${m.scoreB} ${t.names[m.b]}`,
      winner:{id:m.winner,name:t.names[m.winner],level_before:m.winner===m.a?m.levelA:m.levelB,level_after:transition(m.winner===m.a?m.levelA:m.levelB,true),tournament_wins:row.wins,tournament_losses:row.losses,streak:currentWinStreak(t,m.winner)},
      loser:{id:loser,name:t.names[loser],level_before:loser===m.a?m.levelA:m.levelB,level_after:transition(loser===m.a?m.levelA:m.levelB,false)},
      score:{winner:winnerScore,loser:loserScore,difference:winnerScore-loserScore,close:winnerScore-loserScore<=2,blowout:loserScore<=3||winnerScore-loserScore>=8},
      head_to_head:{winner_wins_before:winsBy(previous,m.winner),loser_wins_before:winsBy(previous,loser),first_win_over_opponent:winsBy(previous,m.winner)===0,revenge:latestPrevious?.winner===loser},
      context:{points_awarded:m.points,defending_champion:holder?.id===loser,defending_champion_name:holder?.name||null,first_career_win:!prior.some(x=>x.matches.some(y=>y.winner===m.winner))&&t.matches.filter(x=>x.winner===m.winner).length===1,ranking_upset:(historyById[m.winner]?.rank||999)>(historyById[loser]?.rank||999)},
    });
  }

  if(event.event_type==='match_voided'){
    const m=event.payload.match;
    return compact({event:'match_voided',title:t.title,match_id:m.id,score_line:`${t.names[m.a]} ${m.scoreA}:${m.scoreB} ${t.names[m.b]}`});
  }

  const rows=standings(t),winner=rows[0],holderId=holder?.id||null;
  const playerFacts=rows.map(r=>{
    const matches=t.matches.filter(m=>m.a===r.id||m.b===r.id);
    const margins=matches.map(m=>{const [forScore,againstScore]=scoreFor(m,r.id);return {won:m.winner===r.id,margin:forScore-againstScore,opponent:t.names[m.a===r.id?m.b:m.a]};});
    const biggestWin=margins.filter(x=>x.won).sort((a,b)=>b.margin-a.margin)[0]||null;
    const visited=new Set(matches.flatMap(m=>[r.id===m.a?m.levelA:m.levelB]));visited.add(r.level);
    const beatHolder=holderId&&matches.some(m=>m.winner===r.id&&(m.a===holderId||m.b===holderId));
    return {id:r.id,name:r.name,place:r.place,games:r.games,wins:r.wins,losses:r.losses,win_rate:percent(r.wins,r.games),tournament_points:r.points,season_points:r.seasonPoints,scored:r.scored,conceded:r.conceded,final_level:r.level,longest_win_streak:longestWinStreak(t,r.id),undefeated:r.losses===0&&r.games>0,first_title:r.place===1&&(historyById[r.id]?.titles||0)===0,titles_before:historyById[r.id]?.titles||0,previous_rank:historyById[r.id]?.rank||null,visited_levels:[...visited],bronze_to_gold:visited.has('Bronze')&&r.level==='Gold',beat_defending_champion:Boolean(beatHolder),biggest_win:biggestWin};
  });
  const selected=playerFacts.length<=12?playerFacts:[...playerFacts.slice(0,8),...playerFacts.slice(8).filter(p=>p.bronze_to_gold||p.beat_defending_champion||p.longest_win_streak>=3)].slice(0,12);
  return compact({
    event:'tournament_completed',title:t.title,total_matches:t.matches.length,player_count:t.ids.length,
    champion:{...winner,undefeated:winner.losses===0,first_title:(historyById[winner.id]?.titles||0)===0},
    belt:{previous_holder:holder?{id:holder.id,name:t.names[holder.id]||holder.name}:null,defended:Boolean(holderId&&holderId===winner.id),changed:Boolean(holderId&&holderId!==winner.id)},
    players:selected,omitted_players:Math.max(0,playerFacts.length-selected.length),
  });
}

export const SYSTEM_PROMPT=`Ты — комментатор любительской лиги настольного тенниса TT League.
Пиши по-русски коротко, живо и смешно, как участник дружеского чата.
Можно иногда использовать мягкий сленг и редкую дерзкую фразу вроде «дал просраться», если она уместна. Не вставляй грубость в каждое сообщение.
Используй только факты из входного JSON. Не придумывай счёт, статистику, рекорды, отношения и качества людей.
Не унижай игроков, не шути о внешности, здоровье и личной жизни.
Не повторяй недавние формулировки. Не переписывай строку счёта или место: приложение добавит их само.
Для события матча или старта верни одно предложение. Для итогов — одно короткое предложение о каждом запрошенном игроке.`;

export function modelRequest(facts,recent=[]){
  const final=facts.event==='tournament_completed';
  const properties=final?{
    comments:{type:'array',items:{type:'object',additionalProperties:false,properties:{player_id:{type:'string',enum:facts.players.map(p=>p.id)},comment:{type:'string'}},required:['player_id','comment']}}
  }:{comment:{type:'string'}};
  const required=final?['comments']:['comment'];
  return {
    messages:[
      {role:'system',content:SYSTEM_PROMPT},
      {role:'user',content:JSON.stringify({task:final?'Дай отдельную реплику о каждом игроке из players. Верни каждого player_id ровно один раз.':'Напиши одну короткую реплику к событию.',facts,recent_comments:recent})},
    ],
    response_format:{type:'json_schema',json_schema:{name:final?'tournament_commentary':'short_commentary',strict:true,schema:{type:'object',additionalProperties:false,properties,required}}},
    max_completion_tokens:final?1200:180,
  };
}

function clean(text,max=280){return String(text||'').replace(/\s+/g,' ').trim().slice(0,max);}
function fallbackPlayer(p){
  if(p.place===1&&p.undefeated)return `Прошёл турнир без поражений — сегодня пояс даже не успел занервничать.`;
  if(p.first_title)return `Первый титул: дверь в клуб чемпионов выбита с ноги.`;
  if(p.bronze_to_gold)return `Успел побывать в Bronze и вернуться в Gold — лифт сегодня работал на износ.`;
  if(p.beat_defending_champion)return `Чемпиона зацепил, а значит вечер уже прожит не зря.`;
  return `${p.wins} побед, ${p.losses} поражений и ${p.tournament_points} турнирных очков — всё запротоколировано.`;
}

export function fallbackResult(facts){
  if(facts.event==='tournament_started')return {comment:facts.defending_champion?`${facts.defending_champion.name} выходит защищать пояс. Остальные уже знают, за кем охотиться.`:'Пояс свободен, стол готов — начинаем выяснять, кто сегодня главный.'};
  if(facts.event==='match_completed'){
    if(facts.context.defending_champion)return {comment:`${facts.winner.name} снял скальп действующего чемпиона. Заявка принята.`};
    if(facts.context.first_career_win)return {comment:`Первая победа ${facts.winner.name} в истории лиги — архив официально открыт.`};
    if(facts.head_to_head.first_win_over_opponent)return {comment:`${facts.winner.name} впервые подобрал ключ к ${facts.loser.name}.`};
    if(facts.winner.streak>=3)return {comment:`У ${facts.winner.name} уже ${facts.winner.streak} побед подряд — стол начинает привыкать.`};
    if(facts.score.close)return {comment:'На тоненького: ещё пара розыгрышей — и понадобились бы успокоительные.'};
    if(facts.score.blowout)return {comment:`${facts.winner.name} сегодня решил не затягивать переговоры.`};
    if(facts.head_to_head.revenge)return {comment:`Реванш оформлен. Старый должок закрыт прямо у стола.`};
    return {comment:`${facts.winner.name} забирает матч и едет дальше по турнирному лифту.`};
  }
  if(facts.event==='tournament_completed')return {comments:facts.players.map(p=>({player_id:p.id,comment:fallbackPlayer(p)}))};
  return {};
}

export function formatTelegram(event,facts,result){
  if(event.event_type==='tournament_started')return `🏓 ТУРНИР НАЧАЛСЯ — ${facts.title}\nИграют: ${facts.players.map(p=>p.name).join(', ')}.\n\n${clean(result.comment)||fallbackResult(facts).comment}`;
  if(event.event_type==='match_completed')return `${facts.score_line}\n${clean(result.comment)||fallbackResult(facts).comment}`;
  if(event.event_type==='tournament_completed'){
    const fallback=fallbackResult(facts),given=new Map((result.comments||[]).map(x=>[x.player_id,clean(x.comment,200)]));
    const defaults=new Map(fallback.comments.map(x=>[x.player_id,x.comment]));
    const champ=facts.players.find(p=>p.id===facts.champion.id)||facts.champion;
    const lines=[`🏆 ЧЕМПИОН — ${facts.champion.name}`,given.get(champ.id)||defaults.get(champ.id)||fallbackPlayer(champ)];
    for(const p of facts.players.filter(x=>x.id!==facts.champion.id))lines.push('',`${p.place}. ${p.name} — ${given.get(p.id)||defaults.get(p.id)||fallbackPlayer(p)}`);
    if(facts.omitted_players)lines.push('',`Ещё ${facts.omitted_players} участник(а/ов) — в полной таблице TT League.`);
    return lines.join('\n');
  }
  return `❌ РЕЗУЛЬТАТ ОТМЕНЁН\n${facts.score_line}`;
}
