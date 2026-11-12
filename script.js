/* =====================================================================
   EXPORTADOR PLAME WEB · script.js
   1. Configuración de la conexión (lo completa el cuaderno de Colab)
   2. Utilidades generales
   3. Capa de datos (Supabase)
   4. Guardado automático de correcciones y configuración
   5. Motor del exportador PLAME (lógica original del artefacto)
   6. Panel principal · 7. Empresas · 8. Historial · 9. Configuración
   10. Sesión, navegación e inicio
   ===================================================================== */
(function(){
"use strict";

/* ---------- 1. Configuración de la conexión ----------
   La URL del proyecto y la clave PÚBLICA de Supabase ("publishable key",
   sb_publishable_..., o la antigua "anon key") pueden estar en el código:
   están hechas para usarse en el navegador. La seguridad la dan el inicio
   de sesión y las reglas RLS de la base de datos (supabase_setup.sql).
   NUNCA pongas aquí la clave secreta (sb_secret_... o "service_role"). */
const SUPABASE_URL="https://pkqnondrjqvesgnghvbh.supabase.co";
const SUPABASE_ANON_KEY="sb_publishable_ourAFgoDG3Z8U96ms-fTGg_AL0Zx4U2";
const APP_VERSION="1.0.0";

/* ---------- 2. Utilidades generales ---------- */
const MESES_UI=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Setiembre","Octubre","Noviembre","Diciembre"];
const q=s=>document.querySelector(s);
const qa=s=>[...document.querySelectorAll(s)];
const escH=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=v=>(Math.round((+v||0)*100)/100).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2});
const p2=n=>String(n).padStart(2,"0");
const perLabel=p=>p&&p.length===6?`${MESES_UI[+p.slice(4)-1]} ${p.slice(0,4)}`:"—";
const perCorto=p=>p&&p.length===6?`${p.slice(4)}/${p.slice(0,4)}`:"—";
const fechaHora=iso=>{if(!iso)return "—";const d=new Date(iso);return isNaN(d)?"—":d.toLocaleString("es-PE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"})};
function rucValido(r){if(!/^\d{11}$/.test(r))return false;const f=[5,4,3,2,7,6,5,4,3,2];let s=0;for(let i=0;i<10;i++)s+=(+r[i])*f[i];let d=11-(s%11);if(d===10)d=0;if(d===11)d=1;return d===+r[10]}
function aviso(msg){const t=q("#toast");t.textContent=msg;t.hidden=false;clearTimeout(aviso._t);aviso._t=setTimeout(()=>t.hidden=true,3200)}
function prefs(){try{return JSON.parse(localStorage.getItem("plame-web-prefs")||"{}")}catch(e){return {}}}
function setPref(k,v){const p=prefs();p[k]=v;try{localStorage.setItem("plame-web-prefs",JSON.stringify(p))}catch(e){}}
function descargar(blob,nombre){const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=nombre;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)}
function confirmar(titulo,texto,boton){
  const d=q("#dlgConfirm");q("#dlgConfTitulo").textContent=titulo;q("#dlgConfTexto").textContent=texto;q("#dlgConfSi").textContent=boton||"Eliminar";
  return new Promise(res=>{d.returnValue="";d.addEventListener("close",()=>res(d.returnValue==="si"),{once:true});d.showModal()});
}
function marcarError(form,campo,msg){
  const el=form.querySelector(`[data-err="${campo}"]`);if(!el)return;
  const inp=el.parentElement.querySelector("input,select");
  if(msg){el.textContent=msg;el.hidden=false;if(inp)inp.setAttribute("aria-invalid","true")}
  else{el.hidden=true;el.textContent="";if(inp)inp.removeAttribute("aria-invalid")}
}
function limpiarErrores(form){form.querySelectorAll("[data-err]").forEach(el=>marcarError(form,el.dataset.err,""))}
function mensajeError(err){
  const m=String((err&&(err.message||err.error_description))||err||"");
  if(/Failed to fetch|NetworkError|network/i.test(m))return "No hay conexión con la base de datos. Revisa tu internet e inténtalo de nuevo.";
  if(/JWT|token|session/i.test(m))return "Tu sesión venció. Vuelve a iniciar sesión.";
  if(/relation .* does not exist|schema cache|Could not find the table/i.test(m))return "Las tablas no existen todavía: ejecuta supabase_setup.sql en Supabase.";
  if(/permission denied|row-level security/i.test(m))return "Tu usuario no tiene permiso para esta acción.";
  if(/duplicate key/i.test(m))return "Ya existe un registro con esos datos.";
  return m||"Ocurrió un error inesperado.";
}

/* ---------- 3. Capa de datos (Supabase) ---------- */
const configurado=/^https:\/\//.test(SUPABASE_URL)&&!SUPABASE_URL.includes("__")&&SUPABASE_ANON_KEY.length>20&&!SUPABASE_ANON_KEY.includes("__");
let sb=null;
async function traerTodo(tabla,cols,orden){
  const out=[];const paso=1000;
  for(let desde=0;;desde+=paso){
    let qy=sb.from(tabla).select(cols).range(desde,desde+paso-1);if(orden)qy=qy.order(orden);
    const {data,error}=await qy;if(error)throw error;out.push(...data);if(data.length<paso)break;
  }
  return out;
}
const empDeFila=r=>{const lv=r.jornada_lv==null?null:+r.jornada_lv,sab=r.jornada_sab==null?null:+r.jornada_sab;
  return {ruc:r.ruc,nombre:r.nombre,alias:r.alias||"",lv,sab,porDefinir:lv==null,base31:!!r.base31,reglaBrutoVac:!!r.regla_bruto_vac,activa:r.activa!==false,actualizado:r.actualizado_en}};
const filaDeEmp=e=>({ruc:e.ruc,nombre:e.nombre,alias:e.alias||"",jornada_lv:e.lv,jornada_sab:e.sab,base31:!!e.base31,regla_bruto_vac:!!e.reglaBrutoVac,activa:e.activa!==false});

/* Datos en memoria compartidos por todas las secciones */
const DB={empresas:[],exportaciones:[],user:null};
let ENGINE=null;

/* ---------- 4. Guardado automático ----------
   El motor llama a save() cada vez que cambia algo. Aquí se compara con la
   última versión guardada y solo se envían a Supabase las diferencias. */
const snap={cfg:{},per:{}};
let engineS=null,saveTimer=null,flushing=false,again=false,pendienteAlta=Promise.resolve(),hayError=false;
const VACIO=JSON.stringify({o:null,r:null});
function estadoGuardado(s,txt){const el=q("#saveState");el.dataset.s=s;el.textContent=txt}
function programarGuardado(S){engineS=S;estadoGuardado("saving","Guardando…");clearTimeout(saveTimer);saveTimer=setTimeout(guardarAhora,700)}
function hayCambios(){
  if(!engineS)return false;
  for(const r in engineS.settingsBy)if(JSON.stringify(engineS.settingsBy[r])!==snap.cfg[r])return true;
  const ks=new Set([...Object.keys(engineS.over),...Object.keys(engineS.rh),...Object.keys(snap.per)]);
  for(const k of ks)if(JSON.stringify({o:engineS.over[k]??null,r:engineS.rh[k]??null})!==(snap.per[k]??VACIO))return true;
  return false;
}
async function guardarAhora(){
  clearTimeout(saveTimer);
  if(!engineS||!sb)return;
  if(flushing){again=true;return}
  flushing=true;hayError=false;
  try{
    await pendienteAlta;
    const existe=r=>DB.empresas.some(e=>e.ruc===r);
    for(const ruc of Object.keys(engineS.settingsBy)){
      if(!existe(ruc))continue;
      const j=JSON.stringify(engineS.settingsBy[ruc]);if(j===snap.cfg[ruc])continue;
      const {error}=await sb.from("configuracion_empresa").upsert({ruc,ajustes:JSON.parse(j)},{onConflict:"ruc"});
      if(error)throw error;snap.cfg[ruc]=j;
    }
    const ks=new Set([...Object.keys(engineS.over),...Object.keys(engineS.rh),...Object.keys(snap.per)]);
    for(const k of ks){
      const i=k.lastIndexOf("-");const ruc=k.slice(0,i),periodo=k.slice(i+1);
      if(!existe(ruc)||!/^\d{6}$/.test(periodo))continue;
      const v={o:engineS.over[k]??null,r:engineS.rh[k]??null};const j=JSON.stringify(v);
      if(j===(snap.per[k]??VACIO))continue;
      const vacio=v.r==null&&(v.o==null||!Object.keys(v.o).length);
      const {error}=vacio
        ?await sb.from("ajustes_periodo").delete().eq("ruc",ruc).eq("periodo",periodo)
        :await sb.from("ajustes_periodo").upsert({ruc,periodo,correcciones:v.o,recibos:v.r},{onConflict:"ruc,periodo"});
      if(error)throw error;
      if(vacio)delete snap.per[k];else snap.per[k]=j;
    }
  }catch(err){
    hayError=true;estadoGuardado("error","Sin guardar · reintentando");aviso("No se pudieron guardar los cambios: "+mensajeError(err));
    clearTimeout(saveTimer);saveTimer=setTimeout(guardarAhora,8000);
  }finally{
    flushing=false;
    if(again){again=false;guardarAhora()}
    else if(!hayError)estadoGuardado("ok","Todo guardado");
  }
}
function olvidarSnapshot(ruc){delete snap.cfg[ruc];for(const k of Object.keys(snap.per))if(k.startsWith(ruc+"-"))delete snap.per[k]}
window.addEventListener("beforeunload",e=>{if(hayCambios()){guardarAhora();e.preventDefault();e.returnValue=""}});

/* Alta automática de una empresa nueva detectada en el Excel por su RUC */
function altaDesdeExcel(ruc){
  const e={ruc,nombre:`RUC ${ruc}`,alias:"",lv:null,sab:null,porDefinir:true,base31:false,reglaBrutoVac:false,activa:true,nueva:true};
  DB.empresas.push(e);
  pendienteAlta=(async()=>{
    const {error}=await sb.from("empresas").insert(filaDeEmp(e));
    if(error)aviso("No se pudo registrar la empresa nueva: "+mensajeError(error));
    else{aviso(`Se registró la empresa RUC ${ruc}. Completa su razón social y jornada en «Empresas».`);renderEmpresas();renderPanel()}
  })();
  return e;
}

/* Registro del ZIP descargado en el historial */
async function registrarExportacion(r){
  const fila={ruc:r.ruc,empresa:r.empresa,periodo:r.periodo,trabajadores:r.trabajadores,ingresos:r.ingresos,renta_quinta:r.quinta,recibos:r.recibos,observaciones:r.observaciones,archivo:r.archivo};
  const {data,error}=await sb.from("exportaciones").upsert(fila,{onConflict:"ruc,periodo"}).select().single();
  if(error){aviso("ZIP descargado, pero no se pudo registrar en el historial: "+mensajeError(error));return}
  const i=DB.exportaciones.findIndex(x=>x.id===data.id);if(i>=0)DB.exportaciones[i]=data;else DB.exportaciones.push(data);
  aviso("ZIP descargado y registrado en el historial");renderPanel();renderHistorial();
}

/* ---------- 5. Motor del exportador PLAME ----------
   Lógica del artefacto original. Los cálculos no se modificaron; solo se
   reemplazó dónde se guardan los datos (antes en el navegador, ahora en
   Supabase) y la descarga del ZIP. */
function startEngine(INIT){
/* Lista de clientes con su jornada semanal (archivo HORAS LABORALES). lv = lunes a viernes, sab = sábado; null = por definir. */
/* Las empresas vienen de la tabla «empresas» de Supabase (sección Empresas). */
const EMPRESAS=INIT.empresas;
/* base31: la planilla usa 31 días laborados todos los meses para el cálculo de sueldos; las horas y los días no laborados se calculan con el calendario real. */
/* Jornada por empresa. Si está por definir se usa 8.5 / 5.5 hasta que se indique. */
const jornadaDe=e=>{const lv=e.lv??8.5,sab=e.sab??5.5;const dias=(lv>0?5:0)+(sab>0?1:0);return {lv,sab,dom:0,prom:dias?Math.round((lv*5+sab)/dias*100)/100:8}};
const EMPRESA_CONFIG=new Proxy({},{get:(_,ruc)=>{const e=EMPRESAS.find(x=>x.ruc===ruc);return e?{jornada:jornadaDe(e)}:undefined}});
/* Reglas de columnas por empresa: la columna "h" se declara con "code" y reemplaza a la columna "replaces" cuando ambas existen. */
const REGLA_BRUTO_VAC=[
 {h:"SUELDO BRUTO",code:"0121",label:"Sueldo bruto como remuneración básica (regla de la empresa)",replaces:"SUELDO COMPUTABLE"},
 {h:"VACACIONES PAGADAS",code:"0118",label:"Vacaciones pagadas como remuneración vacacional (regla de la empresa)",replaces:"DESCANSO / REMUNERACION VACACIONAL"}
];
/* Se activa por empresa con la casilla «Regla sueldo bruto y vacaciones pagadas». */
const colMap=()=>{const e=empresa();return e&&e.reglaBrutoVac?REGLA_BRUTO_VAC:[]};
const ALL_COLMAP_H=REGLA_BRUTO_VAC.map(x=>x.h);
const BTK="20608947559";
const MESES=["ENERO","FEBRERO","MARZO","ABRIL","MAYO","JUNIO","JULIO","AGOSTO","SETIEMBRE","OCTUBRE","NOVIEMBRE","DICIEMBRE"];

/* ---------- default settings ---------- */
const DEFAULT_CONCEPTS=[
 {h:"SUELDO COMPUTABLE",code:"0121",label:"Remuneración o jornal básico"},
 {h:"DESCANSO / REMUNERACION VACACIONAL",code:"0118",label:"Remuneración vacacional"},
 {h:"VENTA DE VACACIONES",code:"0117",label:"Compensación vacacional (verificar)"},
 {h:"LIQUIDACION VACACIONES TRUNCAS",code:"0114",label:"Vacaciones truncas"},
 {h:"ASIGNACION FAMILIAR",code:"0201",label:"Asignación familiar"},
 {h:"BONOS O COMISIONES",code:"",label:"Definir según el tipo de bono"},
 {h:"HORAS EXTRAS AL 25%",code:"0105",label:"Sobretiempo 25%"},
 {h:"HORAS EXTRAS AL 35%",code:"0106",label:"Sobretiempo 35%"},
 {h:"DESCUENTOS POR FALTAS U OTROS",code:"",label:"Definir (0704 tardanzas / 0705 inasistencias)"},
 {h:"RENTA 5TA CATEGORIA",code:"0605",label:"Renta de quinta categoría – retenciones"},
 {h:"PRESTAMOS / ADELANTOS",code:"0701",label:"Adelanto"},
 {h:"OTROS DESCUENTOS (CDG706)",code:"0706",label:"Otros descuentos no deducibles de la base"},
 {h:"RETENCIONES JUDICIALES",code:"0703",label:"Descuento por mandato judicial"},
 {h:"CTS",code:"0904",label:"Compensación por tiempo de servicios"},
 {h:"GRATIFICACION",code:"0406",label:"Gratificación FFPP y Navidad – Ley 29351"},
 {h:"BONIFICACION (9% O 6.75%)",code:"0312",label:"Bonificación extraordinaria – Ley 29351"},
 {h:"OTROS INGRESOS EXTRAORDINARIOS",code:"",label:"Definir según el caso"},
 {h:"REINTEGROS",code:"",label:"Definir según el concepto reintegrado"},
 {h:"MOVILIDADES",code:"0909",label:"Movilidad supeditada a asistencia"},
 {h:"SUBSIDIOS ESSALUD",code:"0916",label:"Subsidio por incapacidad (0915 si es maternidad)"},
 {h:"COMISION AFP (VARIABLE)",code:"0601",label:"SPP – comisión porcentual"},
 {h:"PRIMA DE SEGUROS (1.37%)",code:"0606",label:"SPP – prima de seguro"},
 {h:"APORTE OBLIGATORIO (10%)",code:"0608",label:"SPP – aportación obligatoria"},
 {h:"ONP",code:"0607",label:"Sistema Nacional de Pensiones D.L. 19990"},
 {h:"EPS",code:"",label:"Definir si hay descuento EPS al trabajador"},
 {h:"SIS",code:"0811",label:"Seguro Integral de Salud – SIS (empleador)"},
 {h:"ESSALUD",code:"0804",label:"EsSalud seguro regular – trabajador (empleador)"},
 {h:"EPS 2.25%",code:"",label:"Definir (crédito EPS)"},
 {h:"VIDA LEY",code:"0803",label:"Póliza de seguro D. Leg. 688"}
];
const DEFAULT_SETTINGS={
  concepts:Object.fromEntries(DEFAULT_CONCEPTS.map(c=>[c.h,c.code])),
  snl:{vac:"23",faltas:"07",lic:"20",otros:"05"},
  jornada:{lv:8.5,sab:5.5,dom:0,prom:8},
  feriados:{"1":"1","4":"","5":"1","6":"7,29","7":"23,28,29","8":"6,30","10":"8","11":"1","12":"8,9,25"},
  pens4ta:"blank"
};
/* Lo guardado viene de Supabase (configuracion_empresa y ajustes_periodo); save() programa el guardado automático. */
function loadSaved(){return INIT.saved}
function save(){INIT.onSave(S)}
const saved=loadSaved();
const activas=()=>EMPRESAS.filter(e=>e.activa!==false);
function pickRuc(r){const a=activas();return a.some(e=>e.ruc===r)?r:(a.some(e=>e.ruc===BTK)?BTK:(a[0]?a[0].ruc:null))}
function migrate(obj){const o={};for(const k in (obj||{}))o[/-/.test(k)?k:`${BTK}-${k}`]=obj[k];return o}
const S={
  wb:null, sheets:[], month:null, year:new Date().getFullYear(), tab:"trab", open:{},
  ruc:pickRuc(saved.ruc),
  settingsBy:saved.settingsBy||(saved.settings?{[BTK]:saved.settings}:{}),
  over:migrate(saved.over), rh:migrate(saved.rh), settings:null
};
function useCompany(ruc){
  S.ruc=ruc;
  if(!S.settingsBy[ruc])S.settingsBy[ruc]=Object.assign(structuredClone(DEFAULT_SETTINGS),structuredClone(EMPRESA_CONFIG[ruc]||{}));
  S.settings=S.settingsBy[ruc];
  S.settings=Object.assign(structuredClone(DEFAULT_SETTINGS),S.settings);S.settingsBy[ruc]=S.settings;
  for(const c of DEFAULT_CONCEPTS) if(!(c.h in S.settings.concepts)) S.settings.concepts[c.h]=c.code;
  if(!S.settings.jornadaManual&&EMPRESA_CONFIG[ruc])S.settings.jornada=structuredClone(EMPRESA_CONFIG[ruc].jornada);
}
if(S.ruc)useCompany(S.ruc);
const empresa=()=>EMPRESAS.find(e=>e.ruc===S.ruc);

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/\s+/g," ").trim();
const num=v=>{if(typeof v==="number")return isFinite(v)?v:0;const n=parseFloat(String(v??"").replace(/,/g,""));return isFinite(n)?n:0};
const r2=v=>Math.round((v+Number.EPSILON)*100)/100;
const f2=v=>r2(v).toFixed(2);
const fmt=v=>r2(v).toLocaleString("es-PE",{minimumFractionDigits:2,maximumFractionDigits:2});
const pad2=n=>String(n).padStart(2,"0");
const periodKey=()=>`${S.year}${pad2(S.month)}`;
const baseName=()=>`0601${periodKey()}${S.ruc}`;
const sk=()=>`${S.ruc}-${periodKey()}`;
function toast(msg){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2600)}

function parseDate(v){
  if(v instanceof Date&&!isNaN(v)){const d=new Date(v.getTime()+12*3600e3);return {y:d.getFullYear(),m:d.getMonth()+1,d:d.getDate()}}
  if(typeof v==="number"&&v>20000&&v<80000){const d=XLSX.SSF.parse_date_code(v);return {y:d.y,m:d.m,d:d.d}}
  const s=String(v??"").trim();let m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if(m)return {y:+m[3],m:+m[2],d:+m[1]};
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return {y:+m[1],m:+m[2],d:+m[3]};
  return null;
}
const dstr=d=>d?`${pad2(d.d)}/${pad2(d.m)}/${d.y}`:"—";
const cmp=(a,b)=>(a.y-b.y)||(a.m-b.m)||(a.d-b.d);
const daysIn=(y,m)=>new Date(y,m,0).getDate();

function docInfo(raw){
  const s=String(raw??"").trim().replace(/\.0+$/,"");
  const digits=s.replace(/\D/g,"");
  if(!s)return null;
  if(typeof raw==="number")return digits.length<=8?{tipo:"01",num:digits.padStart(8,"0")}:{tipo:"04",num:digits};
  if(/^\d{8}$/.test(s))return {tipo:"01",num:s};
  if(/^\d{1,7}$/.test(s))return {tipo:"01",num:s.padStart(8,"0")};
  return {tipo:"04",num:s.toUpperCase()};
}
function rucFromDni(dni){
  const base="10"+String(dni).padStart(8,"0");const f=[5,4,3,2,7,6,5,4,3,2];
  let s=0;for(let i=0;i<10;i++)s+=(+base[i])*f[i];let r=11-(s%11);if(r===10)r=0;if(r===11)r=1;return base+r;
}
function rucOk(r){if(!/^\d{11}$/.test(r))return false;const f=[5,4,3,2,7,6,5,4,3,2];let s=0;for(let i=0;i<10;i++)s+=(+r[i])*f[i];let d=11-(s%11);if(d===10)d=0;if(d===11)d=1;return d===+r[10]}
function plain(s){return String(s??"").toUpperCase().replace(/Ñ/g,"\u0001").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\u0001/g,"Ñ").replace(/\|/g," ").replace(/\s+/g," ").trim()}
function cp1252(text){const out=new Uint8Array(text.length);for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);out[i]=c<256?c:63}return out}

/* ---------- workbook parsing ---------- */
const FIELDS={
  cod:["CODIGO","COD. TRABAJADOR","ITEM"],
  nombre:["NOMBRES Y APELLIDOS","APELLIDOS Y NOMBRES","APELLIDOS, NOMBRES","TRABAJADOR","COLABORADOR","NOMBRES","NOMBRE"],
  tipoDoc:["TIPO DE DOCUMENTO","TIPO DOC","TIPO DOC."],
  dni:["DNI","DNI / CE","DNI/CE","N° DOCUMENTO","NRO. DOCUMENTO","NRO DOCUMENTO","NUMERO DE DOCUMENTO","N° DE DOCUMENTO","DOC. IDENTIDAD","DOCUMENTO DE IDENTIDAD","DOCUMENTO"],
  alta:["FECHA DE ALTA SUNAT","FECHA DE ALTA","FECHA DE INGRESO","F. DE INGRESO","FECHA INGRESO"],
  baja:["FECHA DE BAJA SUNAT","FECHA DE BAJA","FECHA DE CESE","F. DE SALIDA","FECHA DE SALIDA","FECHA CESE"],
  modalidad:["MODALIDAD DE PAGO","MODALIDAD","TIPO DE PAGO"],susp:["SUSPENSION DE 4TA"],
  pension:["AFP / ONP","AFP/ONP","SISTEMA PENSIONARIO","REGIMEN PENSIONARIO","AFP"],estatus:["ESTATUS","ESTADO"],
  sueldo:["SUELDO SEGUN CONTRATO","SUELDO BASICO","REMUNERACION BASICA","SUELDO PACTADO","SUELDO"],
  lab:["DIAS LABORADOS","DIAS TRABAJADOS","DIAS LAB"],faltas:["DIAS DE FALTAS CON DESCUENTO","DIAS DE FALTAS","FALTAS"],
  lic:["LICENCIAS / DESCANSO MEDICO","DESCANSO MEDICO","DIAS DE DESCANSO MEDICO","LICENCIAS"],
  vac:["DIAS DE VACACIONES GOZADAS","DIAS DE VACACIONES","VACACIONES GOZADAS"],
  vini:["INICIO DE VACACIONES","FECHA INICIO VACACIONES"],vfin:["FIN DE VACACIONES","FECHA FIN VACACIONES"],
  otros:["OTROS DIAS NO LABORADOS","DIAS NO LABORADOS"],
  rhMonto:["RECIBOS POR HONORARIOS"],rh4ta:["RENTA 4TA CATEGORIA"]
};
const isDocHdr=h=>/^(DNI|N° ?(DE )?DOCUMENTO|NRO\.? ?DOCUMENTO|NUMERO DE DOCUMENTO|DOC\. IDENTIDAD|DOCUMENTO( DE IDENTIDAD)?$)/.test(h);
const isNameHdr=h=>/NOMBRE|APELLIDO|TRABAJADOR|COLABORADOR/.test(h);
function cleanNote(t){t=String(t||"");const k=t.indexOf("Comentario:");if(t.includes("[Comentario encadenado]")&&k>=0)t=t.slice(k+11);return t.replace(/\r/g,"").replace(/[ \t]+/g," ").replace(/\n\s*\n+/g,"\n").trim()}
function noteDays(t,y,m){
  const out=new Set();if(!t)return out;
  const re=/(?<!\d)(\d{1,2})\s*[\/\-]\s*(\d{1,2})(?:\s*[\/\-]\s*(\d{4}|\d{2}))?(?!\d)/g;const toks=[];let x;
  while((x=re.exec(t))){let yy=x[3]?+x[3]:y;if(yy<100)yy+=2000;const dd=+x[1],mm=+x[2];if(mm>=1&&mm<=12&&dd>=1&&dd<=31)toks.push({y:yy,m:mm,d:dd,s:x.index,e:re.lastIndex})}
  for(let i=0;i<toks.length;i++){const a=toks[i],b=toks[i+1];
    if(b&&/^\s*(AL|A|HASTA)\s*$/i.test(t.slice(a.e,b.s))){const cur=new Date(a.y,a.m-1,a.d),end=new Date(b.y,b.m-1,b.d);let g=0;while(cur<=end&&g++<62){if(cur.getFullYear()===y&&cur.getMonth()+1===m)out.add(cur.getDate());cur.setDate(cur.getDate()+1)}i++}
    else if(a.y===y&&a.m===m)out.add(a.d)}
  return out}
function findCol(hdr,keys){
  for(const k of keys){const i=hdr.findIndex(h=>h===k);if(i>=0)return i}
  for(const k of keys){const i=hdr.findIndex(h=>h&&h.startsWith(k));if(i>=0)return i}
  return -1;
}
function parseSheet(ws){
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
  let hi=-1;
  for(let i=0;i<Math.min(aoa.length,40);i++){const r=(aoa[i]||[]).map(norm);if(r.some(isDocHdr)&&r.some(isNameHdr)){hi=i;break}}
  if(hi<0)return null;
  const hdrRaw=(aoa[hi]||[]).map(x=>String(x??"").replace(/\s+/g," ").trim());const hdr=hdrRaw.map(norm);const rg=XLSX.utils.decode_range(ws["!ref"]||"A1");
  const col={};for(const k in FIELDS)col[k]=findCol(hdr,FIELDS[k]);
  const ccol={};for(const c of DEFAULT_CONCEPTS)ccol[c.h]=findCol(hdr,[c.h]);
  for(const h of ALL_COLMAP_H){const j=hdr.findIndex(x=>x===h||(x&&x.startsWith(h+" ")&&!/PACTADO|CONTRATO/.test(x)));if(j>=0)ccol[h]=j}
  const extras=[];{const used=new Set(Object.values(ccol));
    let a=findCol(hdr,["SUELDO COMPUTABLE"]);
    if(a<0){const idx=[...Object.values(ccol).filter(x=>x>=0),...hdr.map((h,j)=>h&&AUTO_RULES.some(([re])=>re.test(h))?j:-1).filter(x=>x>=0)];a=idx.length?Math.min(...idx)-1:-1}
    let b=findCol(hdr,["COSTO EMPRESA","COSTO TOTAL","TOTAL COSTO"]);if(b<0)b=hdr.length;
    const hasComp=findCol(hdr,["SUELDO COMPUTABLE"])>=0;
    const fixed=new Set(Object.entries(col).filter(([k,x])=>x>=0&&!(k==="sueldo"&&!hasComp)).map(([,x])=>x));
    if(a>=-1&&b>a)for(let j=a+1;j<b;j++){if(fixed.has(j))continue;const h=hdr[j];if(!h||used.has(j)||/^(TOTAL|NETO|SUELDO NETO|COSTO|RECIBOS POR HONORARIOS|RENTA 4TA|DIAS|FECHA|CUENTA|BANCO|NRO|N° |CODIGO|PROVISION|% DE|SUELDO SEGUN|SUELDO PACTADO|EDAD|CARGO|PUESTO|AREA|CUSPP|CUPS|TELEFONO|HORAS (?!EXTRA))/.test(h)||ccol[h]!==undefined)continue;ccol[h]=j;extras.push(h)}}
  const rows=[];
  for(let i=hi+1;i<aoa.length;i++){
    const r=aoa[i]||[];const name=r[col.nombre],dni=r[col.dni];if(name&&/^TOTAL/.test(norm(name)))continue;if(dni!=null&&String(dni).replace(/[^0-9A-Z]/gi,"").length<6)continue;
    if(!name||dni==null||String(dni).trim()===""||/^-+$/.test(String(dni).trim()))continue;
    const g=k=>col[k]>=0?r[col[k]]:null;
    const amounts={};for(const h in ccol)if(ccol[h]>=0)amounts[h]=num(r[ccol[h]]);
    const notes=[],cm={};
    for(let j=0;j<Math.max(hdr.length,r.length);j++){const cell=ws[XLSX.utils.encode_cell({r:rg.s.r+i,c:rg.s.c+j})];
      if(cell&&cell.c&&cell.c.length){const t=cleanNote(cell.c.map(x=>x.t||"").join("\n"));if(!t)continue;notes.push({h:hdrRaw[j]||XLSX.utils.encode_col(rg.s.c+j),t});for(const k of ["vac","faltas","lic","alta","baja"])if(col[k]===j)cm[k]=t}}
    rows.push({row:i+1,cod:g("cod"),tipoDoc:norm(g("tipoDoc")),nombre:String(name).replace(/\s+/g," ").trim(),dniRaw:dni,modalidad:col.modalidad>=0?String(g("modalidad")??"").trim():"Planilla",
      susp:norm(g("susp")),pension:String(g("pension")??"").trim(),estatus:String(g("estatus")??"").trim(),sueldo:num(g("sueldo")),
      alta:parseDate(g("alta")),baja:parseDate(g("baja")),lab:num(g("lab")),faltas:num(g("faltas")),lic:num(g("lic")),vac:num(g("vac")),
      vini:parseDate(g("vini")),vfin:parseDate(g("vfin")),otros:num(g("otros")),hasOtros:col.otros>=0,hasLab:col.lab>=0,rhMonto:num(g("rhMonto")),rh4ta:num(g("rh4ta")),amounts,notes,cm});
  }
  return {rows,extras,missing:Object.keys(col).filter(k=>col[k]<0)};
}
function topText(ws,nr){try{if(!ws||!ws["!ref"])return "";const rg=XLSX.utils.decode_range(ws["!ref"]);rg.e.r=Math.min(rg.e.r,rg.s.r+(nr||6)-1);rg.e.c=Math.min(rg.e.c,rg.s.c+40);
  return XLSX.utils.sheet_to_json(ws,{header:1,defval:"",range:rg}).flat().join(" ")}catch(e){return ""}}
const ABR=["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SET","OCT","NOV","DIC"];
function findPeriod(wb,fname){
  const votes={};const add=(m,y,w)=>{const k=`${y}-${pad2(m)}`;votes[k]=(votes[k]||0)+w};
  const scan=(t,w)=>{const nt=norm(t).replace(/SEPTIEMBRE/g,"SETIEMBRE");let m,found=false;
    const re=new RegExp("("+MESES.join("|")+")\\s*(?:DE\\s*|DEL\\s*|-|_)?\\s*(20\\d{2})","g");
    while((m=re.exec(nt))){add(MESES.indexOf(m[1])+1,+m[2],w);found=true}
    const re2=/\b[A-Z0-9]{2,12}-(\d{2})(\d{2})\b/g;
    while((m=re2.exec(nt))){if(+m[2]>=1&&+m[2]<=12&&+m[1]>=20&&+m[1]<=40){add(+m[2],2000+(+m[1]),w);found=true}}
    return found};
  const metaP=(wb.Workbook&&wb.Workbook.Sheets)||[];
  for(const n of wb.SheetNames){const m=metaP.find(x=>x.name===n);if(m&&m.Hidden)continue;scan(topText(wb.Sheets[n]),1)}
  const fn=norm(fname||"").replace(/SEPTIEMBRE/g,"SETIEMBRE").replace(/SEP\b/g,"SET");
  if(!scan(fname||"",5)){
    let mi=MESES.findIndex(x=>fn.includes(x));
    if(mi<0){const mA=fn.match(new RegExp("(^|[^A-Z])("+ABR.join("|")+")([^A-Z]|$)"));if(mA)mi=ABR.indexOf(mA[2])}
    if(mi>=0){const ym=fn.match(/\b(20\d{2})\b/);let y=ym?+ym[1]:null;
      if(!y){const best=Object.entries(votes).sort((a,b)=>b[1]-a[1])[0];y=best?+best[0].slice(0,4):new Date().getFullYear()}
      add(mi+1,y,5)}}
  const best=Object.entries(votes).sort((a,b)=>b[1]-a[1]);
  if(!best.length)return null;
  const [k,v]=best[0];return {y:+k.slice(0,4),m:+k.slice(5),votos:v,otros:best.slice(1).map(([k2])=>k2)};
}
function detectCompany(wb,fname){
  const key=e=>norm(e.nombre).replace(/[.,]/g," ").replace(/\b(S ?A ?C|SAC|E ?I ?R ?L|EIRL|S ?A)\b/g,"").replace(/\s+/g," ").trim();
  const clean=t=>norm(t).replace(/[.,]/g," ").replace(/\s+/g," ");
  const aliasCount={};for(const e of EMPRESAS)for(const a of String(e.alias||"").split("|"))if(a)aliasCount[norm(a)]=(aliasCount[norm(a)]||0)+1;
  const aliasHit=(e,t)=>{let w=0;for(const a0 of String(e.alias||"").split("|")){const al=norm(a0);if(al.length<3)continue;
    if(new RegExp("(^|[^A-Z0-9])"+al.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"([^A-Z0-9]|$)").test(t))w=Math.max(w,aliasCount[al]>1?0.4:1)}return w};
  const score=new Map();const add=(e,w)=>score.set(e,(score.get(e)||0)+w);
  const texts=[[fname||"",5]];
  const meta=(wb.Workbook&&wb.Workbook.Sheets)||[];const visible=n=>{const m=meta.find(x=>x.name===n);return !(m&&m.Hidden)};
  for(const n of wb.SheetNames.filter(n=>visible(n)&&!/^\d{1,2}\.\s*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SET|SEP|OCT|NOV|DIC)/.test(norm(n))).slice(0,10))texts.push([topText(wb.Sheets[n],4),1]);
  let nuevo=null;
  for(const [t,w] of texts){const tc=clean(t);
    for(const e of EMPRESAS){
      if(tc.includes(e.ruc))add(e,3*w);
      const k=key(e),kc=k.replace(/ /g,""),tcc=tc.replace(/ /g,"");
      if(k.length>=4&&(tc.includes(k)||tcc.includes(kc)))add(e,2*w+k.length/100);
      const ah=aliasHit(e,tc)||aliasHit(e,tc.replace(/ /g,""));if(ah)add(e,ah*w);
    }
    const mr=tc.match(/RUC\W{0,4}(2\d{10})\b/);if(mr&&rucOk(mr[1])&&!EMPRESAS.some(e=>e.ruc===mr[1]))nuevo=nuevo||mr[1];
  }
  const best=[...score.entries()].sort((a,b)=>b[1]-a[1])[0];
  if(best)return best[0];
  if(nuevo){const e=INIT.onNewEmpresa(nuevo);$("#empresa").innerHTML="";return e}
  return null;
}
function renderEmpresa(){
  const sel=$("#empresa");
  if(!empresa()){sel.innerHTML="";$("#empNombre").textContent="Sin empresas activas";$("#empRuc").textContent="—";$("#empJornada").innerHTML="";return}
  if(!sel.options.length)sel.innerHTML=EMPRESAS.filter(e=>e.activa!==false||e.ruc===S.ruc).map(e=>`<option value="${e.ruc}">${esc(e.nombre)}${e.alias&&norm(e.alias.split("|")[0])!==norm(e.nombre).slice(0,e.alias.split("|")[0].length)?" ("+esc(e.alias.replace(/\|/g," / "))+")":""}</option>`).join("");
  sel.value=S.ruc;const e=empresa();$("#empNombre").textContent=e.nombre;$("#empRuc").textContent=S.ruc;
  const j=S.settings.jornada;$("#empJornada").innerHTML=`${e.alias?esc(e.alias.replace(/\|/g," / "))+" · ":""}L–V ${j.lv} h · sáb ${j.sab>0?j.sab+" h":"no trabajan"}`+(e.base31?' <span class="chip info">sueldos a 31 días</span>':"")+(e.porDefinir?' <span class="chip warn">jornada por definir</span>':"");
}
function loadWorkbook(buf,fname){
  let wb;
  try{wb=XLSX.read(buf,{type:"array",cellDates:true,cellStyles:true})}catch(e){toast("No se pudo leer el archivo. Verifica que sea un Excel (.xlsx).");return}
  const sheets=[];let rhSheet=null;const rhCands=[];const isRHName=nn=>/(RXH|R X H|HONORARIO|(^|[^A-Z])RH([^A-Z]|$)|4TA)/.test(nn);
  const per=findPeriod(wb,fname);
  const det=detectCompany(wb,fname);
  S.fileEmp=det||null;let sw="";
  if(det&&det.ruc!==S.ruc){useCompany(det.ruc);save();renderEmpresa();sw=`Archivo de ${det.nombre}: se cambió la empresa. `;toast(sw)}
  const meta=(wb.Workbook&&wb.Workbook.Sheets)||[];
  const usable=wb.SheetNames.filter(n=>{const m=meta.find(x=>x.name===n);if(m&&m.Hidden)return false;
    const base=n.replace(/\s*\(\d+\)\s*$/,"").trim();return !(base!==n.trim()&&wb.SheetNames.some(x=>x.trim()===base))});
  const fallbackM=per?per.m:(S.month||new Date().getMonth()+1);
  for(const n of usable){
    const nn=norm(n);
    if(isRHName(nn)){rhCands.push(n);continue}
    let mi=MESES.findIndex(x=>nn.includes(x));if(mi<0&&nn.includes("SEPTIEMBRE"))mi=8;
    let mm=mi>=0?mi+1:0;const liq=!mm;
    if(!mm&&nn.includes("PLANILLA"))mm=fallbackM;
    if(!mm)continue;
    const p=parseSheet(wb.Sheets[n]);if(!p)continue;
    sheets.push({name:n.trim(),month:mm,liq,...p});
  }
  if(!sheets.length){for(const n of usable){if(isRHName(norm(n)))continue;const p=parseSheet(wb.Sheets[n]);if(p&&p.rows.length){sheets.push({name:n.trim(),month:fallbackM,liq:true,...p});break}}}
  if(!sheets.length){toast("No encontré la hoja de planilla: necesito una fila de títulos con DNI y nombres del trabajador.");return}
  let yr=per?per.y:null;
  if(!yr)for(const n of wb.SheetNames.slice(0,4)){const a=topText(wb.Sheets[n]);const m=a.match(/\b(20\d{2})\b/);if(m){yr=+m[1];break}}
  S.rhFromFile=null;
  if(!rhCands.length)for(const n of wb.SheetNames){if(sheets.some(x=>x.name===n.trim()))continue;const t=norm(topText(wb.Sheets[n]));if(/HONORARIO/.test(t))rhCands.push(n)}
  for(const n of rhCands){if(parseRHSheet(wb.Sheets[n])){rhSheet=n;break}}
  S.liq=sheets.every(x=>x.liq);S.per=per;S.sheetName=sheets[0].name;
  if(rhSheet&&(S.liq||sheets.length===1)){const list=parseRHSheet(wb.Sheets[rhSheet]);if(list){S.rhFromFile={month:sheets[0].month,year:yr||S.year,list}}}
  S.extraCols=[...new Set(sheets.flatMap(s=>s.extras||[]))];
  S.sheets=sheets;S.year=yr||S.year;$("#year").value=S.year;
  if(S.rhFromFile){S.rh[`${S.ruc}-${S.rhFromFile.year}${pad2(S.rhFromFile.month)}`]=S.rhFromFile.list;save();toast(`${sw}${S.rhFromFile.list.length} recibo(s) leído(s) de la hoja de RxH`)}
  $("#planillaName").textContent=fname;
  const want=[10,9].find(m=>sheets.some(s=>s.month===m));
  S.month=S.month&&sheets.some(s=>s.month===S.month)?S.month:(want||sheets[0].month);
  render();
}

/* ---------- computation ---------- */
const AUTO_RULES=[
 [/SUMAS?\b.*BIENES?.*LIBRE DISP|BIENES?.*NO (SON )?(DE )?LIBRE DISP/,"0922","Sumas o bienes que no son de libre disposición"],
 [/MOVILIDAD.*LIBRE DISP/,"0908","Movilidad de libre disposición"],
 [/MOVILIDAD/,"0909","Movilidad supeditada a asistencia"],
 [/CONDICION(ES)? DE TRABAJO/,"0917","Condiciones de trabajo"],
 [/REFRIGERIO/,"0914","Refrigerio que no es alimentación principal"],
 [/CANASTA|NAVIDE/,"0903","Canasta de Navidad o similares"],
 [/INCENTIVO.*CESE/,"0906","Incentivo por cese del trabajador"],
 [/BONO.*PRODUCTIVIDAD/,"0902","Bono de productividad"],
 [/UTILIDADES/,"0910","Participación en las utilidades"],
 [/VENTA DE VACACIONES|COMPENSACION VACACIONAL/,"0117","Compensación vacacional"],
 [/VACACIONES TRUNCAS/,"0114","Vacaciones truncas"],
 [/REMUNERACION VACACIONAL|DESCANSO VACACIONAL/,"0118","Remuneración vacacional"],
 [/ASIGNACION FAMILIAR/,"0201","Asignación familiar"],
 [/HORAS? EXTRAS?.*25/,"0105","Sobretiempo 25%"],
 [/HORAS? EXTRAS?.*35/,"0106","Sobretiempo 35%"],
 [/FERIADO/,"0107","Trabajo en día feriado o de descanso"],
 [/^(?!INTERESES).*\bCTS\b|TIEMPO DE SERVICIOS/,"0904","Compensación por tiempo de servicios"],
 [/GRATIFICACION/,"0406","Gratificación – Ley 29351"],
 [/BONIFICACION.*(9|EXTRAORDINARIA)/,"0312","Bonificación extraordinaria – Ley 29351"],
 [/SUBSIDIO.*MATERNIDAD/,"0915","Subsidio por maternidad"],
 [/SUBSIDIO/,"0916","Subsidio por incapacidad"],
 [/TARDANZA/,"0704","Tardanzas"],
 [/INASISTENCIA/,"0705","Inasistencias"],
 [/ADELANTO|PRESTAMO/,"0701","Adelanto"],
 [/CUOTA SINDICAL/,"0702","Cuota sindical"],
 [/JUDICIAL/,"0703","Descuento por mandato judicial"],
 [/ESSALUD ?(\+|MAS) ?VIDA/,"0604","EsSalud + Vida"],
 [/VIDA LEY|SEGURO DE VIDA/,"0803","Póliza de seguro D. Leg. 688"],
 [/RENTA (DE )?5TA|QUINTA/,"0605","Renta de quinta categoría"],
 [/SUELDO COMPUTABLE|REMUNERACION BASICA|SUELDO BASICO|JORNAL BASICO|HABER BASICO|REMUNERACION COMPUTABLE/,"0121","Remuneración o jornal básico"],
 [/COMISION.*AFP|AFP.*COMISION/,"0601","SPP – comisión porcentual"],
 [/PRIMA.*SEGURO|SEGURO.*AFP/,"0606","SPP – prima de seguro"],
 [/APORTE OBLIGATORIO|AFP.*APORTE|APORTE.*AFP|FONDO DE PENSION/,"0608","SPP – aportación obligatoria"],
 [/\bONP\b|\bSNP\b|19990/,"0607","Sistema Nacional de Pensiones"],
 [/^SIS\b|SEGURO INTEGRAL/,"0811","Seguro Integral de Salud – SIS"],
 [/^ESSALUD\b|ESSALUD.*(9|REGULAR|APORTE)/,"0804","EsSalud seguro regular"],
 [/SENATI/,"0807","SENATI"],
 [/CONAFOVICER/,"0602","CONAFOVICER"],
 [/^COMISION(ES)?\b/,"0103","Comisiones o destajo"]
];
function codeInfo(h){
  const cm=colMap().find(x=>x.h===h);if(cm)return {code:cm.code,src:"empresa",label:cm.label};
  const m=h.match(/(?:CDG|COD(?:IGO)?\.?)\s*(\d{3,4})\b/)||h.match(/\(\s*(\d{4})\s*\)/)||h.match(/^(0\d{3})\b|\s(0\d{3})$/);
  if(m){const c=(m[1]||m[2]).padStart(4,"0");return {code:c,src:"titulo"}}
  if(h in S.settings.concepts)return {code:S.settings.concepts[h]||"",src:"config"};
  for(const [re,c,l] of AUTO_RULES)if(re.test(h))return {code:c,src:"auto",label:l};
  return {code:"",src:""};
}
const codeFor=h=>codeInfo(h).code;
function allConcepts(){return DEFAULT_CONCEPTS.concat(colMap().map(x=>({h:x.h,code:x.code,label:x.label,regla:true})),(S.extraCols||[]).map(h=>({h,code:"",label:"Columna adicional del Excel: revisa el código",extra:true})))}
function feriadosDe(m){return String(S.settings.feriados[String(m)]||"").split(/[,;\s]+/).map(x=>+x).filter(x=>x>=1&&x<=31)}
function overFor(doc){const k=sk();S.over[k]=S.over[k]||{};S.over[k][doc]=S.over[k][doc]||{};return S.over[k][doc]}
function getOver(doc){return (S.over[sk()]||{})[doc]||{}}

function compute(){
  const sh=S.liq?(S.sheets.find(s=>s.name===S.sheetName)||S.sheets[0]):S.sheets.find(s=>s.month===S.month);if(!sh)return null;
  const y=S.year,m=S.month,D=daysIn(y,m),J=S.settings.jornada,fer=new Set(feriadosDe(m));
  const first={y,m,d:1},last={y,m,d:D};
  const workers=[],excluded=[],rhSrc=[];
  for(const r of sh.rows){
    const mod=norm(r.modalidad);
    if(mod==="PLANILLA"||/PLANILLA|BOLETA|5TA/.test(mod))workers.push(r);
    else if(mod.startsWith("RECIBO POR HONORARIOS"))rhSrc.push(r);
    else excluded.push(r);
  }
  const out=[];
  for(const r of workers){
    const di=docInfo(r.dniRaw);const td=r.tipoDoc||"";
    if(/^0?1$|^DNI/.test(td))di.tipo="01";else if(/^0?4$|CARNE|CE\b|EXTRANJ/.test(td))di.tipo="04";else if(/^0?7$|PASAPORTE/.test(td))di.tipo="07";else if(/^23$|PTP|CPP|PERMISO/.test(td))di.tipo="23";
    const o=getOver(di.num);
    const tipo=o.tipo||di.tipo;
    const alerts=[];
    let start=1,end=D;
    if(r.alta&&cmp(r.alta,last)>0)alerts.push({t:"bad",m:`Alta ${dstr(r.alta)} posterior al periodo`});
    if(r.alta&&r.alta.y===y&&r.alta.m===m)start=r.alta.d;
    if(r.baja&&cmp(r.baja,first)<0)alerts.push({t:"bad",m:`Baja ${dstr(r.baja)} anterior al periodo`});
    if(r.baja&&r.baja.y===y&&r.baja.m===m)end=r.baja.d;
    const fuera=(start-1)+(D-end);
    const vac=o.vac??r.vac, faltas=o.faltas??r.faltas, lic=o.lic??r.lic;
    const rOtros=r.hasOtros===false?fuera:r.otros;
    const rLab=r.hasLab===false?Math.max(0,D-fuera-r.faltas-r.vac-r.lic):r.lab;
    const otrosSE=o.otros??Math.max(0,rOtros-fuera);
    if(rOtros<fuera&&o.otros==null)alerts.push({t:"warn",m:`Otros días (${rOtros}) menor a los días fuera de alta/baja (${fuera})`});
    if(otrosSE>0&&o.otros==null)alerts.push({t:"warn",m:`${otrosSE} día(s) no laborado(s) sin explicar por alta/baja → código ${S.settings.snl.otros}`});
    const suma=rLab+r.faltas+r.lic+r.vac+rOtros, sumaDM=rLab+r.faltas+r.vac+rOtros;
    const okSum=v=>Math.round(v)===D||(empresa().base31&&Math.round(v)===31);
    if(!okSum(suma)&&!okSum(sumaDM))alerts.push({t:"warn",m:`Los días del Excel suman ${sumaDM} (sin D.M.) o ${suma} (con D.M.) y el mes tiene ${D}${empresa().base31?" (o 31 por la base de sueldos)":""}`});
    // horas ordinarias
    let mins=0;
    const vi=r.vini&&r.vfin?r.vini:null,vf=r.vini&&r.vfin?r.vfin:null;
    const vacSet=noteDays(r.cm.vac,y,m),faltSet=noteDays(r.cm.faltas,y,m),licSet=noteDays(r.cm.lic,y,m);
    const vacCom=vacSet.size;
    if(vi)for(let d=1;d<=D;d++){const cur={y,m,d};if(cmp(cur,vi)>=0&&cmp(cur,vf)<=0)vacSet.add(d)}
    const usados=[];
    for(const [lbl,set,val,com] of [["vacaciones",vacSet,vac,vacCom],["faltas",faltSet,faltas,faltSet.size],["descanso/licencia",licSet,lic,licSet.size]]){
      if(set.size&&set.size!==val)alerts.push({t:"warn",m:`Las fechas de ${lbl} suman ${set.size} día(s) y la celda dice ${val}`});
      if(com)usados.push(lbl)}
    let vacD=0,faltD=0,licD=0;
    for(let d=start;d<=end;d++){
      if(vacSet.has(d)){vacD++;continue}
      if(faltSet.has(d)){faltD++;continue}
      if(licSet.has(d)){licD++;continue}
      if(fer.has(d))continue;
      const wd=new Date(y,m-1,d).getDay();
      mins+=Math.round((wd===0?J.dom:wd===6?J.sab:J.lv)*60);
    }
    if(usados.length)alerts.push({t:"info",m:`Fechas leídas del comentario: ${usados.join(", ")}`});
    if(vac>0&&!vacSet.size)alerts.push({t:"info",m:"Vacaciones sin fechas: se descuentan horas promedio"});
    if(lic>0&&r.cm.lic&&!/MEDIC/.test(norm(r.cm.lic))&&!o.licCode)alerts.push({t:"warn",m:`Licencia «${r.cm.lic.replace(/\s+/g," ").slice(0,60)}»: revisa el código (${S.settings.snl.lic})`});
    mins-=Math.round((Math.max(0,vac-vacD)+Math.max(0,faltas-faltD)+Math.max(0,lic-licD)+otrosSE)*J.prom*60);
    mins=Math.max(0,mins);
    let hOrdMin=o.hOrd!=null?Math.round(o.hOrd*60):mins;
    // sobretiempo
    const he25=r.amounts["HORAS EXTRAS AL 25%"]||0,he35=r.amounts["HORAS EXTRAS AL 35%"]||0;
    let heEst=0;
    if((he25||he35)&&r.sueldo>0){const hh=r.sueldo/30/8;heEst=he25/(hh*1.25)+he35/(hh*1.35)}
    const heMin=o.he!=null?Math.round(o.he*60):Math.round(heEst*60);
    if((he25||he35)&&o.he==null)alerts.push({t:"warn",m:`Horas extras estimadas desde el monto (${(heEst).toFixed(2)} h): confirma con el registro`});
    // conceptos
    const lines=[];let ing=0,quinta=0;
    for(const c of allConcepts()){
      if(colMap().some(x=>x.replaces===c.h&&(x.h in r.amounts)))continue;
      const a=r2(r.amounts[c.h]||0);if(!a)continue;
      const code=codeFor(c.h);
      if(!code){alerts.push({t:"bad",m:`${c.h} S/ ${fmt(a)} sin código PLAME: no se exporta`});continue}
      lines.push({code,h:c.h,a});
      if(code==="0605")quinta+=a;else if(!/^0[678]/.test(code))ing+=a;
    }
    if(!lines.some(l=>!/^0[678]/.test(l.code)))alerts.push({t:"warn",m:"Sin ingresos en el mes"});
    if(o.hOrd!=null||o.he!=null||o.vac!=null||o.faltas!=null||o.lic!=null||o.otros!=null||o.licCode)alerts.push({t:"info",m:"Editado a mano"});
    const snl=[];
    if(vac>0)snl.push([S.settings.snl.vac,vac]);
    if(faltas>0)snl.push([S.settings.snl.faltas,faltas]);
    if(lic>0)snl.push([o.licCode||S.settings.snl.lic,lic]);
    if(otrosSE>0&&S.settings.snl.otros)snl.push([S.settings.snl.otros,otrosSE]);
    out.push({r,tipo,doc:di.num,start,end,fuera,vac,faltas,lic,otrosSE,hOrdMin,heMin,lines,ing,quinta,snl,alerts});
  }
  return {sheet:sh,D,workers:out,excluded,rhSrc};
}

/* ---------- recibos por honorarios ---------- */
function splitName(full){
  const w=plain(full).split(" ").filter(Boolean);
  if(w.length<3)return {ap:w[w.length-1]||"",am:"",no:w.slice(0,-1).join(" ")};
  return {ap:w[w.length-2],am:w[w.length-1],no:w.slice(0,-2).join(" ")};
}
function lastDay(){return `${S.year}-${pad2(S.month)}-${pad2(daysIn(S.year,S.month))}`}
function rhList(C){
  const k=sk();
  if(!S.rh[k]){
    S.rh[k]=C.rhSrc.filter(r=>r.rhMonto>0).map(r=>{const di=docInfo(r.dniRaw);const n=splitName(r.nombre);
      return {id:Math.random().toString(36).slice(2),tipo:"06",num:di.tipo==="01"?rucFromDni(di.num):di.num,ap:n.ap,am:n.am,no:n.no,serie:"E001",numero:"",
        monto:r2(r.rhMonto),fe:lastDay(),fp:lastDay(),ret:r.rh4ta>0?"1":"0",fuente:"Excel"}});
  }
  return S.rh[k];
}
function rhAlerts(x){
  const a=[];
  if(!x.numero)a.push("Falta número de recibo");
  if(x.tipo==="06"&&!rucOk(x.num))a.push("RUC inválido");
  if(!x.ap||!x.no)a.push("Falta apellido o nombre");
  if(!(num(x.monto)>0))a.push("Monto en cero");
  if(!x.fe)a.push("Faltan fechas: emisión");


  if(num(x.monto)>1500&&x.ret==="0")a.push("Monto > S/ 1,500 sin retención (¿tiene suspensión?)");
  return a;
}
function rhIn(x){
  const ini=`${S.year}-${pad2(S.month)}-01`,fin=lastDay();
  const ok=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||"");
  if(x.relleno)return {ok:false,m:"Fila con color de relleno: no se declara",c:x.relleno};
  if(!ok(x.fp))return {ok:false,m:"Sin fecha de pago válida: no se declara"};
  if(x.fp>fin)return {ok:false,m:"Pago posterior al periodo: no se declara"};
  const pIn=x.fp>=ini&&x.fp<=fin, eIn=ok(x.fe)&&x.fe>=ini&&x.fe<=fin;
  if(!pIn&&!eIn)return {ok:false,m:"Pago y emisión fuera del periodo: no se declara"};
  return {ok:true};
}
function parseRHSheet(ws){
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
  let hi=-1;for(let i=0;i<Math.min(aoa.length,30);i++){const t=(aoa[i]||[]).map(norm).join("|");if(/EMISI/.test(t)&&/(RENTA BRUTA|MONTO|IMPORTE|TOTAL)/.test(t)){hi=i;break}}
  if(hi<0)return null;
  const rgR=XLSX.utils.decode_range(ws["!ref"]||"A1");const ncol=(aoa[hi]||[]).length;
  const fillOf=i=>{for(let j=0;j<ncol;j++){const c=ws[XLSX.utils.encode_cell({r:rgR.s.r+i,c:rgR.s.c+j})];const st=c&&c.s;
    if(!st||!st.patternType||st.patternType==="none")continue;const fg=st.fgColor||{};const rgb=String(fg.rgb||"").toUpperCase().slice(-6);
    if(rgb==="FFFFFF"||(fg.theme===0&&!fg.tint&&!rgb))continue;return rgb?"#"+rgb:"tema "+(fg.theme??"")}return ""};
  const h=aoa[hi].map(norm);const f=(...ks)=>{for(const k of ks){const i=h.findIndex(x=>x&&x.includes(k));if(i>=0)return i}return -1};
  const cFe=f("FECHA DE EMISION","FECHA EMISION","EMISION"),cFp=f("FECHA DE PAGO","FECHA PAGO"),cNro=f("NRO. DOC. EMITIDO","NRO DOC EMITIDO","N° DOC","COMPROBANTE"),
    cSerie=f("SERIE"),cNum=h.findIndex(x=>x==="NUMERO"||x==="NRO"),cEst=f("ESTADO"),cDocE=f("NRO. DOC. EMISOR","NRO DOC EMISOR","DOC. EMISOR","RUC"),cNom=f("APELLIDOS Y NOMBRES","RAZON SOCIAL","NOMBRE"),
    cBruto=f("RENTA BRUTA","MONTO TOTAL","IMPORTE","TOTAL"),cRet=f("IMPUESTO A LA RENTA","RETENCION","IMPUESTO"),cObs=f("OBSERVACION"),cDesc=f("DESCRIPCION");
  const iso=d=>d?`${d.y}-${pad2(d.m)}-${pad2(d.d)}`:"";
  const list=[];
  for(let i=hi+1;i<aoa.length;i++){
    const r=aoa[i]||[];const bruto=num(r[cBruto]);const doc=String(r[cDocE]??"").replace(/\D/g,"");
    if(!bruto||!doc)continue;
    if(cEst>=0){const e=norm(r[cEst]);if(/^(ANULADO|REVERTIDO)/.test(e))continue}
    let serie="",numero="";
    if(cSerie>=0&&cNum>=0&&cSerie!==cNum){serie=String(r[cSerie]??"").trim();numero=String(r[cNum]??"").trim()}
    else if(cNro>=0){const s=String(r[cNro]??"").trim();const m=s.match(/([A-Z0-9]{4})\s*-\s*(\d+)/i);if(m){serie=m[1].toUpperCase();numero=m[2]}}
    numero=numero.replace(/^0+(?=\d)/,"");
    const w=plain(r[cNom]).split(" ").filter(Boolean);
    const fe=parseDate(r[cFe]);let fp=null,fpTxt="";
    if(cFp>=0){const v=r[cFp];const strict=v instanceof Date||(typeof v==="number"&&v>20000&&v<80000)||/^\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\s*$|^\s*\d{4}-\d{2}-\d{2}\s*$/.test(String(v??""));
      fp=strict?parseDate(v):null;if(!fp)fpTxt=String(v??"").trim()}
    const obs=[cObs>=0?String(r[cObs]??"").replace(/^[\s-]+|[\s-]+$/g,""):"",fpTxt].filter(Boolean).join(" · ");
    list.push({relleno:fillOf(i),id:Math.random().toString(36).slice(2),tipo:doc.length===11?"06":"01",num:doc,ap:w[0]||"",am:w[1]||"",no:w.slice(2).join(" "),
      serie:serie||"E001",numero,monto:r2(bruto),fe:iso(fe),fp:cFp>=0?iso(fp):(iso(fe)||lastDay()),ret:num(r[cRet])>0?"1":"0",fuente:"RxH",obs,
      desc:cDesc>=0?String(r[cDesc]??"").trim().slice(0,80):""});
  }
  return list.length?list:null;
}
function importRH(buf){
  let wb;try{wb=XLSX.read(buf,{type:"array",cellDates:true,cellStyles:true})}catch(e){toast("No se pudo leer el archivo de recibos.");return}
  let list=null;
  const order=[...wb.SheetNames].sort((a,b)=>(/(RXH|HONORARIO)/.test(norm(b))?1:0)-(/(RXH|HONORARIO)/.test(norm(a))?1:0));
  for(const n of order){list=parseRHSheet(wb.Sheets[n]);if(list)break}
  if(!list){toast("No reconocí recibos en ese archivo (busco la columna «Fecha de Emisión» y «Renta Bruta»).");return}
  S.rh[sk()]=list;save();render();toast(`${list.length} recibo(s) importado(s)`);
}

/* ---------- TXT builders ---------- */
const dmy=iso=>{const d=parseDate(iso);return d?dstr(d):""};
function build(C){
  const rem=[],jor=[],snl=[],ps4=[],q4=[];
  for(const w of C.workers){
    const agg={};for(const l of w.lines)agg[l.code]=r2((agg[l.code]||0)+l.a);
    if((agg["0606"]!=null||agg["0608"]!=null||/INTEGRA|PRIMA|PROFUTURO|HABITAT/i.test(w.r.pension))&&agg["0601"]==null)agg["0601"]=0;
    if(agg["0605"]==null)agg["0605"]=0;
    for(const code of Object.keys(agg).sort())rem.push(`${w.tipo}|${w.doc}|${code}|${f2(agg[code])}|${f2(agg[code])}|`);
    jor.push(`${w.tipo}|${w.doc}|${Math.floor(w.hOrdMin/60)}|${w.hOrdMin%60}|${Math.floor(w.heMin/60)}|${w.heMin%60}|`);
    for(const [c,d] of w.snl)snl.push(`${w.tipo}|${w.doc}|${c}|${d}|`);
  }
  const rh=rhList(C).filter(x=>rhIn(x).ok&&!rhAlerts(x).some(a=>/Falta número|Monto en cero|Faltan fechas/.test(a)));
  const seen=new Set();
  const tail=S.settings.pens4ta==="zero"?"0||":"||";
  for(const x of rh){
    const key=x.tipo+x.num;
    if(!seen.has(key)){seen.add(key);ps4.push(`${x.tipo}|${x.num}|${plain(x.ap)}|${plain(x.am)}|${plain(x.no)}|1|0|`)}
    q4.push(`${x.tipo}|${x.num}|R|${String(x.serie).toUpperCase()}|${x.numero}|${f2(num(x.monto))}|${dmy(x.fe)}|${dmy(x.fp<x.fe?x.fe:x.fp)}|${x.ret}|${tail}`);
  }
  return {rem,jor,snl,ps4,"4ta":q4};
}
const FILE_DESC={rem:"Ingresos, tributos y descuentos",jor:"Jornada laboral",snl:"Días subsidiados y no laborados",ps4:"Prestadores de servicios 4ta",
  "4ta":"Comprobantes de 4ta categoría"};

/* ---------- render ---------- */
function render(){
  const sinEmp=!empresa();$("#noEmpresas").hidden=!sinEmp;$("#exportWrap").hidden=sinEmp;if(sinEmp)return;
  // months
  const mb=$("#months");
  if(S.sheets.length){
    if(S.liq){
      mb.innerHTML=`<label class="f">Mes a declarar<select id="mesSel" style="min-width:9em">${MESES.map((m,i)=>`<option value="${i+1}"${i+1===S.month?" selected":""}>${m[0]+m.slice(1).toLowerCase()}</option>`).join("")}</select></label>`
        +(S.per?`<span class="note" style="align-self:flex-end">Leído del archivo: ${MESES[S.per.m-1].toLowerCase()} ${S.per.y}${S.per.otros.length?` · también aparece ${S.per.otros.map(k=>MESES[+k.slice(5)-1].toLowerCase()+" "+k.slice(0,4)).join(", ")}`:""}</span>`:`<span class="chip warn" style="align-self:flex-end">No encontré el mes en el archivo: elígelo</span>`)
        +(S.sheets.length>1?`<div class="row" style="width:100%">${S.sheets.map(x=>`<button type="button" data-sheet="${esc(x.name)}" aria-pressed="${x.name===S.sheetName}">${esc(x.name)}</button>`).join("")}</div>`:"");
    }else mb.innerHTML=S.sheets.map(s=>`<button type="button" data-m="${s.month}" aria-pressed="${s.month===S.month}">${esc(MESES[s.month-1].slice(0,3))}</button>`).join("");
  }
  const C=S.sheets.length?compute():null;
  $("#emptyState").hidden=!!C;$("#workspace").hidden=!C;$("#stats").hidden=!C;
  if(!C)return;
  $("#periodLabel").innerHTML=esc(`Periodo ${MESES[S.month-1]} ${S.year} · hoja «${C.sheet.name}» · ${C.D} días`)+(S.fileEmp&&S.fileEmp.ruc!==S.ruc?` <span class="chip bad">El archivo cargado es de ${esc(S.fileEmp.nombre)}</span>`:"");
  const files=build(C);
  const rh=rhList(C);
  const obsW=C.workers.filter(w=>w.alerts.some(a=>a.t!=="info")).length;
  const obsR=rh.filter(x=>rhIn(x).ok&&rhAlerts(x).length).length;
  $("#sWorkers").textContent=C.workers.length;
  $("#sIngresos").textContent=fmt(C.workers.reduce((s,w)=>s+w.ing,0));
  $("#sQuinta").textContent=fmt(C.workers.reduce((s,w)=>s+w.quinta,0));
  $("#sRH").textContent=rh.filter(x=>rhIn(x).ok).length;
  $("#sObs").textContent=obsW+obsR;
  $("#cTrab").textContent=C.workers.length;$("#cTrab").className="count"+(obsW?" warn":"");
  $("#cRH").textContent=rh.length;$("#cRH").className="count"+(obsR?" warn":"");
  document.querySelectorAll(".tabs button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.tab===S.tab)));
  for(const t of ["trab","rh","arch","conf"])$("#v-"+t).hidden=S.tab!==t;
  if(S.tab==="trab")renderTrab(C);
  if(S.tab==="rh")renderRH(C,rh);
  if(S.tab==="arch")renderArch(C,files);
  if(S.tab==="conf")renderConf(C);
}
const GRUPOS=[["Desc. 07",/^07/],["5ta 0605",/^0605$/],["AFP 0601/06/08",/^060[168]$/],["ONP 0607",/^0607$/],["SIS 0811",/^0811$/],["EsSalud 0804",/^0804$/]];
const sumc=(w,re)=>w.lines.filter(l=>re.test(l.code)).reduce((s,l)=>s+l.a,0);
const chip=a=>`<span class="chip ${a.t==="bad"?"bad":a.t==="warn"?"warn":"info"}">${esc(a.m)}</span>`;
const hm=mins=>(mins/60).toFixed(2).replace(/\.00$/,"");

function renderTrab(C){
  const v=$("#v-trab");
  const rows=C.workers.map((w,i)=>{
    const flag=w.alerts.some(a=>a.t!=="info");
    const open=S.open[w.doc];
    const main=`<tr class="${flag?"flag":""}">
      <td class="mono">${w.tipo}·${esc(w.doc)}</td>
      <td class="name" title="${esc(w.r.nombre)}">${w.r.notes.length?`<button class="linkbtn" data-toggle="${esc(w.doc)}" title="Ver comentarios del Excel">✎${w.r.notes.length}</button> `:""}${esc(w.r.nombre)}</td>
      <td class="mono">${w.r.alta&&w.r.alta.m===S.month&&w.r.alta.y===S.year?"alta "+pad2(w.r.alta.d):""}${w.r.baja&&w.r.baja.m===S.month&&w.r.baja.y===S.year?" baja "+pad2(w.r.baja.d):""}</td>
      <td class="num">${w.r.lab}</td>
      <td class="num"><input type="number" min="0" max="31" data-ov="vac" data-doc="${esc(w.doc)}" value="${w.vac}" aria-label="Vacaciones"></td>
      <td class="num"><input type="number" min="0" max="31" data-ov="faltas" data-doc="${esc(w.doc)}" value="${w.faltas}" aria-label="Faltas"></td>
      <td class="num"><input type="number" min="0" max="31" data-ov="lic" data-doc="${esc(w.doc)}" value="${w.lic}" aria-label="Descanso médico"></td>
      <td class="num"><input type="number" min="0" max="31" data-ov="otros" data-doc="${esc(w.doc)}" value="${w.otrosSE}" aria-label="Otros no laborados"></td>
      <td class="num"><input type="number" min="0" step="0.5" data-ov="hOrd" data-doc="${esc(w.doc)}" value="${hm(w.hOrdMin)}" aria-label="Horas ordinarias"></td>
      <td class="num"><input type="number" min="0" step="0.5" data-ov="he" data-doc="${esc(w.doc)}" value="${hm(w.heMin)}" aria-label="Horas extras"></td>
      <td class="num">${fmt(w.ing)}</td>
      ${GRUPOS.map(([,re])=>{const v=sumc(w,re);return `<td class="num">${v?fmt(v):"—"}</td>`}).join("")}
      <td style="white-space:normal;min-width:180px">${w.alerts.length?w.alerts.map(chip).join(""):'<span class="chip ok">OK</span>'}</td>
      <td><button class="linkbtn" data-toggle="${esc(w.doc)}">${open?"Ocultar":"Detalle"}</button></td>
    </tr>`;
    const det=open?`<tr class="det"><td colspan="19"><div class="concepts">${w.lines.map(l=>`<span><b>${l.code}</b> ${esc(l.h.toLowerCase())} ${f2(l.a)}</span>`).join("")}${w.snl.map(([c,d])=>`<span><b>SNL ${c}</b> ${d} día(s)</span>`).join("")}${w.lic>0?`<label>Código licencia <select data-ovs="licCode" data-doc="${esc(w.doc)}"><option value="">${esc(S.settings.snl.lic)} (general)</option>${[["20","20 Enfermedad (primeros 20 días)"],["21","21 Incapacidad temporal (subsidio)"],["24","24 Cargo cívico / SMO"],["27","27 Licencia con goce"],["05","05 Licencia sin goce"]].map(([c,l])=>`<option value="${c}"${getOver(w.doc).licCode===c?" selected":""}>${l}</option>`).join("")}</select></label>`:""}<span>Pensión: ${esc(w.r.pension||"—")}</span><span>Fila Excel ${w.r.row}</span>${Object.keys(getOver(w.doc)).length?`<button class="linkbtn" data-reset="${esc(w.doc)}">Volver a los valores del Excel</button>`:""}</div>${w.r.notes.length?`<div class="notes">${w.r.notes.map(n=>`<div><b>${esc(n.h)}:</b> ${esc(n.t)}</div>`).join("")}</div>`:""}</td></tr>`:"";
    return main+det;
  }).join("");
  const exc=C.excluded.length?`<p class="note">Fuera del PLAME (no son 4ta ni 5ta): ${C.excluded.map(r=>`${esc(r.nombre)} — ${esc(r.modalidad)} S/ ${fmt(r.rhMonto||r.sueldo)}`).join(" · ")}. Las regalías con retención de 2da categoría van en el PDT 617.</p>`:"";
  v.innerHTML=`
  <p class="note">Las horas ordinarias se calculan con la jornada L–V ${S.settings.jornada.lv} h y sábado ${S.settings.jornada.sab} h, dentro de las fechas de alta y baja, sin los días de vacaciones y feriados. Faltas, descanso médico y otros días se restan a ${S.settings.jornada.prom} h por día. Cualquier celda se puede corregir; el cambio se guarda automáticamente en la base de datos.</p>
  <div class="scroll"><table>
    <thead><tr><th>Doc.</th><th>Trabajador</th><th>Mov.</th><th class="num">Días lab.</th><th class="num">Vac. ${esc(S.settings.snl.vac)}</th><th class="num">Faltas ${esc(S.settings.snl.faltas)}</th><th class="num">D.M. ${esc(S.settings.snl.lic)}</th><th class="num">Otros ${esc(S.settings.snl.otros)}</th><th class="num">H. ord.</th><th class="num">H. extra</th><th class="num">Ingresos</th>${GRUPOS.map(([n])=>`<th class="num">${n}</th>`).join("")}<th>Observaciones</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><th colspan="10">Totales del periodo</th><th class="num">${fmt(C.workers.reduce((s,w)=>s+w.ing,0))}</th>${GRUPOS.map(([,re])=>`<th class="num">${fmt(C.workers.reduce((s,w)=>s+sumc(w,re),0))}</th>`).join("")}<th></th><th></th></tr></tfoot>
  </table></div>${exc}`;
}

function renderRH(C,rh){
  const v=$("#v-rh");
  const body=rh.map(x=>{const al=rhIn(x).ok?rhAlerts(x):[];return `<tr class="${al.length?"flag":""}">
    <td><select data-rh="tipo" data-id="${x.id}" aria-label="Tipo doc"><option value="06"${x.tipo==="06"?" selected":""}>06 RUC</option><option value="01"${x.tipo==="01"?" selected":""}>01 DNI</option><option value="04"${x.tipo==="04"?" selected":""}>04 CE</option></select></td>
    <td><input class="w" data-rh="num" data-id="${x.id}" value="${esc(x.num)}" aria-label="Número de documento"></td>
    <td><input class="w" data-rh="ap" data-id="${x.id}" value="${esc(x.ap)}" aria-label="Apellido paterno"></td>
    <td><input class="w" data-rh="am" data-id="${x.id}" value="${esc(x.am)}" aria-label="Apellido materno"></td>
    <td><input class="ww" data-rh="no" data-id="${x.id}" value="${esc(x.no)}" aria-label="Nombres"></td>
    <td><input data-rh="serie" data-id="${x.id}" value="${esc(x.serie)}" style="width:4.5em;text-align:left" aria-label="Serie"></td>
    <td><input data-rh="numero" data-id="${x.id}" value="${esc(x.numero)}" style="width:6em" aria-label="Número"></td>
    <td><input data-rh="monto" data-id="${x.id}" type="number" step="0.01" value="${esc(x.monto)}" style="width:7em" aria-label="Monto"></td>
    <td><input data-rh="fe" data-id="${x.id}" type="date" value="${esc(x.fe)}" style="width:auto" aria-label="Fecha de emisión"></td>
    <td><input data-rh="fp" data-id="${x.id}" type="date" value="${esc(x.fp)}" style="width:auto" aria-label="Fecha de pago"></td>
    <td><select data-rh="ret" data-id="${x.id}" aria-label="Retención"><option value="1"${x.ret==="1"?" selected":""}>Sí</option><option value="0"${x.ret==="0"?" selected":""}>No</option></select></td>
    <td class="num">${x.ret==="1"?fmt(num(x.monto)*.08):"—"}</td>
    <td style="white-space:normal;min-width:160px">${al.length?al.map(m=>`<span class="chip ${/Falta número|Monto en cero|Faltan fechas/.test(m)?"bad":"warn"}">${esc(m)}</span>`).join(""):'<span class="chip ok">OK</span>'}<span class="chip info">${esc(x.fuente)}</span>${(()=>{const q=rhIn(x);return q.ok?"":`<span class="chip warn">${q.c&&q.c[0]==="#"?`<span style="display:inline-block;width:.8em;height:.8em;border-radius:2px;vertical-align:-1px;margin-right:4px;border:1px solid var(--line);background:${esc(q.c)}"></span>`:""}${esc(q.m)}</span>`})()}${x.fe&&x.fp&&x.fp<x.fe?`<span class="chip info">Pago ${esc(dmy(x.fp))}: se declara ${esc(dmy(x.fe))}</span>`:""}${x.obs?`<span class="chip info">${esc(x.obs)}</span>`:""}</td>
    <td><button class="linkbtn" data-rhdel="${x.id}">Quitar</button></td></tr>`}).join("");
  const xl=C.rhSrc.filter(r=>r.rhMonto>0).map(r=>`${esc(r.nombre)} S/ ${fmt(r.rhMonto)}${r.rh4ta?` (ret. ${fmt(r.rh4ta)})`:""}${r.susp==="SI"?" · con suspensión":""}`).join(" · ");
  v.innerHTML=`
  <div class="row" style="justify-content:space-between">
    <p class="note" style="margin:0">Según el Excel, en ${MESES[S.month-1].toLowerCase()}: ${xl||"no hay recibos"}. Completa serie, número y fechas, o importa el reporte de recibos recibidos de SUNAT. Los recibos sin número no se exportan.</p>
    <div class="row">
      <label class="btn ghost sm" style="cursor:pointer">Importar reporte de recibos<input type="file" id="fileRH" accept=".xlsx,.xls,.csv" hidden></label>
      <button class="btn ghost sm" id="rhAdd">Agregar recibo</button>
      <button class="btn ghost sm" id="rhReset">Rehacer desde el Excel</button>
    </div>
  </div>
  <div class="scroll"><table>
    <thead><tr><th>Tipo</th><th>Documento</th><th>Ap. paterno</th><th>Ap. materno</th><th>Nombres</th><th>Serie</th><th>Número</th><th class="num">Monto</th><th>Emisión</th><th>Pago</th><th>Ret. 4ta</th><th class="num">8 %</th><th>Observaciones</th><th></th></tr></thead>
    <tbody>${body||`<tr><td colspan="14" class="note">No hay recibos para este periodo.</td></tr>`}</tbody>
  </table></div>`;
}

function renderArch(C,files){
  const v=$("#v-arch");
  const blockers=C.workers.flatMap(w=>w.alerts.filter(a=>a.t==="bad").map(a=>`${w.r.nombre}: ${a.m}`));
  const rhPend=rhList(C).filter(x=>!x.numero).length;
  v.innerHTML=`
  <div class="row" style="justify-content:space-between">
    <div><h2>${esc(baseName())}.*</h2><p class="note" style="margin:2px 0 0">Descomprime el ZIP en la carpeta de importación del PLAME (por defecto <span style="font-family:var(--mono)">C:\\Program Files (x86)\\SUNAT\\PDT PLAME\\...\\importa</span>) o selecciona cada archivo desde «Importar».</p></div>
    <button class="btn" id="dlZip">Descargar ZIP</button>
  </div>
  ${blockers.length||rhPend?`<div class="alertbox">${blockers.length?`<b>${blockers.length} observación(es) crítica(s):</b> ${esc(blockers.slice(0,4).join(" · "))}${blockers.length>4?" …":""}<br>`:""}${rhPend?`<b>${rhPend} recibo(s) sin número</b>: no van en .ps4 ni .4ta hasta completarlos.`:""}</div>`:""}
  ${(()=>{const miss={};for(const w of C.workers)for(const c of allConcepts()){const a=r2(w.r.amounts[c.h]||0);if(a&&!codeFor(c.h)){miss[c.h]=miss[c.h]||{t:0,n:0};miss[c.h].t+=a;miss[c.h].n++}}
    const k=Object.keys(miss);if(!k.length)return `<p class="note">Todas las columnas de la planilla con montos en este periodo tienen código PLAME y se exportan.</p>`;
    return `<div class="alertbox"><b>Columnas con montos sin código PLAME:</b> no se están exportando. Asigna el código y se agregan al .rem.<div class="row" style="margin-top:8px">${k.map(h=>`<label class="f">${esc(h)} · ${miss[h].n} trab. · S/ ${fmt(miss[h].t)}<input data-cc="${esc(h)}" placeholder="código" style="width:6em"></label>`).join("")}</div></div>`})()}
  <div class="files">${Object.keys(files).map(ext=>`<article class="panel file">
    <header><div><div class="fn">${esc(baseName())}.${ext}</div><div class="desc">${FILE_DESC[ext]} · ${files[ext].length} línea(s)</div></div>
    <button class="btn ghost sm" data-copy="${ext}"${files[ext].length?"":" disabled"}>Copiar</button></header>
    ${files[ext].length?`<pre>${esc(files[ext].join("\n"))}</pre>`:`<pre class="empty">Sin registros para este periodo; no se incluye en el ZIP.</pre>`}
  </article>`).join("")}</div>
  <p class="note">Formato: campos separados por «|», montos con punto decimal y 2 decimales, fechas dd/mm/aaaa, texto en mayúsculas, codificación ANSI y fin de línea CRLF. Se envían todos los conceptos de la planilla: ingresos, descuentos, renta de 5ta, AFP (0601/0606/0608), ONP (0607), SIS (0811) y EsSalud (0804).</p>`;
  v._files=files;
}

function renderConf(C){
  const v=$("#v-conf");const st=S.settings;
  const present=new Set();for(const w of C.workers)for(const h in w.r.amounts)if(w.r.amounts[h])present.add(h);
  v.innerHTML=`<div class="grid2">
  <section class="panel"><h3>Columnas del Excel → concepto PLAME (tabla 22)</h3>
    <div class="scroll"><table><thead><tr><th>Columna</th><th>Código</th><th>Concepto</th></tr></thead><tbody>
    ${allConcepts().map(c=>`<tr><td>${esc(c.h)}${c.extra?' <span class="chip warn">nueva</span>':""}${c.regla?' <span class="chip ok">regla de la empresa</span>':""}${(()=>{const x=colMap().find(y=>y.replaces===c.h);return x&&S.sheets.some(sh=>sh.rows.some(r=>x.h in r.amounts))?` <span class="chip info">reemplazada por ${esc(x.h)}</span>`:""})()}${present.has(c.h)?' <span class="chip info">con montos</span>':""}</td><td>${(()=>{const ci=codeInfo(c.h);return `<input data-cc="${esc(c.h)}" value="${esc(ci.code)}" style="width:4.5em;text-align:left" placeholder="—" aria-label="Código ${esc(c.h)}"${ci.src==="titulo"||ci.src==="empresa"?" disabled":""}>${ci.src==="titulo"?' <span class="chip ok">del título</span>':ci.src==="auto"?' <span class="chip info">por nombre</span>':""}`})()}</td><td style="white-space:normal">${esc(codeInfo(c.h).label||c.label)}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="note">Una columna sin código no se exporta y aparece como observación. Para que un concepto no se envíe, deja su código vacío.</p>
  </section>
  <div style="display:flex;flex-direction:column;gap:14px">
  <section class="panel"><h3>Días no laborados (tabla 21)</h3>
    <div class="row">
      <label class="f">Vacaciones<input data-snl="vac" value="${esc(st.snl.vac)}" style="width:4em"></label>
      <label class="f">Faltas con descuento<input data-snl="faltas" value="${esc(st.snl.faltas)}" style="width:4em"></label>
      <label class="f">Licencia / descanso médico<input data-snl="lic" value="${esc(st.snl.lic)}" style="width:4em"></label>
      <label class="f">Otros días sin explicar<input data-snl="otros" value="${esc(st.snl.otros)}" style="width:4em"></label>
    </div>
    <p class="note">20 = enfermedad o accidente (primeros 20 días) · 23 = descanso vacacional · 07 = falta no justificada · 05 = licencia sin goce. Los días antes del alta o después de la baja no se declaran.</p>
  </section>
  <section class="panel"><h3>Jornada</h3>
    <div class="row">
      <label class="f">Lunes a viernes (h)<input type="number" step="0.5" data-j="lv" value="${st.jornada.lv}" style="width:5em"></label>
      <label class="f">Sábado (h)<input type="number" step="0.5" data-j="sab" value="${st.jornada.sab}" style="width:5em"></label>
      <label class="f">Domingo (h)<input type="number" step="0.5" data-j="dom" value="${st.jornada.dom}" style="width:5em"></label>
      <label class="f">Por día no laborado (h)<input type="number" step="0.5" data-j="prom" value="${st.jornada.prom}" style="width:5em"></label>
    </div>
    <label class="f">Feriados de ${MESES[S.month-1].toLowerCase()} (días del mes, separados por coma)<input type="text" data-fer="${S.month}" value="${esc(st.feriados[String(S.month)]||"")}" style="width:12em"></label>
    <p class="note">${(()=>{const j=S.settings.jornada,d=(j.lv>0?5:0)+(j.sab>0?1:0);return `${r2(j.lv*5+j.sab)} h semanales ÷ ${d} días = ${j.prom} h por día no laborado.`})()} Los feriados no se cuentan como horas trabajadas.${empresa().porDefinir?" <b>La jornada de esta empresa está por definir</b>: se usa 8.5 / 5.5 hasta que se confirme.":""}</p>
  </section>
  <section class="panel"><h3>Archivo .4ta</h3>
    <label class="f">Campos 10 y 11 (régimen pensionario del prestador)
      <select data-p4="1"><option value="blank"${st.pens4ta!=="zero"?" selected":""}>Vacíos  …|1|||</option><option value="zero"${st.pens4ta==="zero"?" selected":""}>Indicador 0  …|1|0||</option></select></label>
  </section>
  <button class="btn ghost sm" id="resetConf" style="align-self:flex-start">Restaurar valores por defecto</button>
  </div></div>`;
}

/* ---------- events ---------- */
async function readFile(f){return new Uint8Array(await f.arrayBuffer())}
$("#filePlanilla").addEventListener("change",async e=>{const f=e.target.files[0];if(f)loadWorkbook(await readFile(f),f.name)});
const dz=$("#dropPlanilla");
dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("over")});
dz.addEventListener("dragleave",()=>dz.classList.remove("over"));
dz.addEventListener("drop",async e=>{e.preventDefault();dz.classList.remove("over");const f=e.dataTransfer.files[0];if(f)loadWorkbook(await readFile(f),f.name)});
function setLiqPeriod(m,y){
  if(m)S.month=m;if(y)S.year=y;for(const x of S.sheets)x.month=S.month;
  if(S.rhFromFile){S.rhFromFile.month=S.month;S.rhFromFile.year=S.year;S.rh[sk()]=structuredClone(S.rhFromFile.list);save()}
  S.open={};render();toast(`Periodo: ${MESES[S.month-1].toLowerCase()} ${S.year}`);
}
$("#months").addEventListener("click",e=>{const sb=e.target.closest("button[data-sheet]");if(sb){S.sheetName=sb.dataset.sheet;S.open={};render();return}
  const b=e.target.closest("button[data-m]");if(!b)return;S.month=+b.dataset.m;S.open={};render()});
$("#months").addEventListener("change",e=>{if(e.target.id==="mesSel")setLiqPeriod(+e.target.value,null)});
$("#year").addEventListener("change",e=>{const y=+e.target.value;if(!(y>2000))return;if(S.liq)setLiqPeriod(null,y);else{S.year=y;render()}});
document.querySelector(".tabs").addEventListener("click",e=>{const b=e.target.closest("button[data-tab]");if(!b)return;S.tab=b.dataset.tab;render()});

document.addEventListener("change",async e=>{
  const t=e.target;
  if(t.dataset.ovs){const o=overFor(t.dataset.doc);if(t.value)o[t.dataset.ovs]=t.value;else delete o[t.dataset.ovs];save();render();return}
  if(t.dataset.ov){const o=overFor(t.dataset.doc);const v=t.value===""?null:num(t.value);if(v==null)delete o[t.dataset.ov];else o[t.dataset.ov]=v;save();render();return}
  if(t.dataset.rh){const x=(S.rh[sk()]||[]).find(r=>r.id===t.dataset.id);if(x){x[t.dataset.rh]=t.dataset.rh==="monto"?r2(num(t.value)):t.value.trim();save();render()}return}
  if(t.id==="fileRH"){const f=t.files[0];if(f)importRH(await readFile(f));return}
  if(t.dataset.cc!=null){S.settings.concepts[t.dataset.cc]=t.value.replace(/\D/g,"").slice(0,4);save();render();return}
  if(t.dataset.snl){S.settings.snl[t.dataset.snl]=t.value.replace(/\D/g,"").slice(0,2);save();render();return}
  if(t.dataset.j){S.settings.jornadaManual=true;S.settings.jornada[t.dataset.j]=num(t.value);if(t.dataset.j!=="prom"){const j=S.settings.jornada,d=(j.lv>0?5:0)+(j.sab>0?1:0)+(j.dom>0?1:0);j.prom=d?r2((j.lv*5+j.sab+j.dom)/d):8}save();renderEmpresa();render();return}
  if(t.dataset.fer){S.settings.feriados[t.dataset.fer]=t.value;save();render();return}
  if(t.dataset.p4){S.settings.pens4ta=t.value;save();render();return}
});
document.addEventListener("click",async e=>{
  const t=e.target.closest("button");if(!t)return;
  if(t.dataset.toggle){S.open[t.dataset.toggle]=!S.open[t.dataset.toggle];render();return}
  if(t.dataset.reset){const k=sk();if(S.over[k])delete S.over[k][t.dataset.reset];save();render();return}
  if(t.dataset.rhdel){const k=sk();S.rh[k]=(S.rh[k]||[]).filter(r=>r.id!==t.dataset.rhdel);save();render();return}
  if(t.id==="rhAdd"){const k=sk();(S.rh[k]=S.rh[k]||[]).push({id:Math.random().toString(36).slice(2),tipo:"06",num:"",ap:"",am:"",no:"",serie:"E001",numero:"",monto:0,fe:lastDay(),fp:lastDay(),ret:"1",fuente:"Manual"});save();render();return}
  if(t.id==="rhReset"){delete S.rh[sk()];save();render();toast("Recibos rehechos desde el Excel");return}
  if(t.id==="resetConf"){delete S.settingsBy[S.ruc];useCompany(S.ruc);save();render();toast("Valores por defecto restaurados");return}
  if(t.dataset.copy){const files=$("#v-arch")._files;const txt=files[t.dataset.copy].join("\r\n")+"\r\n";
    try{await navigator.clipboard.writeText(txt);toast("Copiado")}catch(err){const pre=t.closest(".file").querySelector("pre");const s=getSelection();const rg=document.createRange();rg.selectNodeContents(pre);s.removeAllRanges();s.addRange(rg);toast("Texto seleccionado: usa Ctrl+C")}return}
  if(t.id==="dlZip"){await downloadZip();return}
});

async function makeZip(){
  const files=$("#v-arch")._files;const zip=new JSZip();let n=0;
  for(const ext in files){if(!files[ext].length)continue;zip.file(`${baseName()}.${ext}`,cp1252(files[ext].join("\r\n")+"\r\n"));n++}
  if(!n)return null;
  return zip.generateAsync({type:"blob",compression:"DEFLATE"});
}
function resumen(){
  const C=compute();if(!C)return null;const rh=rhList(C);
  return {ruc:S.ruc,empresa:empresa().nombre,periodo:periodKey(),trabajadores:C.workers.length,
    ingresos:r2(C.workers.reduce((s,w)=>s+w.ing,0)),quinta:r2(C.workers.reduce((s,w)=>s+w.quinta,0)),
    recibos:rh.filter(x=>rhIn(x).ok).length,
    observaciones:C.workers.filter(w=>w.alerts.some(a=>a.t!=="info")).length+rh.filter(x=>rhIn(x).ok&&rhAlerts(x).length).length};
}
async function downloadZip(){
  const blob=await makeZip();if(!blob){toast("No hay registros para exportar");return}
  const fname=`PLAME_${empresa().nombre.replace(/[^A-Z0-9]+/gi,"_").replace(/^_|_$/g,"")}_${periodKey()}.zip`;
  try{const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=fname;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)}
  catch(err){toast("No se pudo descargar: usa «Copiar» en cada archivo");return}
  const r=resumen();if(r){r.archivo=fname;INIT.onExport(r)}else toast("ZIP descargado");
}
$("#empresa").addEventListener("change",e=>{useCompany(e.target.value);save();renderEmpresa();S.open={};render();toast(`Empresa: ${empresa().nombre}`)});
$("#year").value=S.year;
renderEmpresa();
render();
return {
  /* Después de crear, editar o eliminar empresas */
  empresasCambiaron(){
    $("#empresa").innerHTML="";
    const r=pickRuc(S.ruc);
    if(r)useCompany(r);else{S.ruc=null;S.settings=null}
    renderEmpresa();S.open={};render();
  },
  /* Abrir el exportador con una empresa elegida desde el panel */
  abrirEmpresa(ruc){
    if(!EMPRESAS.some(e=>e.ruc===ruc))return;
    if(ruc!==S.ruc){useCompany(ruc);save();S.open={}}
    $("#empresa").innerHTML="";renderEmpresa();render();
  },
  /* Quitar de memoria lo guardado de una empresa eliminada */
  olvidarEmpresa(ruc){
    delete S.settingsBy[ruc];
    for(const k of Object.keys(S.over))if(k.startsWith(ruc+"-"))delete S.over[k];
    for(const k of Object.keys(S.rh))if(k.startsWith(ruc+"-"))delete S.rh[k];
  }
};
}

/* ---------- 6. Panel principal ---------- */
const ESTADOS={pendiente:["muted","Pendiente"],generado:["info","Generado"],declarado:["ok","Declarado"],observado:["warn","Observado"]};
const chipEstado=e=>{const [c,t]=ESTADOS[e]||ESTADOS.pendiente;return `<span class="chip ${c}">${t}</span>`};
function periodoPanel(){return `${q("#dashAnio").value}${p2(q("#dashMes").value)}`}
function renderPanel(){
  if(!DB.user)return;
  const per=periodoPanel();
  const act=DB.empresas.filter(e=>e.activa);
  const delPer=DB.exportaciones.filter(x=>x.periodo===per);
  const filas=act.map(e=>({e,x:delPer.find(x=>x.ruc===e.ruc)})).sort((a,b)=>a.e.nombre.localeCompare(b.e.nombre));
  const gen=filas.filter(f=>f.x).length,dec=filas.filter(f=>f.x&&f.x.estado==="declarado").length,obs=filas.filter(f=>f.x&&f.x.estado==="observado").length;
  const ing=delPer.reduce((s,x)=>s+(+x.ingresos||0),0),qui=delPer.reduce((s,x)=>s+(+x.renta_quinta||0),0);
  const pct=n=>act.length?Math.round(n/act.length*100):0;
  q("#dashKpis").innerHTML=`
    <div><div class="eyebrow">Empresas activas</div><div class="v">${act.length}</div><div class="s">${act.filter(e=>e.porDefinir).length} con jornada por definir</div></div>
    <div><div class="eyebrow">Archivos generados</div><div class="v">${gen} / ${act.length}</div><div class="progress"><span style="width:${pct(gen)}%"></span></div></div>
    <div><div class="eyebrow">Declarados</div><div class="v">${dec} / ${act.length}</div><div class="progress"><span style="width:${pct(dec)}%;background:var(--ok)"></span></div></div>
    <div><div class="eyebrow">Ingresos declarados</div><div class="v">${money(ing)}</div><div class="s">${perLabel(per)}</div></div>
    <div><div class="eyebrow">Renta 5ta retenida</div><div class="v">${money(qui)}</div><div class="s">${obs?`${obs} periodo(s) observado(s)`:"Sin periodos observados"}</div></div>`;
  q("#dashAvanceNote").textContent=`${perLabel(per)} · ${act.length-gen} pendiente(s) de generar`;
  const filtro=q("#dashFiltro").value;
  const vis=filas.filter(f=>filtro==="todas"||(filtro==="pendiente"?!f.x:f.x&&f.x.estado===filtro));
  q("#dashTabla").innerHTML=vis.length?vis.map(({e,x})=>`<tr>
    <td class="wrap"><b>${escH(e.nombre)}</b><div class="note mono">${e.ruc}</div></td>
    <td>${chipEstado(x?x.estado:"pendiente")}</td>
    <td class="num">${x?x.trabajadores:"—"}</td>
    <td class="num">${x?money(x.ingresos):"—"}</td>
    <td class="num">${x?money(x.renta_quinta):"—"}</td>
    <td><div class="row" style="gap:8px;flex-wrap:nowrap"><button class="linkbtn" data-abrir="${e.ruc}">Abrir</button>${x&&x.estado!=="declarado"?`<button class="linkbtn" data-declarar="${x.id}">Marcar declarado</button>`:""}</div></td>
  </tr>`).join(""):`<tr class="empty-row"><td colspan="6">No hay empresas en este filtro.</td></tr>`;
  renderGrafico(per);
  const tot=DB.empresas.length;
  const fila=(t,v)=>`<div class="srow"><span>${t}</span><b>${v}</b></div>`;
  q("#dashCartera").innerHTML=fila("Empresas registradas",tot)+fila("Activas",act.length)+fila("Inactivas",tot-act.length)
    +fila("Jornada por definir",DB.empresas.filter(e=>e.porDefinir).length)+fila("Sueldos a 31 días",DB.empresas.filter(e=>e.base31).length)
    +fila("Con regla sueldo bruto / vacaciones",DB.empresas.filter(e=>e.reglaBrutoVac).length)+fila("Exportaciones en el historial",DB.exportaciones.length);
}
function renderGrafico(per){
  const y=+per.slice(0,4),m=+per.slice(4);const pers=[];
  for(let i=11;i>=0;i--){const d=new Date(y,m-1-i,1);pers.push(`${d.getFullYear()}${p2(d.getMonth()+1)}`)}
  const val=pers.map(p=>DB.exportaciones.filter(x=>x.periodo===p).reduce((s,x)=>s+(+x.ingresos||0),0));
  const max=Math.max(...val);
  if(!max){q("#dashChart").innerHTML=`<div class="chart-empty">Aún no hay exportaciones registradas en estos 12 periodos.</div>`;return}
  const W=560,H=230,L=8,B=28,T=22,bw=(W-L*2)/12;
  const corto=v=>v>=1e6?(v/1e6).toFixed(1)+"M":v>=1e3?Math.round(v/1e3)+"k":String(Math.round(v));
  const bars=val.map((v,i)=>{const h=v?Math.max(2,(H-B-T)*v/max):0;const x=L+i*bw+bw*.18,w=bw*.64,yy=H-B-h;const p=pers[i];
    return `<g><title>${perLabel(p)}: S/ ${money(v)}</title><rect class="bar${p===per?" cur":""}" x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2"></rect>
    ${v?`<text class="val" x="${(x+w/2).toFixed(1)}" y="${(yy-5).toFixed(1)}" text-anchor="middle">${corto(v)}</text>`:""}
    <text x="${(x+w/2).toFixed(1)}" y="${H-10}" text-anchor="middle">${MESES_UI[+p.slice(4)-1].slice(0,3)}${p.slice(4)==="01"||i===0?" "+p.slice(2,4):""}</text></g>`}).join("");
  q("#dashChart").innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos declarados por periodo"><line class="axis" x1="${L}" x2="${W-L}" y1="${H-B}" y2="${H-B}"></line>${bars}</svg>`;
}
async function marcarDeclarado(id){
  const {data,error}=await sb.from("exportaciones").update({estado:"declarado"}).eq("id",id).select().single();
  if(error){aviso(mensajeError(error));return}
  const i=DB.exportaciones.findIndex(x=>x.id===id);if(i>=0)DB.exportaciones[i]=data;
  aviso(`${data.empresa}: ${perLabel(data.periodo)} marcado como declarado`);renderPanel();renderHistorial();
}

/* ---------- 7. Empresas ---------- */
function renderEmpresas(){
  if(!DB.user)return;
  const t=q("#empBuscar").value.trim().toUpperCase(),f=q("#empFiltro").value;
  const lista=DB.empresas.filter(e=>{
    if(f==="activas"&&!e.activa)return false;if(f==="inactivas"&&e.activa)return false;
    if(f==="pordefinir"&&!e.porDefinir)return false;if(f==="regla"&&!(e.base31||e.reglaBrutoVac))return false;
    return !t||e.nombre.toUpperCase().includes(t)||e.ruc.includes(t)||e.alias.toUpperCase().includes(t);
  }).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  q("#empConteo").textContent=`${lista.length} de ${DB.empresas.length} empresa(s)`;
  q("#empTabla").innerHTML=lista.length?lista.map(e=>`<tr>
    <td class="mono">${e.ruc}${rucValido(e.ruc)?"":' <span class="chip warn" title="El dígito verificador no coincide">verificar</span>'}</td>
    <td class="wrap" style="min-width:200px"><b>${escH(e.nombre)}</b>${e.nueva?' <span class="chip warn">completar datos</span>':""}</td>
    <td class="wrap">${e.alias?e.alias.split("|").filter(Boolean).map(a=>`<span class="chip muted">${escH(a)}</span>`).join(""):"—"}</td>
    <td class="num">${e.lv==null?"—":e.lv}</td>
    <td class="num">${e.sab==null?"—":e.sab}</td>
    <td class="wrap">${e.porDefinir?'<span class="chip warn">jornada por definir</span>':""}${e.base31?'<span class="chip info">31 días</span>':""}${e.reglaBrutoVac?'<span class="chip info">bruto / vac. pagadas</span>':""}</td>
    <td>${e.activa?'<span class="chip ok">Activa</span>':'<span class="chip muted">Inactiva</span>'}</td>
    <td><div class="row" style="gap:10px;flex-wrap:nowrap"><button class="linkbtn" data-emp-edit="${e.ruc}">Editar</button><button class="linkbtn bad" data-emp-del="${e.ruc}">Eliminar</button></div></td>
  </tr>`).join(""):`<tr class="empty-row"><td colspan="8">${DB.empresas.length?"Ninguna empresa coincide con la búsqueda.":"Aún no hay empresas. Usa «+ Nueva empresa»."}</td></tr>`;
}
let empEditando=null,empConfirmarRuc=false;
function abrirFormEmpresa(ruc){
  const f=q("#formEmpresa");limpiarErrores(f);q("#feAviso").hidden=true;empConfirmarRuc=false;
  const e=ruc?DB.empresas.find(x=>x.ruc===ruc):null;empEditando=e;
  q("#dlgEmpTitulo").textContent=e?"Editar empresa":"Nueva empresa";
  q("#feRuc").value=e?e.ruc:"";q("#feRuc").disabled=!!e;
  q("#feNombre").value=e?(e.nueva&&/^RUC \d{11}$/.test(e.nombre)?"":e.nombre):"";
  q("#feAlias").value=e?e.alias:"";q("#feLv").value=e&&e.lv!=null?e.lv:"";q("#feSab").value=e&&e.sab!=null?e.sab:"";
  q("#feBase31").checked=!!(e&&e.base31);q("#feRegla").checked=!!(e&&e.reglaBrutoVac);q("#feActiva").value=!e||e.activa?"1":"0";
  q("#feGuardar").textContent="Guardar empresa";
  q("#dlgEmpresa").showModal();(e?q("#feNombre"):q("#feRuc")).focus();
}
async function guardarEmpresa(ev){
  ev.preventDefault();const f=q("#formEmpresa");limpiarErrores(f);
  const ruc=q("#feRuc").value.replace(/\D/g,""),nombre=q("#feNombre").value.trim().replace(/\s+/g," ").toUpperCase();
  const alias=q("#feAlias").value.split("|").map(x=>x.trim().toUpperCase()).filter(Boolean).join("|");
  const lvT=q("#feLv").value.trim(),sabT=q("#feSab").value.trim();let ok=true;
  if(!empEditando){
    if(!/^\d{11}$/.test(ruc)){marcarError(f,"ruc","El RUC debe tener 11 dígitos.");ok=false}
    else if(DB.empresas.some(e=>e.ruc===ruc)){marcarError(f,"ruc","Ya existe una empresa con este RUC.");ok=false}
  }
  if(!nombre){marcarError(f,"nombre","Escribe la razón social.");ok=false}
  const horas=(t,c)=>{if(t==="")return null;const v=+t;if(!isFinite(v)||v<0||v>24){marcarError(f,c,"Debe estar entre 0 y 24 horas.");ok=false;return null}return v};
  const lv=horas(lvT,"lv"),sab=horas(sabT,"sab");
  if(lvT===""&&sabT!==""){marcarError(f,"lv","Completa también las horas de lunes a viernes, o deja ambas vacías.");ok=false}
  if(!ok)return;
  if(!empEditando&&!rucValido(ruc)&&!empConfirmarRuc){
    empConfirmarRuc=true;const a=q("#feAviso");a.hidden=false;
    a.textContent="El dígito verificador de este RUC no coincide. Revisa el número; si es correcto, vuelve a pulsar «Guardar de todos modos».";
    q("#feGuardar").textContent="Guardar de todos modos";return;
  }
  const datos={ruc:empEditando?empEditando.ruc:ruc,nombre,alias,lv,sab,base31:q("#feBase31").checked,reglaBrutoVac:q("#feRegla").checked,activa:q("#feActiva").value==="1"};
  const btn=q("#feGuardar");btn.disabled=true;
  try{
    const fila=filaDeEmp(datos);
    const {data,error}=empEditando
      ?await sb.from("empresas").update(fila).eq("ruc",datos.ruc).select().single()
      :await sb.from("empresas").insert(fila).select().single();
    if(error)throw error;
    const nueva=empDeFila(data);
    if(empEditando)Object.assign(empEditando,nueva,{nueva:false});else DB.empresas.push(nueva);
    q("#dlgEmpresa").close();
    aviso(empEditando?`Se actualizó ${nueva.nombre}`:`Se registró ${nueva.nombre}`);
    ENGINE.empresasCambiaron();renderEmpresas();renderPanel();renderFiltrosHistorial();
  }catch(err){const a=q("#feAviso");a.hidden=false;a.textContent=mensajeError(err)}
  finally{btn.disabled=false}
}
async function eliminarEmpresa(ruc){
  const e=DB.empresas.find(x=>x.ruc===ruc);if(!e)return;
  const ok=await confirmar("Eliminar empresa",`Se eliminará ${e.nombre} (RUC ${e.ruc}) junto con su configuración de conceptos y jornada, y las correcciones guardadas de todos sus periodos. El historial de exportaciones se conserva. Esta acción no se puede deshacer. Si solo quieres ocultarla, edítala y márcala como inactiva.`,"Eliminar empresa");
  if(!ok)return;
  await guardarAhora();
  const {error}=await sb.from("empresas").delete().eq("ruc",ruc);
  if(error){aviso(mensajeError(error));return}
  DB.empresas.splice(DB.empresas.indexOf(e),1);
  ENGINE.olvidarEmpresa(ruc);olvidarSnapshot(ruc);ENGINE.empresasCambiaron();
  aviso(`Se eliminó ${e.nombre}`);renderEmpresas();renderPanel();renderFiltrosHistorial();
}

/* ---------- 8. Historial ---------- */
function renderFiltrosHistorial(){
  const se=q("#histEmpresa"),va=se.value;
  const rucs=[...new Map([...DB.exportaciones.map(x=>[x.ruc,x.empresa]),...DB.empresas.map(e=>[e.ruc,e.nombre])])].sort((a,b)=>a[1].localeCompare(b[1]));
  se.innerHTML=`<option value="">Todas</option>`+rucs.map(([r,n])=>`<option value="${r}">${escH(n)}</option>`).join("");se.value=rucs.some(([r])=>r===va)?va:"";
  const sa=q("#histAnio"),vy=sa.value;
  const anios=[...new Set(DB.exportaciones.map(x=>x.periodo.slice(0,4)))].sort().reverse();
  sa.innerHTML=`<option value="">Todos</option>`+anios.map(a=>`<option>${a}</option>`).join("");sa.value=anios.includes(vy)?vy:"";
}
function historialFiltrado(){
  const t=q("#histBuscar").value.trim().toUpperCase(),r=q("#histEmpresa").value,a=q("#histAnio").value,e=q("#histEstado").value;
  return DB.exportaciones.filter(x=>(!r||x.ruc===r)&&(!a||x.periodo.startsWith(a))&&(!e||x.estado===e)
    &&(!t||x.empresa.toUpperCase().includes(t)||x.ruc.includes(t)||String(x.nota||"").toUpperCase().includes(t)))
    .sort((a,b)=>b.periodo.localeCompare(a.periodo)||a.empresa.localeCompare(b.empresa));
}
function renderHistorial(){
  if(!DB.user)return;
  const l=historialFiltrado();
  q("#histConteo").textContent=`${l.length} registro(s)`;
  q("#histTabla").innerHTML=l.length?l.map(x=>`<tr>
    <td class="mono">${perCorto(x.periodo)}</td>
    <td class="wrap" style="min-width:180px"><b>${escH(x.empresa)}</b><div class="note mono">${x.ruc}</div></td>
    <td class="num">${x.trabajadores}</td><td class="num">${money(x.ingresos)}</td><td class="num">${money(x.renta_quinta)}</td>
    <td class="num">${x.recibos}</td><td class="num">${x.observaciones}</td>
    <td>${chipEstado(x.estado)}</td>
    <td class="wrap" style="min-width:140px;max-width:260px">${escH(x.nota||"")||'<span class="note">—</span>'}</td>
    <td class="note">${fechaHora(x.actualizado_en)}</td>
    <td><div class="row" style="gap:10px;flex-wrap:nowrap"><button class="linkbtn" data-hist-edit="${x.id}">Editar</button><button class="linkbtn bad" data-hist-del="${x.id}">Eliminar</button></div></td>
  </tr>`).join(""):`<tr class="empty-row"><td colspan="11">${DB.exportaciones.length?"Ningún registro coincide con los filtros.":"Aún no hay exportaciones. Se registran solas al descargar el ZIP en «Exportar PLAME»."}</td></tr>`;
  const s=k=>l.reduce((a,x)=>a+(+x[k]||0),0);
  q("#histPie").innerHTML=l.length?`<tr><th colspan="2">Totales de la selección</th><th class="num">${s("trabajadores")}</th><th class="num">${money(s("ingresos"))}</th><th class="num">${money(s("renta_quinta"))}</th><th class="num">${s("recibos")}</th><th class="num">${s("observaciones")}</th><th colspan="4"></th></tr>`:"";
}
let histEditando=null;
function abrirFormHist(id){
  const f=q("#formHist");limpiarErrores(f);
  const x=id?DB.exportaciones.find(r=>r.id===id):null;histEditando=x;
  q("#dlgHistTitulo").textContent=x?"Editar registro":"Registro manual";
  const se=q("#fhEmpresa");
  se.innerHTML=`<option value="">Elige la empresa</option>`+DB.empresas.slice().sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(e=>`<option value="${e.ruc}">${escH(e.nombre)} · ${e.ruc}</option>`).join("")
    +(x&&!DB.empresas.some(e=>e.ruc===x.ruc)?`<option value="${x.ruc}">${escH(x.empresa)} · ${x.ruc}</option>`:"");
  const hoy=new Date(),prev=new Date(hoy.getFullYear(),hoy.getMonth()-1,1);
  se.value=x?x.ruc:"";se.disabled=!!x;
  q("#fhMes").value=x?+x.periodo.slice(4):prev.getMonth()+1;q("#fhMes").disabled=!!x;
  q("#fhAnio").value=x?x.periodo.slice(0,4):prev.getFullYear();q("#fhAnio").disabled=!!x;
  q("#fhTrab").value=x?x.trabajadores:0;q("#fhRec").value=x?x.recibos:0;q("#fhIng").value=x?x.ingresos:"0.00";q("#fhQuinta").value=x?x.renta_quinta:"0.00";
  q("#fhObs").value=x?x.observaciones:0;q("#fhEstado").value=x?x.estado:"declarado";q("#fhNota").value=x?x.nota||"":"";
  q("#fhAyuda").textContent=x?"La empresa y el periodo no se pueden cambiar; si se registró mal, elimínalo y crea otro.":"Los registros se crean solos al descargar el ZIP. Usa el registro manual para periodos declarados fuera de la herramienta.";
  q("#dlgHist").showModal();
}
async function guardarHist(ev){
  ev.preventDefault();const f=q("#formHist");limpiarErrores(f);let ok=true;
  const ruc=q("#fhEmpresa").value,anio=+q("#fhAnio").value,mes=+q("#fhMes").value;
  if(!ruc){marcarError(f,"empresa","Elige una empresa.");ok=false}
  if(!(anio>=2020&&anio<=2099)){marcarError(f,"anio","Año entre 2020 y 2099.");ok=false}
  const entero=(id,c)=>{const v=+q(id).value;if(!Number.isInteger(v)||v<0){marcarError(f,c,"Número entero mayor o igual a 0.");ok=false}return v};
  const monto=(id,c)=>{const v=Math.round(+q(id).value*100)/100;if(!isFinite(v)||v<0||q(id).value===""){marcarError(f,c,"Monto mayor o igual a 0.");ok=false}return v};
  const fila={trabajadores:entero("#fhTrab","trab"),recibos:entero("#fhRec","rec"),ingresos:monto("#fhIng","ing"),renta_quinta:monto("#fhQuinta","quinta"),
    observaciones:Math.max(0,Math.round(+q("#fhObs").value||0)),estado:q("#fhEstado").value,nota:q("#fhNota").value.trim().slice(0,300)};
  const periodo=`${anio}${p2(mes)}`;
  if(ok&&!histEditando&&DB.exportaciones.some(x=>x.ruc===ruc&&x.periodo===periodo)){marcarError(f,"empresa",`Ya hay un registro de esta empresa para ${perLabel(periodo)}: edítalo en la tabla.`);ok=false}
  if(!ok)return;
  let res;
  if(histEditando)res=await sb.from("exportaciones").update(fila).eq("id",histEditando.id).select().single();
  else{const e=DB.empresas.find(x=>x.ruc===ruc);res=await sb.from("exportaciones").insert({...fila,ruc,periodo,empresa:e?e.nombre:ruc,archivo:"(registro manual)"}).select().single()}
  if(res.error){aviso(mensajeError(res.error));return}
  const i=DB.exportaciones.findIndex(x=>x.id===res.data.id);if(i>=0)DB.exportaciones[i]=res.data;else DB.exportaciones.push(res.data);
  q("#dlgHist").close();aviso(histEditando?"Registro actualizado":"Registro agregado");
  renderFiltrosHistorial();renderHistorial();renderPanel();
}
async function eliminarHist(id){
  const x=DB.exportaciones.find(r=>r.id===id);if(!x)return;
  if(!await confirmar("Eliminar registro",`Se eliminará del historial la exportación de ${x.empresa} de ${perLabel(x.periodo)}. Los archivos ya descargados no se ven afectados. Esta acción no se puede deshacer.`,"Eliminar registro"))return;
  const {error}=await sb.from("exportaciones").delete().eq("id",id);
  if(error){aviso(mensajeError(error));return}
  DB.exportaciones.splice(DB.exportaciones.indexOf(x),1);aviso("Registro eliminado");
  renderFiltrosHistorial();renderHistorial();renderPanel();
}
function csvHistorial(){
  const l=historialFiltrado();if(!l.length){aviso("No hay registros para el reporte");return}
  const c=v=>{const s=String(v??"");return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s};
  const filas=[["Periodo","RUC","Empresa","Trabajadores","Ingresos","Renta 5ta","Recibos 4ta","Observaciones","Estado","Nota","Archivo","Actualizado"]]
    .concat(l.map(x=>[perCorto(x.periodo),x.ruc,x.empresa,x.trabajadores,(+x.ingresos).toFixed(2),(+x.renta_quinta).toFixed(2),x.recibos,x.observaciones,ESTADOS[x.estado][1],x.nota||"",x.archivo,fechaHora(x.actualizado_en)]));
  descargar(new Blob(["﻿"+filas.map(r=>r.map(c).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"}),`historial_plame_${new Date().toISOString().slice(0,10)}.csv`);
}

/* ---------- 9. Configuración ---------- */
function aplicarTema(){const t=prefs().tema||"auto";if(t==="auto")document.documentElement.removeAttribute("data-theme");else document.documentElement.dataset.theme=t;q("#cfgTema").value=t}
async function copiaSeguridad(){
  try{
    const [emp,cfg,aj,exp]=await Promise.all([traerTodo("empresas","*","ruc"),traerTodo("configuracion_empresa","*","ruc"),traerTodo("ajustes_periodo","*","ruc"),traerTodo("exportaciones","*","id")]);
    descargar(new Blob([JSON.stringify({generado:new Date().toISOString(),version:APP_VERSION,empresas:emp,configuracion_empresa:cfg,ajustes_periodo:aj,exportaciones:exp},null,2)],{type:"application/json"}),`copia_plame_${new Date().toISOString().slice(0,10)}.json`);
    aviso("Copia de seguridad descargada");
  }catch(err){aviso(mensajeError(err))}
}
async function cambiarClave(ev){
  ev.preventDefault();const a=q("#pwNew").value,b=q("#pwNew2").value,e=q("#pwErr");e.hidden=true;
  const err=m=>{e.textContent=m;e.hidden=false};
  if(a.length<8)return err("La contraseña debe tener al menos 8 caracteres.");
  if(!/[A-Za-z]/.test(a)||!/\d/.test(a))return err("Usa letras y números.");
  if(a!==b)return err("Las contraseñas no coinciden.");
  const {error}=await sb.auth.updateUser({password:a});
  if(error)return err(/different from the old/i.test(error.message)?"La nueva contraseña debe ser distinta de la actual.":mensajeError(error));
  q("#pwForm").reset();aviso("Contraseña actualizada");
}

/* ---------- 10. Sesión, navegación e inicio ---------- */
function irA(sec){
  if(!q("#sec-"+sec))sec="panel";
  qa(".main>.section").forEach(s=>s.hidden=s.id!=="sec-"+sec);
  qa(".nav button").forEach(b=>{if(b.dataset.sec===sec)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  q("#sidebar").classList.remove("open");q("#menuToggle").setAttribute("aria-expanded","false");
  if(location.hash!=="#"+sec)history.replaceState(null,"","#"+sec);
  window.scrollTo(0,0);
}
function mostrarLogin(msg,tipo){
  q("#boot").hidden=true;q("#app").hidden=true;q("#login").hidden=false;
  const e=q("#loginErr");if(msg){e.textContent=msg;e.className="alertbox "+(tipo||"bad");e.hidden=false}else e.hidden=true;
  if(!configurado){q("#configErr").hidden=false;q("#loginBtn").disabled=true}
  else setTimeout(()=>q("#loginEmail").focus(),0);
}
async function cerrarSesion(motivo){
  try{await guardarAhora()}catch(e){}
  if(motivo)try{sessionStorage.setItem("plame-motivo",motivo)}catch(e){}
  saliendo=true;await sb.auth.signOut().catch(()=>{});location.replace(location.pathname);
}
let saliendo=false,ultimaActividad=Date.now();
function vigilarInactividad(){
  ["pointerdown","keydown","wheel","touchstart"].forEach(ev=>addEventListener(ev,()=>{ultimaActividad=Date.now()},{passive:true}));
  setInterval(()=>{const min=+(prefs().inactividad??30);if(DB.user&&min>0&&Date.now()-ultimaActividad>min*60000)cerrarSesion("Tu sesión se cerró por inactividad. Vuelve a ingresar.")},30000);
}
async function entrar(session){
  DB.user=session.user;q("#boot").hidden=false;q("#login").hidden=true;
  try{
    const [emp,cfg,aj,exp]=await Promise.all([traerTodo("empresas","*","ruc"),traerTodo("configuracion_empresa","ruc,ajustes","ruc"),traerTodo("ajustes_periodo","ruc,periodo,correcciones,recibos","ruc"),traerTodo("exportaciones","*","id")]);
    DB.empresas.splice(0,DB.empresas.length,...emp.map(empDeFila));
    DB.exportaciones=exp;
    const saved={ruc:prefs().ruc,settingsBy:{},over:{},rh:{}};
    for(const c of cfg){saved.settingsBy[c.ruc]=c.ajustes;snap.cfg[c.ruc]=JSON.stringify(c.ajustes)}
    for(const a of aj){const k=`${a.ruc}-${a.periodo}`;if(a.correcciones!=null)saved.over[k]=a.correcciones;if(a.recibos!=null)saved.rh[k]=a.recibos;snap.per[k]=JSON.stringify({o:a.correcciones??null,r:a.recibos??null})}
    if(!ENGINE)ENGINE=startEngine({empresas:DB.empresas,saved,onSave:S=>{setPref("ruc",S.ruc);programarGuardado(S)},onNewEmpresa:altaDesdeExcel,onExport:registrarExportacion});
  }catch(err){
    DB.user=null;await sb.auth.signOut().catch(()=>{});
    mostrarLogin("Ingresaste, pero no se pudo leer la base de datos: "+mensajeError(err));return;
  }
  q("#userEmail").textContent=DB.user.email;q("#cfgEmail").textContent=DB.user.email;
  q("#cfgUltimo").textContent=fechaHora(DB.user.last_sign_in_at);q("#cfgDb").textContent=new URL(SUPABASE_URL).host;
  q("#boot").hidden=true;q("#app").hidden=false;
  renderPanel();renderEmpresas();renderFiltrosHistorial();renderHistorial();
  irA(location.hash.slice(1)||"panel");
  ultimaActividad=Date.now();
}
function enlazarEventos(){
  /* inicio de sesión */
  q("#togglePass").addEventListener("click",()=>{const p=q("#loginPass"),v=p.type==="password";p.type=v?"text":"password";q("#togglePass").textContent=v?"Ocultar":"Mostrar";q("#togglePass").setAttribute("aria-label",v?"Ocultar contraseña":"Mostrar contraseña")});
  q("#loginForm").addEventListener("submit",async ev=>{
    ev.preventDefault();if(!configurado)return;
    const email=q("#loginEmail").value.trim(),pass=q("#loginPass").value,e=q("#loginErr");e.hidden=true;
    q("#loginEmail").removeAttribute("aria-invalid");q("#loginPass").removeAttribute("aria-invalid");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){q("#loginEmail").setAttribute("aria-invalid","true");e.textContent="Escribe tu usuario completo (correo electrónico).";e.className="alertbox bad";e.hidden=false;return}
    if(!pass){q("#loginPass").setAttribute("aria-invalid","true");e.textContent="Escribe tu contraseña.";e.className="alertbox bad";e.hidden=false;return}
    const b=q("#loginBtn");b.disabled=true;b.textContent="Verificando…";
    const {data,error}=await sb.auth.signInWithPassword({email,password:pass});
    b.disabled=false;b.textContent="Ingresar";
    if(error){
      const m=error.message||"";
      e.textContent=/Invalid login credentials/i.test(m)?"Usuario o contraseña incorrectos.":/Email not confirmed/i.test(m)?"Este usuario aún no está confirmado. En Supabase márcalo como confirmado (Auto Confirm User).":error.status===429?"Demasiados intentos. Espera unos minutos e inténtalo de nuevo.":mensajeError(error);
      e.className="alertbox bad";e.hidden=false;q("#loginPass").select();return;
    }
    q("#loginPass").value="";await entrar(data.session);
  });
  /* navegación */
  q("#nav").addEventListener("click",e=>{const b=e.target.closest("button[data-sec]");if(b)irA(b.dataset.sec)});
  q("#menuToggle").addEventListener("click",()=>{const s=q("#sidebar");const o=s.classList.toggle("open");q("#menuToggle").setAttribute("aria-expanded",String(o))});
  addEventListener("hashchange",()=>{if(DB.user)irA(location.hash.slice(1))});
  document.addEventListener("click",e=>{
    const g=e.target.closest("[data-go]");if(g){irA(g.dataset.go);return}
    const c=e.target.closest("[data-close]");if(c){c.closest("dialog").close();return}
    const ab=e.target.closest("[data-abrir]");if(ab){ENGINE.abrirEmpresa(ab.dataset.abrir);irA("exportar");return}
    const de=e.target.closest("[data-declarar]");if(de){marcarDeclarado(+de.dataset.declarar);return}
    const ee=e.target.closest("[data-emp-edit]");if(ee){abrirFormEmpresa(ee.dataset.empEdit);return}
    const ed=e.target.closest("[data-emp-del]");if(ed){eliminarEmpresa(ed.dataset.empDel);return}
    const he=e.target.closest("[data-hist-edit]");if(he){abrirFormHist(+he.dataset.histEdit);return}
    const hd=e.target.closest("[data-hist-del]");if(hd){eliminarHist(+hd.dataset.histDel);return}
  });
  q("#logoutBtn").addEventListener("click",()=>cerrarSesion());
  q("#cfgLogout").addEventListener("click",()=>cerrarSesion());
  /* panel */
  q("#dashMes").innerHTML=MESES_UI.map((m,i)=>`<option value="${i+1}">${m}</option>`).join("");
  const prev=new Date(new Date().getFullYear(),new Date().getMonth()-1,1);
  q("#dashMes").value=prev.getMonth()+1;q("#dashAnio").value=prev.getFullYear();
  ["#dashMes","#dashAnio","#dashFiltro"].forEach(s=>q(s).addEventListener("change",renderPanel));
  /* empresas */
  q("#empNueva").addEventListener("click",()=>abrirFormEmpresa(null));
  q("#empBuscar").addEventListener("input",renderEmpresas);q("#empFiltro").addEventListener("change",renderEmpresas);
  q("#formEmpresa").addEventListener("submit",guardarEmpresa);
  q("#feRuc").addEventListener("input",()=>{empConfirmarRuc=false;q("#feAviso").hidden=true;q("#feGuardar").textContent="Guardar empresa"});
  /* historial */
  q("#fhMes").innerHTML=MESES_UI.map((m,i)=>`<option value="${i+1}">${m}</option>`).join("");
  q("#histNuevo").addEventListener("click",()=>abrirFormHist(null));
  q("#histCsv").addEventListener("click",csvHistorial);
  q("#histBuscar").addEventListener("input",renderHistorial);
  ["#histEmpresa","#histAnio","#histEstado"].forEach(s=>q(s).addEventListener("change",renderHistorial));
  q("#formHist").addEventListener("submit",guardarHist);
  /* configuración */
  q("#cfgTema").addEventListener("change",e=>{setPref("tema",e.target.value);aplicarTema()});
  q("#cfgInact").value=String(prefs().inactividad??30);
  q("#cfgInact").addEventListener("change",e=>setPref("inactividad",+e.target.value));
  q("#cfgBackup").addEventListener("click",copiaSeguridad);
  q("#pwForm").addEventListener("submit",cambiarClave);
}
async function iniciar(){
  aplicarTema();enlazarEventos();vigilarInactividad();
  let motivo=null;try{motivo=sessionStorage.getItem("plame-motivo");sessionStorage.removeItem("plame-motivo")}catch(e){}
  if(!configurado){mostrarLogin();return}
  if(!window.supabase||!window.XLSX||!window.JSZip){mostrarLogin("No se pudieron cargar las librerías necesarias. Revisa tu conexión a internet y recarga la página.");return}
  sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  sb.auth.onAuthStateChange(ev=>{if(ev==="SIGNED_OUT"&&DB.user&&!saliendo){saliendo=true;location.replace(location.pathname)}});
  const {data}=await sb.auth.getSession();
  if(data&&data.session)await entrar(data.session);
  else mostrarLogin(motivo,"info");
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",iniciar);else iniciar();
})();
