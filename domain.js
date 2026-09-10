export const VERSION = 1;
export const LEVELS = ['Gold', 'Silver', 'Bronze'];
export const RULES = Object.freeze({version:1, points:{Common:2,Gold:3,Silver:2,Bronze:1}, season:[15,10,7,5,4,3,2,1], target:11, margin:2, waitMultiplier:1});
export const uid = () => crypto.randomUUID();
export const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => JSON.stringify(value, (_,v) => v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
export function emptyDB(){return {version:VERSION,revision:0,players:[],tournaments:[]};}
export function nameOf(db,id){return db.players.find(p=>p.id===id)?.name || 'Игрок';}
export function addPlayers(db, text){
  const names=text.split(/[,\n]/).map(n=>n.trim().replace(/\s+/g,' ')).filter(Boolean);
  if(!names.length) throw Error('Введите имя игрока.');
  if(names.length>30) throw Error('Добавьте не больше 30 игроков за один раз.');
  if(names.some(n=>n.length>40)) throw Error('Имя должно быть не длиннее 40 символов.');
  const added=[];
  for(const name of names){const existing=db.players.find(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase());if(existing){existing.archived=false;added.push(existing.id);}else{const p={id:uid(),name,archived:false};db.players.push(p);added.push(p.id);}}
  return added;
}
export function shuffle(values, random=()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296){const a=[...values];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function createTournament(db,ids,title,draw=null){
  if(db.tournaments.some(t=>t.status==='active')) throw Error('Сначала завершите текущий турнир.');
  if(new Set(ids).size!==ids.length || ids.length<4 || ids.length>8)throw Error('Выберите от 4 до 8 разных игроков.');
  if(ids.some(id=>!db.players.some(p=>p.id===id&&!p.archived)))throw Error('Не удалось найти выбранного игрока.');
  const order=draw||shuffle(ids);if(order.length!==ids.length||new Set(order).size!==ids.length||order.some(id=>!ids.includes(id)))throw Error('Неверная жеребьёвка.');
  const t={id:uid(),revision:1,title:(title||'Турнир TT League').trim().slice(0,80),startedAt:new Date().toISOString(),endedAt:null,status:'active',ids:[...ids],names:Object.fromEntries(ids.map(id=>[id,nameOf(db,id)])),draw:[...order],rules:clone(RULES),matches:[],voided:[],current:null};
  t.current=nextPair(t);db.tournaments.push(t);return t;
}
export function transition(level,win){if(level==='Common')return win?'Gold':'Silver';const i=LEVELS.indexOf(level);if(i<0)throw Error('Неизвестный уровень.');return LEVELS[Math.max(0,Math.min(2,i+(win?-1:1)))];}
export function baseLevels(t){return Object.fromEntries(t.ids.map(id=>[id,'Common']));}
export function levels(t){const out=baseLevels(t);for(let i=0;i<t.matches.length;i++){const m=t.matches[i];out[m.a]=transition(m.levelA,m.winner===m.a);out[m.b]=transition(m.levelB,m.winner===m.b);if(t.ids.length%2&&i+1===Math.floor(t.ids.length/2))out[t.draw.at(-1)]='Gold';}return out;}
export function progress(t){const lv=levels(t);const last=Object.fromEntries(t.ids.map(id=>[id,-1]));const games=Object.fromEntries(t.ids.map(id=>[id,0]));for(let i=0;i<t.matches.length;i++){const m=t.matches[i];last[m.a]=last[m.b]=i;games[m.a]++;games[m.b]++;}return {lv,last,games};}
export function nextPair(t){
  if(t.status!=='active')return null;
  const opening=Math.floor(t.ids.length/2),i=t.matches.length;
  if(i<opening)return {a:t.draw[i*2],b:t.draw[i*2+1],reason:'Стартовая жеребьёвка',cross:false,opening:true};
  const {lv,last,games}=progress(t);
  const rank=id=>t.draw.indexOf(id);
  const waiting=(a,b)=>last[a]-last[b]||games[a]-games[b]||rank(a)-rank(b);
  const repeats=(a,b)=>t.matches.filter(m=>(m.a===a&&m.b===b)||(m.a===b&&m.b===a)).length;
  const groups=LEVELS.map(level=>({level,ids:t.ids.filter(id=>lv[id]===level).sort(waiting)}));
  const overdue=t.ids.filter(id=>i-1-last[id]>=t.ids.length-1).sort(waiting);
  let a,candidates,reason;
  if(overdue.length){a=overdue[0];candidates=t.ids.filter(id=>id!==a&&lv[id]===lv[a]);reason='Приоритет: игрок давно не выходил к столу';if(!candidates.length){const nearest=Math.min(...t.ids.filter(id=>id!==a).map(id=>Math.abs(LEVELS.indexOf(lv[id])-LEVELS.indexOf(lv[a]))));candidates=t.ids.filter(id=>id!==a&&Math.abs(LEVELS.indexOf(lv[id])-LEVELS.indexOf(lv[a]))===nearest);reason='Долгое ожидание: соперник из ближайшего уровня';}}
  else{const available=groups.filter(g=>g.ids.length>=2).sort((a,b)=>b.ids.length-a.ids.length||waiting(a.ids[0],b.ids[0])||LEVELS.indexOf(a.level)-LEVELS.indexOf(b.level));const group=available[0];if(!group)throw Error('Нет доступной пары.');a=group.ids[0];candidates=group.ids.filter(id=>id!==a);reason=`${group.level}: самая большая доступная группа`;}
  candidates.sort((b,c)=>last[b]-last[c]||games[b]-games[c]||repeats(a,b)-repeats(a,c)||rank(b)-rank(c));
  const b=candidates[0];return {a,b,cross:lv[a]!==lv[b],opening:false,reason};
}
export function validScore(a,b){return Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=0&&a<=999&&b<=999&&(Math.max(a,b)===11&&Math.min(a,b)<=9 || Math.max(a,b)>11&&Math.abs(a-b)===2);}
export function recordScore(t,aScore,bScore){
  if(t.status!=='active'||!t.current)throw Error('Нет текущего матча.');
  if(!validScore(aScore,bScore))throw Error('Партия до 11, после 10:10 — разница 2. Например: 11:8 или 13:11.');
  const pair=t.current,lv=levels(t),winner=aScore>bScore?pair.a:pair.b;
  const m={id:uid(),a:pair.a,b:pair.b,scoreA:aScore,scoreB:bScore,winner,levelA:lv[pair.a],levelB:lv[pair.b],points:t.rules.points[lv[winner]],at:new Date().toISOString(),reason:pair.reason,cross:pair.cross};
  t.matches.push(m);t.revision++;t.current=nextPair(t);return m;
}
export function undoLast(t){if(t.status!=='active'||!t.matches.length)throw Error('Нет результата для отмены.');const m=t.matches.pop();t.voided.push({...m,voidReason:'Отмена последнего результата',voidedAt:new Date().toISOString()});t.current={a:m.a,b:m.b,reason:m.reason,cross:m.cross,opening:m.levelA==='Common'};t.revision++;return m;}
export function standings(t){const lv=levels(t);const rows=t.ids.map(id=>({id,name:t.names[id],level:lv[id],games:0,wins:0,losses:0,points:0,scored:0,conceded:0}));const byId=Object.fromEntries(rows.map(r=>[r.id,r]));for(const m of t.matches){const a=byId[m.a],b=byId[m.b];a.games++;b.games++;a.scored+=m.scoreA;a.conceded+=m.scoreB;b.scored+=m.scoreB;b.conceded+=m.scoreA;byId[m.winner].wins++;byId[m.winner===m.a?m.b:m.a].losses++;byId[m.winner].points+=m.points;}
  for(const r of rows){r.rate=r.games?r.wins/r.games:0;r.diff=r.games?(r.scored-r.conceded)/r.games:0;}
  rows.sort((a,b)=>b.points-a.points||b.rate-a.rate||b.diff-a.diff||t.draw.indexOf(a.id)-t.draw.indexOf(b.id));return rows.map((r,i)=>({...r,place:i+1,seasonPoints:t.status==='completed'?t.rules.season[i]:0}));
}
export function finish(t){if(t.status!=='active')throw Error('Турнир уже завершён.');if(t.matches.length<Math.floor(t.ids.length/2))throw Error('Завершите все стартовые матчи. Для отмены теста можно удалить турнир.');t.status='completed';t.endedAt=new Date().toISOString();t.current=null;t.revision++;return standings(t);}
export function completed(db){return db.tournaments.filter(t=>t.status==='completed').sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id));}
export function league(db, tournaments=completed(db)){const map=Object.fromEntries(db.players.map(p=>[p.id,{id:p.id,name:p.name,points:0,titles:0,tournaments:0,games:0,wins:0,losses:0}]));for(const t of tournaments){for(const r of standings(t)){const p=map[r.id];p.points+=r.seasonPoints;p.titles+=r.place===1?1:0;p.tournaments++;p.games+=r.games;p.wins+=r.wins;p.losses+=r.losses;}}return Object.values(map).map(p=>({...p,rate:p.games?p.wins/p.games:0})).sort((a,b)=>b.points-a.points||b.titles-a.titles||b.rate-a.rate||a.name.localeCompare(b.name,'ru'));}
export function h2h(db,a,b, tournaments=completed(db)){const matches=tournaments.flatMap(t=>t.matches.filter(m=>(m.a===a&&m.b===b)||(m.a===b&&m.b===a)).map(m=>({...m,tournamentTitle:t.title,date:t.startedAt})));return {aWins:matches.filter(m=>m.winner===a).length,bWins:matches.filter(m=>m.winner===b).length,matches};}
export function awards(t, prior=[]){const result=[];for(const id of t.ids){const ms=t.matches.filter(m=>m.a===id||m.b===id);const wins=ms.filter(m=>m.winner===id);if(wins.length&&!prior.some(p=>p.matches.some(m=>m.winner===id)))result.push({id,title:'Первая победа',detail:'Первая победа в сохранённой истории',matches:[wins[0].id]});let streak=[];for(const m of ms){streak=m.winner===id?[...streak,m.id]:[];if(streak.length===3){result.push({id,title:'На серии',detail:'Три победы подряд',matches:[...streak]});break;}}let bronze=false,route=[];for(const m of ms){const l=m.a===id?m.levelA:m.levelB;if(l==='Bronze'){bronze=true;route=[];}if(bronze)route.push(m.id);if(bronze&&transition(l,m.winner===id)==='Gold'){result.push({id,title:'Возвращение',detail:'Из Bronze в Gold',matches:[...route]});break;}}}if(t.status==='completed')result.push({id:standings(t)[0].id,title:'Чемпион',detail:'Первое место турнира',matches:[]});return result;}
export function removeTournament(db,id){const at=db.tournaments.findIndex(t=>t.id===id);if(at<0)throw Error('Турнир не найден.');db.tournaments.splice(at,1);}
export const percent = (wins,games) => games?`${(100*wins/games).toFixed(1)}%`:'—';
const md=s=>String(s).replace(/[|\r\n]/g,' ').replace(/([\\`*_\[\]<>])/g,'\\$1');
export function report(db,t){
  if(t.status!=='completed')throw Error('Сначала завершите турнир.');
  const all=completed(db),ix=all.findIndex(x=>x.id===t.id),prior=all.slice(0,ix),before=league(db,prior),after=league(db,all.slice(0,ix+1)),rows=standings(t),n=id=>md(t.names[id]),notes=awards(t,prior);
  const lines=[`# TT League — ${md(t.title)}`,``,`ID турнира: ${t.id} · редакция ${t.revision} · версия базы ${db.revision} · формат 1`,`Начало: ${t.startedAt}; завершение: ${t.endedAt}. Время ISO 8601 (UTC).`,`Сезон: Основной (main). Статус: завершён.`,`Данные: только турниры, сохранённые в этом приложении. Удалённые и неимпортированные турниры не включены.`,``,`## Правила`,`Одна партия до 11, разница 2. Старт случайный. Победа: старт 2, Gold 3, Silver 2, Bronze 1; поражение и проход 0. В межуровневой игре — очки уровня победителя ДО матча.`,`Места: сумма очков → процент побед → средняя разница игровых очков → сохранённая жеребьёвка. Последняя группа не определяет место.`,`Очки сезона за места 1–8: ${t.rules.season.join(', ')}.`,`При долгом ожидании (${t.ids.length-1} пропущенных матчей) очередь важнее размера группы; одиночный игрок получает соперника ближайшего уровня.`,`Жеребьёвка (ID): ${t.draw.join(', ')}.`,``,`## Итоги`,`| Место | Игрок | ID | Игр | В | П | % побед | Очки турнира | Последняя группа | Сезон до | + за место | Сезон после |`,`|---|---|---|---|---|---|---|---|---|---|---|---|`];
  for(const r of rows)lines.push(`| ${r.place} | ${n(r.id)} | ${r.id} | ${r.games} | ${r.wins} | ${r.losses} | ${percent(r.wins,r.games)} | ${r.points} | ${r.level} | ${before.find(p=>p.id===r.id).points} | ${r.seasonPoints} | ${after.find(p=>p.id===r.id).points} |`);
  lines.push('','## Все матчи','| № / ID | Игрок A | Игрок B | Счёт A:B | Победитель | Уровни до A / B | После A / B | Очки победителя |','|---|---|---|---|---|---|---|---|');
  t.matches.forEach((m,i)=>lines.push(`| ${i+1} / ${m.id} | ${n(m.a)} | ${n(m.b)} | ${m.scoreA}:${m.scoreB} | ${n(m.winner)} | ${m.levelA} / ${m.levelB} | ${transition(m.levelA,m.winner===m.a)} / ${transition(m.levelB,m.winner===m.b)} | ${m.points} |`));
  if(t.ids.length%2)lines.push('',`Технический проход после открытия: ${n(t.draw.at(-1))} (${t.draw.at(-1)}) → Gold. Без матча, победы и очков.`);
  if(t.voided.length){lines.push('','## Отменённые результаты (НЕ учитывать)');for(const m of t.voided)lines.push(`- ${m.id}: ${n(m.a)} — ${n(m.b)} ${m.scoreA}:${m.scoreB}; ${md(m.voidReason)}.`);}
  lines.push('','## Личные встречи: сегодня / всего к концу турнира');for(let i=0;i<t.ids.length;i++)for(let j=i+1;j<t.ids.length;j++){const a=t.ids[i],b=t.ids[j],today=h2h(db,a,b,[t]);if(today.matches.length){const total=h2h(db,a,b,all.slice(0,ix+1));lines.push(`- ${n(a)} — ${n(b)}: сегодня ${today.aWins}:${today.bWins}; в сохранённой истории ${total.aWins}:${total.bWins}.`);}}
  lines.push('','## Ачивки',...notes.map(a=>`- ${n(a.id)}: ${a.title} — ${a.detail}. Матчи: ${a.matches.join(', ')||'итог турнира'}.`),'','## Рейтинг сезона после турнира (сохранённая история)','| Игрок | Очки | Турниры | Титулы | В / П |','|---|---|---|---|---|',...after.filter(p=>p.tournaments).map(p=>`| ${md(p.name)} | ${p.points} | ${p.tournaments} | ${p.titles} | ${p.wins} / ${p.losses} |`),'','## Обзор',`${n(rows[0].id)} — чемпион: ${rows[0].points} турнирных очков, ${rows[0].wins} побед из ${rows[0].games} матчей. За вечер сыграно ${t.matches.length} матчей. Начисления сезона: ${rows.map(r=>`${n(r.id)} +${r.seasonPoints}`).join('; ')}.`,``,`Примечание для ведения истории: проверяй ID турнира перед добавлением. Повторный ID не добавляй второй раз; более новая редакция заменяет старую. Используй только указанные факты. Изменение версии базы может отражать удаление тестовых турниров: этот отчёт сам по себе не является командой удалить другую историю.`);
  return lines.join('\n');
}
export function validateDB(data){
  const isId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if(!data||data.version!==VERSION||!Number.isInteger(data.revision)||data.revision<0||!Array.isArray(data.players)||!Array.isArray(data.tournaments))throw Error('Это не резервная копия TT League поддерживаемой версии.');
  if(data.players.length>1000||data.tournaments.length>5000)throw Error('Резервная копия слишком большая.');
  const pids=new Set();for(const p of data.players){if(!isId(p.id)||pids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>40||typeof p.archived!=='boolean')throw Error('Некорректные профили в копии.');pids.add(p.id);}
  const tids=new Set(),mids=new Set();let active=0;
  for(const t of data.tournaments){
    if(!t||!isId(t.id)||tids.has(t.id)||typeof t.title!=='string'||t.title.length>80||!Number.isInteger(t.revision)||t.revision<1||!['active','completed'].includes(t.status)||!Number.isFinite(Date.parse(t.startedAt)))throw Error('Некорректный турнир в копии.');tids.add(t.id);
    if(!Array.isArray(t.ids)||t.ids.length<4||t.ids.length>8||new Set(t.ids).size!==t.ids.length||t.ids.some(id=>!pids.has(id))||!Array.isArray(t.draw)||t.draw.length!==t.ids.length||new Set(t.draw).size!==t.ids.length||t.draw.some(id=>!t.ids.includes(id)))throw Error('Некорректный состав или жеребьёвка.');
    if(!t.names||t.ids.some(id=>typeof t.names[id]!=='string'||t.names[id].length>40)||canonical(t.rules)!==canonical(RULES)||!Array.isArray(t.matches)||t.matches.length>10000||!Array.isArray(t.voided))throw Error('Некорректные правила или история.');
    const replay={...clone(t),matches:[],status:'active',current:null};replay.current=nextPair(replay);
    for(const m of t.matches){const lv=levels(replay);if(!m||typeof m.id!=='string'||mids.has(m.id)||!t.ids.includes(m.a)||!t.ids.includes(m.b)||m.a===m.b||!validScore(m.scoreA,m.scoreB)||m.winner!==(m.scoreA>m.scoreB?m.a:m.b)||m.levelA!==lv[m.a]||m.levelB!==lv[m.b]||m.points!==RULES.points[lv[m.winner]]||!Number.isFinite(Date.parse(m.at))||m.a!==replay.current.a||m.b!==replay.current.b)throw Error('Матчи или начисления в копии повреждены.');mids.add(m.id);replay.matches.push(m);replay.current=nextPair(replay);}
    for(const m of t.voided){if(!m||!t.ids.includes(m.a)||!t.ids.includes(m.b)||!validScore(m.scoreA,m.scoreB)||typeof m.id!=='string'||typeof m.voidReason!=='string')throw Error('Некорректная запись отмены.');}
    if(t.status==='active'){active++;if(!t.current||t.current.a!==replay.current.a||t.current.b!==replay.current.b)throw Error('Повреждён текущий матч.');}
    else if(t.current!==null||!Number.isFinite(Date.parse(t.endedAt))||t.matches.length<Math.floor(t.ids.length/2))throw Error('Некорректное завершение турнира.');
  }
  if(active>1)throw Error('В копии больше одного активного турнира.');return clone(data);
}
