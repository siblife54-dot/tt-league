import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {factsForEvent,fallbackResult,formatTelegram,modelRequest} from './commentary.js';

const jsonHeaders={'Content-Type':'application/json'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:jsonHeaders});
const required=(name:string)=>{const value=Deno.env.get(name);if(!value)throw Error(`Missing secret: ${name}`);return value;};
const detail=(stage:string,error:unknown)=>Error(`${stage}: ${error instanceof Error?error.message:JSON.stringify(error)}`);

async function cloudComment(facts:Record<string,unknown>,recent:string[]){
  const apiKey=required('CLOUDRU_API_KEY');
  const base=(Deno.env.get('CLOUDRU_BASE_URL')||'https://foundation-models.api.cloud.ru/v1').replace(/\/$/,'');
  const model=Deno.env.get('CLOUDRU_MODEL')||'openai/gpt-5.4-mini';
  const response=await fetch(`${base}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,...modelRequest(facts,recent)})});
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(`Cloud.ru ${response.status}: ${JSON.stringify(data).slice(0,500)}`);
  const raw=data?.choices?.[0]?.message?.content;
  const content=Array.isArray(raw)?raw.map((x:{text?:string})=>x.text||'').join(''):raw;
  if(!content)throw Error(`Cloud.ru returned empty content (${data?.choices?.[0]?.finish_reason||'unknown'})`);
  return JSON.parse(content);
}

async function telegram(method:string,body:Record<string,unknown>){
  const token=required('TELEGRAM_BOT_TOKEN');
  const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:jsonHeaders,body:JSON.stringify(body)});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.ok)throw Error(`Telegram ${response.status}: ${JSON.stringify(data).slice(0,500)}`);
  return data.result;
}

Deno.serve(async req=>{
  if(req.method!=='POST')return reply({error:'POST required'},405);
  let id='';
  try{
    const webhook=await req.json();
    id=String(webhook?.record?.id||webhook?.id||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return reply({error:'Valid event id required'},400);

    const url=required('SUPABASE_URL');
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(required('SUPABASE_SECRET_KEYS')).default;
    const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:found,error:readError}=await db.from('tt_commentary_events').select('*').eq('id',id).single();
    if(readError)throw detail('read event',readError);
    if(!found)throw Error('Event not found');
    if(found.status==='sent')return reply({ok:true,duplicate:true});
    if(found.attempts>=3)return reply({ok:false,error:'Retry limit reached'},409);

    const {data:event,error:claimError}=await db.from('tt_commentary_events').update({status:'processing',attempts:found.attempts+1,error:null}).eq('id',id).in('status',['pending','failed']).select('*').maybeSingle();
    if(claimError)throw detail('claim event',claimError);
    if(!event)return reply({ok:true,duplicate:true});

    if(event.event_type==='match_voided'){
      const matchId=event.payload?.match?.id;
      const {data:original}=await db.from('tt_commentary_events').select('telegram_message_id,telegram_text').eq('event_type','match_completed').eq('payload->match->>id',matchId).eq('status','sent').maybeSingle();
      if(original?.telegram_message_id){
        const text=`❌ РЕЗУЛЬТАТ ОТМЕНЁН\n${String(original.telegram_text||'').replace(/^❌ РЕЗУЛЬТАТ ОТМЕНЁН\n/,'')}`;
        await telegram('editMessageText',{chat_id:required('TELEGRAM_CHAT_ID'),message_id:original.telegram_message_id,text});
        await db.from('tt_commentary_events').update({status:'sent',telegram_message_id:original.telegram_message_id,telegram_text:text,processed_at:new Date().toISOString()}).eq('id',id);
        return reply({ok:true,edited:true});
      }
    }

    const {data:stateRow,error:stateError}=await db.from('tt_league_state').select('payload').eq('id','main').single();
    if(stateError)throw detail('read league state',stateError);
    const facts=factsForEvent(event,stateRow.payload);
    const {data:recentRows}=await db.from('tt_commentary_events').select('telegram_text').eq('status','sent').not('telegram_text','is',null).order('created_at',{ascending:false}).limit(5);
    const recent=(recentRows||[]).map((x:{telegram_text:string})=>x.telegram_text.slice(0,350));
    let generated,aiError='';
    try{generated=await cloudComment(facts,recent);}catch(error){aiError=error instanceof Error?error.message:String(error);generated=fallbackResult(facts);}
    const text=formatTelegram(event,facts,generated);
    const sent=await telegram('sendMessage',{chat_id:required('TELEGRAM_CHAT_ID'),text,disable_web_page_preview:true});
    const {error:saveError}=await db.from('tt_commentary_events').update({status:'sent',telegram_message_id:sent.message_id,telegram_text:text,error:aiError||null,processed_at:new Date().toISOString()}).eq('id',id);
    if(saveError)throw detail('save sent event',saveError);
    return reply({ok:true,used_fallback:Boolean(aiError)});
  }catch(error){
    const message=error instanceof Error?error.message:JSON.stringify(error);
    if(id)try{
      const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if(url&&key)await createClient(url,key,{auth:{persistSession:false}}).from('tt_commentary_events').update({status:'failed',error:message.slice(0,1000),processed_at:new Date().toISOString()}).eq('id',id).eq('status','processing');
    }catch{/* Preserve the original error. */}
    console.error(message);
    return reply({ok:false,error:message},500);
  }
});
