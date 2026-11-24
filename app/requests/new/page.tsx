'use client';
import {useEffect,useState,useRef} from 'react';
import Shell,{useProfile} from '../../../components/Shell';
import {api,post} from '../../../lib/api';
import {BASE_PATH} from '../../../lib/config';
import type {Section} from '../../../lib/types';
type Item={id:string;item_no:string;description:string;issue_unit:string;revision:number;chemical_scope:string};
export default function NewRequest(){
 const {user,error:profileError}=useProfile();
 const [sections,setSections]=useState<Section[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [form,setForm]=useState({sectionId:'',chemicalName:'',purpose:'',requestQuantity:'',unit:'',declaredType:'EXISTING'});
 const [query,setQuery]=useState(''),[items,setItems]=useState<Item[]>([]),[selected,setSelected]=useState<Item|null>(null),[searching,setSearching]=useState(false),[page,setPage]=useState(1),[total,setTotal]=useState(0),[searchError,setSearchError]=useState('');
 const lock=useRef(false),operation=useRef<{payload:string;key:string}|null>(null);
 useEffect(()=>{if(user){setForm(f=>({...f,sectionId:user.sectionId||''}));api('/sections').then(r=>setSections(r.sections)).catch(e=>setError(e.message));}},[user]);
 useEffect(()=>{
  if(!user||form.declaredType!=='EXISTING'||selected||!query.trim()){setItems([]);setTotal(0);setSearching(false);return;}
  let live=true;setSearching(true);setSearchError('');
  const timer=setTimeout(()=>{api(`/items?${new URLSearchParams({q:query.trim(),page:String(page),selectable:'1'})}`).then(r=>{if(live){setItems(r.items);setTotal(r.total);}}).catch(e=>{if(live){setSearchError(e.message);setItems([]);}}).finally(()=>{if(live)setSearching(false);});},300);
  return()=>{live=false;clearTimeout(timer);};
 },[user,query,page,selected,form.declaredType]);
 const change=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}));
 function switchType(value:string){setForm(f=>({...f,declaredType:value,unit:''}));setSelected(null);setQuery('');setPage(1);setItems([]);setError('');operation.current=null;}
 async function submit(e:React.FormEvent){e.preventDefault();if(lock.current)return;if(form.declaredType==='EXISTING'&&!selected){setError('กรุณาค้นหาและเลือก Item จาก Item Master ก่อน');return;}
  lock.current=true;setBusy(true);setError('');
  try{const data={...form,requestQuantity:Number(form.requestQuantity),unit:selected?.issue_unit||form.unit,itemMasterId:selected?.id||null,itemMasterRevision:selected?.revision??null,itemNo:selected?.item_no||'',itemDescription:selected?.description||''};
   if(!Number.isFinite(data.requestQuantity)||data.requestQuantity<=0)throw new Error('ปริมาณต้องเป็นตัวเลขมากกว่า 0');
   const payload=JSON.stringify(data);if(operation.current?.payload!==payload)operation.current={payload,key:crypto.randomUUID()};
   await post('/requests',data,operation.current.key);window.location.assign(`${BASE_PATH}/dashboard/`);
  }catch(e){setError(e instanceof Error?e.message:'Unable to submit');}finally{lock.current=false;setBusy(false);}
 }
 const allowed=user?.roles.some(r=>['REQUESTOR','ADMIN'].includes(r)),existing=form.declaredType==='EXISTING';
 return <Shell user={user}><div className="toolbar"><div><h1>New Chemical Request — Dashboard v2</h1><span className="muted">ระบบสร้างเลขคำขออัตโนมัติเมื่อบันทึกสำเร็จ</span></div><a className="button" href={`${BASE_PATH}/dashboard/`}>Back</a></div>
 {(profileError||error)&&<div role="alert" className="error">{profileError||error}</div>}
 {user&&!allowed?<div className="notice">ต้องมีสิทธิ์ Requestor หรือ Admin เพื่อสร้างคำขอ</div>:<form onSubmit={submit} className="card"><fieldset disabled={busy||!user||!allowed||!!user?.mustChangePassword} style={{border:0,padding:0}}><div className="grid">
 <div><label htmlFor="section">Section</label><select id="section" required value={form.sectionId} onChange={e=>change('sectionId',e.target.value)} disabled={!user?.roles.includes('ADMIN')}><option value="">Select Section</option>{sections.map(s=><option key={s.id} value={s.id}>{s.section_code} — {s.section_name}</option>)}</select></div>
 <div><label htmlFor="type">Declared Type</label><select id="type" value={form.declaredType} onChange={e=>switchType(e.target.value)}><option value="EXISTING">Existing Chemical — เลือก Item เดิม</option><option value="NEW">New Chemical — ยังไม่มี Item</option></select></div>
 {existing?<div className="full"><label htmlFor="itemSearch">ค้นหาจาก Item Description บางส่วน</label><input id="itemSearch" maxLength={200} placeholder="เช่น Hand Cleaner หรือ CRC" value={query} onChange={e=>{setQuery(e.target.value);setSelected(null);setPage(1);setItems([]);setForm(f=>({...f,unit:''}));}} autoComplete="off"/>
 {selected?<div className="notice" style={{marginTop:12}}><strong>เลือกแล้ว: {selected.item_no} — {selected.description}</strong><br/>หน่วย {selected.issue_unit} · {selected.chemical_scope==='UNCONFIRMED'?'Master ยังไม่ยืนยันว่าเป็นสารเคมี':'Master ระบุเป็นสารเคมี'}<br/><button type="button" onClick={()=>{setSelected(null);setQuery('');setPage(1);}}>เปลี่ยน Item</button></div>:<>
 {searchError&&<div className="error" role="alert">{searchError}</div>}
 {query.trim()&&<div className="scroll" style={{marginTop:12,maxHeight:360,overflowY:'auto'}}><table><thead><tr><th>Item</th><th>Description</th><th>Unit</th><th></th></tr></thead><tbody>{items.map(i=><tr key={i.id}><td>{i.item_no}</td><td>{i.description}</td><td>{i.issue_unit}</td><td><button type="button" disabled={searching} onClick={()=>{setSelected(i);setForm(f=>({...f,unit:i.issue_unit}));setItems([]);setError('');}}>เลือก</button></td></tr>)}{!items.length&&<tr><td colSpan={4}>{searching?'กำลังค้นหา...':'ไม่พบรายการที่เปิดใช้งานและไม่ถูกระบุว่าไม่ใช่สารเคมี'}</td></tr>}</tbody></table></div>}
 {!!total&&<div className="toolbar" style={{marginTop:12}}><span>{total} รายการ · หน้า {page}</span><div><button type="button" disabled={page===1||searching} onClick={()=>{setItems([]);setSearching(true);setPage(p=>p-1);}}>Previous</button> <button type="button" disabled={page*50>=total||searching} onClick={()=>{setItems([]);setSearching(true);setPage(p=>p+1);}}>Next</button></div></div>}</>}
 </div>:<div className="full notice">New Chemical ยังไม่ต้องกรอก Item หรือ Item Description แต่ต้องกรอกชื่อสารเคมี</div>}
 {existing&&<><div><label htmlFor="itemNo">Item No. — จาก Master</label><input id="itemNo" readOnly value={selected?.item_no||''} placeholder="กรุณาเลือก Item ด้านบน"/></div><div><label htmlFor="itemDescription">Item Description — จาก Master</label><input id="itemDescription" readOnly value={selected?.description||''}/></div></>}
 <div className="full"><label htmlFor="chemicalName">ชื่อสารเคมี / Chemical Name</label><input id="chemicalName" required maxLength={300} value={form.chemicalName} onChange={e=>change('chemicalName',e.target.value)}/></div>
 <div className="full"><label htmlFor="purpose">วัตถุประสงค์การใช้ / Purpose</label><textarea id="purpose" required maxLength={2000} value={form.purpose} onChange={e=>change('purpose',e.target.value)}/></div>
 <div><label htmlFor="quantity">Request Quantity</label><input id="quantity" type="number" step="any" min="0.000000001" max="1000000000000" required value={form.requestQuantity} onChange={e=>change('requestQuantity',e.target.value)}/></div>
 <div><label htmlFor="unit">Unit {existing?'— จาก Master':''}</label><input id="unit" required maxLength={40} readOnly={existing} value={existing?selected?.issue_unit||'':form.unit} onChange={e=>change('unit',e.target.value)}/></div>
 </div></fieldset>
 <div className="notice" style={{marginTop:20}}>Existing ต้องเลือก Item เดิมจาก Master · New ต้องกรอกชื่อสารเคมี ไม่ต้องมี Item<br/>คำขอเก็บสำเนา Item ณ เวลาส่ง ไม่เปลี่ยนตาม Master ภายหลัง<br/>รุ่นนี้คง Workflow เดิม Existing → Store Review / New → Safety Review ยังไม่รวมการแนบเอกสารและ Workflow 5 ประเภทเต็มรูปแบบ</div>
 <div className="actions"><button className="primary" disabled={busy||!user||!allowed||!!user?.mustChangePassword||(existing&&!selected)}>{busy?'Submitting...':'Submit Request'}</button><a className="button" href={`${BASE_PATH}/dashboard/`}>Cancel</a></div></form>}</Shell>;
}
