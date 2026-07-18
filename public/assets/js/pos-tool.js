// POS reservation tool (call-center CSF layout) shared by the live app and the
// Rise/Reach embed.
//
// Extracted from app.js renderCall() so BOTH surfaces render the SAME markup +
// wiring with no risk of drifting apart (same precedent as cs-tool.js). The
// markup, ids, and classes are byte-identical to the pre-extraction app.js:
// the instructor-live-mode DOM snapshots (clonePosHtml/snapshotLivePos) and the
// styles in styles.css depend on them, so do not rename anything here without
// checking those readers.
//
// Exports:
//   posToolHtml()            -> the POS work-surface markup (a string). No
//                               scenario data is baked into the markup; all
//                               runtime data flows in via wirePosTool.
//   wirePosTool(root, opts)  -> wires the POS inside root (the container that
//                               holds the rendered markup). opts:
//                                 scenario   (required) the active scenario
//                                 onFieldTip (el) called once with the floating
//                                            script-tooltip element so the host
//                                            can own its teardown
//                                 endpoints  { geocode, staticmap } URL
//                                            overrides for token-authed hosts
//                               Returns { getCallbackNotes(), destroy() }.

// Verbatim copies of app.js's helpers so this module never has to import from
// app.js (mirrors cs-tool.js keeping its own local escapeHtml).
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function escapeAttr(s) {
  return escapeHtml(s);
}

// Meridian's San Antonio branch network. Surfaced in the CSR panel so the
// agent can match the pickup branch to where the customer is loading.
const BRANCHES = [
  {
    name: 'Downtown',
    area: 'Central',
    address: '410 S Santa Rosa Ave, San Antonio, TX 78207',
    hours: 'Mon-Sat 7a-7p, Sun 9a-5p',
    serves: 'Downtown, Southtown, King William, Tobin Hill',
    lat: 29.4218,
    lng: -98.4980,
  },
  {
    name: 'Northgate',
    area: 'North Central',
    address: '14200 San Pedro Ave, San Antonio, TX 78232',
    hours: 'Mon-Sat 7a-7p, Sun 9a-5p',
    serves: 'Stone Oak, Northwest Hills, Hollywood Park, North Central',
    lat: 29.6010,
    lng: -98.4910,
  },
  {
    name: 'Riverside',
    area: 'Southeast',
    address: '800 SE Military Dr, San Antonio, TX 78214',
    hours: 'Mon-Sat 7a-6p, Sun closed',
    serves: 'Riverside, Highland Park, Southeast Side',
    lat: 29.3517,
    lng: -98.4799,
  },
  {
    name: 'Westside',
    area: 'West',
    address: '2100 Culebra Rd, San Antonio, TX 78228',
    hours: 'Mon-Sat 7a-7p, Sun 9a-5p',
    serves: 'West Side, Leon Valley, Loma Park',
    lat: 29.4561,
    lng: -98.5475,
  },
  {
    name: 'Airport',
    area: 'North / Airport',
    address: '9800 Airport Blvd, San Antonio, TX 78216',
    hours: 'Daily 6a-9p',
    serves: 'Airport corridor, North Central, Uptown',
    lat: 29.5293,
    lng: -98.4690,
  },
];

// Cincinnati-area branches for the demo (Robert's one-way is FROM Cincinnati).
const CINCINNATI_BRANCHES = [
  {
    name: 'Downtown',
    area: 'Central',
    address: '1208 Central Pkwy, Cincinnati, OH 45202',
    hours: 'Mon-Sat 7a-7p, Sun 9a-5p',
    serves: 'Downtown, Over-the-Rhine, Pendleton, West End',
    lat: 39.1095,
    lng: -84.5170,
  },
  {
    name: 'Oakley',
    area: 'Northeast',
    address: '3025 Madison Rd, Cincinnati, OH 45209',
    hours: 'Mon-Sat 7a-7p, Sun 9a-5p',
    serves: 'Oakley, Hyde Park, Norwood, Pleasant Ridge',
    lat: 39.1556,
    lng: -84.4270,
  },
  {
    name: 'Western Hills',
    area: 'West',
    address: '5400 Glenway Ave, Cincinnati, OH 45238',
    hours: 'Mon-Sat 7a-6p, Sun closed',
    serves: 'Western Hills, Westwood, Price Hill, Cheviot',
    lat: 39.1140,
    lng: -84.6090,
  },
  {
    name: 'Blue Ash',
    area: 'North',
    address: '9920 Kenwood Rd, Blue Ash, OH 45242',
    hours: 'Mon-Sat 7a-7p, Sun 9a-5p',
    serves: 'Blue Ash, Montgomery, Kenwood, Sycamore',
    lat: 39.2320,
    lng: -84.3783,
  },
  {
    name: 'Florence',
    area: 'South / Northern KY',
    address: '7585 Mall Rd, Florence, KY 41042',
    hours: 'Daily 7a-8p',
    serves: 'Florence, Covington, Newport, Northern Kentucky',
    lat: 38.9989,
    lng: -84.6266,
  },
];

// Branch sets by metro, chosen by the scenario's origin so pickup locations
// match where the customer is actually loading. Each metro carries its own
// phone list (correct area codes). The first entry is the default fallback
// when a scenario has no origin location.
const METROS = [
  {
    center: { lat: 29.4241, lng: -98.4936 },
    branches: BRANCHES,
    phones: ['(210) 555-3120', '(210) 555-4786', '(210) 555-2941', '(210) 555-6075', '(210) 555-8312'],
  },
  {
    center: { lat: 39.1031, lng: -84.5120 },
    branches: CINCINNATI_BRANCHES,
    phones: ['(513) 555-3120', '(513) 555-4786', '(513) 555-2941', '(513) 555-6075', '(859) 555-8312'],
  },
];

// Rough great-circle miles between two {lat,lng} points (module scope so branch
// selection can run before renderCall's local helper is in scope).
function milesBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Pick the metro whose center is nearest the scenario's origin; default to the
// first metro (San Antonio) when the scenario has no location. scenario.location
// may use `lon` or `lng`.
function metroForLocation(loc) {
  const lat = loc && Number.isFinite(loc.lat) ? loc.lat : null;
  const lng = loc ? (Number.isFinite(loc.lng) ? loc.lng : loc.lon) : null;
  if (lat == null || !Number.isFinite(lng)) return METROS[0];
  let best = METROS[0];
  let bestMi = Infinity;
  for (const m of METROS) {
    const mi = milesBetween({ lat, lng }, m.center);
    if (mi < bestMi) { bestMi = mi; best = m; }
  }
  return best;
}

// In-town: base is the 24-hour (per-day) rate, charged per day plus per_mile
// mileage. One-way: ow_base + distance * ow_mile is a single bundled rate that
// already includes the days and miles the route needs.
// In-town base/per_mile unchanged. One-way (ow_base + dist*ow_mile) is
// calibrated so the demo route (~1340 mi Cincinnati->Austin) lands on the
// real-system reference prices: 10'≈$1,756, 15'≈$1,848, 20'≈$2,310, 26'≈$2,771.
const TRUCK_SIZES = [
  { size: 10, label: "10' Moving Truck", base: 19.95, per_mile: 0.79, ow_base: 282, ow_mile: 1.10 },
  { size: 15, label: "15' Moving Truck", base: 29.95, per_mile: 0.89, ow_base: 294, ow_mile: 1.16 },
  { size: 20, label: "20' Moving Truck", base: 39.95, per_mile: 1.19, ow_base: 367, ow_mile: 1.45 },
  { size: 26, label: "26' Moving Truck", base: 49.95, per_mile: 1.29, ow_base: 439, ow_mile: 1.74 },
];
const TRUCK_BY_SIZE = Object.fromEntries(TRUCK_SIZES.map((t) => [t.size, t]));

// Add-on equipment for the Location-step MODEL/PRICE table. Flat one-way
// prices (these don't scale meaningfully with distance). category drives the
// Trucks/Trailers/Towing filter checkboxes; available:false renders the row
// greyed with the "* not available at current location" footnote. Toggling a
// row adds/removes it from the cart as a flat line item.
const EQUIPMENT_ADDONS = [
  { key: 'tr_5x8_cargo', label: "5' x 8' Cargo Trailer", category: 'trailer', price: 494, available: true },
  { key: 'tr_4x8_cargo', label: "4' x 8' Cargo Trailer", category: 'trailer', price: 372, available: true },
  { key: 'tr_5x9_util', label: "5' x 9' Utility Trailer with Ramp", category: 'trailer', price: 494, available: true },
  { key: 'tr_6x12_cargo', label: "6' x 12' Cargo Trailer", category: 'trailer', price: 866, available: false },
  { key: 'tow_auto', label: 'Auto Transport', category: 'towing', price: 695, available: true },
  { key: 'tow_dolly', label: 'Tow Dolly', category: 'towing', price: 350, available: true },
  { key: 'tow_toyhauler', label: 'Toy Hauler', category: 'towing', price: 426, available: false },
];
const ADDON_BY_KEY = Object.fromEntries(EQUIPMENT_ADDONS.map((a) => [a.key, a]));

const LOAD_SIZES = [
  { value: 'home_improvement', label: 'Home Improvement / Small Loads', truck: 10 },
  { value: 'apt_studio', label: 'Apartment - 1 Bedroom / Studio / Deliveries', truck: 10 },
  { value: 'studio_1br', label: 'Studio to 1 Bedroom Apt.', truck: 10 },
  { value: '1br_2br', label: '1 Bedroom Home to 2 Bedroom Apt.', truck: 15 },
  { value: '2br_3br', label: '2 Bedroom Home to 3 Bedroom Apt.', truck: 20 },
  { value: '3br_4br', label: '3 Bedroom Home to 4 Bedroom Home', truck: 26 },
  { value: 'other', label: 'Other', truck: null },
];
const LOAD_BY_VALUE = Object.fromEntries(LOAD_SIZES.map((l) => [l.value, l]));

const RENTAL_LENGTHS = [
  { value: '1', label: '1 day (24 hours)', days: 1 },
  { value: '2', label: '2 days', days: 2 },
  { value: '3', label: '3 days', days: 3 },
  { value: '4', label: '4 days', days: 4 },
  { value: '5', label: '5 days', days: 5 },
  { value: '7', label: '7 days', days: 7 },
];
const RENTAL_BY_VALUE = Object.fromEntries(RENTAL_LENGTHS.map((r) => [r.value, r]));

// ---- CSF chrome (matches preview.js) ----
// Per-step display title for the topbar + charcoal panel head. Step 1 shows
// "Moving Truck" in the panel head (it's the equipment category) but "Reservation
// Details" in the topbar title.
const STEP_TITLES = {
  1: 'Reservation Details',
  2: 'Choose Equipment',
  3: 'Select Pick Up Location',
  4: 'Scheduling',
  5: 'Checkout',
};
const CSF_TABS = ['Moving Truck', 'Moving Container', 'Storage', 'Hitch', 'Moving Help', 'Ready-To-Go Box', 'Hookup'];
const SCRIPT_ICON = `<svg class="csf-script-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const EDIT_ICON = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><path d="M9.5 3 L13 6.5 L6 13.5 L2.5 13.5 L2.5 10 Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
const TRUCK_SVG = `<svg viewBox="0 0 72 40" fill="none" aria-hidden="true"><rect x="2" y="9" width="40" height="21" rx="2" stroke="currentColor" stroke-width="2"/><path d="M42 15h11l9 9v6H42z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M44 24h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="32" r="4.5" fill="#fff" stroke="currentColor" stroke-width="2"/><circle cx="52" cy="32" r="4.5" fill="#fff" stroke="currentColor" stroke-width="2"/></svg>`;
const BACK_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M9 5 L6 8 L9 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const NEXT_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M7 5 L10 8 L7 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const INFO_ICON = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2v3.6M8 5.2v.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const TRASH_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// The floating per-field script tooltip for the CURRENT wiring. Module-level so
// a re-wire can sweep a stray tip from a previous call view (belt-and-braces;
// the host's teardown normally removes it first via onFieldTip).
let activeFieldTip = null;

export function posToolHtml() {
  const loadSizeOptionsHtml = ['<option value="">Select...</option>']
    .concat(LOAD_SIZES.map((l) => `<option value="${l.value}">${escapeHtml(l.label)}</option>`)).join('');

  const rentalLengthOptionsHtml = RENTAL_LENGTHS
    .map((r) => `<option value="${r.value}"${r.value === '1' ? ' selected' : ''}>${escapeHtml(r.label)}</option>`).join('');

  const timeSlotsHtml = (() => {
    const out = ['<option value="">Select a time...</option>'];
    for (let h = 8; h <= 18; h++) {
      for (const m of [0, 30]) {
        const ampm = h < 12 ? 'AM' : 'PM';
        const hh = ((h + 11) % 12) + 1;
        const label = `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
        out.push(`<option value="${label}">${label}</option>`);
      }
    }
    return out.join('');
  })();

  const expMonthsHtml = ['<option value="">Month</option>']
    .concat(Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      return `<option value="${mm}">${mm}</option>`;
    })).join('');

  const nowYear = new Date().getFullYear();
  const expYearsHtml = ['<option value="">Year</option>']
    .concat(Array.from({ length: 9 }, (_, i) => {
      const yy = nowYear + i;
      return `<option value="${String(yy).slice(-2)}">${yy}</option>`;
    })).join('');

  const csfTabsHtml = CSF_TABS.map((t, i) =>
    `<button type="button" class="csf-tab${i === 0 ? ' active' : ''}">${escapeHtml(t)}</button>`
  ).join('');

  return `
        <div class="csf-topbar" id="pos-topbar">
          <div class="csf-topbar-titles">
            <div class="csf-eyebrow">Customer Service Form</div>
            <div class="csf-title" id="pos-topbar-title">${escapeHtml(STEP_TITLES[1])}</div>
          </div>
          <div class="csf-topbar-nav">
            <div class="csf-nav-row">
              <a class="csf-nav-link">FAQs</a>
              <a class="csf-nav-link">POS Dashboard</a>
            </div>
            <div class="csf-topbar-action" id="pos-topbar-action">
              <button type="button" class="csf-new-btn" id="pos-top-new">New Reservation</button>
              <div class="csf-topbar-actions" id="pos-top-steps" hidden>
                <button type="button" class="csf-topbtn" id="pos-top-back">${BACK_ICON} Back</button>
                <button type="button" class="csf-topbtn" id="pos-top-next">${NEXT_ICON} Next</button>
                <button type="button" class="csf-topbtn" id="pos-top-save">${CLOSE_ICON} Save/Close Quote</button>
              </div>
            </div>
          </div>
        </div>

        <div class="pos" id="pos">
          <aside class="pos-rail pos-rail-left" aria-label="Customer and reservation context">
            <section class="pos-card" id="pos-customer-card">
              <div class="pos-card-head">
                <span class="pos-card-title" id="pos-customer-title">Customer Contact Information</span>
                <span class="pos-verified" id="pos-verified" hidden>Verified Customer</span>
                <button type="button" class="pos-card-edit" id="pos-customer-edit" hidden aria-label="Edit customer information" title="Edit customer information">${EDIT_ICON}</button>
              </div>
              <div class="pos-card-body" id="pos-customer-body">
                <div class="pos-script">
                  <svg class="pos-script-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
                  <div class="pos-script-lines">
                    <p class="pos-script-line">Thank you for calling Meridian Moving and Storage, this is your name. How may I help you?</p>
                    <p class="pos-script-suggest">No problem! May I start with your cell phone number?</p>
                  </div>
                </div>
                <div class="pos-lookup">
                  <input class="pos-input" id="pos-lookup-input" type="text" placeholder="Phone number or email address">
                  <button type="button" class="pos-lookup-btn" id="pos-lookup-btn" aria-label="Search">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                  </button>
                </div>
                <div class="pos-lookup-result" id="pos-lookup-result" hidden></div>
              </div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Checklist</span></div>
              <div class="pos-card-body">
                <div class="pos-check-item">Moving Truck</div>
              </div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Reservation Details</span>${EDIT_ICON}</div>
              <div class="pos-card-body" id="pos-rsvdetails-body">
                <p class="pos-card-empty">Details fill in as you build the reservation.</p>
              </div>
            </section>

            <section class="pos-card" id="pos-entity-card" hidden>
              <div class="pos-card-head"><span class="pos-card-title" id="pos-entity-title">Entity</span></div>
              <div class="pos-card-body" id="pos-entity-body"></div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Reservation Notes</span>${EDIT_ICON}</div>
              <div class="pos-card-body">
                <div class="csf-notes-label">Customer Notes</div>
                <p class="csf-notes-text pos-note-text" id="pos-customer-notes">No cautionary notes</p>
                <div class="csf-notes-label">Callback Notes</div>
                <textarea class="pos-input pos-notes-input" id="pos-callback-notes" rows="3" placeholder="Add a note about this reservation..." aria-label="Callback notes"></textarea>
              </div>
            </section>
          </aside>

          <div class="pos-stage">
            <ol class="pos-stepper" id="pos-stepper" aria-label="Reservation steps" hidden>
              <li class="pos-stepper-item active" data-step="1"><span class="pos-stepper-num">1</span><span class="pos-stepper-label">Details</span></li>
              <li class="pos-stepper-item" data-step="2"><span class="pos-stepper-num">2</span><span class="pos-stepper-label">Equipment</span></li>
              <li class="pos-stepper-item" data-step="3"><span class="pos-stepper-num">3</span><span class="pos-stepper-label">Location</span></li>
              <li class="pos-stepper-item" data-step="4"><span class="pos-stepper-num">4</span><span class="pos-stepper-label">Time</span></li>
              <li class="pos-stepper-item" data-step="5"><span class="pos-stepper-num">5</span><span class="pos-stepper-label">Checkout</span></li>
            </ol>

            <div class="csf-tabs" id="pos-tabs">${csfTabsHtml}</div>

            <div class="csf-panel" id="pos-panel">
              <div class="csf-panel-head" id="pos-panel-head"><span id="pos-panel-head-text">Moving Truck</span>${INFO_ICON}</div>
              <div class="csf-panel-body">
            <form class="pos-form" id="pos-form" autocomplete="off" novalidate>
              <section class="pos-step" data-step="1">
                <div class="pos-grid-3">
                  <label class="pos-field">
                    <span class="pos-field-label">Moving From</span>
                    <input class="pos-input" data-rsv="moving_from" type="text" placeholder="City, state">
                  </label>
                  <label class="pos-field">
                    <span class="pos-field-label">Moving To (Optional)</span>
                    <input class="pos-input" data-rsv="moving_to" type="text" placeholder="City, state">
                  </label>
                  <div class="pos-field">
                    <span class="pos-field-label">Move Type</span>
                    <div class="pos-radio-row">
                      <label class="pos-radio"><input type="radio" name="move_type" data-rsv="move_type" value="in_town" checked> In Town</label>
                      <label class="pos-radio"><input type="radio" name="move_type" data-rsv="move_type" value="one_way"> One Way</label>
                    </div>
                  </div>
                </div>

                <div class="pos-grid-2">
                  <label class="pos-field">
                    <span class="pos-field-label">Move/Pickup Date</span>
                    <input class="pos-input" data-rsv="pickup_date" type="date">
                  </label>
                  <label class="pos-field">
                    <span class="pos-field-label">How many bedrooms?</span>
                    <select class="pos-input" data-rsv="load_size">${loadSizeOptionsHtml}</select>
                  </label>
                </div>

                <div class="pos-grid-2">
                  <div class="pos-field">
                    <span class="pos-field-label">Are you towing a vehicle?</span>
                    <div class="pos-radio-row">
                      <label class="pos-radio"><input type="radio" name="towing" data-rsv="towing" value="yes"> Yes</label>
                      <label class="pos-radio"><input type="radio" name="towing" data-rsv="towing" value="no" checked> No</label>
                    </div>
                  </div>
                  <div class="pos-field">
                    <span class="pos-field-label">Do you need a trailer?</span>
                    <div class="pos-radio-row">
                      <label class="pos-radio"><input type="radio" name="trailer" data-rsv="trailer" value="yes"> Yes</label>
                      <label class="pos-radio"><input type="radio" name="trailer" data-rsv="trailer" value="no" checked> No</label>
                    </div>
                  </div>
                </div>
              </section>

              <section class="pos-step" data-step="2" hidden>
                <div class="csf-script">
                  <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text" id="pos-equip-script-rate">Add a load size on the previous step to see the recommended rate.</p></div>
                  <div class="csf-script-row" id="pos-equip-script-secure-row" hidden>${SCRIPT_ICON}<p class="csf-script-text">Which credit card would you like to secure your reservation with?</p></div>
                </div>
                <div class="csf-objection">Is the customer not ready to book? <a class="csf-link">Click for help to overcome their objections</a> to book now!</div>

                <div class="pos-equip-rec" id="pos-equip-rec" data-size="?">
                  <div class="pos-equip-badge">Recommended</div>
                  <div class="pos-equip-body">
                    <div class="pos-equip-photo" aria-hidden="true">${TRUCK_SVG}</div>
                    <div class="pos-equip-name" id="pos-equip-name">Add a load size on the previous step to see a fit.</div>
                    <div class="pos-equip-rate mono" id="pos-equip-rate"></div>
                    <p class="pos-equip-includes" id="pos-equip-includes"></p>
                    <div class="pos-grid-2 pos-field-inline">
                      <label class="pos-field" id="pos-field-rental">
                        <span class="pos-field-label">Rental Length (24-hr periods)</span>
                        <select class="pos-input" data-rsv="rental_length">${rentalLengthOptionsHtml}</select>
                      </label>
                      <label class="pos-field" id="pos-field-miles">
                        <span class="pos-field-label" id="pos-miles-label">Estimated miles</span>
                        <input class="pos-input" data-rsv="miles" type="number" min="0" step="1" placeholder="e.g. 25" value="0">
                      </label>
                    </div>
                    <a class="csf-link pos-equip-dims">&#9776; Dimensions</a>
                  </div>
                </div>

                <details class="pos-equip-all">
                  <summary>+ Show all moving equipment</summary>
                  <div class="pos-equip-grid">
                    ${TRUCK_SIZES.map((t) => `
                      <button type="button" class="pos-equip-opt" data-truck="${t.size}">
                        <span class="pos-equip-opt-name">${t.size}' Moving Truck</span>
                        <span class="pos-equip-opt-rate mono">$${t.base.toFixed(2)}/day + $${t.per_mile.toFixed(2)}/mi</span>
                      </button>
                    `).join('')}
                  </div>
                </details>
              </section>

              <section class="pos-step" data-step="3" hidden>
                <div class="csf-script">
                  <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">The closest pickup spot to you is the location below. Does that work?</p></div>
                </div>
                <p class="pos-hint" id="pos-loc-hint">Pick the location nearest where the customer is loading. Sorted by distance.</p>
                <div class="csf-loc-controls">
                  <span class="csf-loc-sort">Sort by: Distance to Customer</span>
                  <div class="csf-loc-filters">
                    <label class="pos-check"><input type="checkbox" data-equip-filter="truck" checked> Trucks</label>
                    <label class="pos-check"><input type="checkbox" data-equip-filter="trailer"> Trailers</label>
                    <label class="pos-check"><input type="checkbox" data-equip-filter="towing"> Towing</label>
                  </div>
                  <div class="csf-loc-legend">
                    <span><i class="csf-legend-sq" style="background:#16a34a;"></i> Available</span>
                    <span><i class="csf-legend-sq" style="background:#ea7a1d;"></i> Alternate Models</span>
                    <span><i class="csf-legend-sq" style="background:#dc2626;"></i> No Availability</span>
                  </div>
                </div>
                <div class="csf-loc-split">
                  <div class="csf-loc-col-left">
                    <div class="pos-loc-map" id="pos-loc-map" hidden></div>
                    <div class="csf-loc-avail-head">Available and Closest</div>
                    <div class="pos-loc-list" id="pos-loc-list"></div>
                    <a class="csf-loc-more">View More Locations&hellip;</a>
                  </div>
                  <div class="csf-loc-col-right">
                    <div class="csf-equip-avail-name" id="pos-equip-avail-name">Available Equipment</div>
                    <table class="csf-equip-table pos-equip-table">
                      <thead><tr><th>Model</th><th>Price</th></tr></thead>
                      <tbody id="pos-equip-table-body"></tbody>
                    </table>
                    <p class="csf-equip-foot" id="pos-equip-foot" hidden>* Selection not available at current location.</p>
                  </div>
                </div>
              </section>

              <section class="pos-step" data-step="4" hidden>
                <div class="csf-sched-grid">
                  <div class="csf-sched-left">
                    <div class="pos-sched-truck" id="pos-sched-truck"></div>
                    <div class="csf-sched-addlinks">
                      <a class="csf-link">+ Add Coverage</a>
                      <a class="csf-link">+ Add Dollies/Furniture Pads</a>
                      <a class="csf-link">+ Add Trailer / Towing</a>
                    </div>
                    <div class="pos-sched-loc" id="pos-sched-loc"></div>
                  </div>
                  <div class="csf-sched-right">
                    <!-- One-way: pick AM/PM, then a local rep calls to finalize
                         location/time/equipment (matches the real CSF). -->
                    <div class="csf-sched-block" id="sched-oneway" hidden>
                      <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">Would you prefer to pick up in the AM or PM?</p></div>
                      <div class="pos-field">
                        <div class="pos-radio-row">
                          <label class="pos-radio"><input type="radio" name="pickup_window" data-rsv="pickup_window" value="A.M."> A.M.</label>
                          <label class="pos-radio"><input type="radio" name="pickup_window" data-rsv="pickup_window" value="P.M." checked> P.M.</label>
                        </div>
                      </div>
                      <label class="pos-check"><input type="checkbox" data-rsv-flag="send_to_traffic" checked> Send to Traffic</label>
                      <div class="csf-sched-advisory">
                        <div class="csf-sched-advisory-head">IMPORTANT: READ TO CUSTOMER!</div>
                        <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">A local Meridian representative will call you by 6:00 PM on <span id="sched-advisory-date">the day before your pickup</span> to get your agreement on and schedule available location, time, and equipment.</p></div>
                        <label class="pos-check"><input type="checkbox" data-rsv-flag="advisory_read"> I have READ the above advisories to the customer</label>
                      </div>
                    </div>
                    <!-- In-town: schedule a specific pickup time, as before. -->
                    <div class="csf-sched-block" id="sched-intown" hidden>
                      <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">What time would you like to pick up?</p></div>
                      <label class="pos-field">
                        <span class="pos-field-label">Available Times</span>
                        <select class="pos-input" data-rsv="pickup_time">${timeSlotsHtml}</select>
                      </label>
                      <div class="pos-field">
                        <span class="pos-field-label">Pickup Method</span>
                        <div class="pos-radio-row">
                          <label class="pos-radio"><input type="radio" name="pickup_method" data-rsv="pickup_method" value="in_store" checked> In Store</label>
                          <label class="pos-radio"><input type="radio" name="pickup_method" data-rsv="pickup_method" value="truckshare"> TruckShare</label>
                        </div>
                      </div>
                      <a class="csf-link" style="display:inline-block;margin-bottom:12px;">Check Other Locations</a>
                      <label class="pos-check"><input type="checkbox" data-rsv-flag="send_to_traffic"> Send to Traffic</label>
                    </div>
                  </div>
                </div>
              </section>

              <section class="pos-step csf-checkout" data-step="5" hidden>
                <div class="pos-test-banner">Simulation mode. Card details are not stored or charged.</div>
                <div class="pos-card-status" id="pos-card-status">Enter the card in the Credit Card panel to confirm.</div>

                <section class="pos-card">
                  <div class="pos-card-head" style="display:flex;align-items:center;justify-content:space-between;"><span class="pos-card-title">Additional Products and Services</span>${INFO_ICON}</div>
                  <div class="pos-card-body">
                    <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">Will you need storage before or after your move?</p></div>
                    <label class="pos-field">
                      <span class="pos-field-label">Will you need storage before or after the move?</span>
                      <select class="pos-input" data-rsv="storage">
                        <option value="no">No storage needed</option>
                        <option value="before">Yes, before the move</option>
                        <option value="after">Yes, after the move</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section class="pos-card">
                  <div class="pos-card-head"><span class="pos-card-title">Verify Contact Information for Scheduling</span></div>
                  <div class="pos-card-body">
                    <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">What is your preferred method of contact; email, phone or text?</p></div>
                    <p class="csf-verify-note">Please verify with your customer the email/phone number shown below.</p>
                    <ul class="csf-verify-list">
                      <li>Customer's Email Address is required if they prefer being contacted via Email.</li>
                      <li>Customer's Phone Number is required if they prefer being contacted via Phone or Text.</li>
                    </ul>
                    <div class="pos-grid-3">
                      <label class="pos-field">
                        <span class="pos-field-label">Email for Reservation Receipt</span>
                        <input class="pos-input" data-rsv="receipt_email" type="text" inputmode="email" placeholder="name@example.com">
                      </label>
                      <label class="pos-field">
                        <span class="pos-field-label">Phone Number</span>
                        <input class="pos-input" data-rsv="receipt_phone" type="tel" placeholder="555-123-4567">
                      </label>
                      <div class="pos-field">
                        <span class="pos-field-label">Preferred Contact Method</span>
                        <div class="pos-check-row">
                          <label class="pos-check"><input type="checkbox" data-rsv-contact="email"> Email</label>
                          <label class="pos-check"><input type="checkbox" data-rsv-contact="phone"> Phone</label>
                          <label class="pos-check"><input type="checkbox" data-rsv-contact="text" checked> Text</label>
                        </div>
                      </div>
                    </div>
                    <div class="csf-script-row">${SCRIPT_ICON}<p class="csf-script-text">May I please have your current address?</p></div>
                    <div class="pos-grid-2">
                      <label class="pos-field">
                        <span class="pos-field-label">Current Address</span>
                        <input class="pos-input" data-rsv="current_address" type="text" placeholder="Optional">
                      </label>
                      <div class="pos-field">
                        <span class="pos-field-label">Preferred Language</span>
                        <div class="pos-radio-row">
                          <label class="pos-radio"><input type="radio" name="language" data-rsv="language" value="english" checked> English</label>
                          <label class="pos-radio"><input type="radio" name="language" data-rsv="language" value="french"> French</label>
                          <label class="pos-radio"><input type="radio" name="language" data-rsv="language" value="spanish"> Spanish</label>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </section>

              <div class="pos-error" id="pos-error" hidden></div>
            </form>
                <div class="pos-nav csf-panel-foot">
                  <button type="button" class="ghost-button" id="pos-back" hidden>Back</button>
                  <button type="submit" class="primary-button" id="pos-next" form="pos-form">Continue</button>
                </div>
              </div>
            </div>

            <div class="pos-result" id="pos-result"></div>
          </div>

          <aside class="pos-rail pos-rail-right" aria-label="Cart and payment">
            <section class="pos-card pos-cart-card">
              <div class="pos-card-head pos-card-head-accent"><span class="pos-card-title">Shopping Cart</span><span style="cursor:pointer;">${TRASH_ICON}</span></div>
              <div class="pos-card-body" id="pos-cart-body">
                <p class="pos-card-empty">Add equipment to start the cart.</p>
              </div>
            </section>

            <section class="pos-card">
              <div class="pos-card-head"><span class="pos-card-title">Credit Card</span></div>
              <div class="pos-card-body pos-cc">
                <label class="pos-field">
                  <span class="pos-field-label">Card Number</span>
                  <input class="pos-input pos-cc-num" data-rsv="card_number" type="text" inputmode="numeric" autocomplete="off" placeholder="" maxlength="23" aria-label="Card number (masked as you type)">
                </label>
                <div class="pos-grid-2">
                  <label class="pos-field">
                    <span class="pos-field-label">Exp Month</span>
                    <select class="pos-input" data-rsv="card_exp_month">${expMonthsHtml}</select>
                  </label>
                  <label class="pos-field">
                    <span class="pos-field-label">Exp Year</span>
                    <select class="pos-input" data-rsv="card_exp_year">${expYearsHtml}</select>
                  </label>
                </div>
                <label class="pos-field">
                  <span class="pos-field-label">Billing Zip Code</span>
                  <input class="pos-input" data-rsv="card_zip" type="text" inputmode="numeric" autocomplete="postal-code" placeholder="78207" maxlength="5">
                </label>
                <div class="pos-cc-chip" id="pos-cc-chip" data-brand="unknown" hidden>
                  <span class="pos-cc-brand" id="pos-cc-brand">CARD</span>
                  <span class="mono" id="pos-cc-last4">&bull;&bull;&bull;&bull;</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
  `;
}

export function wirePosTool(root, opts = {}) {
  const { scenario, onFieldTip = () => {}, endpoints = {} } = opts;
  if (!root || !scenario) return null;
  const byId = (id) => root.querySelector('#' + id);
  const GEOCODE_URL = endpoints.geocode || '/api/geocode';
  const STATICMAP_URL = endpoints.staticmap || '/api/staticmap';
  const isShowcaseCall = typeof scenario.id === 'string' && scenario.id.startsWith('showcase_');

  // Pickup branches for the metro the customer is moving FROM (Cincinnati for
  // the demo), so the location step shows locations that make sense.
  const originMetro = metroForLocation(scenario.location);
  const POS_LOCATIONS = originMetro.branches.map((b, i) => ({
    ...b,
    entity: String(833071 - i * 412),
    distance: (1.6 + i * 2.4).toFixed(1),
    phone: originMetro.phones[i] || originMetro.phones[0],
    available_sizes: i === 2 ? [10, 15, 20] : [10, 15, 20, 26],
  }));
  const LOC_BY_NAME = Object.fromEntries(POS_LOCATIONS.map((l) => [l.name, l]));

  const pos = byId('pos');
  const posForm = byId('pos-form');
  const posStepper = byId('pos-stepper');
  const posNav = pos.querySelector('.pos-nav');
  const posNextBtn = byId('pos-next');
  const posBackBtn = byId('pos-back');
  const posErrorEl = byId('pos-error');
  const posResult = byId('pos-result');
  const posCartBody = byId('pos-cart-body');
  const posCcChip = byId('pos-cc-chip');
  const posCcBrand = byId('pos-cc-brand');
  const posCcLast4 = byId('pos-cc-last4');
  const posCardStatus = byId('pos-card-status');
  const posEquipRec = byId('pos-equip-rec');
  const posEquipName = byId('pos-equip-name');
  const posEquipRate = byId('pos-equip-rate');
  const posEquipHint = byId('pos-equip-hint');
  const posLocList = byId('pos-loc-list');
  const posEquipTableBody = byId('pos-equip-table-body');
  const posEquipAvailName = byId('pos-equip-avail-name');
  const posEquipFoot = byId('pos-equip-foot');
  const posSchedTruck = byId('pos-sched-truck');
  const posSchedLoc = byId('pos-sched-loc');
  const posVerified = byId('pos-verified');
  const posCustomerBody = byId('pos-customer-body');
  const posRsvDetailsBody = byId('pos-rsvdetails-body');
  const posEntityCard = byId('pos-entity-card');
  const posEntityTitle = byId('pos-entity-title');
  const posEntityBody = byId('pos-entity-body');
  const posCustomerNotes = byId('pos-customer-notes');
  const posLookupInput = byId('pos-lookup-input');
  const posLookupBtn = byId('pos-lookup-btn');
  const posLookupResult = byId('pos-lookup-result');
  // CSF chrome refs
  const posTopbarTitle = byId('pos-topbar-title');
  const posTopNewBtn = byId('pos-top-new');
  const posTopStepsWrap = byId('pos-top-steps');
  const posTopBackBtn = byId('pos-top-back');
  const posTopNextBtn = byId('pos-top-next');
  const posTabs = byId('pos-tabs');
  const posPanel = byId('pos-panel');
  const posPanelHeadText = byId('pos-panel-head-text');
  const posCustomerTitle = byId('pos-customer-title');
  const posCustomerEdit = byId('pos-customer-edit');
  posCustomerEdit?.addEventListener('click', openCustomerEditModal);

  const WAIVER_INFO = {
    none: { label: 'Waiver declined', daily: 0 },
    basic: { label: 'Basic waiver', daily: 15 },
    premium: { label: 'Premium waiver', daily: 25 },
  };
  const ENV_FEE = 5.00;
  const VLRF = 1.20;
  const TAX_RATE = 0.0825;
  const TOTAL_STEPS = 5;
  let posStep = 1;
  let truckOverride = null;
  let selectedLocation = null;
  let selectedRecord = null;
  // Add-on equipment keys (from EQUIPMENT_ADDONS) the agent has toggled on in the
  // Location-step MODEL/PRICE table. These flow into computeQuote()/renderCart()
  // as flat one-way line items.
  const selectedAddons = new Set();
  // Active category filters for the Location-step equipment table (Trucks /
  // Trailers / Towing). Trucks on by default to match the reference screen.
  const equipFilters = { truck: true, trailer: false, towing: false };
  let storageAsked = false;
  // Geocoded origin/destination for distance-ranked branches and one-way
  // mileage. Seeded from the scenario's known origin (so the demo's pickup
  // locations rank against Cincinnati out of the gate); otherwise null until
  // the agent picks a place from the city typeahead.
  let originGeo = (() => {
    const l = scenario.location;
    if (!l || !Number.isFinite(l.lat)) return null;
    const lng = Number.isFinite(l.lng) ? l.lng : l.lon;
    if (!Number.isFinite(lng)) return null;
    const parts = String(l.label || '').split(',');
    return { lat: l.lat, lng, city: (parts[0] || '').trim(), state: (parts[1] || '').trim() };
  })();
  let destGeo = null;

  function fmtMoney(n) { return '$' + Number(n || 0).toFixed(2); }

  function getRsv(name) {
    const els = pos.querySelectorAll(`[data-rsv="${name}"]`);
    if (!els.length) return '';
    if (els[0].type === 'radio') {
      const checked = Array.from(els).find((e) => e.checked);
      return checked ? checked.value : '';
    }
    return els[0].value || '';
  }
  function setRsv(name, value) {
    const el = pos.querySelector(`[data-rsv="${name}"]`);
    if (el) el.value = value;
  }

  function recommendedSize() {
    if (truckOverride) return truckOverride;
    const ls = LOAD_BY_VALUE[getRsv('load_size')];
    return ls && ls.truck ? ls.truck : null;
  }
  function currentTruck() {
    const size = recommendedSize();
    return size ? TRUCK_BY_SIZE[size] : null;
  }
  function rentalDays() {
    const r = RENTAL_BY_VALUE[getRsv('rental_length')];
    return r ? r.days : 1;
  }

  function oneWayQuote(truck, distance) {
    const dist = Math.max(0, Math.round(distance || 0));
    const amount = truck.ow_base + dist * truck.ow_mile;
    // One-way rentals bundle in allotted days roughly per ~300 miles of driving.
    const days = Math.max(2, Math.round(dist / 300) + 1);
    return { amount, days, miles: dist };
  }

  function computeQuote() {
    const truck = currentTruck();
    const oneWay = getRsv('move_type') === 'one_way';
    const miles = Number(getRsv('miles') || 0);
    const waiver = WAIVER_INFO[getRsv('waiver') || 'none'] || WAIVER_INFO.none;
    const padsChecked = !!pos.querySelector('[data-rsv-equipment="pads"]:checked');
    const dollyChecked = !!pos.querySelector('[data-rsv-equipment="dolly"]:checked');

    const lines = [];
    let subtotal = 0;
    let days = oneWay ? 1 : rentalDays();
    let ow = null;
    if (truck) {
      if (oneWay) {
        ow = oneWayQuote(truck, miles);
        days = ow.days;
        subtotal += ow.amount;
        lines.push({ label: truck.label, sub: `one-way rate, includes ${ow.days} days and ${ow.miles} mi`, amount: ow.amount });
      } else {
        const truckCost = truck.base * days;
        subtotal += truckCost;
        lines.push({ label: truck.label, sub: `$${truck.base.toFixed(2)}/day x ${days} day${days === 1 ? '' : 's'}`, amount: truckCost });
        if (miles > 0) {
          const milesCost = truck.per_mile * miles;
          subtotal += milesCost;
          lines.push({ label: 'Mileage', sub: `${miles} mi x $${truck.per_mile.toFixed(2)}/mi`, amount: milesCost });
        }
      }
      subtotal += ENV_FEE;
      lines.push({ label: 'Environmental Fee', amount: ENV_FEE });
      subtotal += VLRF;
      lines.push({ label: 'Vehicle License Recovery Fee', amount: VLRF });
    }
    const waiverCost = waiver.daily * days;
    if (waiverCost > 0) { subtotal += waiverCost; lines.push({ label: `${waiver.label}${days > 1 ? ' x ' + days + ' days' : ''}`, amount: waiverCost }); }
    if (padsChecked) { subtotal += 10; lines.push({ label: 'Furniture pads', amount: 10 }); }
    if (dollyChecked) { const c = 7 * days; subtotal += c; lines.push({ label: `Utility dolly${days > 1 ? ' x ' + days + ' days' : ''}`, amount: c }); }

    // Add-on equipment (trailers / towing) chosen on the Location step. Flat
    // one-way prices, so they go straight in as single line items.
    for (const key of selectedAddons) {
      const a = ADDON_BY_KEY[key];
      if (!a) continue;
      subtotal += a.price;
      lines.push({ label: a.label, amount: a.price });
    }

    const tax = subtotal * TAX_RATE;
    const total = subtotal + tax;
    return { truck, oneWay, days, miles, ow, waiver, padsChecked, dollyChecked, lines, subtotal, tax, total };
  }

  function renderCart() {
    const q = computeQuote();
    if (!q.truck) {
      posCartBody.innerHTML = '<p class="pos-card-empty">Add equipment to start the cart.</p>';
      return;
    }
    // CSF itemized cart: a Moving Truck sub-row, the quote line items, a Moving Truck
    // subtotal, the total, and the action links. The Show Taxes toggle keeps
    // the tax line behind a click like the preview's link affordance.
    const lineHtml = q.lines.map((l) => `
      <div class="csf-cart-line">
        <div class="csf-cart-line-label">${escapeHtml(l.label)}</div>
        <div class="csf-cart-line-amt">${fmtMoney(l.amount)}${l.sub ? `<span class="csf-cart-line-sub">${escapeHtml(l.sub)}</span>` : ''}</div>
      </div>
    `).join('');
    posCartBody.innerHTML = `
      <div class="csf-cart-sub"><span>Moving Truck</span><span style="cursor:pointer;">${TRASH_ICON}</span></div>
      ${lineHtml}
      <div class="csf-cart-subtotal"><span>Moving Truck Total:</span><span>${fmtMoney(q.subtotal)}</span></div>
      <details class="pos-cart-taxes"><summary>Show Taxes</summary>
        <div class="csf-cart-line csf-cart-line-muted"><div class="csf-cart-line-label">Estimated tax (8.25%)</div><div class="csf-cart-line-amt">${fmtMoney(q.tax)}</div></div>
      </details>
      <div class="csf-cart-total"><span>Total</span><span>${fmtMoney(q.total)}</span></div>
      <div class="csf-cart-links">
        <a class="csf-link">Estimate Price w/ Mileage</a>
        <a class="csf-link csf-cart-taxes-link">Show Taxes</a>
        <a class="csf-link">View Coverage Rates</a>
      </div>
    `;
    // Wire the Show Taxes link to the (visually hidden) details toggle so the
    // tax line still surfaces on click without a second markup path.
    const taxesDetails = posCartBody.querySelector('.pos-cart-taxes');
    const taxesLink = posCartBody.querySelector('.csf-cart-taxes-link');
    if (taxesDetails && taxesLink) {
      taxesLink.addEventListener('click', (e) => {
        e.preventDefault();
        taxesDetails.open = !taxesDetails.open;
      });
    }
  }

  function renderEquip() {
    const size = recommendedSize();
    const truck = size ? TRUCK_BY_SIZE[size] : null;
    const oneWay = getRsv('move_type') === 'one_way';
    posEquipRec.dataset.size = size ? String(size) : '?';
    const badge = posEquipRec.querySelector('.pos-equip-badge');
    if (badge) badge.textContent = truckOverride ? 'Override' : 'Recommended';

    const rentalField = byId('pos-field-rental');
    const milesLabel = byId('pos-miles-label');
    if (rentalField) rentalField.hidden = oneWay;
    if (milesLabel) milesLabel.textContent = oneWay ? 'Estimated distance (miles)' : 'Estimated miles';

    const rateEl = byId('pos-equip-script-rate');
    const secureRow = byId('pos-equip-script-secure-row');
    if (secureRow) secureRow.hidden = !truck;

    if (!truck) {
      posEquipName.textContent = 'Pick a truck below, or set a load size on the Details step.';
      posEquipRate.textContent = '';
      if (rateEl) rateEl.textContent = 'Add a load size on the previous step to see the recommended rate.';
    } else {
      const miles = Number(getRsv('miles') || 0);
      posEquipName.textContent = truck.label;
      if (oneWay) {
        const ow = oneWayQuote(truck, miles);
        posEquipRate.textContent = miles > 0
          ? `${fmtMoney(ow.amount)} (includes ${ow.days} days and ${ow.miles} miles)`
          : 'One-way rate is distance-based, enter the miles to see it';
        if (rateEl) rateEl.textContent = miles > 0
          ? `The rate for the ${truck.label} I recommend is ${fmtMoney(ow.amount)} plus a ${fmtMoney(ENV_FEE)} environmental fee and a ${fmtMoney(VLRF)} Vehicle License Recovery Fee, plus local taxes.`
          : `For a one-way ${truck.label}, the rate is based on the distance and already includes the days and miles you'll need. About how far is the move?`;
      } else {
        posEquipRate.textContent = `$${truck.base.toFixed(2)}/day + $${truck.per_mile.toFixed(2)}/mile`;
        if (rateEl) rateEl.textContent = `The ${truck.label} is $${truck.base.toFixed(2)} a day plus $${truck.per_mile.toFixed(2)} a mile, plus a ${fmtMoney(ENV_FEE)} environmental fee and a ${fmtMoney(VLRF)} Vehicle License Recovery Fee, plus local taxes.`;
      }
    }
    // Recommended-card "Rate includes ... dropped off in [dest]" line (one-way).
    const includesEl = byId('pos-equip-includes');
    if (includesEl) {
      const milesIn = Number(getRsv('miles') || 0);
      if (truck && oneWay && milesIn > 0) {
        const owInc = oneWayQuote(truck, milesIn);
        const dest = (getRsv('moving_to') || '').split(',')[0].trim();
        includesEl.textContent = `Rate includes ${owInc.days} days of use and ${owInc.miles} miles.${dest ? ' Equipment should be dropped off in ' + dest.toUpperCase() + '.' : ''}`;
      } else {
        includesEl.textContent = '';
      }
    }
    // Keep every tile's rate in sync with the move type: one-way shows the flat
    // bundled rate (per the entered distance), in-town shows per-day + per-mile.
    const milesNow = Number(getRsv('miles') || 0);
    pos.querySelectorAll('.pos-equip-opt').forEach((b) => {
      b.classList.toggle('selected', Number(b.dataset.truck) === size);
      const t = TRUCK_BY_SIZE[Number(b.dataset.truck)];
      const rateSpan = b.querySelector('.pos-equip-opt-rate');
      if (!t || !rateSpan) return;
      if (oneWay) {
        rateSpan.textContent = milesNow > 0
          ? `${fmtMoney(oneWayQuote(t, milesNow).amount)} one-way`
          : 'one-way (enter miles)';
      } else {
        rateSpan.textContent = `$${t.base.toFixed(2)}/day + $${t.per_mile.toFixed(2)}/mi`;
      }
    });
  }

  function renderEntity() {
    const loc = LOC_BY_NAME[selectedLocation];
    if (!loc) { posEntityCard.hidden = true; return; }
    posEntityCard.hidden = false;
    posEntityTitle.textContent = `Entity ${loc.entity}`;
    posEntityBody.innerHTML = `
      <div class="pos-kv"><span>Location</span><span>Meridian of ${escapeHtml(loc.name)}</span></div>
      <div class="pos-kv"><span>Address</span><span class="mono">${escapeHtml(loc.address)}</span></div>
      <div class="pos-kv"><span>Phone</span><span class="mono">${escapeHtml(loc.phone)}</span></div>
    `;
  }

  function haversineMiles(a, b) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 3958.8; // earth radius, miles
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function nearestBranch() {
    if (!originGeo) return null;
    let best = null;
    for (const loc of POS_LOCATIONS) {
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
      const mi = haversineMiles(originGeo, { lat: loc.lat, lng: loc.lng });
      if (!best || mi < best.mi) best = { loc, mi };
    }
    return best;
  }

  // Build the pickup-location list. With a geocoded origin the branches are
  // sorted nearest-first with real haversine distances and the closest is
  // tagged Recommended; without one we keep the original order and the static
  // distance estimates so the step still works before any ZIP is entered.
  function renderLocations() {
    const items = POS_LOCATIONS.map((loc) => ({
      loc,
      mi: originGeo && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
        ? haversineMiles(originGeo, { lat: loc.lat, lng: loc.lng })
        : null,
    }));
    const located = items.every((it) => it.mi != null);
    if (located) items.sort((a, b) => a.mi - b.mi);
    const locHint = byId('pos-loc-hint');
    if (locHint) {
      if (located && items[0]) {
        const where = cityLabelOf(originGeo, getRsv('moving_from'));
        locHint.textContent = `Based on ${where}, we suggest Meridian of ${items[0].loc.name} (${items[0].mi.toFixed(1)} mi). Branches are sorted nearest first.`;
      } else {
        locHint.textContent = 'Pick the location nearest where the customer is loading. Sorted by distance.';
      }
    }

    // Static map of the customer's area with the nearest branches pinned.
    // Proxied through /api/staticmap so the Google key stays server-side; the
    // image only appears once we have a geocoded origin to center on.
    const mapEl = byId('pos-loc-map');
    if (mapEl) {
      if (originGeo && Number.isFinite(originGeo.lat) && Number.isFinite(originGeo.lng)) {
        const pts = items
          .filter((it) => Number.isFinite(it.loc.lat) && Number.isFinite(it.loc.lng))
          .slice(0, 5)
          .map((it) => `${it.loc.lat},${it.loc.lng}`)
          .join('|');
        const src = `${STATICMAP_URL}?c=${encodeURIComponent(originGeo.lat + ',' + originGeo.lng)}`
          + (pts ? `&pts=${encodeURIComponent(pts)}` : '')
          + '&w=600&h=200';
        mapEl.innerHTML = '<img class="pos-loc-map-img" alt="Map of nearby pickup locations" loading="lazy">';
        const img = mapEl.querySelector('img');
        img.addEventListener('error', () => { mapEl.hidden = true; });
        mapEl.hidden = false;
        img.src = src;
      } else {
        mapEl.hidden = true;
        mapEl.innerHTML = '';
      }
    }

    // Pick the row to auto-expand: the chosen branch if any, else the nearest.
    let openIdx = items.findIndex((it) => it.loc.name === selectedLocation);
    if (openIdx < 0) openIdx = 0;

    posLocList.innerHTML = items.map((item, i) => {
      const loc = item.loc;
      const recommended = i === 0;
      const distText = item.mi != null ? item.mi.toFixed(1) : loc.distance;
      const open = i === openIdx;
      const sel = loc.name === selectedLocation;
      return `
      <div class="pos-loc-card${open ? ' open' : ''}${sel ? ' selected' : ''}" data-location="${escapeAttr(loc.name)}">
        <button type="button" class="pos-loc-card-head" data-loc-toggle aria-expanded="${open ? 'true' : 'false'}">
          <span class="pos-loc-num">${i + 1}</span>
          <span class="pos-loc-card-name">Meridian Moving &amp; Storage of ${escapeHtml(loc.name)}${recommended ? ' <span class="pos-loc-rec">Recommended</span>' : ''}</span>
          <span class="pos-loc-toggle">${open ? '&minus;' : '+'}</span>
        </button>
        <div class="pos-loc-card-body"${open ? '' : ' hidden'}>
          <div class="pos-loc-card-addr mono">${escapeHtml(loc.address)}</div>
          <div class="pos-loc-card-dist">${escapeHtml(distText)} mile(s)</div>
          <div class="pos-loc-card-hours">${escapeHtml(loc.hours)}</div>
          <div class="pos-loc-card-links">
            <a class="csf-link">&#9678; Directions</a>
            <a class="csf-link">Cross Contact (${escapeHtml(loc.entity)})</a>
            <a class="csf-link">View ESL</a>
          </div>
          <button type="button" class="pos-loc-choose${sel ? ' chosen' : ''}" data-loc-choose>${sel ? '&#10003; Selected for pickup' : 'Use this location'}</button>
        </div>
      </div>
    `;
    }).join('');
  }

  // Location-step MODEL/PRICE table. Lists every truck (one-way bundled price, or
  // in-town per-day + per-mile) followed by the trailer/towing add-ons. Selecting
  // a truck row drives truckOverride (same path as the step-2 tiles) so the cart
  // and recommendation stay consistent; toggling an add-on flows into the cart.
  // Trucks/Trailers/Towing filter checkboxes show/hide categories. Rows that the
  // chosen branch can't supply (truck size missing from available_sizes, or an
  // add-on flagged available:false) render greyed with the asterisk footnote.
  function renderEquipTable() {
    if (!posEquipTableBody) return;
    const oneWay = getRsv('move_type') === 'one_way';
    const miles = Number(getRsv('miles') || 0);
    const activeSize = recommendedSize();
    const branch = LOC_BY_NAME[selectedLocation] || null;
    let anyUnavailable = false;

    const rows = [];

    if (equipFilters.truck) {
      for (const t of TRUCK_SIZES) {
        const branchHas = !branch || branch.available_sizes.includes(t.size);
        if (!branchHas) anyUnavailable = true;
        const selected = Number(activeSize) === t.size;
        let priceHtml;
        if (oneWay) {
          priceHtml = miles > 0
            ? `<span class="pos-eq-price-avail">${fmtMoney(oneWayQuote(t, miles).amount)}</span>`
            : `<span class="pos-eq-price-muted">enter miles</span>`;
        } else {
          priceHtml = `<span class="pos-eq-price-avail">${fmtMoney(t.base)}</span> <span class="csf-eq-permile">+ ${fmtMoney(t.per_mile)}/mi</span>`;
        }
        rows.push(`
          <tr class="pos-eq-row${selected ? ' selected' : ''}${branchHas ? '' : ' unavailable'}" data-eq-truck="${t.size}">
            <td><span class="csf-eq-cell"><input type="radio" name="pos-eq-truck"${selected ? ' checked' : ''}${branchHas ? '' : ' disabled'}> ${escapeHtml(t.label)}${branchHas ? '' : ' *'}</span></td>
            <td>${priceHtml}</td>
          </tr>
        `);
      }
    }

    for (const a of EQUIPMENT_ADDONS) {
      const cat = a.category === 'towing' ? 'towing' : 'trailer';
      if (!equipFilters[cat]) continue;
      if (!a.available) anyUnavailable = true;
      const checked = selectedAddons.has(a.key);
      rows.push(`
        <tr class="pos-eq-row${checked ? ' selected' : ''}${a.available ? '' : ' unavailable'}" data-eq-addon="${escapeAttr(a.key)}">
          <td><span class="csf-eq-cell"><input type="checkbox"${checked ? ' checked' : ''}${a.available ? '' : ' disabled'}> ${escapeHtml(a.label)}${a.available ? '' : ' *'}</span></td>
          <td><span class="pos-eq-price-avail">${fmtMoney(a.price)}</span></td>
        </tr>
      `);
    }

    posEquipTableBody.innerHTML = rows.join('') || '<tr><td colspan="2" class="pos-eq-empty">No equipment matches the current filters.</td></tr>';
    if (posEquipAvailName) {
      posEquipAvailName.textContent = branch
        ? `Available Equipment: Meridian Moving & Storage of ${branch.name}`
        : 'Available Equipment';
    }
    if (posEquipFoot) posEquipFoot.hidden = !anyUnavailable;
  }

  // "San Antonio, TX" for the Location-step suggestion copy.
  function cityLabelOf(geo, fallback) {
    if (!geo || !geo.city) return fallback;
    return geo.state ? `${geo.city}, ${geo.state}` : geo.city;
  }

  // Bias the city typeahead toward where this customer is calling from (the
  // scenario's origin), so "Cin" surfaces Cincinnati, not a San Antonio match.
  // scenario.location may use `lon` or `lng`; null falls back to the SA default.
  const geocodeBias = (() => {
    const l = scenario.location;
    if (!l || !Number.isFinite(l.lat)) return null;
    const lng = Number.isFinite(l.lng) ? l.lng : l.lon;
    return Number.isFinite(lng) ? { lat: l.lat, lng } : null;
  })();

  // Look up candidate places for the city typeahead.
  async function geocodeSearch(query) {
    const q = (query || '').trim();
    if (!q) return [];
    try {
      const res = await fetch(GEOCODE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query: q, bias: geocodeBias }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.results) ? data.results : [];
    } catch {
      return [];
    }
  }

  // Recompute the one-way distance from the two resolved places. Only acts on a
  // one-way move with both endpoints known; in-town leaves mileage manual.
  function autoFillOneWayMiles() {
    if (getRsv('move_type') !== 'one_way' || !originGeo || !destGeo) return;
    const tripMi = Math.max(1, Math.round(haversineMiles(originGeo, destGeo)));
    setRsv('miles', String(tripMi));
    onPosChange();
  }

  // Turn a Moving From/To input into a city typeahead: type a place, pick from
  // the dropdown, and the field fills with "City, ST" while we keep the
  // coordinates. Nothing about branches shows here - the suggestion lives on
  // the Location step. onResolve gets the picked place, or null when the field
  // is cleared or edited so it no longer matches the last pick.
  function attachCityAutocomplete(input, onResolve) {
    if (!input) return;
    const wrap = document.createElement('div');
    wrap.className = 'pos-ac';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const menu = document.createElement('ul');
    menu.className = 'pos-ac-menu';
    menu.hidden = true;
    wrap.appendChild(menu);

    let items = [];
    let activeIdx = -1;
    let seq = 0;
    let resolvedDisplay = null;
    let timer = null;

    // The menu is position:fixed (so .pos-stage's scroll can't clip it), so we
    // pin it under the input and keep it there while scrolling/resizing.
    function position() {
      const r = input.getBoundingClientRect();
      menu.style.top = `${r.bottom + 4}px`;
      menu.style.left = `${r.left}px`;
      menu.style.width = `${r.width}px`;
    }
    function onReposition() { if (!menu.hidden) position(); }
    function hide() {
      menu.hidden = true;
      activeIdx = -1;
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    }
    function render() {
      if (!items.length) { hide(); return; }
      menu.innerHTML = items.map((it, i) =>
        `<li class="pos-ac-item${i === activeIdx ? ' active' : ''}" data-idx="${i}" role="option">${escapeHtml(it.display)}</li>`
      ).join('');
      menu.hidden = false;
      position();
      window.addEventListener('scroll', onReposition, true);
      window.addEventListener('resize', onReposition);
    }
    function pick(i) {
      const it = items[i];
      if (!it) return;
      input.value = it.display;
      resolvedDisplay = it.display;
      hide();
      onResolve(it);
    }
    async function search(q) {
      const mine = ++seq;
      const results = await geocodeSearch(q);
      if (mine !== seq) return;
      items = results;
      activeIdx = -1;
      render();
    }

    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const v = input.value.trim();
      if (v === resolvedDisplay) return;
      // The text no longer matches a pick, so any stored coordinates are stale.
      resolvedDisplay = null;
      onResolve(null);
      if (v.length < 3) { items = []; hide(); return; }
      timer = setTimeout(() => search(v), 250);
    });
    input.addEventListener('keydown', (e) => {
      if (menu.hidden || !items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); render(); }
      else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(activeIdx); }
      else if (e.key === 'Escape') { hide(); }
    });
    // mousedown (not click) so the pick lands before the input's blur hides it.
    menu.addEventListener('mousedown', (e) => {
      const li = e.target.closest('.pos-ac-item');
      if (!li) return;
      e.preventDefault();
      pick(Number(li.dataset.idx));
    });
    input.addEventListener('blur', () => {
      // Let a click settle, then resolve free-typed text to the best match so
      // ranking still works if the agent tabbed past the dropdown.
      setTimeout(async () => {
        hide();
        const v = input.value.trim();
        if (!v || v === resolvedDisplay) return;
        const results = await geocodeSearch(v);
        if (!results.length) { onResolve(null); return; }
        input.value = results[0].display;
        resolvedDisplay = results[0].display;
        onResolve(results[0]);
      }, 150);
    });
  }

  function renderSched() {
    const q = computeQuote();
    const loc = LOC_BY_NAME[selectedLocation];
    const rl = RENTAL_BY_VALUE[getRsv('rental_length')];
    if (q.truck) {
      const rateText = q.oneWay
        ? '$' + (q.ow ? q.ow.amount.toFixed(2) : q.truck.ow_base.toFixed(2)) + ' one-way'
        : '$' + q.truck.base.toFixed(2) + '/day + $' + q.truck.per_mile.toFixed(2) + '/mile';
      const lenText = q.oneWay
        ? `One-way · ${q.ow ? q.ow.days : 1} days and ${q.ow ? q.ow.miles : 0} mi included`
        : `Rental length: ${escapeHtml(rl ? rl.label : '1 day')}`;
      posSchedTruck.innerHTML = `
        <div class="pos-sched-row">
          <span class="pos-sched-truck-name">${escapeHtml(q.truck.label)}</span>
          <span class="mono">${rateText}</span>
        </div>
        <div class="pos-sched-sub">${lenText}</div>
      `;
    } else {
      posSchedTruck.innerHTML = '';
    }
    if (loc) {
      posSchedLoc.innerHTML = `
        <div class="pos-sched-loc-title">Pick Up Location (${escapeHtml(loc.entity)})</div>
        <div class="pos-sched-loc-name">Meridian Moving &amp; Storage of ${escapeHtml(loc.name)}</div>
        <div class="pos-sched-loc-addr mono">${escapeHtml(loc.address)}</div>
        <div class="pos-sched-loc-addr mono">${escapeHtml(loc.phone)}</div>
      `;
    } else {
      posSchedLoc.innerHTML = '<p class="pos-card-empty">Select a pickup location on the previous step.</p>';
    }

    // One-way moves use the AM/PM window + the rep-callback advisory (matching
    // the real CSF); in-town keeps the specific-time scheduler. Toggle blocks.
    const oneWay = getRsv('move_type') === 'one_way';
    const owBlock = byId('sched-oneway');
    const itBlock = byId('sched-intown');
    if (owBlock) owBlock.hidden = !oneWay;
    if (itBlock) itBlock.hidden = oneWay;
    // Advisory date: a local rep calls by 6 PM the day before the pickup date.
    const advEl = byId('sched-advisory-date');
    if (advEl) {
      const pd = getRsv('pickup_date'); // YYYY-MM-DD
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pd || '');
      if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        d.setDate(d.getDate() - 1);
        advEl.textContent = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
      } else {
        advEl.textContent = 'the day before your pickup';
      }
    }
  }

  function renderLeftRail() {
    const ls = LOAD_BY_VALUE[getRsv('load_size')];
    const oneWay = getRsv('move_type') === 'one_way';
    const rows = [];
    if (getRsv('moving_from')) rows.push(['Moving From', getRsv('moving_from')]);
    if (getRsv('moving_to')) rows.push(['Moving To', getRsv('moving_to')]);
    if (getRsv('pickup_date')) rows.push(['Rental Date', getRsv('pickup_date')]);
    if (ls) rows.push(['Moving', ls.label]);
    rows.push(['Move Type', oneWay ? 'One Way' : 'In Town']);
    // One-way bundles the rate, days, and miles together (unlike in-town), so the
    // reservation details surface the allotted days and the route miles.
    if (oneWay) {
      const miles = Number(getRsv('miles') || 0);
      if (miles > 0) {
        const ow = oneWayQuote(currentTruck() || { ow_base: 0, ow_mile: 0 }, miles);
        rows.push(['Days', `${ow.days} days`]);
        rows.push(['Miles', `${miles} mile${miles === 1 ? '' : 's'}`]);
      }
    }
    if (selectedLocation) rows.push(['Pickup', 'Meridian of ' + selectedLocation]);
    posRsvDetailsBody.innerHTML = rows.length
      ? rows.map(([k, v]) => `<div class="pos-kv"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join('')
      : '<p class="pos-card-empty">Details fill in as you build the reservation.</p>';
  }

  function renderCustomerCard(r) {
    posVerified.hidden = false;
    posVerified.textContent = r.is_new ? 'New Customer' : 'Verified Customer';
    // CSF post-lookup profile: the card head flips to "Customer" and the body
    // shows the name/phone/email + Verified + Past Rentals, driven by the live
    // lookup record. This replaces the pre-lookup script + lookup field.
    if (posCustomerTitle) posCustomerTitle.textContent = 'Customer';
    if (posCustomerEdit) posCustomerEdit.hidden = false;
    const hasHistory = (r.past_rentals || []).length || (r.active_reservations || []).length || (r.claims_cases || []).length;
    const checkSvg = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M5.3 8 L7 9.7 L10.7 6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const clockSvg = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5 V8 L10.5 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    posCustomerBody.innerHTML = `
      <div class="csf-cust-name">${escapeHtml(r.full_name || '')}</div>
      ${r.phone ? `<div class="csf-cust-line">${escapeHtml(r.phone)}</div>` : ''}
      ${r.email ? `<div class="csf-cust-line">${escapeHtml(r.email)}</div>` : ''}
      ${r.account_id ? `<div class="csf-cust-line">Account ${escapeHtml(r.account_id)}</div>` : ''}
      ${r.member_since ? `<div class="csf-cust-line">Member since ${escapeHtml(String(r.member_since))}</div>` : ''}
      <div class="csf-verified">${checkSvg} ${r.is_new ? 'New Customer' : 'Verified Customer'}</div>
      ${hasHistory ? `<button type="button" class="csf-pastrentals" id="pos-history-link">${clockSvg} Past Rentals/Reservations</button>` : ''}
    `;
    if (r.notes) posCustomerNotes.textContent = r.notes;
    byId('pos-history-link')?.addEventListener('click', () => openHistoryModal(r));
  }

  function renderLookupResult(kind, r) {
    posLookupResult.hidden = false;
    posLookupResult.dataset.state = kind;
    if (kind === 'found') {
      posLookupResult.innerHTML = `<span class="pos-lookup-badge ok">Record found</span> ${escapeHtml(r.full_name)} loaded into the customer panel.`;
    } else if (kind === 'prospect') {
      posLookupResult.innerHTML = `<span class="pos-lookup-badge">New prospect</span> ${escapeHtml(r.notes || 'No record on file. Continue as a new reservation.')}`;
    } else {
      posLookupResult.innerHTML = '<span class="pos-lookup-badge">No match</span> No customer matched. Confirm the number, or continue as a new reservation.';
    }
  }

  function matchCustomerRecord(record, query) {
    if (!record || record.found === false) return false;
    const phoneDigits = (s) => String(s || '').replace(/\D/g, '');
    const norm = (s) => String(s || '').toLowerCase().trim();
    const qPhone = phoneDigits(query);
    const qText = norm(query);
    if (qPhone && phoneDigits(record.phone).includes(qPhone) && qPhone.length >= 4) return true;
    if (qText && norm(record.email).includes(qText) && qText.length >= 3) return true;
    if (qText && norm(record.full_name).includes(qText) && qText.length >= 2) return true;
    return false;
  }

  function doLookup() {
    const q = posLookupInput.value.trim();
    if (!q) return;
    const record = scenario.customer_record;
    if (matchCustomerRecord(record, q)) {
      // Repeat customer — pop the verify modal pre-filled with their details.
      openCustomerModal({ mode: 'found', record, query: q });
    } else {
      // No match — pop the modal to add a new customer.
      const prospect = !!(record && record.found === false);
      openCustomerModal({ mode: 'new', query: q, prospect });
    }
  }

  function splitName(full) {
    const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { first: '', last: '' };
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  // Load a customer (matched or newly created) into the panel: flips the card to
  // the profile, copies contact info into the receipt fields, refreshes the rail.
  function loadCustomer(rec) {
    selectedRecord = rec;
    renderCustomerCard(rec);
    setRsv('receipt_email', rec.email || '');
    setRsv('receipt_phone', rec.phone || '');
    renderLeftRail();
  }

  // Verify-a-repeat / add-a-new customer modal, opened from a phone/email lookup.
  function openCustomerModal({ mode, record, query, prospect }) {
    const found = mode === 'found';
    let first = '', last = '', phone = '', email = '';
    if (found && record) {
      const n = splitName(record.full_name);
      first = n.first; last = n.last;
      phone = record.phone || '';
      email = record.email || '';
    } else {
      const q = String(query || '').trim();
      if (q.includes('@')) email = q;
      else if (/\d/.test(q)) phone = q;
    }

    const chatIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const field = (key, label, val) => `<div class="pos-field"><label class="pos-field-label">${label}</label><input class="pos-input" data-cf="${key}" value="${escapeAttr(val)}" autocomplete="off"></div>`;

    const overlay = document.createElement('div');
    overlay.className = 'pos-modal';
    overlay.innerHTML = `
      <div class="pos-modal-inner pos-modal-customer" role="dialog" aria-modal="true" aria-labelledby="pos-cust-title">
        <div class="pos-modal-head">
          <h3 class="pos-modal-title" id="pos-cust-title">${found ? 'Repeat Customer Found' : 'New Customer'}</h3>
          <button type="button" class="pos-modal-close" aria-label="Close">&times;</button>
        </div>
        <p class="pos-modal-sub">${found ? 'Please verify all contact information.' : 'No match found. Add the customer\'s contact information.'}</p>
        <div class="pos-cust-script">${chatIcon}<span>May I ask who I am speaking with?</span></div>
        <div class="pos-cust-grid">
          ${field('first', 'First Name', first)}
          ${field('phone', 'Phone Number', phone)}
          ${field('last', 'Last Name', last)}
          ${field('email', 'Email Address', email)}
        </div>
        <p class="pos-cust-error" id="pos-cust-error" hidden></p>
        <div class="pos-modal-actions">
          <button type="button" class="ghost-button" data-cust-action="${found ? 'create' : 'cancel'}">${found ? 'Create New Customer' : 'Cancel'}</button>
          <button type="button" class="primary-button" data-cust-action="${found ? 'continue' : 'create'}">${found ? 'Continue' : 'Create New Customer'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => { try { overlay.querySelector('[data-cf="first"]')?.focus(); } catch {} }, 30);

    let settled = false;
    const fv = (k) => (overlay.querySelector(`[data-cf="${k}"]`)?.value || '').trim();
    function close() {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function doContinue() {
      // Verified the matched record (carry any edits the agent made).
      close();
      loadCustomer({ ...record, full_name: `${fv('first')} ${fv('last')}`.trim(), phone: fv('phone'), email: fv('email') });
    }
    function doCreate() {
      if (!fv('first') || (!fv('phone') && !fv('email'))) {
        const el = overlay.querySelector('#pos-cust-error');
        if (el) { el.textContent = 'Enter at least a first name and a phone number or email.'; el.hidden = false; }
        return;
      }
      close();
      loadCustomer({
        found: true,
        is_new: true,
        full_name: `${fv('first')} ${fv('last')}`.trim(),
        phone: fv('phone'),
        email: fv('email'),
        account_id: null,
        member_since: null,
        past_rentals: [],
        active_reservations: [],
        claims_cases: [],
        notes: '',
      });
    }
    function cancel() {
      close();
      if (!found) {
        selectedRecord = null;
        posVerified.hidden = true;
        renderLookupResult(prospect ? 'prospect' : 'notfound', scenario.customer_record);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') cancel();
      else if (e.key === 'Enter') { e.preventDefault(); if (found) doContinue(); else doCreate(); }
    }
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cust-action]');
      if (btn) {
        const a = btn.dataset.custAction;
        if (a === 'continue') doContinue();
        else if (a === 'create') doCreate();
        else cancel();
        return;
      }
      if (e.target.closest('.pos-modal-close') || e.target === overlay) cancel();
    });
    document.addEventListener('keydown', onKey);
  }

  // Edit-on-the-fly modal for the loaded customer: lets the agent correct the
  // name, phone, or email mid-call from the left rail without redoing lookup.
  function openCustomerEditModal() {
    const rec = selectedRecord;
    if (!rec) return;
    const n = splitName(rec.full_name || '');
    const chatIcon = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true"><path d="M4 5h16v11H9l-4 3v-3H4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    const field = (key, label, val) => `<div class="pos-field"><label class="pos-field-label">${label}</label><input class="pos-input" data-cf="${key}" value="${escapeAttr(val)}" autocomplete="off"></div>`;

    const overlay = document.createElement('div');
    overlay.className = 'pos-modal';
    overlay.innerHTML = `
      <div class="pos-modal-inner pos-modal-customer" role="dialog" aria-modal="true" aria-labelledby="pos-edit-title">
        <div class="pos-modal-head">
          <h3 class="pos-modal-title" id="pos-edit-title">Edit Customer Information</h3>
          <button type="button" class="pos-modal-close" aria-label="Close">&times;</button>
        </div>
        <p class="pos-modal-sub">Update the customer's contact details on the fly.</p>
        <div class="pos-cust-script">${chatIcon}<span>Let me update that for you.</span></div>
        <div class="pos-cust-grid">
          ${field('first', 'First Name', n.first)}
          ${field('phone', 'Phone Number', rec.phone || '')}
          ${field('last', 'Last Name', n.last)}
          ${field('email', 'Email Address', rec.email || '')}
        </div>
        <p class="pos-cust-error" id="pos-edit-error" hidden></p>
        <div class="pos-modal-actions">
          <button type="button" class="ghost-button" data-edit-action="cancel">Cancel</button>
          <button type="button" class="primary-button" data-edit-action="save">Save Changes</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => { try { overlay.querySelector('[data-cf="first"]')?.focus(); } catch {} }, 30);

    let settled = false;
    const fv = (k) => (overlay.querySelector(`[data-cf="${k}"]`)?.value || '').trim();
    function close() {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function save() {
      if (!fv('first') || (!fv('phone') && !fv('email'))) {
        const el = overlay.querySelector('#pos-edit-error');
        if (el) { el.textContent = 'Keep at least a first name and a phone number or email.'; el.hidden = false; }
        return;
      }
      close();
      loadCustomer({ ...selectedRecord, full_name: `${fv('first')} ${fv('last')}`.trim(), phone: fv('phone'), email: fv('email') });
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter') { e.preventDefault(); save(); }
    }
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit-action="save"]')) save();
      else if (e.target.closest('[data-edit-action="cancel"]') || e.target.closest('.pos-modal-close') || e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
  }

  function detectBrand(num) {
    const n = String(num || '').replace(/\D/g, '');
    if (/^4/.test(n)) return 'visa';
    if (/^(34|37)/.test(n)) return 'amex';
    if (/^(5[1-5]|2[2-7])/.test(n)) return 'mastercard';
    if (/^6(011|5)/.test(n)) return 'discover';
    return 'unknown';
  }
  function formatCardNumber(raw) {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 19);
    const groups = detectBrand(digits) === 'amex'
      ? [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)]
      : (digits.match(/.{1,4}/g) || []);
    return groups.filter(Boolean).join(' ');
  }
  function updateCardChip() {
    const num = getRsv('card_number').replace(/\D/g, '');
    const brand = detectBrand(num);
    posCcChip.hidden = num.length < 2;
    posCcChip.dataset.brand = brand;
    posCcBrand.textContent = brand === 'unknown' ? 'CARD' : brand.toUpperCase();
    posCcLast4.textContent = num ? '•••• ' + num.slice(-4) : '••••';
  }
  function updateCardStatus() {
    const num = getRsv('card_number').replace(/\D/g, '');
    if (!posCardStatus) return;
    posCardStatus.textContent = num.length >= 13
      ? `Card on file: ${detectBrand(num).toUpperCase()} ending ${num.slice(-4)}.`
      : 'Enter the card in the Credit Card panel to confirm.';
  }

  function showErr(text) {
    posErrorEl.textContent = text;
    posErrorEl.hidden = false;
    posErrorEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Highlight the specific field a step is waiting on and float a guidance
  // tooltip next to it (reuses the field-tip element). The highlight clears as
  // soon as the agent edits that field. Falls back to the top error banner if
  // the field is not on screen.
  function showFieldError(selector, message) {
    const el = selector ? pos.querySelector(selector) : null;
    if (!el) { showErr(message); return; }
    pos.querySelectorAll('.pos-input-error').forEach((x) => x.classList.remove('pos-input-error'));
    el.classList.add('pos-input-error');
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}
    const place = () => {
      const tip = fieldTip;
      if (!tip) return;
      const txt = tip.querySelector('.pos-fieldtip-text');
      if (txt) txt.textContent = message;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const th = tip.offsetHeight;
      let top = r.top - th - 8;
      if (top < 8) top = r.bottom + 8;
      tip.style.top = `${Math.round(top)}px`;
      tip.style.left = `${Math.round(r.left)}px`;
    };
    window.setTimeout(place, 240);
    const clear = () => {
      el.classList.remove('pos-input-error');
      if (fieldTip) fieldTip.hidden = true;
      el.removeEventListener('input', clear);
      el.removeEventListener('change', clear);
    };
    el.addEventListener('input', clear);
    el.addEventListener('change', clear);
  }

  // Returns null when the step is complete, or { message, selector } naming the
  // field that still needs attention so the caller can highlight it and float a
  // guidance tooltip. Each step gates on the info it is responsible for
  // gathering, so the agent cannot advance with a half-built reservation.
  function validateStep(n) {
    const err = (message, selector) => ({ message, selector });
    if (n === 1) {
      if (!selectedRecord) return err('Look up the customer first: enter their phone or email, hit search, then verify or add their info.', '#pos-lookup-input');
      if (!getRsv('moving_from').trim()) return err('Enter where the customer is moving from (city and state).', '[data-rsv="moving_from"]');
      if (!getRsv('moving_to').trim()) return err('Enter where the customer is moving to (city and state).', '[data-rsv="moving_to"]');
      if (!getRsv('load_size')) return err('Pick the home or load size so we can recommend the right truck.', '[data-rsv="load_size"]');
      if (!getRsv('pickup_date')) return err('Set the rental date.', '[data-rsv="pickup_date"]');
    } else if (n === 2) {
      if (!recommendedSize()) return err('Pick a truck: set a home/load size on the Details step, or choose one under "Show all moving equipment".', '#pos-equip-rec');
      if (getRsv('move_type') === 'one_way' && Number(getRsv('miles') || 0) <= 0) return err('Enter the estimated distance for the one-way move.', '[data-rsv="miles"]');
    } else if (n === 3) {
      if (!selectedLocation) return err('Select a pickup location with the "Use this location" button on a branch.', '#pos-loc-list');
    } else if (n === 5) {
      if (getRsv('card_number').replace(/\D/g, '').length < 13) return err('Enter the card number in the Credit Card panel.', '[data-rsv="card_number"]');
      if (!getRsv('card_exp_month') || !getRsv('card_exp_year')) return err('Set the card expiration in the Credit Card panel.', '[data-rsv="card_exp_month"]');
      if (!/^\d{5}$/.test(getRsv('card_zip'))) return err('Enter a 5-digit billing ZIP in the Credit Card panel.', '[data-rsv="card_zip"]');
    }
    return null;
  }

  function showStep(n) {
    posStep = Math.max(1, Math.min(TOTAL_STEPS, n));
    posForm.querySelectorAll('.pos-step').forEach((s) => { s.hidden = Number(s.dataset.step) !== posStep; });
    posStepper.querySelectorAll('.pos-stepper-item').forEach((it) => {
      const sn = Number(it.dataset.step);
      it.classList.toggle('active', sn === posStep);
      it.classList.toggle('done', sn < posStep);
    });
    posBackBtn.hidden = posStep === 1;
    posErrorEl.hidden = true;
    posNextBtn.textContent = posStep === TOTAL_STEPS ? 'Reserve Now' : 'Continue';
    // CSF chrome per step: topbar title, panel head ("Moving Truck" on step 1, else
    // the step title), category tabs (step 1 only), panel standalone border
    // (steps 2-5), and the topbar action group (New Reservation vs Back/Next).
    if (posTopbarTitle) posTopbarTitle.textContent = STEP_TITLES[posStep] || '';
    if (posPanelHeadText) posPanelHeadText.textContent = posStep === 1 ? 'Moving Truck' : (STEP_TITLES[posStep] || '');
    if (posTabs) posTabs.hidden = posStep !== 1;
    if (posPanel) posPanel.dataset.standalone = posStep === 1 ? 'false' : 'true';
    if (posTopNewBtn) posTopNewBtn.hidden = posStep !== 1;
    if (posTopStepsWrap) posTopStepsWrap.hidden = posStep === 1;
    if (posTopBackBtn) posTopBackBtn.disabled = posStep === 1;
    if (posStep === 2) renderEquip();
    if (posStep === 3) { renderLocations(); renderEquipTable(); }
    if (posStep === 4) renderSched();
    if (posStep === 5) updateCardStatus();
    const stage = posForm.closest('.pos-stage');
    if (stage) stage.scrollTop = 0;
  }

  posBackBtn.addEventListener('click', () => showStep(posStep - 1));

  // CSF topbar Back/Next mirror the in-panel nav so the agent can drive the
  // reservation from the header too. Next routes through requestSubmit so it
  // hits the same validation/storage-modal flow as the panel Continue button.
  posTopBackBtn?.addEventListener('click', () => { if (posStep > 1) showStep(posStep - 1); });
  posTopNextBtn?.addEventListener('click', () => posForm.requestSubmit());

  posForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = validateStep(posStep);
    if (err) { showFieldError(err.selector, err.message); return; }
    if (posStep === 1 && !storageAsked) {
      storageAsked = true;
      openStorageModal(() => showStep(2));
      return;
    }
    if (posStep < TOTAL_STEPS) { showStep(posStep + 1); return; }
    reserve();
  });

  function onPosChange() {
    renderCart();
    renderLeftRail();
    if (posStep === 2) renderEquip();
    if (posStep === 3) renderEquipTable();
    if (posStep === 4) renderSched();
  }
  posForm.addEventListener('input', onPosChange);
  posForm.addEventListener('change', onPosChange);

  pos.querySelector('[data-rsv="load_size"]')?.addEventListener('change', () => {
    truckOverride = null;
    renderEquip();
    renderEquipTable();
    renderCart();
  });

  pos.querySelectorAll('.pos-equip-opt').forEach((b) => {
    b.addEventListener('click', () => {
      truckOverride = Number(b.dataset.truck);
      renderEquip();
      renderCart();
      renderSched();
    });
  });

  posLocList.addEventListener('click', (e) => {
    const card = e.target.closest('.pos-loc-card');
    if (!card) return;
    // "Use this location" choose button: select the branch (drives entity card,
    // scheduling, left rail, and the equipment table's location-availability).
    if (e.target.closest('[data-loc-choose]')) {
      selectedLocation = card.dataset.location;
      renderLocations();
      renderEntity();
      renderSched();
      renderLeftRail();
      renderEquipTable();
      return;
    }
    // Accordion header toggle: expand/collapse this item; collapse the others so
    // only one branch is open at a time (matches the reference screen).
    if (e.target.closest('[data-loc-toggle]')) {
      const willOpen = !card.classList.contains('open');
      pos.querySelectorAll('.pos-loc-card').forEach((c) => {
        const isThis = c === card;
        c.classList.toggle('open', isThis && willOpen);
        const body = c.querySelector('.pos-loc-card-body');
        const tog = c.querySelector('.pos-loc-toggle');
        const head = c.querySelector('.pos-loc-card-head');
        if (body) body.hidden = !(isThis && willOpen);
        if (tog) tog.innerHTML = (isThis && willOpen) ? '&minus;' : '+';
        if (head) head.setAttribute('aria-expanded', String(isThis && willOpen));
      });
    }
  });

  // Filter checkboxes (Trucks / Trailers / Towing) show/hide categories in the
  // equipment table.
  pos.querySelectorAll('[data-equip-filter]').forEach((cb) => {
    cb.addEventListener('change', () => {
      equipFilters[cb.dataset.equipFilter] = cb.checked;
      renderEquipTable();
    });
  });

  // Equipment table selection. Truck rows behave like the step-2 tiles (set the
  // active truck via truckOverride); add-on rows toggle into the cart. Rows the
  // chosen branch can't supply are disabled. Everything re-renders the table,
  // cart, equipment recommendation, and scheduling so the screens stay in sync.
  if (posEquipTableBody) {
    posEquipTableBody.addEventListener('click', (e) => {
      const truckRow = e.target.closest('[data-eq-truck]');
      if (truckRow && !truckRow.classList.contains('unavailable')) {
        truckOverride = Number(truckRow.dataset.eqTruck);
        renderEquipTable();
        renderEquip();
        renderCart();
        renderSched();
        renderLeftRail();
        return;
      }
      const addonRow = e.target.closest('[data-eq-addon]');
      if (addonRow && !addonRow.classList.contains('unavailable')) {
        const key = addonRow.dataset.eqAddon;
        if (selectedAddons.has(key)) selectedAddons.delete(key);
        else selectedAddons.add(key);
        renderEquipTable();
        renderCart();
      }
    });
  }

  // City typeahead on the move addresses. Picking a place stores its
  // coordinates, which drive the branch ranking on the Location step and the
  // one-way mileage. No branch info is shown on the Details step itself.
  attachCityAutocomplete(pos.querySelector('[data-rsv="moving_from"]'), (place) => {
    originGeo = place ? { lat: place.lat, lng: place.lng, city: place.city, state: place.state, postcode: place.postcode } : null;
    renderLocations();
    renderEquipTable();
    renderLeftRail();
    autoFillOneWayMiles();
  });
  attachCityAutocomplete(pos.querySelector('[data-rsv="moving_to"]'), (place) => {
    destGeo = place ? { lat: place.lat, lng: place.lng, city: place.city, state: place.state, postcode: place.postcode } : null;
    autoFillOneWayMiles();
    renderLeftRail();
  });
  pos.querySelectorAll('[data-rsv="move_type"]').forEach((el) => {
    el.addEventListener('change', autoFillOneWayMiles);
  });

  posLookupBtn.addEventListener('click', doLookup);
  posLookupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doLookup(); }
  });

  const posCardNum = pos.querySelector('[data-rsv="card_number"]');
  const posCardZip = pos.querySelector('[data-rsv="card_zip"]');
  posCardNum.addEventListener('input', (e) => {
    e.target.value = formatCardNumber(e.target.value);
    updateCardChip();
    updateCardStatus();
  });
  posCardZip.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
  });

  // ---- Per-field CSR script tooltips ---------------------------------------
  // As the rep tabs/clicks from field to field, a floating "what to say" bubble
  // follows focus (mirrors the live U-Haul CSF). It's pure focus UI on the POS
  // form, so it behaves identically in phone and chat mode. Delegated on the
  // POS container so it survives per-step re-renders.
  const FIELD_SCRIPTS = {
    __lookup__: 'May I start with your cell phone number or email address?',
    moving_from: 'What zip code, city, or landmark are you moving from?',
    moving_to: 'And where are you moving to?',
    pickup_date: 'What day would you like to pick up?',
    load_size: 'How many bedrooms are you moving?',
    rental_length: 'How many days do you need the truck?',
    miles: 'About how many miles is the move?',
    pickup_time: 'What time would you like to pick up?',
    storage: 'Will you need storage before or after your move?',
    receipt_email: "What's the best email for the reservation receipt?",
    receipt_phone: 'And the best phone number to reach you?',
    current_address: 'May I please have your current address?',
    card_number: 'Which credit card would you like to use to confirm the reservation?',
    card_zip: 'And the billing zip code for that card?',
  };
  if (activeFieldTip) { try { activeFieldTip.remove(); } catch {} }
  const fieldTip = document.createElement('div');
  fieldTip.className = 'pos-fieldtip';
  fieldTip.hidden = true;
  fieldTip.innerHTML = `<span class="pos-fieldtip-icon" aria-hidden="true">${SCRIPT_ICON}</span><span class="pos-fieldtip-text"></span>`;
  document.body.appendChild(fieldTip);
  activeFieldTip = fieldTip;
  onFieldTip(fieldTip);
  const fieldTipText = fieldTip.querySelector('.pos-fieldtip-text');

  function showFieldTip(el) {
    const key = el.getAttribute('data-rsv') || (el.id === 'pos-lookup-input' ? '__lookup__' : '');
    const script = key && FIELD_SCRIPTS[key];
    if (!script) { fieldTip.hidden = true; return; }
    fieldTipText.textContent = script;
    fieldTip.hidden = false;
    const r = el.getBoundingClientRect();
    const th = fieldTip.offsetHeight;
    let top = r.top - th - 8;
    if (top < 8) top = r.bottom + 8; // not enough room above → drop below
    fieldTip.style.top = `${Math.round(top)}px`;
    fieldTip.style.left = `${Math.round(r.left)}px`;
  }
  pos.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-rsv], #pos-lookup-input');
    if (el) showFieldTip(el);
    else fieldTip.hidden = true;
  });
  pos.addEventListener('focusout', () => { fieldTip.hidden = true; });

  function reserve() {
    const q = computeQuote();
    const loc = LOC_BY_NAME[selectedLocation] || {};
    const num = getRsv('card_number').replace(/\D/g, '');
    const custName = selectedRecord?.full_name || (scenario.blind ? 'the caller' : scenario.customer_name);
    const exp = `${getRsv('card_exp_month') || '--'}/${getRsv('card_exp_year') || '--'}`;
    const brand = detectBrand(num);
    const last4 = num.slice(-4) || '----';
    const conf = 'MR-' + Math.floor(100000 + Math.random() * 900000);
    const ls = LOAD_BY_VALUE[getRsv('load_size')];
    const rl = RENTAL_BY_VALUE[getRsv('rental_length')];

    const lineHtml = q.lines.map((l) => `
      <div class="pos-cart-line"><div class="pos-cart-line-label">${escapeHtml(l.label)}</div><div class="pos-cart-line-amt mono">${fmtMoney(l.amount)}</div></div>
    `).join('');

    posForm.hidden = true;
    posStepper.hidden = true;
    if (posNav) posNav.hidden = true;
    if (posPanel) posPanel.hidden = true;
    if (posTabs) posTabs.hidden = true;
    posResult.innerHTML = `
      <div class="csf-complete">
        <div class="csf-complete-banner">
          <div class="csf-complete-banner-title">&#9989; Reservation Complete</div>
          <p class="csf-complete-banner-text">The reservation has been completed!</p>
          <p class="csf-complete-banner-text">A confirmation ${getRsv('receipt_phone') ? `has been sent via text to <span class="mono">${escapeHtml(getRsv('receipt_phone'))}</span>` : 'has been sent to the customer'}. Confirmation number <strong class="mono">${escapeHtml(conf)}</strong>.</p>
        </div>
        <div class="pos-card csf-complete-card">
          <div class="pos-card-body">
            <h3 class="csf-complete-name">Customer Name: ${escapeHtml(custName)}</h3>
            <div class="csf-complete-grid">
              <div class="csf-complete-col">
                <div class="csf-complete-subhead">Reservation Summary</div>
                <div class="csf-complete-model">${escapeHtml(q.truck ? q.truck.label.toUpperCase() : 'TRUCK')}</div>
                <dl class="csf-complete-facts">
                  <div><dt>Pick Up Date:</dt><dd>${escapeHtml(getRsv('pickup_date') || 'TBD')}</dd></div>
                  <div><dt>Pick Up Time:</dt><dd>${escapeHtml(q.oneWay ? `${getRsv('pickup_window') || 'P.M.'} (rep confirms exact time)` : (getRsv('pickup_time') || 'TBD'))}</dd></div>
                  <div><dt>Rental Length:</dt><dd>${escapeHtml(q.oneWay ? `${q.ow ? q.ow.days : 1} days (one-way)` : (rl ? rl.label : '1 day'))}</dd></div>
                  <div><dt>Rental Type:</dt><dd>${q.oneWay ? 'One Way' : 'In Town'}</dd></div>
                  ${ls ? `<div><dt>Move:</dt><dd>${escapeHtml(ls.label)}</dd></div>` : ''}
                </dl>
                <div class="csf-complete-loc">
                  <div class="csf-complete-map" aria-hidden="true"></div>
                  <div class="csf-complete-loc-info">
                    <em>${escapeHtml(loc.name ? 'Meridian of ' + loc.name : 'Pickup location TBD')}</em>
                    ${loc.address ? `<span>${escapeHtml(loc.address)}</span>` : ''}
                    ${loc.phone ? `<span class="mono">${escapeHtml(loc.phone)}</span>` : ''}
                  </div>
                </div>
              </div>
              <div class="csf-complete-col">
                <div class="csf-complete-subhead">Summary of Charges</div>
                <div class="csf-complete-charges">
                  ${q.lines.map((l) => `<div class="csf-complete-charge"><span class="csf-complete-charge-label">${escapeHtml(l.label)}</span><span class="csf-complete-charge-amt mono">${fmtMoney(l.amount)}</span></div>`).join('')}
                  <div class="csf-complete-charge"><span class="csf-complete-charge-label">Estimated Tax</span><span class="csf-complete-charge-amt mono">${fmtMoney(q.tax)}</span></div>
                  <div class="csf-complete-charge csf-complete-total"><span class="csf-complete-charge-label">Total:</span><span class="csf-complete-charge-amt mono">${fmtMoney(q.total)}</span></div>
                  <div class="pos-cc-chip" data-brand="${escapeAttr(brand)}" style="margin-top:8px;">
                    <span class="pos-cc-brand">${escapeHtml(brand === 'unknown' ? 'CARD' : brand.toUpperCase())}</span>
                    <span class="mono">•••• ${escapeHtml(last4)}</span>
                    <span class="mono">exp ${escapeHtml(exp)}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="pos-receipt-readback" style="margin-top:16px;">
              <div class="pos-receipt-readback-title">Read back to the caller</div>
              <p>"Your confirmation number is <strong class="mono">${escapeHtml(conf)}</strong>. We're holding a ${escapeHtml(q.truck ? q.truck.label : 'truck')} for you at the ${escapeHtml(loc.name || 'pickup')} location on ${escapeHtml(getRsv('pickup_date'))} ${q.oneWay ? `in the ${escapeHtml(getRsv('pickup_window') || 'P.M.')}, and a local Meridian representative will call you the day before to lock in the exact time and equipment` : `at ${escapeHtml(getRsv('pickup_time') || 'your selected time')}`}. Your total comes to ${escapeHtml(fmtMoney(q.total))} on the card ending in ${escapeHtml(last4)}. Is there anything else I can help you with?"</p>
            </div>
          </div>
        </div>
        <div class="csf-complete-foot">
          <span class="csf-complete-foot-note">Does this same customer need to make another reservation?</span>
          <button class="ghost-button" type="button" id="pos-new">Start another reservation</button>
        </div>
      </div>
    `;
    byId('pos-new')?.addEventListener('click', () => {
      posResult.innerHTML = '';
      posForm.reset();
      posForm.hidden = false;
      // Stepper stays hidden in the CSF chrome; the panel/tabs come back.
      posStepper.hidden = true;
      if (posNav) posNav.hidden = false;
      if (posPanel) posPanel.hidden = false;
      if (posTabs) posTabs.hidden = false;
      truckOverride = null;
      selectedLocation = null;
      storageAsked = false;
      originGeo = null;
      destGeo = null;
      selectedAddons.clear();
      equipFilters.truck = true;
      equipFilters.trailer = false;
      equipFilters.towing = false;
      pos.querySelectorAll('[data-equip-filter]').forEach((cb) => {
        cb.checked = !!equipFilters[cb.dataset.equipFilter];
      });
      posEntityCard.hidden = true;
      updateCardChip();
      setRsv('pickup_date', new Date().toISOString().slice(0, 10));
      renderCart();
      renderLeftRail();
      renderSched();
      renderLocations();
      renderEquipTable();
      showStep(1);
    });
  }

  function openStorageModal(onContinue) {
    const overlay = document.createElement('div');
    overlay.className = 'pos-modal';
    overlay.innerHTML = `
      <div class="pos-modal-inner" role="dialog" aria-modal="true" aria-labelledby="pos-storage-title">
        <div class="pos-modal-eyebrow">Storage</div>
        <h3 class="pos-modal-title" id="pos-storage-title">Will the customer need storage?</h3>
        <p class="pos-modal-sub">Ask if they need storage before or after the move. Meridian self-storage carries a one-year price-lock guarantee.</p>
        <div class="pos-modal-actions">
          <button type="button" class="ghost-button" data-storage="no">No thanks</button>
          <button type="button" class="primary-button" data-storage="after">Yes, add storage</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    let settled = false;
    function close(val) {
      if (settled) return;
      settled = true;
      if (val) setRsv('storage', val);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      onContinue();
    }
    function onKey(e) { if (e.key === 'Escape') close('no'); }
    overlay.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-storage]');
      if (btn) { close(btn.dataset.storage); return; }
      if (e.target === overlay) close('no');
    });
    document.addEventListener('keydown', onKey);
  }

  function openHistoryModal(r) {
    const reservations = r.active_reservations || [];
    const claims = r.claims_cases || [];
    const past = r.past_rentals || [];
    const overlay = document.createElement('div');
    overlay.className = 'pos-modal';
    overlay.innerHTML = `
      <div class="pos-modal-inner pos-modal-wide" role="dialog" aria-modal="true" aria-labelledby="pos-hist-title">
        <div class="pos-modal-head">
          <h3 class="pos-modal-title" id="pos-hist-title">${escapeHtml(r.full_name)} &middot; history</h3>
          <button type="button" class="pos-modal-close" aria-label="Close">&times;</button>
        </div>
        ${reservations.length ? `<div class="pos-hist-group pos-hist-accent"><div class="pos-hist-title">Active reservations</div>${reservations.map((res) => `<div class="pos-hist-row"><span class="mono">${escapeHtml(res.confirmation)}</span> ${escapeHtml(res.truck)} &middot; ${escapeHtml(res.location)} &middot; ${escapeHtml(res.date)} &middot; ${escapeHtml(res.total)} &middot; <em>${escapeHtml(res.status)}</em></div>`).join('')}</div>` : ''}
        ${claims.length ? `<div class="pos-hist-group pos-hist-warn"><div class="pos-hist-title">Open claims</div>${claims.map((c) => `<div class="pos-hist-row"><span class="mono">${escapeHtml(c.case_id)}</span> ${escapeHtml(c.amount)} &middot; ${escapeHtml(c.description)} &middot; <em>${escapeHtml(c.status)}</em></div>`).join('')}</div>` : ''}
        ${past.length ? `<div class="pos-hist-group"><div class="pos-hist-title">Past rentals (${past.length})</div>${past.map((p) => `<div class="pos-hist-row"><span class="mono">${escapeHtml(p.date)}</span> ${escapeHtml(p.truck)} &middot; ${escapeHtml(p.location)} &middot; ${escapeHtml(p.total)} &middot; <em>${escapeHtml(p.status)}</em></div>`).join('')}</div>` : ''}
        ${r.notes ? `<div class="pos-hist-group"><div class="pos-hist-title">Agent notes</div><p class="pos-hist-notes">${escapeHtml(r.notes)}</p></div>` : ''}
      </div>
    `;
    document.body.appendChild(overlay);
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('.pos-modal-close')) close();
    });
    document.addEventListener('keydown', onKey);
  }

  // Init
  setRsv('pickup_date', new Date().toISOString().slice(0, 10));
  renderLeftRail();
  renderCart();
  renderEquip();
  renderSched();
  renderLocations();
  renderEquipTable();
  updateCardChip();
  showStep(1);

  // Caller ID: when a known repeat customer calls, their number is already on
  // the line — prefill the lookup and pull up the verify modal so the agent just
  // confirms. Skipped for showcase + blind calls (where revealing the caller
  // would break the format).
  const callerRecord = scenario.customer_record;
  if (!isShowcaseCall && !scenario.blind && callerRecord && callerRecord.found === true && callerRecord.phone) {
    if (posLookupInput) posLookupInput.value = callerRecord.phone;
    setTimeout(() => {
      // Bail if the call ended before the pop fired (avoid a stray overlay).
      if (!posLookupInput || !posLookupInput.isConnected) return;
      try { openCustomerModal({ mode: 'found', record: callerRecord, query: callerRecord.phone }); } catch {}
    }, 700);
  }

  return {
    getCallbackNotes: () => (byId('pos-callback-notes')?.value || '').trim(),
    destroy() {
      if (activeFieldTip === fieldTip) activeFieldTip = null;
      try { fieldTip.remove(); } catch {}
    },
  };
}
