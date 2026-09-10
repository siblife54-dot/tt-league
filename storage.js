import {emptyDB,validateDB} from './domain.js';
let database;
export async function openStore(){
  database=await new Promise((resolve,reject)=>{const r=indexedDB.open('tt-league',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Не удалось открыть хранилище. Проверьте, что браузер разрешает хранить данные сайта.'));});
  const data=await new Promise((resolve,reject)=>{const tx=database.transaction('state','readonly');const r=tx.objectStore('state').get('league');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return data?validateDB(data):emptyDB();
}
export function saveStore(data){return new Promise((resolve,reject)=>{const tx=database.transaction('state','readwrite'),store=tx.objectStore('state');const read=store.get('league');let conflict=false;read.onsuccess=()=>{if((read.result?.revision||0)!==data.revision-1){conflict=true;tx.abort();}else store.put(data,'league');};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('Не удалось сохранить. Освободите место на устройстве и повторите.'));tx.onabort=()=>reject(Error(conflict?'Данные изменились в другой вкладке. Обновите страницу.':'Сохранение прервано. Результат не записан.'));});}
export function backupBeforeReplace(data){return new Promise((resolve,reject)=>{const tx=database.transaction('state','readwrite');tx.objectStore('state').put(data,'before-import');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
export function readPreviousBackup(){return new Promise((resolve,reject)=>{const r=database.transaction('state','readonly').objectStore('state').get('before-import');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
