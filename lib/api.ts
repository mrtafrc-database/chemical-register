import {WORKFLOW_API_URL, BASE_PATH} from './config';
export function signIn(){window.location.assign(`${BASE_PATH}/`);}
export async function api(path:string, options:RequestInit={}){
 if(!WORKFLOW_API_URL)throw new Error('ยังไม่ได้ตั้ง NEXT_PUBLIC_WORKFLOW_API_URL ใน GitHub Actions Variables');
 const token=sessionStorage.getItem('chemical_register_token');if(!token){signIn();throw new Error('Please sign in');}
 const headers=new Headers(options.headers);headers.set('Authorization',`Bearer ${token}`);
 if(options.body)headers.set('Content-Type','application/json');
 const response=await fetch(`${WORKFLOW_API_URL.replace(/\/$/,'')}${path}`,{...options,headers,cache:'no-store'});
 let data:any;try{data=await response.json();}catch{throw new Error('API response is not JSON. Check Worker URL');}
 if(response.status===401){sessionStorage.removeItem('chemical_register_token');signIn();}
 if(!response.ok||!data.success)throw new Error(data.message||`Request failed (${response.status})`);return data;
}
export const post=(path:string,body:unknown,key=crypto.randomUUID())=>api(path,{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(body)});
