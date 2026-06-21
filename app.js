import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDFcf21kHFt6UiP_PR8PzM2Yr16AvjWzTk",
  authDomain: "cstore-delivery.firebaseapp.com",
  projectId: "cstore-delivery",
  storageBucket: "cstore-delivery.firebasestorage.app",
  messagingSenderId: "208559702059",
  appId: "1:208559702059:web:8c0767185369f2a420ea6e"
};

const GOOGLE_MAPS_API_KEY = "AIzaSyA4UyTSWWEOGhbwrmeh8pm1JQce5m7PeLg";

const ADMIN_EMAIL = "admin@cstore.com";
const DEFAULT_PRICING = { tier1_km: 5, tier1_cost: 35, tier2_km: 10, tier2_rate: 7, tier3_rate: 8 };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let extractedCustomerCoords = null;
let currentRole = null;
let branches = [];
let pricing = { ...DEFAULT_PRICING };
let unsubscribeBranches = null;
let unsubscribePricing = null;

const $ = (id) => document.getElementById(id);

function setMessage(type, html) {
  const el = $("messageBox");
  if (!el) return;
  el.className = `alert ${type}`;
  el.innerHTML = html;
}

function setLoginMessage(type, text) {
  const el = $("loginMessage");
  if (!el) return;
  el.className = `alert ${type}`;
  el.textContent = text;
}

function formatNumber(value) {
  return new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value);
}

function formatDistance(meters) {
  if (meters == null) return "غير متاح";
  return `${formatNumber(meters / 1000)} كم`;
}

function formatDuration(seconds) {
  if (!seconds) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hours} س ${rem} د` : `${hours} س`;
}

function calculateDeliveryCost(distanceKm) {
  if (distanceKm <= pricing.tier1_km) return pricing.tier1_cost;
  if (distanceKm <= pricing.tier2_km) {
    return pricing.tier1_cost + ((distanceKm - pricing.tier1_km) * pricing.tier2_rate);
  }
  return pricing.tier1_cost +
    ((pricing.tier2_km - pricing.tier1_km) * pricing.tier2_rate) +
    ((distanceKm - pricing.tier2_km) * pricing.tier3_rate);
}

function normalizeLatLng(coords) {
  if (!coords) return null;

  let lat = Number(coords.lat);
  let lng = Number(coords.lng);

  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    [lat, lng] = [lng, lat];
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return {
    lat: Number(lat.toFixed(7)),
    lng: Number(lng.toFixed(7))
  };
}

function initializeTheme() {
  const savedTheme = localStorage.getItem("cstore-theme") || "light";
  document.body.classList.toggle("dark", savedTheme === "dark");
  updateThemeButton();
}

function updateThemeButton() {
  const btn = $("themeToggle");
  if (!btn) return;
  const isDark = document.body.classList.contains("dark");
  btn.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("cstore-theme", isDark ? "dark" : "light");
  updateThemeButton();
}

function renderBranches() {
  if ($("branchesCountBadge")) {
    $("branchesCountBadge").textContent = `${branches.length} / ${branches.length} فروع`;
  }

  if (!$("branchesContainer")) return;

  $("branchesContainer").innerHTML = branches.map((branch) => `
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
  if (!$("adminBranchesForm")) return;

  $("adminBranchesForm").innerHTML = branches.map((branch, index) => `
    <div class="admin-item">
      <div class="admin-head">
        <strong>${branch.name}</strong>
        <span class="status">Admin</span>
      </div>
      <div class="admin-grid">
        <div class="field">
          <label>اسم الفرع</label>
          <input value="${branch.name}" data-index="${index}" data-field="name" class="branch-editor">
        </div>
        <div class="field">
          <label>Latitude</label>
          <input type="number" step="0.0000001" value="${branch.lat}" data-index="${index}" data-field="lat" class="branch-editor">
        </div>
        <div class="field">
          <label>Longitude</label>
          <input type="number" step="0.0000001" value="${branch.lng}" data-index="${index}" data-field="lng" class="branch-editor">
        </div>
      </div>
    </div>
  `).join("");

  $("price_tier1_km").value = pricing.tier1_km;
  $("price_tier1_cost").value = pricing.tier1_cost;
  $("price_tier2_km").value = pricing.tier2_km;
  $("price_tier2_rate").value = pricing.tier2_rate;
  $("price_tier3_rate").value = pricing.tier3_rate;

  document.querySelectorAll(".branch-editor").forEach((input) => {
    input.addEventListener("change", (e) => {
      const index = Number(e.target.dataset.index);
      const field = e.target.dataset.field;
      branches[index][field] = field === "name" ? e.target.value : parseFloat(e.target.value);
    });
  });
}

function applyRoleUI() {
  const isAdmin = currentRole === "admin";

  $("userRoleBadge").textContent = isAdmin ? "Admin" : "View";
  $("adminPanel").classList.toggle("active", isAdmin);
  $("branchesCard").classList.toggle("hidden", !isAdmin);
  $("mainGrid").classList.toggle("view-mode", !isAdmin);

  renderBranches();
  renderAdminForm();
}

async function reloadDataFromFirebase() {
  const branchesSnap = await getDocs(collection(db, "branches"));
  branches = branchesSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));

  const pricingSnap = await getDoc(doc(db, "pricing", "main"));
  pricing = pricingSnap.exists() ? { ...DEFAULT_PRICING, ...pricingSnap.data() } : { ...DEFAULT_PRICING };

  applyRoleUI();
}

function setupLiveListeners() {
  if (unsubscribeBranches) unsubscribeBranches();
  if (unsubscribePricing) unsubscribePricing();

  unsubscribeBranches = onSnapshot(collection(db, "branches"), (snap) => {
    branches = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
    if (currentRole) applyRoleUI();
  });

  unsubscribePricing = onSnapshot(doc(db, "pricing", "main"), (snap) => {
    pricing = snap.exists() ? { ...DEFAULT_PRICING, ...snap.data() } : { ...DEFAULT_PRICING };
    if (currentRole) applyRoleUI();
  });
}

function stopLiveListeners() {
  if (unsubscribeBranches) unsubscribeBranches();
  if (unsubscribePricing) unsubscribePricing();
  unsubscribeBranches = null;
  unsubscribePricing = null;
}

async function saveAdminSettings() {
  if (currentRole !== "admin") return;

  pricing = {
    tier1_km: parseFloat($("price_tier1_km").value),
    tier1_cost: parseFloat($("price_tier1_cost").value),
    tier2_km: parseFloat($("price_tier2_km").value),
    tier2_rate: parseFloat($("price_tier2_rate").value),
    tier3_rate: parseFloat($("price_tier3_rate").value)
  };

  for (const branch of branches) {
    await setDoc(doc(db, "branches", branch.id), {
      name: branch.name,
      lat: Number(branch.lat),
      lng: Number(branch.lng)
    });
  }

  await setDoc(doc(db, "pricing", "main"), pricing);
  setMessage("ok", "تم حفظ التعديلات بنجاح.");
}

function extractLatLng(input) {
  if (!input) return null;

  const s = String(input).trim();

  const direct = s.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
  if (direct) return normalizeLatLng({ lat: direct[1], lng: direct[2] });

  if (!s.startsWith("http")) return "INCOMPLETE_INPUT";

  if (/[?&]saddr=/.test(s) && /[?&]daddr=/.test(s)) {
    return "DIRECTIONS_LINK_UNSUPPORTED";
  }

  const patterns = [
    /!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/,
    /[?&](?:q|query|destination)=(-?\d+\.?\d*),(-?\d+\.?\d*)/,
    /@(-?\d+\.?\d*),(-?\d+\.?\d*)/
  ];

  for (const p of patterns) {
    const m = s.match(p);
    if (m) return normalizeLatLng({ lat: m[1], lng: m[2] });
  }

  return "FULL_URL_BUT_UNREADABLE";
}

function convertCustomerLink() {
  const input = $("customerLocation").value.trim();
  const coords = extractLatLng(input);

  if (!input) {
    setMessage("warn", "اكتب رابط العميل أو الإحداثيات أولاً.");
    return;
  }

  if (typeof coords === "string") {
    setMessage("warn", "الرابط غير صالح. الصق رابط كامل أو إحداثيات مباشرة.");
    return;
  }

  extractedCustomerCoords = coords;
  $("extractedCoordsBox").classList.remove("hidden");
  $("extractedCoordsText").textContent = `${coords.lat}, ${coords.lng}`;
  setMessage("ok", "تم استخراج الإحداثيات بنجاح.");
}

function useExtractedCoordinates() {
  if (!extractedCustomerCoords) {
    setMessage("warn", "لا توجد إحداثيات مستخرجة.");
    return;
  }

  $("customerLocation").value = `${extractedCustomerCoords.lat},${extractedCustomerCoords.lng}`;
  setMessage("ok", "تم وضع الإحداثيات في خانة العميل.");
}

function useExampleCoordinates() {
  $("customerLocation").value = "30.04822252,31.39434674";
  setMessage("info", "تم وضع مثال جاهز.");
}

async function routeForBranch(customer, branch) {
  try {
    const cleanCustomer = normalizeLatLng(customer);
    const cleanBranch = normalizeLatLng(branch);

    if (!cleanCustomer || !cleanBranch) throw new Error("Invalid coordinates");

    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration"
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: cleanBranch.lat,
              longitude: cleanBranch.lng
            }
          }
        },
        destination: {
          location: {
            latLng: {
              latitude: cleanCustomer.lat,
              longitude: cleanCustomer.lng
            }
          }
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        units: "METRIC",
        routeModifiers: {
          avoidTolls: false,
          avoidHighways: false
        },
        computeAlternativeRoutes: true
      })
    });

    if (!response.ok) throw new Error(await response.text());

    const data = await response.json();

    if (!data.routes || !data.routes.length) throw new Error("No route returned");

    const bestRoute = data.routes.reduce((best, current) =>
      current.distanceMeters < best.distanceMeters ? current : best
    );

    return {
      ...branch,
      distanceMeters: bestRoute.distanceMeters,
      durationSeconds: bestRoute.duration ? parseInt(bestRoute.duration.replace("s", ""), 10) : null
    };

  } catch (error) {
    console.error("Route error:", branch.name, error);
    return { ...branch, distanceMeters: null, durationSeconds: null, error: String(error) };
  }
}

async function calculateRoadDistance() {
  const rawInput = $("customerLocation").value.trim();
  let customer = extractLatLng(rawInput);

  if (!rawInput) {
    setMessage("warn", "اكتب لوكيشن العميل أولاً.");
    return;
  }

  if (typeof customer === "string" || !customer) {
    setMessage("warn", "لوكيشن العميل غير صحيح. استخدم رابط كامل أو إحداثيات مباشرة.");
    return;
  }

  customer = normalizeLatLng(customer);

  if (!branches.length) {
    setMessage("warn", "لا توجد فروع محملة من Firebase.");
    return;
  }

  setMessage("info", '<span class="loader"></span> جاري حساب مسافات الطريق...');

  const results = await Promise.all(branches.map(branch => routeForBranch(customer, branch)));
  const validResults = results.filter(r => typeof r.distanceMeters === "number");

  if (!validResults.length) {
    setMessage("warn", "لم أتمكن من حساب مسافة الطريق. راجع Google API Key أو تفعيل Routes API.");
    return;
  }

  validResults.sort((a, b) => a.distanceMeters - b.distanceMeters);

  const nearest = validResults[0];
  const nearestKm = nearest.distanceMeters / 1000;
  const nearestCost = calculateDeliveryCost(nearestKm);

  $("distanceContent").innerHTML = `
    <div class="muted">أقرب فرع</div>
    <div style="font-size:26px;font-weight:800;margin:6px 0 12px;">${nearest.name}</div>
    <div class="result-box">
      <div class="muted">مسافة الطريق</div>
      <div class="big">${formatDistance(nearest.distanceMeters)}</div>
      <div class="small">المدة التقريبية: ${formatDuration(nearest.durationSeconds) || "—"}</div>
    </div>
  `;

  $("costContent").innerHTML = `
    <div class="result-box green">
      <div>إجمالي تكلفة التوصيل</div>
      <div class="big">${formatNumber(nearestCost)} ج</div>
    </div>
  `;

  $("allBranchesResults").innerHTML = `
    <div class="summary-grid">
      ${validResults.map(branch => {
        const isNearest = branch.id === nearest.id;
        const km = branch.distanceMeters / 1000;
        const cost = calculateDeliveryCost(km);

        return `
          <div class="summary-item ${isNearest ? "nearest" : ""}">
            <div class="summary-head">
              <strong>${branch.name}</strong>
              ${isNearest ? '<span class="status">الأقرب</span>' : ""}
            </div>
            <div class="muted" style="margin-top:10px;">مسافة الطريق</div>
            <div style="font-size:28px;font-weight:800;">${formatDistance(branch.distanceMeters)}</div>
            <div class="small">${branch.durationSeconds ? `المدة: ${formatDuration(branch.durationSeconds)}` : "غير متاح"}</div>
            <div style="margin-top:10px;font-size:22px;font-weight:800;">السعر: ${formatNumber(cost)} ج</div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  setMessage("ok", "تم حساب مسافة الطريق بنجاح باستخدام Google Maps.");
}

async function login() {
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;

  if (!email || !password) {
    setLoginMessage("warn", "اكتب البريد الإلكتروني والباسورد.");
    return;
  }

  try {
    setLoginMessage("info", "جاري تسجيل الدخول...");
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error(error);
    setLoginMessage("warn", `Login error: ${error.code}`);
  }
}

async function logout() {
  await signOut(auth);
}

function bindEvents() {
  $("themeToggle")?.addEventListener("click", toggleTheme);
  $("loginButton")?.addEventListener("click", login);
  $("logoutButton")?.addEventListener("click", logout);
  $("saveAdminButton")?.addEventListener("click", saveAdminSettings);
  $("reloadDataButton")?.addEventListener("click", reloadDataFromFirebase);
  $("convertButton")?.addEventListener("click", convertCustomerLink);
  $("useExtractedButton")?.addEventListener("click", useExtractedCoordinates);
  $("useExampleButton")?.addEventListener("click", useExampleCoordinates);
  $("calculateButton")?.addEventListener("click", calculateRoadDistance);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentRole = null;
    stopLiveListeners();

    $("loginOverlay")?.classList.remove("hidden");
    if ($("userRoleBadge")) $("userRoleBadge").textContent = "غير مسجل";
    $("adminPanel")?.classList.remove("active");
    $("branchesCard")?.classList.add("hidden");
    $("mainGrid")?.classList.add("view-mode");

    return;
  }

  currentRole = user.email === ADMIN_EMAIL ? "admin" : "view";

  await reloadDataFromFirebase();
  setupLiveListeners();

  $("loginOverlay")?.classList.add("hidden");
  setLoginMessage("ok", "تم تسجيل الدخول بنجاح.");
});

initializeTheme();
bindEvents();
