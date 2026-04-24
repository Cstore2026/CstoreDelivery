const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6Ijk2NGNjYTQzYTIxMjQ5MWY4ZjEyZDdjYjUwZDc4MDZhIiwiaCI6Im11cm11cjY0In0=";
const DEFAULT_BRANCHES = [
  { id: 1, name: "فرع مصر الجديدة", lat: 30.1119, lng: 31.3407 },
  { id: 2, name: "فرع مدينة نصر", lat: 30.0639, lng: 31.3466 },
  { id: 3, name: "فرع المعادي", lat: 29.9673, lng: 31.2729 },
  { id: 4, name: "فرع التجمع الاول", lat: 30.06399, lng: 31.46802 },
  { id: 5, name: "فرع التجمع الخامس", lat: 30.0286317, lng: 31.4748435 }
];
const DEFAULT_PRICING = {
  tier1_km: 5,
  tier1_cost: 35,
  tier2_km: 10,
  tier2_rate: 7,
  tier3_rate: 8
};
const DEFAULT_USERS = {
  admin: "admin123",
  view: "view123"
};

let extractedCustomerCoords = null;
let currentRole = null;
let branches = [];
let pricing = {};
let users = {};

function initializeTheme() {
  const savedTheme = localStorage.getItem("cstore-theme") || "light";
  document.body.classList.toggle("dark", savedTheme === "dark");
  updateThemeButton();
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("cstore-theme", isDark ? "dark" : "light");
  updateThemeButton();
}

function updateThemeButton() {
  const btn = document.getElementById("themeToggle");
  const isDark = document.body.classList.contains("dark");
  btn.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
}

function loadState() {
  branches = JSON.parse(localStorage.getItem("cstore-branches") || "null") || structuredClone(DEFAULT_BRANCHES);
  pricing = JSON.parse(localStorage.getItem("cstore-pricing") || "null") || structuredClone(DEFAULT_PRICING);
  users = JSON.parse(localStorage.getItem("cstore-users") || "null") || structuredClone(DEFAULT_USERS);
}

function saveState() {
  localStorage.setItem("cstore-branches", JSON.stringify(branches));
  localStorage.setItem("cstore-pricing", JSON.stringify(pricing));
  localStorage.setItem("cstore-users", JSON.stringify(users));
}

function login() {
  const role = document.getElementById("roleSelect").value;
  const pass = document.getElementById("passwordInput").value;
  const msg = document.getElementById("loginMessage");

  if (pass !== users[role]) {
    msg.className = "alert warn";
    msg.textContent = "الباسورد غير صحيح.";
    return;
  }

  currentRole = role;
  localStorage.setItem("cstore-current-role", role);
  document.getElementById("loginOverlay").classList.add("hidden");
  applyRoleUI();
  msg.className = "alert ok";
  msg.textContent = "تم تسجيل الدخول بنجاح.";
}

function logout() {
  currentRole = null;
  localStorage.removeItem("cstore-current-role");
  document.getElementById("loginOverlay").classList.remove("hidden");
  document.getElementById("passwordInput").value = "";
  document.getElementById("loginMessage").className = "alert warn";
  document.getElementById("loginMessage").textContent = "نسخة محلية. الحماية هنا بسيطة ومناسبة للاستخدام الداخلي فقط.";
}

function tryAutoLogin() {
  const saved = localStorage.getItem("cstore-current-role");
  if (saved === "admin" || saved === "view") {
    currentRole = saved;
    document.getElementById("loginOverlay").classList.add("hidden");
    applyRoleUI();
  }
}

function applyRoleUI() {
  const isAdmin = currentRole === "admin";
  document.getElementById("userRoleBadge").textContent = isAdmin ? "Admin" : "View";
  document.getElementById("adminPanel").classList.toggle("active", isAdmin);
  document.getElementById("branchesCard").classList.toggle("hidden", !isAdmin);
  document.getElementById("mainGrid").classList.toggle("view-mode", !isAdmin);
  document.getElementById("branchesTitle").textContent = isAdmin ? "الفروع الحالية" : "الفروع";
  document.getElementById("branchesNote").textContent = isAdmin
    ? "كأدمن تقدر تعدل الفروع من لوحة التحكم أعلى الصفحة."
    : "الفروع ثابتة. استخدم فقط لوكيشن العميل للحساب.";
  renderBranches();
  renderAdminForm();
}

function renderBranches() {
  const container = document.getElementById("branchesContainer");
  container.innerHTML = branches.map(branch => `
    <div class="branch-item">
      <div class="branch-head">
        <strong>${branch.name}</strong>
        <span class="status">${currentRole === "admin" ? "قابل للتعديل" : "ثابت"}</span>
      </div>
      <div class="coord-grid">
        <div class="coord-box"><label>Latitude</label><div>${branch.lat}</div></div>
        <div class="coord-box"><label>Longitude</label><div>${branch.lng}</div></div>
      </div>
    </div>
  `).join("");
}

function renderAdminForm() {
  if (currentRole !== "admin") return;
  const holder = document.getElementById("adminBranchesForm");
  holder.innerHTML = branches.map((branch, index) => `
    <div class="admin-item">
      <div class="admin-head">
        <strong>${branch.name}</strong>
        <span class="status">Admin</span>
      </div>
      <div class="admin-grid">
        <div class="field">
          <label>اسم الفرع</label>
          <input value="${branch.name}" onchange="updateBranchField(${index}, 'name', this.value)">
        </div>
        <div class="field">
          <label>Latitude</label>
          <input type="number" step="0.0000001" value="${branch.lat}" onchange="updateBranchField(${index}, 'lat', this.value)">
        </div>
        <div class="field">
          <label>Longitude</label>
          <input type="number" step="0.0000001" value="${branch.lng}" onchange="updateBranchField(${index}, 'lng', this.value)">
        </div>
      </div>
    </div>
  `).join("");

  document.getElementById("price_tier1_km").value = pricing.tier1_km;
  document.getElementById("price_tier1_cost").value = pricing.tier1_cost;
  document.getElementById("price_tier2_km").value = pricing.tier2_km;
  document.getElementById("price_tier2_rate").value = pricing.tier2_rate;
  document.getElementById("price_tier3_rate").value = pricing.tier3_rate;
  document.getElementById("user_admin_password").value = users.admin || "";
  document.getElementById("user_view_password").value = users.view || "";
}

function updateBranchField(index, field, value) {
  branches[index][field] = field === "name" ? value : parseFloat(value);
}

function saveAdminSettings() {
  if (currentRole !== "admin") return;
  pricing = {
    tier1_km: parseFloat(document.getElementById("price_tier1_km").value),
    tier1_cost: parseFloat(document.getElementById("price_tier1_cost").value),
    tier2_km: parseFloat(document.getElementById("price_tier2_km").value),
    tier2_rate: parseFloat(document.getElementById("price_tier2_rate").value),
    tier3_rate: parseFloat(document.getElementById("price_tier3_rate").value)
  };

  const newAdminPassword = document.getElementById("user_admin_password").value.trim();
  const newViewPassword = document.getElementById("user_view_password").value.trim();

  if (!newAdminPassword || !newViewPassword) {
    setMessage("warn", "لا يمكن ترك باسورد الأدمن أو الفيو فارغًا.");
    return;
  }

  users = {
    admin: newAdminPassword,
    view: newViewPassword
  };

  saveState();
  renderBranches();
  renderAdminForm();
  setMessage("ok", "تم حفظ تعديلات الفروع والتسعير وكلمات المرور بنجاح.");
}

function resetAdminSettings() {
  if (currentRole !== "admin") return;
  branches = structuredClone(DEFAULT_BRANCHES);
  pricing = structuredClone(DEFAULT_PRICING);
  users = structuredClone(DEFAULT_USERS);
  saveState();
  renderBranches();
  renderAdminForm();
  setMessage("info", "تم استرجاع الإعدادات الافتراضية بما فيها كلمات المرور.");
}

function setMessage(type, html) {
  const el = document.getElementById("messageBox");
  el.className = `alert ${type}`;
  el.innerHTML = html;
}

function extractLatLng(input) {
  if (!input) return null;
  const s = String(input).trim();

  const isDirectCoords = /^\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*$/.test(s);
  if (isDirectCoords) {
    const parts = s.split(",");
    return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
  }

  const isFullUrl = s.startsWith("http://") || s.startsWith("https://");
  if (!isFullUrl) {
    return "INCOMPLETE_INPUT";
  }

  const hasSaddr = /[?&]saddr=/.test(s);
  const hasDaddr = /[?&]daddr=/.test(s);

  const daddrCoords = s.match(/[?&]daddr=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (daddrCoords) {
    return { lat: parseFloat(daddrCoords[1]), lng: parseFloat(daddrCoords[2]) };
  }

  const patterns = [
    /@(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /[?&](?:q|query)=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/,
    /\/maps\/search\/.*?@(-?\d+\.?\d*),(-?\d+\.?\d*)/
  ];

  for (const pattern of patterns) {
    const match = s.match(pattern);
    if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
  }

  if (hasSaddr && hasDaddr) {
    return "DIRECTIONS_LINK_UNSUPPORTED";
  }

  try {
    const url = new URL(s);
    const q = url.searchParams.get("q") || url.searchParams.get("query");
    if (q) {
      const decoded = decodeURIComponent(q).trim();
      const coordMatch = decoded.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
      if (coordMatch) {
        return { lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]) };
      }
      return { type: "TEXT_QUERY", query: decoded };
    }
  } catch (e) {}

  return "FULL_URL_BUT_UNREADABLE";
}

async function geocodeTextQuery(textQuery) {
  const url = `https://api.openrouteservice.org/geocode/search?api_key=${encodeURIComponent(ORS_API_KEY)}&text=${encodeURIComponent(textQuery)}&size=1`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const feature = data?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!coords || coords.length < 2) {
    throw new Error("No geocoding result");
  }
  return { lat: coords[1], lng: coords[0], label: feature?.properties?.label || textQuery };
}

function convertCustomerLink() {
  const input = document.getElementById("customerLocation").value.trim();
  const coords = extractLatLng(input);
  const box = document.getElementById("extractedCoordsBox");
  const text = document.getElementById("extractedCoordsText");

  if (!input) {
    extractedCustomerCoords = null;
    box.classList.add("hidden");
    setMessage("warn", "اكتب رابط العميل أو الإحداثيات أولاً.");
    return;
  }

  const looksLikeFullUrl = input.startsWith("http://") || input.startsWith("https://");
  const looksLikeCoords = /^\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*$/.test(input);

  if (!looksLikeFullUrl && !looksLikeCoords) {
    extractedCustomerCoords = null;
    box.classList.add("hidden");
    setMessage("warn", "المدخل غير صحيح. يجب إدخال رابط كامل يبدأ بـ https:// أو إحداثيات مباشرة بصيغة lat,lng فقط.");
    return;
  }

  if (coords === "INCOMPLETE_INPUT") {
    extractedCustomerCoords = null;
    box.classList.add("hidden");
    setMessage("warn", "الرابط أو النص غير مكتمل. لا تستخدم جزءًا من الرابط. الصق الرابط كاملًا أو الإحداثيات مباشرة.");
    return;
  }

  if (coords === "FULL_URL_BUT_UNREADABLE") {
    extractedCustomerCoords = null;
    box.classList.add("hidden");
    setMessage("warn", "الرابط كامل لكنه لا يحتوي على إحداثيات واضحة. استخدم لوكيشن العميل نفسه أو الإحداثيات مباشرة.");
    return;
  }

  if (coords === "DIRECTIONS_LINK_UNSUPPORTED") {
    extractedCustomerCoords = null;
    box.classList.add("hidden");
    setMessage("warn", "هذا رابط اتجاهات وليس لوكيشن عميل مباشر. لا تضع رابط فيه saddr و daddr. افتح مكان العميل نفسه فقط، ثم انسخ لوكيشن العميل أو الإحداثيات مباشرة بصيغة lat,lng.");
    return;
  }

  if (coords && coords.type === "TEXT_QUERY") {
    extractedCustomerCoords = null;
    box.classList.add("hidden");
    setMessage("info", `تم التعرف على عنوان نصي: <b>${coords.query}</b>. عند الضغط على احسب مسافة الطريق، سيحاول النظام تحويله إلى إحداثيات أولاً.`);
    return;
  }

  if (coords) {
    extractedCustomerCoords = coords;
    box.classList.remove("hidden");
    text.textContent = `${coords.lat}, ${coords.lng}`;
    setMessage("ok", "تم استخراج الإحداثيات بنجاح. يمكنك استخدام الإحداثيات المستخرجة أو الحساب مباشرة.");
    return;
  }

  extractedCustomerCoords = null;
  box.classList.add("hidden");
  setMessage("warn", "تعذر استخراج الإحداثيات من هذا المدخل. استخدم لوكيشن العميل فقط أو الإحداثيات المباشرة بصيغة lat,lng.");
}

function useExtractedCoordinates() {
  if (!extractedCustomerCoords) {
    setMessage("warn", "لا توجد إحداثيات مستخرجة لاستخدامها.");
    return;
  }
  document.getElementById("customerLocation").value = `${extractedCustomerCoords.lat},${extractedCustomerCoords.lng}`;
  setMessage("ok", "تم وضع الإحداثيات في خانة العميل.");
}

function useExampleCoordinates() {
  document.getElementById("customerLocation").value = "30.04822252,31.39434674";
  document.getElementById("extractedCoordsBox").classList.add("hidden");
  extractedCustomerCoords = null;
  setMessage("info", "تم وضع مثال جاهز للتجربة. اضغط الآن على زر حساب مسافة الطريق.");
}

function calculateDeliveryCost(distanceKm) {
  if (distanceKm == null || Number.isNaN(distanceKm)) return 0;
  if (distanceKm <= pricing.tier1_km) return pricing.tier1_cost;
  if (distanceKm <= pricing.tier2_km) return pricing.tier1_cost + ((distanceKm - pricing.tier1_km) * pricing.tier2_rate);
  return pricing.tier1_cost + ((pricing.tier2_km - pricing.tier1_km) * pricing.tier2_rate) + ((distanceKm - pricing.tier2_km) * pricing.tier3_rate);
}

function formatNumber(value) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(value);
}

function formatDistance(meters) {
  if (meters == null) return "غير متاح";
  const km = meters / 1000;
  return `${formatNumber(km)} كم`;
}

function formatDuration(seconds) {
  if (seconds == null) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours} س ${rem} د` : `${hours} س`;
}

async function routeForBranch(customer, branch) {
  const url = "https://api.openrouteservice.org/v2/directions/driving-car";
  const payload = { coordinates: [[branch.lng, branch.lat], [customer.lng, customer.lat]] };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const summary = data?.routes?.[0]?.summary;
    if (!summary) throw new Error("No summary returned");

    return { ...branch, distanceMeters: summary.distance, durationSeconds: summary.duration };
  } catch (error) {
    return { ...branch, distanceMeters: null, durationSeconds: null, error: String(error) };
  }
}

async function calculateRoadDistance() {
  const rawInput = document.getElementById("customerLocation").value.trim();
  let customer = extractLatLng(rawInput);
  const looksLikeFullUrl = rawInput.startsWith("http://") || rawInput.startsWith("https://");
  const looksLikeCoords = /^\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*$/.test(rawInput);

  if (!rawInput) {
    setMessage("warn", "اكتب لوكيشن العميل أولاً.");
    return;
  }

  if (!looksLikeFullUrl && !looksLikeCoords) {
    setMessage("warn", "المدخل غير صحيح. الصق رابطًا كاملًا يبدأ بـ https:// أو إحداثيات مباشرة بصيغة lat,lng.");
    return;
  }

  if (customer === "INCOMPLETE_INPUT") {
    setMessage("warn", "الرابط أو النص غير مكتمل. لا تستخدم جزءًا من الرابط. الصق الرابط كاملًا أو الإحداثيات مباشرة.");
    return;
  }

  if (customer === "FULL_URL_BUT_UNREADABLE") {
    setMessage("warn", "الرابط كامل لكنه لا يحتوي على إحداثيات واضحة. استخدم لوكيشن العميل نفسه أو الإحداثيات مباشرة.");
    return;
  }

  if (customer === "DIRECTIONS_LINK_UNSUPPORTED") {
    setMessage("warn", "الرابط الحالي هو رابط اتجاهات. استخدم لوكيشن العميل فقط، وليس رابط مسار بين نقطتين.");
    return;
  }

  if (!customer) {
    setMessage("warn", "تعذر قراءة لوكيشن العميل. استخدم رابط العميل المباشر أو الإحداثيات بصيغة lat,lng.");
    return;
  }

  try {
    if (customer && customer.type === "TEXT_QUERY") {
      setMessage("info", '<span class="loader"></span> جاري تحويل العنوان النصي إلى إحداثيات...');
      customer = await geocodeTextQuery(customer.query);
    }

    setMessage("info", '<span class="loader"></span> جاري حساب مسافات الطريق...');
    const results = await Promise.all(branches.map(branch => routeForBranch(customer, branch)));
    const validResults = results.filter(r => typeof r.distanceMeters === "number");

    if (validResults.length === 0) {
      setMessage("warn", "لم أتمكن من حساب مسافة الطريق. راجع اتصال الإنترنت أو صلاحية المفتاح داخل الملف.");
      return;
    }

    validResults.sort((a, b) => a.distanceMeters - b.distanceMeters);
    const nearest = validResults[0];
    const distanceKm = nearest.distanceMeters / 1000;
    const cost = calculateDeliveryCost(distanceKm);

    document.getElementById("distanceContent").innerHTML = `
      <div class="muted">أقرب فرع</div>
      <div style="font-size:26px;font-weight:800;margin:6px 0 12px;">${nearest.name}</div>
      <div class="result-box">
        <div class="muted">مسافة الطريق</div>
        <div class="big">${formatDistance(nearest.distanceMeters)}</div>
        <div class="small">المدة التقريبية: ${formatDuration(nearest.durationSeconds) || "—"}</div>
      </div>
    `;

    document.getElementById("costContent").innerHTML = `
      <div class="result-box green">
        <div>إجمالي تكلفة التوصيل</div>
        <div class="big">${formatNumber(cost)} ج</div>
      </div>
      <div class="small" style="margin-top:12px;">
        <div>حتى ${pricing.tier1_km} كم = ${formatNumber(pricing.tier1_cost)} جنيه ثابت</div>
        <div>أكثر من ${pricing.tier1_km} حتى ${pricing.tier2_km} كم = سعر الشريحة الثانية ${formatNumber(pricing.tier2_rate)} للكيلو</div>
        <div>أكثر من ${pricing.tier2_km} كم = سعر الشريحة الثالثة ${formatNumber(pricing.tier3_rate)} للكيلو</div>
      </div>
    `;

    document.getElementById("allBranchesResults").innerHTML = `
      <div class="summary-grid">
        ${results.map(branch => {
          const isNearest = branch.id === nearest.id;
          return `
            <div class="summary-item ${isNearest ? "nearest" : ""}">
              <div class="summary-head">
                <strong>${branch.name}</strong>
                ${isNearest ? '<span class="status">الأقرب</span>' : ""}
              </div>
              <div class="muted" style="margin-top:10px;">مسافة الطريق</div>
              <div style="font-size:28px;font-weight:800;">${formatDistance(branch.distanceMeters)}</div>
              <div class="small">${branch.durationSeconds ? `المدة: ${formatDuration(branch.durationSeconds)}` : "غير متاح"}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    setMessage("ok", customer.label ? "تم تحويل العنوان إلى إحداثيات وحساب مسافة الطريق بنجاح." : "تم حساب مسافة الطريق بنجاح.");
  } catch (error) {
    console.error(error);
    setMessage("warn", "حدث خطأ أثناء الحساب. تأكد من اتصال الإنترنت.");
  }
}

initializeTheme();
loadState();
renderBranches();
tryAutoLogin();
