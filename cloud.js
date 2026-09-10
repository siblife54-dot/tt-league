import { CLOUD } from './cloud-config.js';
import { validateDB } from './domain.js';

let session = null;
export function isOrganizer(){return !!session && Date.parse(session.expires_at)>Date.now();}
export async function request(path, body, method=body===undefined?'GET':'POST'){
  let response;
  try {response=await fetch(`${CLOUD.url}/rest/v1/${path}`,{
    method, cache:'no-store', headers:{apikey:CLOUD.key,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}), signal:AbortSignal.timeout(20000),
  });}catch {throw Error('Нет связи с общей базой. Изменение не подтверждено; проверьте соединение и обновите данные.');}
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    if(data?.code==='40001')throw Object.assign(Error('Результаты уже изменились на другом устройстве. Обновите данные и проверьте текущую пару.'),{conflict:true});
    if(data?.code==='42501'){session=null;throw Object.assign(Error('Войдите как организатор ещё раз.'),{auth:true});}
    if(['PGRST205','PGRST202','42P01','42883'].includes(data?.code))throw Object.assign(Error('Общая база ещё не настроена. Выполните файл установки в проекте TT League.'),{setup:true});
    throw Error('Общая база не приняла запрос. Данные не изменены.');
  }
  return data;
}
export async function readCloud(){const rows=await request('tt_league_state?id=eq.main&select=payload,revision');if(!Array.isArray(rows)||rows.length!==1)throw Object.assign(Error('Общая база ещё не настроена.'),{setup:true});return validateDB(rows[0].payload);}
export async function writeCloud(data){if(!isOrganizer())throw Object.assign(Error('Для изменения данных войдите как организатор.'),{auth:true});return request('rpc/tt_write',{session_token:session.token,expected_revision:data.revision-1,new_payload:data});}
export async function loginOrganizer(password){
  const result=await request('rpc/tt_login',{password});
  if(result?.error==='wait')throw Error('Слишком много попыток. Подождите минуту.');
  if(result?.error==='not_configured')throw Error('Пароль организатора ещё не задан в Supabase.');
  if(!result?.token||!Number.isFinite(Date.parse(result.expires_at)))throw Error('Неверный пароль.');
  session={token:result.token,expires_at:result.expires_at};
}
export async function logoutOrganizer(){const old=session;session=null;if(old)try{await request('rpc/tt_logout',{session_token:old.token});}catch{/* Local access ends immediately; server sessions also expire. */}}
