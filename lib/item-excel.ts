export const ITEM_COLUMNS=['Item','Description','Old Item Number','Type','Industry','System','Concession','Site','Issue Unit','Item Owner','Status','Lot Type','Rotating','Condition Enabled','Dangerous','Inspect on Receipt','Need QI for PM','Safety Check','Calibration','Contractual_QTY','Supplementary_QTY','Item Regis No.','Brand','Model','Specification'];
export type ExcelRow={rowNumber:number;sourceData:Record<string,string|number|null>};
export function normalizeItemRows(matrix:unknown[][]):ExcelRow[]{
 if(matrix.length<2||matrix.length>1001)throw new Error('Excel ต้องมีข้อมูล 1–1000 แถว');
 const headers=matrix[0].map(v=>String(v??'').trim());
 if(headers.length!==25||new Set(headers).size!==25||ITEM_COLUMNS.some(k=>!headers.includes(k)))throw new Error('หัวตารางแถว 1 ต้องมี 25 คอลัมน์ตาม Item Master.xlsx ครบ ไม่ซ้ำ');
 const codes=new Set<string>();const rows:ExcelRow[]=[];
 for(let i=1;i<matrix.length;i++){
  const input=matrix[i];if(input.every(v=>v==null||String(v).trim()===''))continue;
  if(input.slice(25).some(v=>v!=null&&String(v).trim()!==''))throw new Error(`แถว ${i+1}: มีข้อมูลเกิน 25 คอลัมน์`);
  const sourceData:Record<string,string|number|null>={};
  for(const k of ITEM_COLUMNS){const value=input[headers.indexOf(k)];if(value==null||value===''){sourceData[k]=null;continue;}
   if(typeof value==='object')throw new Error(`แถว ${i+1} ${k}: ไม่รองรับสูตร วันที่ error หรือ object กรุณา Paste Values ก่อน`);
   if(['Contractual_QTY','Supplementary_QTY'].includes(k)){
    if(typeof value!=='number'&&typeof value!=='string')throw new Error(`แถว ${i+1}: ${k} ต้องเป็นตัวเลข`);
    const str=String(value).trim();if(!str){sourceData[k]=null;continue;}
    if(!/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(str)&&!/^\.\d+$/.test(str))throw new Error(`แถว ${i+1}: ${k} ต้องเป็นเลขไม่ติดลบ ไม่ใส่ comma หรือหน่วย`);
    const n=Number(str);if(!Number.isFinite(n)||n<0||n>1e12)throw new Error(`แถว ${i+1}: ${k} ไม่ถูกต้อง`);sourceData[k]=n;
   }else{const str=String(value).trim();if(str.length>2000)throw new Error(`แถว ${i+1}: ${k} เกิน 2000 ตัวอักษร`);sourceData[k]=str||null;}
  }
  const code=sourceData.Item;if(typeof code!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(code))throw new Error(`แถว ${i+1}: Item ไม่ถูกต้อง`);
  if(codes.has(code.toLowerCase()))throw new Error(`แถว ${i+1}: Item ${code} ซ้ำใน Excel`);codes.add(code.toLowerCase());
  rows.push({rowNumber:i+1,sourceData});
 }
 if(!rows.length)throw new Error('ไม่มีข้อมูลนำเข้า');return rows;
}
export async function readItemExcel(file:File):Promise<ExcelRow[]>{
 if(!/\.xlsx$/i.test(file.name))throw new Error('รองรับ .xlsx เท่านั้น ไม่รองรับ .xls หรือ .xlsm');
 if(file.size>2*1024*1024)throw new Error('ไฟล์ต้องไม่เกิน 2 MB');
 const {default:ExcelJS}=await import('exceljs');const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(await file.arrayBuffer());
 const sheet=workbook.getWorksheet('List of Items');if(!sheet)throw new Error('ไม่พบชีต List of Items');
 if(sheet.rowCount>1001||sheet.columnCount>25)throw new Error('ชีตต้องไม่เกิน 1000 แถวข้อมูลและ 25 คอลัมน์ กรุณาลบแถว/คอลัมน์ส่วนเกิน');
 const matrix:unknown[][]=[];
 for(let r=1;r<=sheet.rowCount;r++){const values:unknown[]=[];for(let c=1;c<=25;c++)values.push(sheet.getCell(r,c).value);matrix.push(values);}
 return normalizeItemRows(matrix);
}
