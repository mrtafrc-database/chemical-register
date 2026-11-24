// Add-on API. Existing authentication Worker remains the source of token validation.
interface Statement { bind(...values: unknown[]): Statement; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{results:T[]}>; }
interface Database { prepare(sql:string):Statement; batch(statements:Statement[]):Promise<unknown[]>; }
interface Env { DB:Database; AUTH_API_URL:string; ALLOWED_ORIGINS:string; AUTH_SERVICE:{fetch(request:Request):Promise<Response>}; }
type User = {id:string; username:string; display_name:string; section_id:string|null; must_change_password:number; roles:string[]};
type Chemical = {id:string; requestor_id:string; section_id:string; status:string; declared_type:string; request_quantity:number; revision:number; safety_classification:string|null; store_review_status:string; [key:string]:unknown};
class ApiError extends Error { constructor(public status:number, message:string) {super(message);} }
const fail=(s:number,m:string):never=>{throw new ApiError(s,m)};
const uuid=()=>crypto.randomUUID();
const sha=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const text=(b:Record<string,unknown>,key:string,max=500,optional=false):string=>{const v=b[key];if(optional&&(v===undefined||v===null))return '';if(typeof v!=='string'||v.length>max||(!optional&&!v.trim()))fail(400,`Invalid ${key}`);return (v as string).trim();};
const num=(b:Record<string,unknown>,key:string,positive=false):number=>{const v=b[key];if(typeof v!=='number'||!Number.isFinite(v)||v>(1e12)||v<0||(positive&&v===0))fail(400,`Invalid ${key}`);return v as number;};
const enumValue=(b:Record<string,unknown>,key:string,values:string[]):string=>{const v=text(b,key,80);if(!values.includes(v))fail(400,`Invalid ${key}`);return v;};
function has(u:User,...roles:string[]){return roles.some(r=>u.roles.includes(r));}
function privileged(u:User){return has(u,'ADMIN','STORE','SAFETY');}
function sectionEditor(u:User,r:Chemical){return has(u,'ADMIN')||(has(u,'REQUESTOR')&&!!u.section_id&&u.section_id===r.section_id);}
function visible(u:User,r:Chemical){return privileged(u)||r.requestor_id===u.id||(r.declared_type==='EXISTING'&&sectionEditor(u,r));}
const closed=(r:Chemical)=>['APPROVED_FOR_PURCHASE','REJECTED','CANCELLED'].includes(r.status);
async function authenticate(req:Request,env:Env):Promise<User>{
 const bearer=req.headers.get('Authorization')||'';
 if(!/^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(bearer)||bearer.length>4096)fail(401,'Please sign in');
 const url=new URL(env.AUTH_API_URL);if(url.protocol!=='https:'||url.pathname!=='/')fail(503,'Invalid authentication API configuration');
 if(!env.AUTH_SERVICE)fail(503,'Missing AUTH_SERVICE service binding on Workflow Worker');
 let response:Response;try{response=await env.AUTH_SERVICE.fetch(new Request(new URL('/me',url),{headers:{Authorization:bearer},redirect:'manual',signal:AbortSignal.timeout(8000)}));}catch(error){console.error('AUTH_SERVICE /me fetch failed',error instanceof Error?{name:error.name,message:error.message}:{name:'UnknownError'});fail(503,'Login service connection failed through AUTH_SERVICE');}
 if(response!.status===401||response!.status===403)fail(401,'Session expired');
 if(!response!.ok){console.error('AUTH_SERVICE /me HTTP status',response!.status);fail(503,`Login service /me returned HTTP ${response!.status}`);}
 let data:any;try{data=await response!.json();}catch{fail(503,'Invalid authentication response');}
 if(!data.success||typeof data.user?.username!=='string')fail(401,'Invalid session');
 const row=await env.DB.prepare('SELECT id,username,display_name,section_id,must_change_password FROM users WHERE username=? COLLATE NOCASE AND is_active=1').bind(data.user.username).first<Omit<User,'roles'>>();
 if(!row)fail(403,'User is not enabled in this database');
 const roles=await env.DB.prepare('SELECT r.role_code FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=?').bind(row!.id).all<{role_code:string}>();
 return {...row!,roles:roles.results.map(r=>r.role_code)};
}
async function getRequest(env:Env,id:string,u:User){
 const r=await env.DB.prepare('SELECT * FROM chemical_requests WHERE id=?').bind(id).first<Chemical>();if(!r||!visible(u,r))fail(404,'Request not found');return r!;
}
async function body(req:Request,maxBytes=16384){
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail(415,'JSON required');
 const reader=req.body?.getReader();if(!reader)fail(400,'Missing body');let size=0;const chunks:Uint8Array[]=[];
 while(true){const {done,value}=await reader!.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader!.cancel();fail(413,'Request too large');}chunks.push(value);}
 const joined=new Uint8Array(size);let at=0;for(const c of chunks){joined.set(c,at);at+=c.length;}
 let b:any;try{b=JSON.parse(new TextDecoder().decode(joined));}catch{fail(400,'Invalid JSON');}
 if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'Invalid JSON object');return b as Record<string,unknown>;
}
async function replay(env:Env,key:string,user:User,hash:string){
 const prev=await env.DB.prepare('SELECT actor_id,payload_hash,request_id FROM workflow_operations WHERE id=?').bind(key).first<{actor_id:string;payload_hash:string;request_id:string}>();
 if(!prev)return null;if(prev.actor_id!==user.id||prev.payload_hash!==hash)fail(409,'Idempotency key already used');
 return {success:true,request:await getRequest(env,prev.request_id,user),replayed:true};
}
async function mutate(req:Request,env:Env,u:User,path:string,id?:string,action?:string){
 if(u.must_change_password)fail(403,'Change the initial password in the authentication system before submitting or reviewing requests');
 const b=await body(req);const key=req.headers.get('Idempotency-Key')||'';if(!/^[0-9a-f-]{36}$/i.test(key))fail(400,'A UUID Idempotency-Key is required');
 const hash=await sha(JSON.stringify({path,body:b}));const prior=await replay(env,key,u,hash);if(prior)return prior;
 const statements:Statement[]=[];const stmt=(sql:string,...v:unknown[])=>env.DB.prepare(sql).bind(...v);
 const now=new Date().toISOString();let r:Chemical|undefined;let target:string;let requestId=id||uuid();let auditAction:string;let next:Record<string,unknown>={};
 if(!id){
  if(!has(u,'REQUESTOR','ADMIN'))fail(403,'Requestor role required');
  const sectionId=has(u,'ADMIN')?text(b,'sectionId',100):u.section_id;if(!sectionId)fail(400,'A section must be assigned');
  const section=await stmt('SELECT id FROM sections WHERE id=? AND is_active=1',sectionId).first();if(!section)fail(400,'Section is not active');
  const declared=enumValue(b,'declaredType',['EXISTING','NEW']);const quantity=num(b,'requestQuantity',true);
  const chemical=text(b,'chemicalName',300),purpose=text(b,'purpose',2000);
  let itemNo='',description='',unit=declared==='NEW'?text(b,'unit',40):'',masterId:string|null=null,snapshot:string|null=null;
  if(declared==='NEW'){
   if(b.itemMasterId!=null&&b.itemMasterId!=='')fail(400,'New Chemical must not select an existing Item');
   if(text(b,'itemNo',100,true)||text(b,'itemDescription',2000,true))fail(400,'New Chemical leaves Item and Item Description blank');
  }else{
   masterId=text(b,'itemMasterId',100);
   const master=await readMaster(env,masterId);
   if(master.is_active!==1||master.chemical_scope==='NON_CHEMICAL')fail(409,'Selected Item is disabled or marked non-chemical');
   if(typeof b.itemMasterRevision!=='number'||!Number.isInteger(b.itemMasterRevision)||b.itemMasterRevision!==master.revision)fail(409,'Item changed after selection; select it again');
   itemNo=master.item_no;description=String(master.description);unit=String(master.issue_unit);
   if(itemNo.length>100||description.length>2000||!unit||unit.length>40)fail(400,'Master description or unit is invalid for a request; ask Admin to correct it');
   // Do not trust client-supplied Item/Description/Unit. Snapshot the complete validated master.
   snapshot=JSON.stringify({...master,source_data:JSON.parse(master.source_data),captured_at:now});
   const guard=uuid();statements.push(stmt('INSERT INTO workflow_tx_guards(id,success) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM item_master WHERE id=? AND revision=? AND is_active=1 AND chemical_scope<>?) THEN 1 ELSE 0 END',guard,masterId,master.revision,'NON_CHEMICAL'));
  }
  target=declared==='EXISTING'?'PENDING_STORE_REVIEW':'PENDING_SAFETY_REVIEW';auditAction='REQUEST_SUBMITTED';
  next={status:target,declared_type:declared,request_quantity:quantity,item_master_id:masterId,item_no:itemNo,item_description:description,unit,chemical_name:chemical};
  statements.push(stmt("UPDATE running_sequences SET last_value=last_value+1 WHERE sequence_key='chemical_request'"));
  statements.push(stmt('INSERT INTO workflow_tx_guards(id,success) VALUES (?,changes())',uuid()));
  const year=new Date().getUTCFullYear();
  statements.push(stmt(`INSERT INTO chemical_requests(id,running_number,running_year,running_sequence,section_id,requestor_id,item_no,item_description,chemical_name,purpose,request_quantity,unit,declared_type,status,store_review_status,revision,item_master_id,item_snapshot)
   SELECT ?,printf('CR-%d-%06d',?,last_value),?,last_value,?,?,?,?,?,?,?,?,?,?,?,0,?,? FROM running_sequences WHERE sequence_key='chemical_request'`,requestId,year,year,sectionId,u.id,itemNo,description,chemical,purpose,quantity,unit,declared,target,declared==='EXISTING'?'PENDING_REVIEW':'NOT_REQUIRED',masterId,snapshot));
 }else{
  r=await getRequest(env,id,u);if(typeof b.revision!=='number'||!Number.isInteger(b.revision)||b.revision!==r.revision)fail(409,'This request changed. Refresh before trying again');
  if(closed(r))fail(409,'This request is already closed');let sets:string[]=[];let values:unknown[]=[];
  const set=(column:string,value:unknown)=>{sets.push(`${column}=?`);values.push(value);next[column]=value;};
  target=r.status;
  if(action==='store-review'){
   if(!has(u,'STORE','ADMIN'))fail(403,'Store role required');if(!['SUBMITTED','PENDING_STORE_REVIEW'].includes(r.status)||r.declared_type!=='EXISTING')fail(409,'Request is not waiting for Store review');
   const current=num(b,'currentStock'),limit=num(b,'approvedLimit'),remark=text(b,'remark',2000,true),limitUnit=text(b,'limitUnit',40);
   if(limitUnit!==r.unit)fail(400,'Stock, purchase quantity and limit must use the same Issue Unit; no unit conversion is performed');
   const total=current+r.request_quantity;if(!Number.isFinite(total)||total>1e12)fail(400,'Total quantity is too large');
   const result=total<=limit?'WITHIN_LIMIT':'EXCEEDS_LIMIT';
   if(b.result!==undefined&&b.result!==result)fail(400,'Result does not match stock plus purchase compared with the limit');
   if(result==='EXCEEDS_LIMIT'&&!remark)fail(400,'Over Limit requires a comment: reduce purchase quantity or request storage expansion');
   target=result==='EXCEEDS_LIMIT'?'RETURNED_FOR_DOCUMENTS':'APPROVED_FOR_PURCHASE';auditAction='STORE_REVIEWED';set('store_review_status',result);
   next.current_stock=current;next.request_quantity=r.request_quantity;next.total_after_purchase=total;next.approved_limit=limit;next.limit_unit=limitUnit;
   // maximum_stock retains the original generated current_stock + request_quantity formula.
   statements.push(stmt('INSERT INTO store_reviews(id,request_id,reviewer_id,current_stock,request_quantity,result,remark,approved_limit,limit_unit) VALUES (?,?,?,?,?,?,?,?,?)',uuid(),id,u.id,current,r.request_quantity,result,remark,limit,limitUnit));
  }else if(action==='safety-review'){
   if(!has(u,'SAFETY','ADMIN'))fail(403,'Safety role required');if(r.status!=='PENDING_SAFETY_REVIEW')fail(409,'Request is not waiting for Safety review');
   const a=enumValue(b,'action',['REVIEW','RETURN_FOR_DOCUMENTS','APPROVE','REJECT']),comment=text(b,'comment',2000,true);
   const classification=b.classification?enumValue(b,'classification',['EXISTING','NEW_GENERAL','NEW_HAZARDOUS','OTHER']):r.safety_classification;
   if(['REVIEW','APPROVE'].includes(a)&&!classification)fail(400,'Safety classification is required');
   if(classification&&((r.declared_type==='EXISTING')!==(classification==='EXISTING')))fail(400,'Classification must match the declared type');
   if(['RETURN_FOR_DOCUMENTS','REJECT'].includes(a)&&!comment)fail(400,'A reason is required');
   if(r.safety_classification==='NEW_HAZARDOUS'&&classification!=='NEW_HAZARDOUS')fail(409,'Hazardous classification cannot be downgraded in this release');
   if(classification)set('safety_classification',classification);
   if(a==='APPROVE'){
    const docs=await stmt("SELECT id FROM request_documents WHERE request_id=? AND is_active=1 AND document_type='SDS'",id).first();if(!docs)fail(409,'An active SDS is required before approval; document upload is not enabled in this release');
    if(r.declared_type==='EXISTING'&&r.store_review_status!=='WITHIN_LIMIT')fail(409,'Store must confirm Within Limit before purchase approval');
    if(classification==='NEW_HAZARDOUS'){
     if(r.safety_classification!=='NEW_HAZARDOUS')fail(409,'Save hazardous classification and obtain Customer approval first');
     const approval=await stmt('SELECT result FROM customer_approvals WHERE request_id=? ORDER BY created_at DESC,id DESC LIMIT 1',id).first<{result:string}>();if(approval?.result!=='APPROVED')fail(409,'Customer approval is required');
    }
    target='APPROVED_FOR_PURCHASE';set('safety_review_status','APPROVED');
   }else if(a==='RETURN_FOR_DOCUMENTS'){target='RETURNED_FOR_DOCUMENTS';set('safety_review_status','RETURNED');}
   else if(a==='REJECT'){target='REJECTED';set('safety_review_status','REJECTED');}
   else if(classification==='NEW_HAZARDOUS'){
    target='PENDING_CUSTOMER_APPROVAL';statements.push(stmt('INSERT INTO customer_approvals(id,request_id,handled_by,result,created_at) VALUES (?,?,?,?,?)',uuid(),id,u.id,'PENDING',now));
   }
   auditAction='SAFETY_'+a;statements.push(stmt('INSERT INTO safety_reviews(id,request_id,reviewer_id,classification,action,comment) VALUES (?,?,?,?,?,?)',uuid(),id,u.id,classification,a,comment));
  }else if(action==='customer-approval'){
   if(!has(u,'SAFETY','ADMIN'))fail(403,'Safety role required');if(r.status!=='PENDING_CUSTOMER_APPROVAL')fail(409,'Not waiting for Customer approval');
   const result=enumValue(b,'result',['APPROVED','REJECTED']),reference=text(b,'customerReference',300),comment=text(b,'comment',2000,true);
   const docs=await stmt("SELECT id FROM request_documents WHERE request_id=? AND is_active=1 AND document_type='CUSTOMER_APPROVAL'",id).first();if(!docs)fail(409,'Customer approval evidence is required; document upload is not enabled in this release');
   target=result==='APPROVED'?'PENDING_SAFETY_REVIEW':'REJECTED';if(result==='REJECTED')set('safety_review_status','REJECTED');auditAction='CUSTOMER_'+result;
   statements.push(stmt('INSERT INTO customer_approvals(id,request_id,handled_by,result,customer_reference,comment,responded_at,created_at) VALUES (?,?,?,?,?,?,?,?)',uuid(),id,u.id,result,reference,comment,now,now));
  }else if(action==='resubmit'){
   if(r.declared_type==='EXISTING'&&r.store_review_status==='EXCEEDS_LIMIT'){
    if(!sectionEditor(u,r))fail(403,'A Requestor in this Section or Admin is required to revise and resubmit');
    if(r.status!=='RETURNED_FOR_DOCUMENTS')fail(409,'Request is not returned by Store');
    if(Object.keys(b).some(k=>!['revision','requestQuantity','reason'].includes(k)))fail(400,'Only purchase quantity and reason may be edited in this step');
    const quantity=num(b,'requestQuantity',true);text(b,'reason',2000);
    if(quantity>=r.request_quantity)fail(400,'Reduce purchase quantity for this step; quantity or storage expansion is not enabled yet');
    set('request_quantity',quantity);target='PENDING_STORE_REVIEW';set('store_review_status','PENDING_REVIEW');auditAction='REQUEST_QUANTITY_REVISED_AND_RESUBMITTED';
   }else{
    if(r.requestor_id!==u.id&&!has(u,'ADMIN'))fail(403,'Only the Requestor can resubmit');if(r.status!=='RETURNED_FOR_DOCUMENTS')fail(409,'Not returned for documents');
    const docs=await stmt("SELECT id FROM request_documents WHERE request_id=? AND is_active=1 AND document_type='SDS'",id).first();if(!docs)fail(409,'An active SDS is required; document upload is not enabled in this release');
    target=r.declared_type==='EXISTING'?'PENDING_STORE_REVIEW':'PENDING_SAFETY_REVIEW';set('store_review_status',r.declared_type==='EXISTING'?'PENDING_REVIEW':'NOT_REQUIRED');set('safety_review_status','PENDING_REVIEW');auditAction='REQUEST_RESUBMITTED';
   }
  }else if(action==='cancel'){
   if(r.requestor_id!==u.id&&!has(u,'ADMIN'))fail(403,'Only the Requestor can cancel');const reason=text(b,'reason',2000);target='CANCELLED';set('cancellation_reason',reason);set('cancelled_at',now);auditAction='REQUEST_CANCELLED';
  }else fail(404,'Action not found');
  set('status',target);sets.push('updated_at=?','revision=revision+1');values.push(now,id,r.revision,r.status);
  // Guard CHECK aborts the entire D1 batch if optimistic UPDATE changes no row.
  statements.unshift(stmt(`UPDATE chemical_requests SET ${sets.join(',')} WHERE id=? AND revision=? AND status=?`,...values),stmt('INSERT INTO workflow_tx_guards(id,success) VALUES (?,changes())',uuid()));
 }
 const notice='Request status: '+target!;
 statements.push(stmt('INSERT INTO audit_logs(id,request_id,actor_id,action,entity_type,entity_id,old_values,new_values,reason) VALUES (?,?,?,?,?,?,?,?,?)',uuid(),requestId,u.id,auditAction!,'chemical_requests',requestId,r?JSON.stringify({status:r.status,revision:r.revision,request_quantity:r.request_quantity,store_review_status:r.store_review_status}):null,JSON.stringify(next),String(b.remark||b.comment||b.reason||'')||null));
 // In-app notification only. No emails are sent in this release.
 statements.push(stmt(`INSERT INTO notifications(id,user_id,request_id,channel,title,message)
 SELECT ? || '-' || u.id,u.id,?,'IN_APP',?,? FROM users u WHERE u.is_active=1 AND
 (u.id=(SELECT requestor_id FROM chemical_requests WHERE id=?) OR (EXISTS(SELECT 1 FROM chemical_requests cr WHERE cr.id=? AND cr.declared_type='EXISTING' AND cr.section_id=u.section_id) AND EXISTS(SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id=ur.role_id WHERE ur.user_id=u.id AND ro.role_code='REQUESTOR')) OR EXISTS
 (SELECT 1 FROM user_roles ur JOIN roles ro ON ro.id=ur.role_id WHERE ur.user_id=u.id AND ro.role_code=?))`,uuid(),requestId,'Chemical Register',notice,requestId,requestId,target === 'PENDING_STORE_REVIEW'?'STORE':(['PENDING_SAFETY_REVIEW','PENDING_CUSTOMER_APPROVAL'].includes(target!)?'SAFETY':'__NONE__')));
 statements.unshift(stmt('INSERT INTO workflow_operations(id,actor_id,request_id,payload_hash) VALUES (?,?,?,?)',key,u.id,requestId,hash));
 statements.push(stmt('DELETE FROM workflow_tx_guards'));
 try{await env.DB.batch(statements);}catch{const saved=await replay(env,key,u,hash);if(saved)return saved;fail(409,'The operation could not be saved. Refresh and retry; no partial changes were committed');}
 return {success:true,request:await getRequest(env,requestId,u)};
}
// Item Master: read requires a recognized role; all changes require ADMIN.
const masterColumns=['Item','Description','Old Item Number','Type','Industry','System','Concession','Site','Issue Unit','Item Owner','Status','Lot Type','Rotating','Condition Enabled','Dangerous','Inspect on Receipt','Need QI for PM','Safety Check','Calibration','Contractual_QTY','Supplementary_QTY','Item Regis No.','Brand','Model','Specification'];
const masterQuantities=['Contractual_QTY','Supplementary_QTY'];
type MasterRow={id:string;item_no:string;source_data:string;revision:number;[key:string]:unknown};
async function readMaster(env:Env,id:string){const row=await env.DB.prepare('SELECT * FROM item_master WHERE id=?').bind(id).first<MasterRow>();if(!row)fail(404,'Item not found');return row!;}
function masterInput(b:Record<string,unknown>){
 const source=b.sourceData;
 if(!source||typeof source!=='object'||Array.isArray(source))fail(400,'Invalid sourceData');
 const raw=source as Record<string,unknown>;if(Object.keys(raw).some(k=>!masterColumns.includes(k)))fail(400,'Unknown source column');
 const d:Record<string,string|number|null>={};
 for(const k of masterColumns){const v=raw[k];if(v===null||v===undefined||v===''){d[k]=null;continue;}
  if(masterQuantities.includes(k)){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e12)fail(400,`Invalid ${k}`);d[k]=v as number;}
  else {if(typeof v!=='string'||v.length>2000)fail(400,`Invalid ${k}`);d[k]=(v as string).trim()||null;}
 }
 for(const k of ['Item','Description','Issue Unit'])if(typeof d[k]!=='string'||!d[k])fail(400,`${k} is required`);
 if(!/^[A-Za-z0-9._-]{1,100}$/.test(d.Item as string))fail(400,'Invalid Item code');
 const max=b.maximumStoredQuantity;if(max!==null&&(typeof max!=='number'||!Number.isFinite(max)||max<0||max>1e12))fail(400,'Maximum stored quantity must be a number or null');
 const scope=enumValue(b,'chemicalScope',['UNCONFIRMED','CHEMICAL','NON_CHEMICAL']);
 const unit=text(b,'storageUnit',40,true),container=text(b,'containerSize',300,true),notes=text(b,'storageNotes',2000,true);
 if(max!==null&&!unit)fail(400,'Storage unit is required when maximum stored quantity is specified');
 if(typeof b.isActive!=='boolean')fail(400,'Invalid active status');
 return {sourceData:d,chemicalScope:scope,maximumStoredQuantity:max,storageUnit:unit,containerSize:container,storageNotes:notes,isActive:b.isActive};
}
async function masterRoute(req:Request,env:Env,u:User,url:URL,path:string):Promise<{data:unknown;status:number}|null>{
 const match=path.match(/^\/items\/([A-Za-z0-9_-]{1,100})(?:\/(save|history))?$/);
 if(path!=='/items'&&!match)return null;
 if(!has(u,'ADMIN','REQUESTOR','STORE','SAFETY'))fail(403,'Item master role required');
 if(req.method==='GET'&&path==='/items'){
  const page=Number(url.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>100000)fail(400,'Invalid page');
  const q=(url.searchParams.get('q')||'').trim();if(q.length>200)fail(400,'Search too long');
  const scope=url.searchParams.get('scope')||'';if(scope&&!['UNCONFIRMED','CHEMICAL','NON_CHEMICAL'].includes(scope))fail(400,'Invalid scope');
  const active=url.searchParams.get('active')||'';if(active&&!['0','1'].includes(active))fail(400,'Invalid active filter');
  const where:string[]=['1=1'],args:unknown[]=[];
  const selectable=url.searchParams.get('selectable')||'';if(selectable&&!['0','1'].includes(selectable))fail(400,'Invalid selectable filter');if(selectable==='1')where.push("is_active=1 AND chemical_scope<>'NON_CHEMICAL'");
  if(q){where.push("(instr(lower(item_no),lower(?))>0 OR instr(lower(description),lower(?))>0 OR instr(lower(system_code),lower(?))>0)");args.push(q,q,q);}
  if(scope){where.push('chemical_scope=?');args.push(scope);}if(active){where.push('is_active=?');args.push(Number(active));}
  const sql=where.join(' AND ');
  const rows=await env.DB.prepare(`SELECT id,item_no,description,issue_unit,system_code,source_dangerous,chemical_scope,maximum_stored_quantity,storage_unit,is_active,revision FROM item_master WHERE ${sql} ORDER BY item_no LIMIT 50 OFFSET ?`).bind(...args,(page-1)*50).all();
  const count=await env.DB.prepare(`SELECT COUNT(*) total FROM item_master WHERE ${sql}`).bind(...args).first();return {data:{success:true,items:rows.results,total:count?.total||0,page},status:200};
 }
 if(req.method==='GET'&&match&&!match[2])return {data:{success:true,item:await readMaster(env,match[1])},status:200};
 if(req.method==='GET'&&match&&match[2]==='history'){
  if(!has(u,'ADMIN'))fail(403,'Admin role required');await readMaster(env,match[1]);
  const a=await env.DB.prepare('SELECT * FROM item_master_audit WHERE item_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(match[1]).all();return {data:{success:true,history:a.results},status:200};
 }
 const create=req.method==='POST'&&path==='/items';const save=req.method==='POST'&&match?.[2]==='save';
 if(!create&&!save)fail(405,'Method not allowed');
 if(!has(u,'ADMIN'))fail(403,'Only Admin can manage Item Master');if(u.must_change_password)fail(403,'Change the initial password before managing Item Master');
 const b=await body(req),key=req.headers.get('Idempotency-Key')||'';if(!/^[0-9a-f-]{36}$/i.test(key))fail(400,'A UUID Idempotency-Key is required');
 const input=masterInput(b),reason=text(b,'reason',1000),payloadHash=await sha(JSON.stringify({path,body:b}));
 const replayMaster=async()=>{const op=await env.DB.prepare('SELECT actor_id,item_id,payload_hash FROM item_master_operations WHERE id=?').bind(key).first();if(!op)return null;if(op.actor_id!==u.id||op.payload_hash!==payloadHash)fail(409,'Idempotency key already used');return {data:{success:true,item:await readMaster(env,String(op.item_id)),replayed:true},status:create?201:200};};
 const prior=await replayMaster();if(prior)return prior;
 const id=create?uuid():match![1],old=create?null:await readMaster(env,id);
 if(old){if(typeof b.revision!=='number'||b.revision!==old.revision)fail(409,'Item changed; refresh before editing');if(input.sourceData.Item!==old.item_no)fail(400,'Item code cannot be changed after creation');}
 const d=input.sourceData,data=JSON.stringify(d),now=new Date().toISOString();
 const values=[d.Item,d.Description,d['Issue Unit'],d.System||'',d.Status||'',d.Dangerous||'',data,input.chemicalScope,input.maximumStoredQuantity,input.storageUnit,input.containerSize,input.storageNotes,input.isActive?1:0];
 const s=(sql:string,...v:unknown[])=>env.DB.prepare(sql).bind(...v);const batch:Statement[]=[];const guard=uuid();
 if(create)batch.push(s('INSERT INTO item_master(id,item_no,description,issue_unit,system_code,source_status,source_dangerous,source_data,chemical_scope,maximum_stored_quantity,storage_unit,container_size,storage_notes,is_active,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,...values,u.id,u.id,now,now));
 else batch.push(s('UPDATE item_master SET item_no=?,description=?,issue_unit=?,system_code=?,source_status=?,source_dangerous=?,source_data=?,chemical_scope=?,maximum_stored_quantity=?,storage_unit=?,container_size=?,storage_notes=?,is_active=?,updated_by=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?',...values,u.id,now,id,old!.revision));
 batch.push(s('INSERT INTO workflow_tx_guards(id,success) VALUES (?,changes())',guard));
 batch.push(s('INSERT INTO item_master_audit(id,item_id,actor_id,action,old_values,new_values,reason) VALUES (?,?,?,?,?,?,?)',uuid(),id,u.id,create?'CREATE':'UPDATE',old?JSON.stringify(old):null,JSON.stringify(input),reason));
 batch.push(s('INSERT INTO item_master_operations(id,actor_id,item_id,payload_hash) VALUES (?,?,?,?)',key,u.id,id,payloadHash));batch.push(s('DELETE FROM workflow_tx_guards WHERE id=?',guard));
 try{await env.DB.batch(batch);}catch{const done=await replayMaster();if(done)return done;fail(409,'Item could not be saved; duplicate code or concurrent edit. No partial changes committed');}
 return {data:{success:true,item:await readMaster(env,id)},status:create?201:200};
}

// Excel is parsed locally; this server validates every row again. Five-row atomic chunks.
type ImportPlanRow={rowNumber:number;id:string|null;revision:number|null;action:string;sourceData:Record<string,string|number|null>;changes:{column:string;before:unknown;after:unknown}[]};
async function prepareImport(env:Env,b:Record<string,unknown>){
 if(!Array.isArray(b.rows)||b.rows.length<1||b.rows.length>5)fail(400,'Import chunk must contain 1–5 rows');
 const codes=new Set<string>(),numbers=new Set<number>();const plans:ImportPlanRow[]=[];
 for(const entry of b.rows as unknown[]){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))fail(400,'Invalid import row');
  const e=entry as Record<string,unknown>;const rowNumber=e.rowNumber;
  if(typeof rowNumber!=='number'||!Number.isInteger(rowNumber)||rowNumber<2||rowNumber>10001||numbers.has(rowNumber))fail(400,'Invalid or repeated Excel row number');numbers.add(rowNumber as number);
  if(!e.sourceData||typeof e.sourceData!=='object'||Array.isArray(e.sourceData))fail(400,'Invalid source row');
  const raw=e.sourceData as Record<string,unknown>;
  if(Object.keys(raw).length!==25||masterColumns.some(k=>!Object.prototype.hasOwnProperty.call(raw,k)))fail(400,'All 25 source columns are required');
  // Validate supplied types before merging. Null means preserve existing, not clear it.
  const supplied:Record<string,string|number|null>={};
  for(const k of masterColumns){const v=raw[k];if(v===null||v===''){supplied[k]=null;continue;}if(masterQuantities.includes(k)){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e12)fail(400,`Row ${rowNumber}: invalid ${k}`);supplied[k]=v as number;}else{if(typeof v!=='string'||v.length>2000)fail(400,`Row ${rowNumber}: invalid ${k}`);supplied[k]=(v as string).trim()||null;}}
  const code=supplied.Item;if(typeof code!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(code))fail(400,`Row ${rowNumber}: invalid Item`);
  const codeKey=(code as string).toLowerCase();if(codes.has(codeKey))fail(400,'Duplicate Item in chunk');codes.add(codeKey);
  const old=await env.DB.prepare('SELECT * FROM item_master WHERE item_no=? COLLATE NOCASE').bind(code).first<MasterRow>();
  const oldSource=old?JSON.parse(old.source_data) as Record<string,string|number|null>:null;
  const merged:Record<string,string|number|null>={};for(const k of masterColumns)merged[k]=supplied[k]===null&&oldSource?oldSource[k]??null:supplied[k];
  if(old)merged.Item=old.item_no; // Existing code is immutable, including capitalization.
  const validated=masterInput({sourceData:merged,chemicalScope:'UNCONFIRMED',maximumStoredQuantity:null,storageUnit:'',containerSize:'',storageNotes:'',isActive:true}).sourceData;
  const changes=masterColumns.filter(k=>!oldSource||validated[k]!==oldSource[k]).map(k=>({column:k,before:oldSource?.[k]??null,after:validated[k]}));
  plans.push({rowNumber:rowNumber as number,id:old?.id||null,revision:old?.revision??null,action:old?(changes.length?'UPDATE':'UNCHANGED'):'CREATE',sourceData:validated,changes});
 }
 return plans;
}
async function importRoute(req:Request,env:Env,u:User,path:string):Promise<{data:unknown;status:number}|null>{
 if(!['/item-import/preview','/item-import/commit'].includes(path))return null;
 if(req.method!=='POST')fail(405,'POST required');if(!has(u,'ADMIN'))fail(403,'Only Admin can upload Excel');if(u.must_change_password)fail(403,'Change the initial password before importing');
 const b=await body(req,65536);
 if(path==='/item-import/preview'){const rows=await prepareImport(env,b);return {data:{success:true,rows,planHash:await sha(JSON.stringify(rows))},status:200};}
 const key=req.headers.get('Idempotency-Key')||'';if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))fail(400,'UUID Idempotency-Key required');
 const reason=text(b,'reason',1000),planHash=text(b,'planHash',64);if(!/^[a-f0-9]{64}$/.test(planHash))fail(400,'Invalid preview hash');
 const hash=await sha(JSON.stringify({path,body:b}));
 const replayImport=async()=>{const op=await env.DB.prepare('SELECT actor_id,payload_hash FROM item_master_operations WHERE id=?').bind(key).first();if(!op)return false;if(op.actor_id!==u.id||op.payload_hash!==hash)fail(409,'Idempotency key already used');return true;};
 if(await replayImport())return {data:{success:true,replayed:true},status:200};
 const rows=await prepareImport(env,b);if(await sha(JSON.stringify(rows))!==planHash)fail(409,'Master changed after preview. Preview again; this chunk was not saved');
 const statements:Statement[]=[];const st=(sql:string,...v:unknown[])=>env.DB.prepare(sql).bind(...v);let anchor='';const now=new Date().toISOString();
 for(const row of rows){const id=row.id||uuid();if(!anchor)anchor=id;const d=row.sourceData;
  if(row.action==='UNCHANGED'){
   // Still guard unchanged rows against a race after preview.
   const guard=uuid();statements.push(st('INSERT INTO workflow_tx_guards(id,success) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM item_master WHERE id=? AND revision=?) THEN 1 ELSE 0 END',guard,id,row.revision));statements.push(st('DELETE FROM workflow_tx_guards WHERE id=?',guard));continue;
  }
  const old=row.id?await readMaster(env,id):null;
  const values=[d.Description,d['Issue Unit'],d.System||'',d.Status||'',d.Dangerous||'',JSON.stringify(d)];
  if(!old)statements.push(st('INSERT INTO item_master(id,item_no,description,issue_unit,system_code,source_status,source_dangerous,source_data,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',id,d.Item,...values,u.id,u.id,now,now));
  else statements.push(st('UPDATE item_master SET description=?,issue_unit=?,system_code=?,source_status=?,source_dangerous=?,source_data=?,updated_by=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?',...values,u.id,now,id,row.revision));
  const guard=uuid();statements.push(st('INSERT INTO workflow_tx_guards(id,success) VALUES (?,changes())',guard));
  // CREATE/UPDATE are supported by the existing immutable audit schema; provenance is in reason.
  statements.push(st('INSERT INTO item_master_audit(id,item_id,actor_id,action,old_values,new_values,reason) VALUES (?,?,?,?,?,?,?)',uuid(),id,u.id,old?'UPDATE':'CREATE',old?JSON.stringify(old):null,JSON.stringify({sourceData:d,importRow:row.rowNumber,method:'EXCEL_UPLOAD'}),`Excel row ${row.rowNumber}: ${reason}`));
  statements.push(st('DELETE FROM workflow_tx_guards WHERE id=?',guard));
 }
 statements.push(st('INSERT INTO item_master_operations(id,actor_id,item_id,payload_hash) VALUES (?,?,?,?)',key,u.id,anchor,hash));
 try{await env.DB.batch(statements);}catch{if(await replayImport())return {data:{success:true,replayed:true},status:200};fail(409,'Import chunk failed; no rows in this chunk were committed. Preview again');}
 return {data:{success:true,created:rows.filter(r=>r.action==='CREATE').length,updated:rows.filter(r=>r.action==='UPDATE').length,unchanged:rows.filter(r=>r.action==='UNCHANGED').length},status:200};
}

export default {async fetch(req:Request,env:Env):Promise<Response>{
 const origin=req.headers.get('Origin');const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
 if(origin&&allowed.includes(origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';headers['Access-Control-Allow-Headers']='Authorization, Content-Type, Idempotency-Key';}
 const send=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!allowed.includes(origin))return send({success:false,message:'Origin is not allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 try{
  const u=await authenticate(req,env);const url=new URL(req.url),path=url.pathname.replace(/\/$/,'')||'/';
  const imported=await importRoute(req,env,u,path);if(imported)return send(imported.data,imported.status);
  const master=await masterRoute(req,env,u,url,path);if(master)return send(master.data,master.status);
  if(req.method==='GET'&&path==='/profile')return send({success:true,user:{id:u.id,username:u.username,displayName:u.display_name,sectionId:u.section_id,roles:u.roles,mustChangePassword:!!u.must_change_password}});
  if(req.method==='GET'&&path==='/sections'){const rows=await env.DB.prepare('SELECT id,section_code,section_name FROM sections WHERE is_active=1 ORDER BY section_code').all();return send({success:true,sections:rows.results});}
  if(req.method==='GET'&&path==='/requests'){
   const page=Math.max(1,Math.min(100000,Number(url.searchParams.get('page'))||1));if(!Number.isInteger(page))fail(400,'Invalid page');
   const where=privileged(u)?'1=1':has(u,'REQUESTOR')?"(cr.requestor_id=? OR (cr.declared_type='EXISTING' AND cr.section_id=?))":'cr.requestor_id=?',args=privileged(u)?[]:has(u,'REQUESTOR')?[u.id,u.section_id]:[u.id];
   const rows=await env.DB.prepare(`SELECT cr.*,s.section_code,u.display_name requestor_name FROM chemical_requests cr JOIN sections s ON s.id=cr.section_id JOIN users u ON u.id=cr.requestor_id WHERE ${where} ORDER BY cr.submitted_at DESC,cr.id DESC LIMIT 50 OFFSET ?`).bind(...args,(page-1)*50).all();
   const total=await env.DB.prepare(`SELECT COUNT(*) total FROM chemical_requests cr WHERE ${where}`).bind(...args).first();return send({success:true,requests:rows.results,total,page});
  }
  const match=path.match(/^\/requests\/([A-Za-z0-9_-]{1,100})(?:\/(store-review|safety-review|customer-approval|resubmit|cancel))?$/);
  if(req.method==='GET'&&match&&!match[2]){
   const r=await getRequest(env,match[1],u);const queries=['SELECT * FROM store_reviews WHERE request_id=? ORDER BY reviewed_at DESC,id DESC','SELECT * FROM safety_reviews WHERE request_id=? ORDER BY reviewed_at DESC,id DESC','SELECT * FROM customer_approvals WHERE request_id=? ORDER BY created_at DESC,id DESC','SELECT id,file_name,document_type,uploaded_at FROM request_documents WHERE request_id=? AND is_active=1 ORDER BY uploaded_at DESC','SELECT id,actor_id,action,old_values,new_values,reason,created_at FROM audit_logs WHERE request_id=? ORDER BY created_at DESC,id DESC LIMIT 100'];
   const [store,safety,customer,documents,audit]=await Promise.all(queries.map(sql=>env.DB.prepare(sql).bind(r.id).all()));return send({success:true,request:r,storeReviews:store.results,safetyReviews:safety.results,customerApprovals:customer.results,documents:documents.results,audit:audit.results});
  }
  if(req.method==='POST'&&path==='/requests')return send(await mutate(req,env,u,path),201);
  if(req.method==='POST'&&match&&match[2])return send(await mutate(req,env,u,path,match[1],match[2]));
  return send({success:false,message:'Endpoint not found'},404);
 }catch(e){if(e instanceof ApiError)return send({success:false,message:e.message},e.status);console.error('workflow request failed');return send({success:false,message:'Server error; check configuration and migrations'},500);}
}};
