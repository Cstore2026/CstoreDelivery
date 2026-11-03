import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js';
import { getFirestore, collection, doc, getDocs, getDoc, addDoc, updateDoc, setDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js';
import { firebaseConfig, googleMapsApiKey } from './config.js';
import { normalizePricing, validatePricing, calculateDeliveryCost } from './pricing.mjs';

// Shared logins. Only these three emails have access; enforced again by firestore.rules.
const EMAIL_ROLES = Object.freeze({
  'admin@cstore.com': 'admin',
  'callcenter@cstore.com': 'supervisor',
  'view@cstore.com': 'employee'
});
const ROLE_LABELS = { admin: 'Admin', supervisor: 'مشرف الكول سنتر', employee: 'موظف الكول سنتر' };
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
};
const number = x => new Intl.NumberFormat('ar-EG', {maximumFractionDigits: 2}).format(x);
const distanceText = meters => Number.isFinite(meters) ? `${number(meters / 1000)} كم` : '—';
const durationText = millis => Number.isFinite(millis) ? `${Math.ceil(millis / 60000)} دقيقة تقريبًا` : '—';
const errorText = e => e?.code === 'permission-denied' ? 'ليس لديك صلاحية لتنفيذ العملية؛ راجع قواعد Firestore.' : 'العملية لم تنجح. راجع إعدادات Firebase أو الإنترنت.';
let role = null;
let branches = [];
let pricing = normalizePricing();
let unsubs = [];
let locationMethod = 'address';
let customerCoords = null;
let addressQuerySerial = 0;
let predictionsSerial = 0;
let placesSession = null;
let autoCompleteTimeout;
let mapPromise = null;
let mapInstance = null;
let customerMarker = null;
let branchMarker = null;
let shownPolyline = null;
let lastRouteResults = [];
let calcSerial = 0;
let selectedBranchId = null;
let editingPricing = false;
let authEpoch = 0;

function setMessage(type, message) { const n = $('messageBox'); n.className = `alert ${type}`; n.textContent = message; }
function refreshCopyLocationButton() {
  // Copy only the customer drop-off point, never a branch or map viewport center.
  const btn = $('copyCustomerLocationButton');
  btn.disabled = !customerCoords || !$('locationConfirmed').checked;
}
async function copyCustomerLocation() {
  if (!customerCoords || !$('locationConfirmed').checked) {
    setMessage('warn', 'حدد موقع التسليم وأكده مع العميل قبل نسخ اللوكيشن.');
    return;
  }
  const link = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${customerCoords.lat.toFixed(7)},${customerCoords.lng.toFixed(7)}`)}`;
  try {
    await navigator.clipboard.writeText(link);
    setMessage('ok', 'تم نسخ رابط موقع العميل. الصقه في واتساب أو أي رسالة للطيار.');
  } catch (e) {
    console.warn('Clipboard was not available:', e);
    // If permission to use the clipboard is blocked, keep the link accessible.
    window.prompt('النسخ التلقائي مش متاح؛ انسخ الرابط ده يدويًا:', link);
    setMessage('warn', 'لو لم يتم النسخ تلقائيًا، انسخ رابط الموقع من النافذة التي ظهرت.');
  }
}
function loginMessage(type, message) { const n = $('loginMessage'); n.className = `alert ${type}`; n.textContent = message; }
function normalizeCoord(obj) {
  if (!obj) return null;
  const lat = Number(obj.lat), lng = Number(obj.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? {lat, lng} : null;
}
const isArchived = b => b.archived === true;
const isEnabled = b => b.enabled !== false; // Legacy branches predate the enabled field; only NEW branches start false.
const isOpen = b => b.isOpen !== false;
const isEligible = b => !isArchived(b) && isEnabled(b) && isOpen(b) && !!normalizeCoord(b);
const activeBranches = () => branches.filter(isEligible);
const branchStatus = b => isArchived(b) ? 'مؤرشف' : !isEnabled(b) ? 'لم يُفعّل بعد' : isOpen(b) ? 'مفتوح' : 'مغلق';
function branchOrder(a,b) { return String(a.name || '').localeCompare(String(b.name || ''),'ar'); }
function resetResult(message = 'هنا هتشوف المسافة والتكلفة من كل فرع بعد البحث.') {
  calcSerial++;
  lastRouteResults = [];
  selectedBranchId = null;
  $('distanceContent').textContent = 'بعد الحساب سيظهر أقرب فرع مفتوح ومسافة الطريق الفعلية.';
  $('costContent').textContent = 'بعد التأكيد والحساب ستظهر تكلفة التوصيل.';
  $('allBranchesResults').textContent = message;
  removeRouteDrawing();
}
function invalidateCustomer() {
  customerCoords = null;
  $('locationConfirmed').checked = false;
  refreshCopyLocationButton();
  $('addressReview').classList.add('hidden');
  if (customerMarker) { customerMarker.setMap(null); customerMarker = null; }
  $('mapLocationStatus').textContent = 'الخريطة تظهر بعد تحديد الموقع';
  $('addressMatches').classList.add('hidden');
  $('streetSuggestions').classList.add('hidden');
  resetResult();
}

function updateRoleView() {
  $('userRoleBadge').textContent = ROLE_LABELS[role] || 'غير مسجل';
  $('adminPanel').classList.toggle('active', role === 'admin');
  $('supervisorPanel').classList.toggle('hidden', role !== 'supervisor');
  $('branchesCountBadge').textContent = `${activeBranches().length} / ${branches.filter(b => !isArchived(b)).length} فروع متاحة`;
  if (role === 'admin') renderAdminBranches();
  if (role === 'supervisor') renderSupervisorBranches();
}
function updateBranchAndPricing() {
  updateRoleView();
  resetResult('تم تحديث حالة الفروع أو التسعير؛ اضغط حساب مرة ثانية لعرض أسعار حديثة.');
}

function adminBranchCard(b) {
  const root = make('div','admin-item');
  const header = make('div','admin-head');
  header.append(make('strong','',b.name || 'فرع بلا اسم'), make('span','status',branchStatus(b)));
  const fields = make('div','admin-grid triple');
  const inputs = {};
  for (const [key,label,type] of [['name','اسم الفرع','text'],['lat','Latitude','number'],['lng','Longitude','number']]) {
    const wrap=make('div','field'); const l=make('label','',label); const input=make('input');
    input.type=type; if(type==='number')input.step='any'; input.value=b[key] ?? ''; input.setAttribute('aria-label', label);
    wrap.append(l,input); fields.append(wrap); inputs[key]=input;
  }
  const actions = make('div','btn-row');
  const save = make('button','btn secondary','حفظ الاسم والإحداثيات'); save.type='button';
  save.addEventListener('click', async () => {
    const pos = normalizeCoord({lat:inputs.lat.value,lng:inputs.lng.value});
    if (!inputs.name.value.trim() || !pos || !inputs.lat.value || !inputs.lng.value) { setMessage('warn','اسم الفرع والإحداثيات الصحيحة مطلوبين.'); return; }
    await safeWrite(() => updateDoc(doc(db,'branches',b.id),{name:inputs.name.value.trim(), ...pos}), 'تم حفظ بيانات الفرع.');
  });
  actions.append(save);
  if (!isArchived(b)) {
    const enable = make('button','btn secondary',isEnabled(b) ? 'إلغاء تفعيل الفرع' : 'تفعيل الفرع لأول مرة'); enable.type='button';
    enable.addEventListener('click', async () => {
      if (isEnabled(b) && !window.confirm('إلغاء تفعيل الفرع هيقفله كمان. متأكد؟')) return;
      await safeWrite(() => updateDoc(doc(db,'branches',b.id),{enabled:!isEnabled(b),isOpen:false}), 'تم تحديث تفعيل الفرع (مغلق حتى يتم فتحه يدويًا).');
    });
    const open = make('button','btn secondary',isOpen(b) && isEnabled(b) ? 'قفل الفرع' : 'فتح الفرع'); open.type='button';
    open.disabled = !isEnabled(b);
    open.addEventListener('click', async () => safeWrite(() => updateDoc(doc(db,'branches',b.id),{isOpen:!isOpen(b)}), 'تم تغيير حالة الفرع.'));
    const archive = make('button','btn secondary danger','أرشفة الفرع'); archive.type='button';
    archive.addEventListener('click', async () => {
      if (!window.confirm(`تأكيد أرشفة ${b.name}؟ مش هيظهر في الحساب بعد كده.`)) return;
      await safeWrite(() => updateDoc(doc(db,'branches',b.id),{archived:true,enabled:false,isOpen:false}), 'تمت أرشفة الفرع.');
    });
    actions.append(enable,open,archive);
  } else {
    const restore = make('button','btn secondary','استعادة الفرع كمغلق وغير مفعّل'); restore.type='button';
    restore.addEventListener('click', async () => safeWrite(() => updateDoc(doc(db,'branches',b.id),{archived:false,enabled:false,isOpen:false}), 'تمت استعادة الفرع.'));
    actions.append(restore);
  }
  root.append(header,fields,actions);return root;
}
function renderAdminBranches() {
  const host=$('adminBranchesForm'); host.replaceChildren();
  branches.slice().sort(branchOrder).forEach(b => host.append(adminBranchCard(b)));
  if (!branches.length) host.append(make('p','muted','لا توجد فروع في Firebase حتى الآن.'));
}
function renderSupervisorBranches() {
  const host=$('supervisorBranches'); host.replaceChildren();
  for (const b of branches.slice().sort(branchOrder).filter(b=>!isArchived(b))) {
    const row=make('div','branch-status-row');
    const label=make('div'); label.append(make('strong','',b.name),make('span','small',` — ${branchStatus(b)}`));
    const action=make('button',isOpen(b)&&isEnabled(b)?'btn secondary':'btn primary',isOpen(b)&&isEnabled(b)?'قفل الفرع':'فتح الفرع');
    action.type='button'; action.disabled=!isEnabled(b);
    action.title=!isEnabled(b)?'الأدمن لازم يفعّل الفرع أولاً':'';
    action.addEventListener('click',async()=>safeWrite(()=>updateDoc(doc(db,'branches',b.id),{isOpen:!isOpen(b)}),'تم حفظ حالة الفرع.'));
    row.append(label,action); host.append(row);
  }
}
async function safeWrite(action,success) {
  if (!['admin','supervisor'].includes(role)) return;
  try { await action(); setMessage('ok',success); } catch(e) {console.error(e);setMessage('warn',errorText(e));}
}
async function addBranch(ev) {
  ev.preventDefault(); if(role!=='admin')return;
  const name=$('newBranchName').value.trim();
  const latInput=$('newBranchLat').value, lngInput=$('newBranchLng').value;
  const coords=normalizeCoord({lat:latInput,lng:lngInput});
  if(!name || !latInput || !lngInput || !coords){setMessage('warn','أدخل اسم الفرع وخط عرض وطول صحيحين.');return;}
  await safeWrite(async()=>{
    await addDoc(collection(db,'branches'),{name,...coords,enabled:false,isOpen:false,archived:false});
    $('addBranchForm').reset();
  },'تم إضافة الفرع مغلق وغير مفعّل؛ الأدمن لازم يفعّله أولاً.');
}
async function normalizeLegacyBranches(){
  if(role!=='admin')return;
  const old=branches.filter(b=>!('enabled' in b)||!('isOpen' in b)||!('archived' in b));
  if(!old.length){setMessage('info','كل الفروع الحالية جاهزة بالفعل.');return;}
  if(!window.confirm(`تحديث ${old.length} فروع قديمة لحالة مفعّل ومفتوح (بالحالة القديمة المعتادة)؟`))return;
  await safeWrite(async()=>{
    for(const b of old)await updateDoc(doc(db,'branches',b.id),{enabled:b.enabled??true,isOpen:b.isOpen??true,archived:b.archived??false});
  },'تمت تهيئة الفروع القديمة بنجاح.');
}

// Admin-only tariff editor. No tier details appear in employee or supervisor DOM.
function tierRow(kind,tier,index){
  const isCum=kind==='cumulative';
  const first=isCum&&index===0;
  const root=make('div','tariff-row');root.dataset.kind=kind;
  const from=make('input'); from.type='number';from.step='any';from.min='0';from.value=tier.from??0;from.title='من كم';from.setAttribute('aria-label','من كم');
  const to=make('input');to.type='number';to.step='any';to.min='0';to.placeholder=isCum&&!first?'مفتوح':'إلى كم';to.value=tier.to??'';to.title='إلى كم';to.setAttribute('aria-label','إلى كم');
  const rate=make('input');rate.type='number';rate.step='any';rate.min='0';rate.value=first?tier.price??'':tier.rate??'';rate.title=first?'المبلغ الثابت':'سعر الكيلو';rate.setAttribute('aria-label',rate.title);
  const del=make('button','btn secondary danger','حذف');del.type='button';
  del.disabled=first;
  del.addEventListener('click',()=>{root.remove();editingPricing=true;});
  root.append(from,to,rate,del);
  return root;
}
function renderPricingEditor(){
  if(role!=='admin'||editingPricing)return;
  $('pricingMode').value=pricing.activeMode;
  for(const [kind,target,tiers] of [['cumulative','cumulativeTierRows',pricing.cumulativeTiers],['perKmTier','perKmTierRows',pricing.perKmTiers]]){
    const host=$(target);host.replaceChildren();tiers.forEach((t,i)=>host.append(tierRow(kind,t,i)));
  }
}
function appendTier(kind){
  if(role!=='admin')return;
  const host=$(kind==='cumulative'?'cumulativeTierRows':'perKmTierRows');
  const rows=[...host.querySelectorAll('.tariff-row')];
  let from=0;
  if(rows.length){
    const inputs=rows.at(-1).querySelectorAll('input');
    if(kind==='cumulative' && inputs[1].value.trim()==='') {
      // Split the currently unlimited final tier into two connected tiers.
      inputs[1].value=String((Number(inputs[0].value)||0)+5);
    }
    from=Number(inputs[1].value)||Number(inputs[0].value)||0;
  }
  host.append(tierRow(kind,{from,to:kind==='cumulative'?null:from+5,rate:0},rows.length)); editingPricing=true;
}
function readPricingRows(kind){
  const host=$(kind==='cumulative'?'cumulativeTierRows':'perKmTierRows');
  return [...host.querySelectorAll('.tariff-row')].map((row,index)=>{
    const [from,to,rate]=row.querySelectorAll('input');
    const base=kind==='cumulative'&&index===0;
    return {from:from.value===''?NaN:Number(from.value),to:to.value===''?null:Number(to.value), ...(base?{type:'base',price:rate.value===''?NaN:Number(rate.value)}:kind==='cumulative'?{type:'rate',rate:rate.value===''?NaN:Number(rate.value)}:{rate:rate.value===''?NaN:Number(rate.value)})};
  });
}
async function savePricing(){
  if(role!=='admin')return;
  const draft={activeMode:$('pricingMode').value,cumulativeTiers:readPricingRows('cumulative'),perKmTiers:readPricingRows('perKmTier')};
  const error=validatePricing(draft); if(error){setMessage('warn',error);return;}
  // Preserve legacy fields for rollback and backward compatibility with existing site.
  const old={tier1_km:draft.cumulativeTiers[0].to,tier1_cost:draft.cumulativeTiers[0].price,
    tier2_km:draft.cumulativeTiers[1]?.to??draft.cumulativeTiers[0].to,
    tier2_rate:draft.cumulativeTiers[1]?.rate??0,tier3_rate:draft.cumulativeTiers[2]?.rate??0};
  await safeWrite(async()=>{await setDoc(doc(db,'pricing','main'),{...old,...draft},{merge:true});pricing=draft;editingPricing=false;},'تم حفظ الشرائح ونظام التسعير النشط.');
}

// Load Maps JavaScript API once; use Routes JS library (browser-capable, no REST/CORS proxy).
function loadMaps(){
  if(window.google?.maps?.importLibrary)return Promise.resolve(window.google.maps);
  if(mapPromise)return mapPromise;
  mapPromise=new Promise((resolve,reject)=>{
    const id='cstoreMapsReady';
    const timeout=setTimeout(()=>{delete window[id];reject(new Error('Maps timeout'));},25000);
    window[id]=()=>{clearTimeout(timeout);delete window[id];resolve(window.google.maps);};
    const script=document.createElement('script');
    script.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}&v=weekly&loading=async&language=ar&region=EG&callback=${id}`;
    script.async=true;script.onerror=()=>{clearTimeout(timeout);delete window[id];reject(new Error('Maps failed'));};
    document.head.append(script);
  }).catch(e=>{mapPromise=null;throw e;});return mapPromise;
}
async function getMap(){
  await loadMaps();
  if(!mapInstance){
    const {Map}=await google.maps.importLibrary('maps');
    mapInstance=new Map($('customerMap'),{center:{lat:30.05,lng:31.25},zoom:11,streetViewControl:false,mapTypeControl:true,fullscreenControl:true,clickableIcons:true});
  }
  return mapInstance;
}
async function setCustomerLocation(coords,description,accuracy){
  const point=normalizeCoord(coords);if(!point)return;
  const map=await getMap();customerCoords=point;
  if(customerMarker)customerMarker.setMap(null);
  customerMarker=new google.maps.Marker({map,position:point,title:'موقع تسليم العميل',animation:google.maps.Animation.DROP});
  map.setCenter(point);map.setZoom(16);
  $('mapLocationStatus').textContent='موقع العميل ظاهر — راجعه مع العميل';
  $('matchedAddress').textContent=description||`${point.lat}, ${point.lng}`;
  $('addressAccuracy').textContent=accuracy||'العنوان تقريبي، أكد مكان التسليم مع العميل قبل الحساب.';
  $('addressReview').classList.remove('hidden');
  $('locationConfirmed').checked=false;
  refreshCopyLocationButton();
  resetResult();
  setMessage('info','راجع الخريطة والمعالم مع العميل، ثم علّم تأكيد الموقع واضغط حساب.');
}
function switchMethod(method){
  locationMethod=method;
  $('addressPanel').classList.toggle('hidden',method!=='address');
  $('linkPanel').classList.toggle('hidden',method!=='link');
  for(const [id,name] of [['addressMethodButton','address'],['linkMethodButton','link']]){
    $(id).className=`btn ${method===name?'primary':'secondary'}`;
    $(id).setAttribute('aria-pressed',String(method===name));
  }
  invalidateCustomer();setMessage('info','حدد موقع العميل وراجعه على الخريطة قبل حساب السعر.');
}
function fullAddress(){
  const building=$('buildingNumber').value.trim(),street=$('streetName').value.trim(),area=$('areaName').value.trim();
  if(!building||!street||!area)return null;
  return `${building} ${street}، ${area}، مصر`;
}
async function searchAddress(){
  invalidateCustomer();
  const query=fullAddress();if(!query){setMessage('warn','رقم العمارة واسم الشارع والمنطقة مطلوبين.');return;}
  const serial=++addressQuerySerial,btn=$('searchAddressButton');btn.disabled=true;
  setMessage('info','جاري البحث عن العنوان في Google…');
  try{
    await loadMaps();const {Geocoder}=await google.maps.importLibrary('geocoding');
    const geo=new Geocoder();const {results}=await geo.geocode({address:query,region:'EG',componentRestrictions:{country:'EG'}});
    if(serial!==addressQuerySerial)return;
    if(!results?.length){setMessage('warn','لم يتم العثور على العنوان. راجع البيانات أو استخدم لوكيشن العميل.');return;}
    const host=$('addressMatches');host.replaceChildren();
    for(const result of results.slice(0,6)){
      if(!result.geometry?.location)continue;
      const option=make('button','address-option',result.formatted_address||'نتيجة من Google');option.type='button';
      option.addEventListener('click',async()=>{
        if(serial!==addressQuerySerial)return;
        host.classList.add('hidden');
        const loc=result.geometry.location;
        const roof=result.geometry.location_type==='ROOFTOP';
        const accuracy=roof&&!result.partial_match?'Google حددت موقعًا قريبًا من مستوى المبنى؛ ما زال تأكيد العميل مطلوبًا.':'الموقع تقريبي وقد لا يطابق رقم العمارة؛ لازم تأكيد العميل بالمعالم قبل التسعير.';
        await setCustomerLocation({lat:loc.lat(),lng:loc.lng()},result.formatted_address,accuracy);
      });host.append(option);
    }
    host.classList.remove('hidden');setMessage('info','اختر النتيجة المناسبة وراجعها مع العميل على الخريطة.');
  }catch(e){console.error(e);setMessage('warn','بحث Google Maps غير متاح. راجع المفتاح وMaps JavaScript وGeocoding وخدمات الفوترة.');}
  finally{btn.disabled=false;}
}
async function autocomplete(){
  const serial=++predictionsSerial;
  const street=$('streetName').value.trim(),area=$('areaName').value.trim();
  const host=$('streetSuggestions');
  if(street.length<3 || area.length<2 || locationMethod!=='address'){host.classList.add('hidden');return;}
  try{
    await loadMaps();
    const {AutocompleteSuggestion,AutocompleteSessionToken}=await google.maps.importLibrary('places');
    if(!placesSession)placesSession=new AutocompleteSessionToken();
    const result=await AutocompleteSuggestion.fetchAutocompleteSuggestions({input:`${street}، ${area}، مصر`,includedRegionCodes:['eg'],language:'ar',sessionToken:placesSession});
    if(serial!==predictionsSerial)return;
    host.replaceChildren();
    for(const item of result.suggestions?.slice(0,5)||[]){
      const prediction=item.placePrediction;if(!prediction)continue;
      const option=make('button','address-option',prediction.text.toString());option.type='button';
      option.addEventListener('click',async()=>{
        try{
          const p=prediction.toPlace();await p.fetchFields({fields:['formattedAddress','location']});
          placesSession=null;host.classList.add('hidden');
          // This suggestion aids street selection; it does NOT prove the building number.
          if(p.formattedAddress){$('streetName').value=p.formattedAddress.split(/[,،]/)[0].trim();}
          invalidateCustomer();setMessage('info','تم اختيار اقتراح شارع. اضغط بحث عن العنوان الكامل للتحقق من رقم العمارة.');
        }catch(e){console.warn(e);setMessage('warn','تعذر فتح اقتراح العنوان. يمكنك كتابة العنوان يدويًا.');}
      });host.append(option);
    }
    host.classList.toggle('hidden',!host.childElementCount);
  }catch(e){console.warn('Places suggestions:',e);host.classList.add('hidden');}
}
function coordsFromLink(raw){
  const s=String(raw||'').trim();
  const numeric='(-?\\d{1,3}(?:\\.\\d+)?)';
  const direct=s.match(new RegExp(`^\\s*${numeric}\\s*[,،]\\s*${numeric}\\s*$`));
  if(direct)return normalizeCoord({lat:direct[1],lng:direct[2]});
  let url;try{url=new URL(s);}catch{return null;}
  if(!['https:','http:'].includes(url.protocol)||!/^(?:www\.)?(?:google\.[a-z.]+|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl)$/.test(url.hostname))return null;
  // Link geometry (!3d..!4d) is a place point; @lat,lng is often only the camera center.
  const candidates=[/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,/[@](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/];
  for(const key of ['query','q','destination','ll']){
    const value=url.searchParams.get(key);const match=value?.match(new RegExp(`^${numeric},${numeric}$`));
    if(match)return normalizeCoord({lat:match[1],lng:match[2]});
  }
  let readable=url.href; try{readable=decodeURIComponent(url.href);}catch{/* use original URL */}
  for(const re of candidates){const match=readable.match(re);if(match)return normalizeCoord({lat:match[1],lng:match[2]});}
  return null;
}
async function convertLink(){
  invalidateCustomer();const point=coordsFromLink($('customerLocation').value);
  if(!point){setMessage('warn','تعذر استخراج الإحداثيات. استخدم رابط Google Maps كامل فيه إحداثيات المكان، أو اكتب latitude,longitude.');return;}
  try{await setCustomerLocation(point,`الإحداثيات: ${point.lat}, ${point.lng}`,'تأكد إن النقطة هي عنوان تسليم الأوردر، وليس مجرد مركز الخريطة أو موقع العميل الحالي.');}
  catch(e){console.error(e);setMessage('warn','الخريطة غير متاحة. راجع مفتاح Google Maps وإعدادات المشروع.');}
}

async function roadRoute(branch,customer,Route){
  try{
    const {routes}=await Route.computeRoutes({origin:normalizeCoord(branch),destination:customer,travelMode:'DRIVING',routingPreference:'TRAFFIC_AWARE',fields:['distanceMeters','durationMillis','path']});
    const route=routes?.[0];if(!route||!Number.isFinite(route.distanceMeters))throw new Error('Route missing');
    return {branch,distanceMeters:route.distanceMeters,durationMillis:route.durationMillis??null,path:route.path??[],price:calculateDeliveryCost(route.distanceMeters/1000,pricing)};
  }catch(e){console.warn('Route failed',branch.id,e);return {branch,error:true};}
}
async function mapRoadPath(result){
  if(!result||!result.path?.length||!customerCoords)return;
  const map=await getMap();removeRouteDrawing();
  selectedBranchId=result.branch.id;
  shownPolyline=new google.maps.Polyline({map,path:result.path,strokeColor:'#f02b8d',strokeOpacity:.9,strokeWeight:6});
  branchMarker=new google.maps.Marker({map,position:normalizeCoord(result.branch),title:result.branch.name,icon:'https://maps.google.com/mapfiles/ms/icons/green-dot.png'});
  const bounds=new google.maps.LatLngBounds();result.path.forEach(p=>bounds.extend(p));bounds.extend(customerCoords);map.fitBounds(bounds,50);
  document.querySelectorAll('.compare-row').forEach(row=>row.classList.toggle('selected-route',row.dataset.branchId===selectedBranchId));
}
function removeRouteDrawing(){
  if(shownPolyline){shownPolyline.setMap(null);shownPolyline=null;}
  if(branchMarker){branchMarker.setMap(null);branchMarker=null;}
}
function createRow(label,dist,fee,state,branchId){
  const tr=make('tr','compare-row');if(branchId)tr.dataset.branchId=branchId;
  for(const val of [label,dist,fee,state]){const td=make('td','',val);tr.append(td);}
  return tr;
}
function showComparison(results,failedIds){
  const host=$('allBranchesResults');host.replaceChildren();
  const wrap=make('div','table-scroll'),table=make('table','comparison-table'),thead=make('thead'),tr=make('tr');
  for(const text of ['الفرع','المسافة الفعلية','تكلفة التوصيل','الحالة'])tr.append(make('th','',text));
  thead.append(tr);table.append(thead);
  const tbody=make('tbody');
  const sorted=[...results].sort((a,b)=>a.distanceMeters-b.distanceMeters);
  const eligibleResults=sorted.filter(r=>r.price?.price!==null&&Number.isFinite(r.price?.price));
  const nearest=eligibleResults[0];
  // Include all branches with visible unavailability; closed branches do not incur paid route requests.
  for(const r of sorted){
    const isNearest=r===nearest;
    const fee=r.price?.outside?'خارج نطاق الشرائح':`${number(r.price?.price??0)} جنيه`;
    const row=createRow(r.branch.name,distanceText(r.distanceMeters),fee,isNearest?'أقرب فرع متاح':'مفتوح',r.branch.id);
    if(isNearest)row.classList.add('nearest');
    row.tabIndex=0;row.title='عرض مسار هذا الفرع على الخريطة';
    row.addEventListener('click',()=>void mapRoadPath(r));
    row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();void mapRoadPath(r);}});
    tbody.append(row);
  }
  for(const b of branches.slice().sort(branchOrder).filter(b=>!isArchived(b))){
    if(isEligible(b)&&!failedIds.has(b.id))continue;
    const description=isEligible(b)?'تعذّر حساب الطريق':branchStatus(b);
    const row=createRow(b.name,'—','—',description);row.classList.add('unavailable');tbody.append(row);
  }
  table.append(tbody);wrap.append(table);host.append(wrap);
  return nearest;
}
async function calculate(){
  if(!customerCoords){setMessage('warn','حدد موقع العميل أولًا على الخريطة.');return;}
  if(!$('locationConfirmed').checked){setMessage('warn','لازم العميل يؤكد إن الموقع الظاهر هو مكان التسليم قبل حساب السعر.');return;}
  const configErr=validatePricing(pricing);if(configErr){setMessage('warn',`راجع تسعير الأدمن: ${configErr}`);return;}
  const available=activeBranches();if(!available.length){resetResult('كل الفروع مقفولة أو غير مفعّلة حاليًا.');setMessage('warn','لا يوجد أي فرع مفتوح ومفعّل حاليًا.');return;}
  const serial=++calcSerial;const current=customerCoords;
  const btn=$('calculateButton');btn.disabled=true;setMessage('info',`جاري حساب الطريق من ${available.length} فروع...`);
  try{
    await loadMaps();const {Route}=await google.maps.importLibrary('routes');
    // Batch requests to limit bursts and Maps API quota usage.
    const results=[];
    for(let i=0;i<available.length;i+=4){
      const batch=await Promise.all(available.slice(i,i+4).map(b=>roadRoute(b,current,Route)));
      if(serial!==calcSerial)return;
      results.push(...batch);
    }
    const ok=results.filter(r=>!r.error),fail=new Set(results.filter(r=>r.error).map(r=>r.branch.id));
    const nearest=showComparison(ok,fail);
    lastRouteResults=ok;
    if(!ok.length){$('distanceContent').textContent='مسافة الطريق غير متاحة.';$('costContent').textContent='تعذر حساب التكلفة.';setMessage('warn','تعذر حساب مسافات كل الفروع. راجع تفعيل Routes API / Maps JS وقيود مفتاح Google.');return;}
    if(!nearest){$('distanceContent').textContent='لا يوجد فرع داخل نطاق الشرائح.';$('costContent').textContent='المسافة خارج نطاق التوصيل المعتمد.';setMessage('warn','المسافات المحسوبة خارج الشرائح أو غير متاحة. راجع إدارة التسعير.');return;}
    const distance=$('distanceContent');distance.replaceChildren(make('div','muted','أقرب فرع مفتوح'),make('div','big',nearest.branch.name),make('div','result-box',`${distanceText(nearest.distanceMeters)} — ${durationText(nearest.durationMillis)}`));
    const cost=$('costContent');cost.replaceChildren(make('div','result-box green',`${number(nearest.price.price)} جنيه`),make('div','small',`المسافة المحتسبة: ${number(nearest.price.billableKm)} كم بعد جبر الكسر لأعلى`));
    await mapRoadPath(nearest);
    setMessage(fail.size?'warn':'ok',fail.size?`تم حساب ${ok.length} فروع. تعذر حساب ${fail.size} فروع؛ المقارنة غير مكتملة ويجب مراجعتها.`:'تم حساب تكلفة التوصيل من كل الفروع المفتوحة بنجاح.');
  }catch(e){console.error(e);setMessage('warn','حساب الطريق غير متاح. راجع Google Maps وRoutes API وقيود المفتاح.');}
  finally{btn.disabled=false;}
}

function applyData(){updateBranchAndPricing();renderPricingEditor();}
function unsubscribeAll(){unsubs.forEach(unsub=>unsub());unsubs=[];}
async function startSnapshots(epoch){
  unsubscribeAll();
  // onSnapshot keeps all shared accounts in sync, including branch opening/closing.
  unsubs.push(onSnapshot(collection(db,'branches'),snap=>{
    if(epoch!==authEpoch)return;
    branches=snap.docs.map(d=>({id:d.id,...d.data()}));applyData();
  },e=>{console.error(e);setMessage('warn',errorText(e));}));
  unsubs.push(onSnapshot(doc(db,'pricing','main'),snap=>{
    if(epoch!==authEpoch)return;
    pricing=normalizePricing(snap.exists()?snap.data():{});applyData();
  },e=>{console.error(e);setMessage('warn',errorText(e));}));
}
async function login(){
  const email=$('emailInput').value.trim().toLowerCase(),password=$('passwordInput').value;
  if(!email||!password){loginMessage('warn','اكتب البريد الإلكتروني وكلمة المرور.');return;}
  if(!EMAIL_ROLES[email]){loginMessage('warn','الحساب ده مش ضمن حسابات النظام المعتمدة.');return;}
  try{loginMessage('info','جاري الدخول...');await signInWithEmailAndPassword(auth,email,password);}
  catch(e){console.error(e);loginMessage('warn','تعذر تسجيل الدخول. تأكد من الحساب وكلمة المرور في Firebase Authentication.');}
}
async function logout(){try{await signOut(auth);}catch(e){setMessage('warn','تعذر تسجيل الخروج.');}}
function initTheme(){document.body.classList.toggle('dark',localStorage.getItem('cstore-theme')==='dark');updateThemeButton();}
function updateThemeButton(){$('themeToggle').textContent=document.body.classList.contains('dark')?'☀️ Light Mode':'🌙 Dark Mode';}
function bind(){
  $('themeToggle').addEventListener('click',()=>{document.body.classList.toggle('dark');localStorage.setItem('cstore-theme',document.body.classList.contains('dark')?'dark':'light');updateThemeButton();});
  $('loginButton').addEventListener('click',login);$('passwordInput').addEventListener('keydown',e=>{if(e.key==='Enter')void login();});
  $('logoutButton').addEventListener('click',logout);
  $('addBranchForm').addEventListener('submit',addBranch);
  $('normalizeOldBranchesButton').addEventListener('click',normalizeLegacyBranches);
  $('addCumulativeTierButton').addEventListener('click',()=>appendTier('cumulative'));
  $('addPerKmTierButton').addEventListener('click',()=>appendTier('perKmTier'));
  $('savePricingButton').addEventListener('click',savePricing);
  $('pricingMode').addEventListener('change',()=>{editingPricing=true;});
  for(const id of ['cumulativeTierRows','perKmTierRows'])$(id).addEventListener('input',()=>{editingPricing=true;});
  $('addressMethodButton').addEventListener('click',()=>switchMethod('address'));
  $('linkMethodButton').addEventListener('click',()=>switchMethod('link'));
  $('searchAddressButton').addEventListener('click',searchAddress);
  $('convertButton').addEventListener('click',convertLink);
  $('calculateButton').addEventListener('click',calculate);
  $('copyCustomerLocationButton').addEventListener('click',copyCustomerLocation);
  $('locationConfirmed').addEventListener('change',()=>{refreshCopyLocationButton();resetResult();});
  for(const id of ['buildingNumber','streetName','areaName','landmark'])$(id).addEventListener('input',()=>{
    addressQuerySerial++;predictionsSerial++;invalidateCustomer();
    if(id==='streetName'||id==='areaName'){clearTimeout(autoCompleteTimeout);autoCompleteTimeout=setTimeout(autocomplete,500);}
  });
  $('customerLocation').addEventListener('input',invalidateCustomer);
}
onAuthStateChanged(auth,async user=>{
  const epoch=++authEpoch;unsubscribeAll();
  if(!user){role=null;branches=[];pricing=normalizePricing();$('loginOverlay').classList.remove('hidden');updateRoleView();resetResult();return;}
  const email=(user.email||'').toLowerCase();
  if(!EMAIL_ROLES[email]){
    loginMessage('warn','الحساب ده مش مصرح له باستخدام النظام.');await signOut(auth);return;
  }
  role=EMAIL_ROLES[email];$('loginOverlay').classList.add('hidden');
  $('passwordInput').value='';updateRoleView();
  startSnapshots(epoch);
});
document.addEventListener('DOMContentLoaded',()=>{initTheme();bind();});
