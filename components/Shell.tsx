'use client';
import {useEffect,useState} from 'react';
import {AUTH_API_URL,BASE_PATH} from '../lib/config';
import {api,signIn} from '../lib/api';
import type {User} from '../lib/types';
export function useProfile(){
 const [user,setUser]=useState<User|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;api('/profile').then(r=>{if(active)setUser(r.user);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 return {user,error};
}
export function Badge({status}:{status:string}){return <span className={`badge ${status==='RETURNED_FOR_DOCUMENTS'?'returned':['CANCELLED','REJECTED'].includes(status)?'closed':''}`}>{status.replaceAll('_',' ')}</span>;}
export default function Shell({user,children}:{user:User|null;children:React.ReactNode}){
 const [busy,setBusy]=useState(false);
 async function logout(){setBusy(true);try{const token=sessionStorage.getItem('chemical_register_token');if(token)await fetch(`${AUTH_API_URL}/logout`,{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(8000)});}catch{}finally{sessionStorage.removeItem('chemical_register_token');signIn();}}
 return <><header className="topbar"><a href={`${BASE_PATH}/dashboard/`} style={{textDecoration:'none',fontSize:19,fontWeight:700}}>Chemical Register</a><div style={{display:'flex',gap:12,alignItems:'center'}}><span className="muted">{user?.displayName}</span>{user?.roles.includes('ADMIN')&&<a className="button" href={`${BASE_PATH}/items/`}>Item Master</a>}<button onClick={logout} disabled={busy}>Sign Out</button></div></header><main className="container">{user?.mustChangePassword&&<div className="notice">บัญชีนี้ต้องเปลี่ยนรหัสผ่านเริ่มต้นก่อนสร้างหรือบันทึกผลตรวจ กรุณาติดต่อผู้ดูแลระบบ Login เดิม — API จะไม่อนุญาตให้ข้ามเงื่อนไขนี้</div>}{children}</main></>;
}
