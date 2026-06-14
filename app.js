
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

/* ================= CONFIG ================= */

const firebaseConfig = {
  apiKey: "PUT_FIREBASE_KEY",
  authDomain: "cstore-delivery.firebaseapp.com",
  projectId: "cstore-delivery",
  storageBucket: "cstore-delivery.firebasestorage.app",
  messagingSenderId: "208559702059",
  appId: "PUT_APP_ID"
};

const GOOGLE_MAPS_API_KEY = "PUT_GOOGLE_KEY";

const ADMIN_EMAIL = "admin@cstore.com";

const DEFAULT_PRICING = {
  tier1_km: 5,
  tier1_cost: 35,
  tier2_km: 10,
  tier2_rate: 7,
  tier3_rate: 8
};

/* ================= INIT ================= */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ================= STATE ================= */

let branches = [];
let pricing = { ...DEFAULT_PRICING };
let currentRole = null;

const $ = (id) => document.getElementById(id);

/* ================= PRICE ================= */

function calcPrice(km) {
  if (km <= pricing.tier1_km) return pricing.tier1_cost;

  if (km <= pricing.tier2_km) {
    return pricing.tier1_cost + (km - pricing.tier1_km) * pricing.tier2_rate;
  }

  return (
    pricing.tier1_cost +
    (pricing.tier2_km - pricing.tier1_km) * pricing.tier2_rate +
    (km - pricing.tier2_km) * pricing.tier3_rate
  );
}

/* ================= FIREBASE ================= */

async function loadData() {
  const snap = await getDocs(collection(db, "branches"));
  branches = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const priceDoc = await getDoc(doc(db, "pricing", "main"));
  pricing = priceDoc.exists()
    ? { ...DEFAULT_PRICING, ...priceDoc.data() }
    : DEFAULT_PRICING;
}

/* ================= LOGIN ================= */

async function login() {
  const email = $("emailInput").value;
  const pass = $("passwordInput").value;

  await signInWithEmailAndPassword(auth, email, pass);
}

async function logout() {
  await signOut(auth);
}

/* ================= GOOGLE ROUTE ================= */

async function getRoute(a, b) {
  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
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
              latitude: a.lat,
              longitude: a.lng
            }
          }
        },
        destination: {
          location: {
            latLng: {
              latitude: b.lat,
              longitude: b.lng
            }
          }
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        units: "METRIC"
      })
    }
  );

  const data = await res.json();

  if (!data.routes || !data.routes.length) {
    throw new Error("No route found");
  }

  return data.routes[0];
}

/* ================= EXTRACT ================= */

function extractCoords(input) {
  const match = input.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
  if (!match) return null;

  return {
    lat: Number(match[1]),
    lng: Number(match[2])
  };
}

/* ================= MAIN ================= */

async function calculate() {
  const input = $("customerLocation").value;

  const customer = extractCoords(input);

  if (!customer) {
    alert("ادخل إحداثيات صحيحة");
    return;
  }

  let results = [];

  for (let b of branches) {
    const route = await getRoute(b, customer);

    const km = route.distanceMeters / 1000;

    results.push({
      ...b,
      km,
      price: calcPrice(km),
      distanceMeters: route.distanceMeters
    });
  }

  results.sort((a, b) => a.distanceMeters - b.distanceMeters);

  render(results);
}

/* ================= UI ================= */

function render(results) {
  const nearest = results[0];

  $("distanceContent").innerHTML = `
    <div class="muted">أقرب فرع</div>
    <div class="big">${nearest.name}</div>
    <div>${nearest.km.toFixed(2)} كم</div>
  `;

  $("costContent").innerHTML = `
    <div class="big">${nearest.price.toFixed(0)} جنيه</div>
  `;

  let html = "";

  results.forEach((b, i) => {
    html += `
      <div class="branch-card ${i === 0 ? "nearest" : ""}">
        <div class="branch-name">
          ${b.name} ${i === 0 ? "⭐ الأقرب" : ""}
        </div>

        <div class="branch-distance">
          المسافة: ${b.km.toFixed(2)} كم
        </div>

        <div class="branch-price">
          السعر: ${b.price.toFixed(0)} ج
        </div>
      </div>
    `;
  });

  $("allBranchesResults").innerHTML = html;
}

/* ================= EVENTS ================= */

function bind() {
  $("loginButton").onclick = login;
  $("logoutButton").onclick = logout;
  $("calculateButton").onclick = calculate;

  $("saveAdminButton")?.addEventListener("click", async () => {
    await setDoc(doc(db, "pricing", "main"), pricing);
    alert("Saved");
  });
}

/* ================= AUTH ================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $("loginOverlay").classList.remove("hidden");
    return;
  }

  $("loginOverlay").classList.add("hidden");

  currentRole = user.email === ADMIN_EMAIL ? "admin" : "view";

  await loadData();

  bind();
});
