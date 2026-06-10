// cs-tool.js — Customer Service demo "Customer Management" tool (shared module)
// ----------------------------------------------------------------------------
// A de-branded, static (client-side only) replica of the U-Haul intranet
// customer-management flow the trainee navigates during the demo_service call
// (caller "Greg Foster"). Extracted from app.js so BOTH the live app (app.js)
// and the static state gallery (preview.js) render the SAME markup + wiring,
// with no risk of the two drifting apart.
//
// Exports:
//   csToolHtml()   — returns the 4-view .cs-tool markup as an HTML string.
//   wireCsTool(root) — event-delegated view switching + customer search.
//
// Four views live inside one .cs-tool container and are switched purely by
// toggling [data-cs-view] panels (no re-render of the call):
//   1. customer  — Customer Management (default; search → populate Greg)
//   2. contract  — Contract Lookup for MER-512874
//   3. receipts  — Receipts list for the contract
//   4. receipt   — the printed Return receipt (the payoff screen)
// All data is hard-coded to tell one consistent charge story: quoted ~$70 at
// reservation, actual $124.51 (drove 56 mi + $30 fuel fee for returning at
// 7/16 vs 3/4 out). See the call prompt's DATA SANITY note.
// ============================================================================

// Local copy of app.js's HTML escaper so this module has no dependency on
// app.js (preview.js must be able to import it without pulling in the app).
// The moved markup only escapes element text, so escapeHtml alone suffices.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function csToolHtml() {
  // Persistent intranet top bar (mirrors uhaul.net's internal navbar). Tools is
  // the active section; the orange strip under the dark bar is CSS.
  const navItems = ['Reports', 'Equipment', 'Publications', 'Multimedia', 'Tools', 'HR', 'Links', 'Boards', 'Sustainability', 'Cross contact'];
  const nav = navItems.map((t) =>
    `<a class="cs-nav-item${t === 'Tools' ? ' is-active' : ''}">${escapeHtml(t)}</a>`
  ).join('');

  // ---- View 1: Customer Management -----------------------------------------
  const mainTabs = ['Overview', 'Dealerships', 'Tolls/Citations', 'VIP/Gift Card', 'Transaction History', 'Dispute', 'Payment Methods', 'Cautionary Alert', 'Communication', 'Privacy Request', 'Rental/Move Claims', 'Reviews', 'eAlert'];
  const mainTabsHtml = mainTabs.map((t) => `<a class="cs-subtab">${escapeHtml(t)}</a>`).join('');
  const pastTabs = [['Equipment', true], ['Storage', false], ['Moving Help', false], ['Receipts', false], ['Meridian.com Orders', false], ['Boxes', false]];
  const pastTabsHtml = pastTabs.map(([t, on]) =>
    `<span class="cs-pill${on ? ' is-active' : ''}">${escapeHtml(t)}</span>`
  ).join('');

  const customerView = `
    <section class="cs-view" data-cs-view="customer">
      <h1 class="cs-h1">Customer Management</h1>
      <div class="cs-layout">
        <aside class="cs-rail">
          <div class="cs-card cs-search-card">
            <div class="cs-card-label">Customer Search</div>
            <form class="cs-search" data-cs-search>
              <input class="cs-input" type="text" data-cs-query placeholder="Name, phone, or confirmation #" aria-label="Customer search">
              <button type="submit" class="cs-search-btn" aria-label="Search">
                <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 10.5 L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              </button>
            </form>
            <div class="cs-rail-links">
              <a class="cs-link">Add New Customer to Database</a>
              <a class="cs-link">Send App to Customer</a>
              <a class="cs-link">Add Cautionary Alert</a>
            </div>
          </div>

          <div class="cs-rail-empty" data-cs-rail-empty>
            <p class="cs-muted">Search for a customer to view their profile.</p>
          </div>

          <div class="cs-rail-results" data-cs-rail-results hidden>
            <div class="cs-card">
              <div class="cs-cust-name">Greg Foster <span class="cs-verified" title="Verified account">&#10003;</span></div>
              <div class="cs-cust-rating"><span class="cs-stars" aria-hidden="true">&#9733;&#9733;&#9733;&#9733;&#9734;</span> <a class="cs-link">1 Review</a></div>
              <dl class="cs-facts">
                <div><dt>Total Transactions:</dt><dd>2</dd></div>
                <div><dt>Total Amount:</dt><dd>$191.13</dd></div>
              </dl>
              <div class="cs-rail-links">
                <a class="cs-link">Edit Profile and Vehicles</a>
                <a class="cs-link cs-link-danger">Delete Verified Account</a>
              </div>
            </div>

            <div class="cs-card">
              <div class="cs-card-label">Contact Information</div>
              <div class="cs-kv"><span class="cs-k">Phone:</span> (210) 555-7193 <span class="cs-tag">Primary</span></div>
              <div class="cs-kv"><span class="cs-k">Email:</span> greg.foster.satx@gmail.com <span class="cs-tag">Primary</span></div>
            </div>

            <div class="cs-card">
              <div class="cs-card-label">Social Media</div>
              <p class="cs-muted">None available</p>
            </div>

            <div class="cs-card">
              <div class="cs-card-label">Address Information</div>
              <div class="cs-kv"><span class="cs-k">Billing Address:</span> SAN ANTONIO, TX, United States</div>
              <a class="cs-link">Show All</a>
            </div>
          </div>
        </aside>

        <div class="cs-main">
          <nav class="cs-subtabs">${mainTabsHtml}</nav>

          <div class="cs-card cs-orders-card">
            <div class="cs-orders-head">
              <span class="cs-card-label">Current Orders</span>
              <a class="cs-link">Create a new reservation</a>
            </div>
            <div class="cs-pill-row"><span class="cs-pill is-active">Storage &#9662;</span></div>
            <table class="cs-table">
              <thead><tr><th>Contract ID</th><th>Entity</th><th>Location</th><th>Unit</th></tr></thead>
              <tbody><tr><td colspan="4" class="cs-table-empty">No data available in table</td></tr></tbody>
            </table>
            <div class="cs-table-foot"><span>Showing 0 to 0 of 0 entries</span><span class="cs-pager">Previous Next</span></div>
          </div>

          <div class="cs-card cs-orders-card">
            <div class="cs-orders-head"><span class="cs-card-label">Past Orders</span></div>
            <div class="cs-pill-row">${pastTabsHtml}</div>
            <table class="cs-table">
              <thead><tr><th>Date &#9662;</th><th>Type</th><th>Contract/Reservation/Receipt</th><th>Equipment</th><th>Status</th><th>Total Paid</th></tr></thead>
              <tbody data-cs-past-body>
                <tr><td colspan="6" class="cs-table-empty">No data available in table</td></tr>
              </tbody>
            </table>
            <div class="cs-table-foot" data-cs-past-foot><span>Showing 0 to 0 of 0 entries</span><span class="cs-pager">Previous Next</span></div>
          </div>
        </div>
      </div>
    </section>`;

  // The Past Orders rows are injected on search (kept out of the static markup
  // so the pre-search empty state reads correctly).
  const pastRowsHtml = `
    <tr><td>06/06/2026</td><td>InTown</td><td><a class="cs-link" data-cs-go="contract">MER-512874</a></td><td>DC4821H</td><td>Received</td><td>$124.51</td></tr>
    <tr><td>11/09/2025</td><td>InTown</td><td><span class="cs-link-muted">MER-417286</span></td><td>JH3308F</td><td>Received</td><td>$66.62</td></tr>`;

  // ---- View 2: Contract Lookup ---------------------------------------------
  const contractView = `
    <section class="cs-view" data-cs-view="contract" hidden>
      <a class="cs-back" data-cs-go="customer">&#8249; Customer Management</a>
      <h1 class="cs-h1">Contract Lookup &mdash; Contract MER-512874</h1>

      <div class="cs-contract-top">
        <div class="cs-card">
          <div class="cs-kv"><span class="cs-k">Primary Phone:</span> (210) 555-7193</div>
          <div class="cs-kv"><span class="cs-k">Email:</span> greg.foster.satx@gmail.com</div>
          <div class="cs-kv"><span class="cs-k">License:</span> TX - ********4471</div>
          <div class="cs-kv"><span class="cs-k">Entry Method:</span> Scan</div>
          <div class="cs-kv"><span class="cs-k">Birth Date:</span> 3/*/1987</div>
        </div>
        <div class="cs-card">
          <div class="cs-store-name">MERIDIAN MOVING &amp; STORAGE OF NORTHWEST SAN ANTONIO</div>
          <div class="cs-muted">8124 Culebra Rd, San Antonio, TX 78251</div>
          <div class="cs-muted">Phone: (210) 555-7008</div>
        </div>
        <div class="cs-card cs-action-links">
          <a class="cs-link">Add Customer Action Flag</a>
          <a class="cs-link">Issue VIP</a>
          <a class="cs-link">$50.00 Reservation Guarantee (Field Use Only)</a>
          <a class="cs-link">Incidents/Claims associated with this contract</a>
          <a class="cs-link">View Contract in POS</a>
          <a class="cs-link">Contract Close Report</a>
        </div>
      </div>

      <div class="cs-section-head">&#9662; Rental Information</div>
      <div class="cs-meta-row">Transaction: InTown &nbsp;|&nbsp; Status: Closed &nbsp;|&nbsp; Created Date: 6/5/2026 4:12 PM &nbsp;|&nbsp; Created by: 712044</div>

      <div class="cs-rdr">
        <div class="cs-card">
          <div class="cs-card-label">Reservation</div>
          <table class="cs-mini"><tbody>
            <tr><td>Equipment DC</td><td>Rate $19.95</td></tr>
            <tr><td>Coverage Safe Move</td><td>Rate $15.00</td></tr>
          </tbody></table>
          <div class="cs-kv"><span class="cs-k">Mileage Rate:</span> $0.99</div>
          <div class="cs-kv"><span class="cs-k">Pickup Date/Time:</span> 6/6/2026 9:00 AM</div>
          <div class="cs-kv"><span class="cs-k">Days/Hours requested:</span> 8 Hours</div>
          <div class="cs-kv"><span class="cs-k">Estimated mileage:</span> 30</div>
          <div class="cs-kv"><span class="cs-k">Rental City/State:</span> SAN ANTONIO, TX</div>
          <div class="cs-kv"><span class="cs-k">Preferred Location:</span> 871078</div>
          <div class="cs-kv"><span class="cs-k">Assigned Location:</span> 871078</div>
          <div class="cs-kv"><span class="cs-k">Scheduled Date/Time:</span> 6/6/2026 9:00 AM</div>
          <div class="cs-kv"><span class="cs-k">Scheduling location:</span> 871078</div>
        </div>
        <div class="cs-card">
          <div class="cs-card-label">Dispatch</div>
          <table class="cs-mini"><tbody>
            <tr><td><span class="cs-link-muted">DC4821H</span></td><td>$19.95</td></tr>
            <tr><td>Safe Move</td><td>$15.00</td></tr>
          </tbody></table>
          <div class="cs-kv"><span class="cs-k">Mileage Rate:</span> $0.99</div>
          <div class="cs-kv"><span class="cs-k">Dispatch Date/Time:</span> 6/6/2026 8:52 AM</div>
          <div class="cs-kv"><span class="cs-k">Original Due Date/Time:</span> 6/6/2026 5:00 PM</div>
          <div class="cs-kv"><span class="cs-k">Expected Due Date/Time:</span> 6/6/2026 5:00 PM</div>
          <div class="cs-kv"><span class="cs-k">Contract period:</span> 8 Hours 8 Minutes</div>
          <div class="cs-kv"><span class="cs-k">Rental City/State:</span> SAN ANTONIO, TX</div>
          <div class="cs-kv"><span class="cs-k">Dispatch Location:</span> 871078</div>
          <div class="cs-kv"><span class="cs-k">Pickup odometer:</span> 18,442.0</div>
          <div class="cs-kv"><span class="cs-k">Pickup fuel level:</span> 3/4</div>
        </div>
        <div class="cs-card">
          <div class="cs-card-label">Return</div>
          <table class="cs-mini"><tbody>
            <tr><td>DC4821H</td><td></td></tr>
          </tbody></table>
          <div class="cs-kv"><span class="cs-k">Return Date/Time:</span> 6/6/2026 2:38 PM</div>
          <div class="cs-kv"><span class="cs-k">Days/Hours used:</span> 5 Hours 46 Minutes</div>
          <div class="cs-kv"><span class="cs-k">Chargeable Rental Periods:</span> 1</div>
          <div class="cs-kv"><span class="cs-k">Total miles used:</span> <strong>56</strong></div>
          <div class="cs-kv"><span class="cs-k">Add'l miles used:</span> 26</div>
          <div class="cs-kv"><span class="cs-k">Rental City/State:</span> SAN ANTONIO, TX</div>
          <div class="cs-kv"><span class="cs-k">Return location:</span> 871078</div>
          <div class="cs-kv"><span class="cs-k">Return odometer:</span> 18,498.0</div>
          <div class="cs-kv"><span class="cs-k">Return fuel level:</span> <strong>7/16</strong></div>
        </div>
      </div>

      <div class="cs-section-head">&#9662; Payment Information</div>
      <table class="cs-table cs-pay-table">
        <thead><tr>
          <th>Payment date</th><th>Payment Location</th><th>Transaction Type</th><th>Method of Payment</th><th>Auth Code</th><th>Pending/Hold Amount</th><th>Settled Amount</th><th>Balance Remaining</th><th>Receipts</th>
        </tr></thead>
        <tbody>
          <tr><td>6/5/2026 4:12 PM</td><td>712044</td><td></td><td>Visa 4539****6467</td><td>&mdash;</td><td>&mdash;</td><td>$0.00</td><td>$0.00</td><td></td></tr>
          <tr><td>6/6/2026 8:52 AM</td><td>871078</td><td>Rental</td><td>Visa 4539****6467</td><td>085203</td><td>$92.02</td><td>&mdash;</td><td>$0.00</td><td><a class="cs-link" data-cs-go="receipts">View</a></td></tr>
          <tr><td>6/6/2026 2:38 PM</td><td>871078</td><td>Return</td><td>Visa 4539****6467</td><td>143807</td><td>&mdash;</td><td><strong>$124.51</strong></td><td>$0.00</td><td><a class="cs-link" data-cs-go="receipts">View</a></td></tr>
          <tr class="cs-pay-total"><td colspan="6"></td><td colspan="2">Total Contract:</td><td><strong>$124.51</strong></td></tr>
        </tbody>
      </table>
    </section>`;

  // ---- View 3: Receipts list -----------------------------------------------
  const receiptsView = `
    <section class="cs-view" data-cs-view="receipts" hidden>
      <a class="cs-back" data-cs-go="contract">&#8249; Back to Contract</a>
      <h1 class="cs-h1">Contract Search</h1>
      <p class="cs-sub">Original receipts for Contract MER-512874</p>
      <div class="cs-receipts-tools">
        <input class="cs-input" type="text" placeholder="Filter" aria-label="Filter receipts">
        <button type="button" class="cs-customize-btn">Customize</button>
      </div>
      <table class="cs-table">
        <thead><tr><th>Receipt</th><th>Date &#9662;</th><th>Description</th><th>Location</th></tr></thead>
        <tbody>
          <tr><td><a class="cs-link" data-cs-go="receipt">View</a></td><td>6/6/2026 2:38:11 PM</td><td>&#128666; In-Town Return (IN)</td><td>871078</td></tr>
          <tr><td><span class="cs-link-muted">View</span></td><td>6/6/2026 8:52:07 AM</td><td>In-Town Rental (OUT)</td><td>871078</td></tr>
          <tr><td><span class="cs-link-muted">View</span></td><td>6/5/2026 4:12:48 PM</td><td>In-Town Reservation</td><td>712044</td></tr>
        </tbody>
      </table>
      <div class="cs-page-foot">
        <span class="cs-foot-links"><a class="cs-link">Messageboards</a> &middot; <a class="cs-link">Contact</a> &middot; <a class="cs-link">User policy</a></span>
        <span class="cs-wordmark">MERIDIAN</span>
      </div>
    </section>`;

  // ---- View 4: Receipt document (payoff screen) ----------------------------
  const terms = [
    'Equipment must be returned to the dispatching location by the agreed due date and time. Failure to return rented equipment may result in additional rental periods, recovery fees, and reporting of the equipment as unreturned.',
    'Mileage and fuel charges are computed from the odometer and fuel-gauge readings recorded at dispatch and at return. A fuel service fee applies when equipment is returned below the fuel level at which it was dispatched.',
    'The renter is responsible for damage to or loss of the equipment during the rental period, subject to any coverage purchased. Coverage does not apply to negligence, prohibited use, or unauthorized drivers.',
    'Questions about this receipt or any charge should be directed to the dispatching location at the phone number shown above. Billing disputes must be raised within the period stated in your rental agreement.',
    'Your contact information is used to administer this rental and may be retained per our privacy policy. This receipt reflects charges settled to the payment method on file.',
  ];
  const termsHtml = terms.map((t) => `<li>${escapeHtml(t)}</li>`).join('');

  const receiptView = `
    <section class="cs-view" data-cs-view="receipt" hidden>
      <a class="cs-back" data-cs-go="receipts">&#8249; Back to Receipts</a>
      <div class="cs-receipt-layout">
        <aside class="cs-email-pane">
          <label class="cs-email-label" for="cs-email-input">Email Address</label>
          <input class="cs-input" id="cs-email-input" type="email" value="greg.foster.satx@gmail.com">
          <div class="cs-email-actions">
            <button type="button" class="cs-btn" data-cs-email>Email Receipt</button>
            <button type="button" class="cs-btn cs-btn-ghost" data-cs-email>Print</button>
          </div>
          <span class="cs-email-sent" data-cs-email-sent hidden>Sent &#10003;</span>
        </aside>

        <article class="cs-receipt">
          <div class="cs-receipt-head">
            <div><span class="cs-wordmark">MERIDIAN</span> <span class="cs-receipt-kicker">Receipt</span></div>
            <div class="cs-receipt-head-right">
              <div class="cs-barcode" aria-hidden="true"></div>
              <div class="cs-muted">In-Town Return In</div>
              <div class="cs-muted">(210) 555-7008</div>
            </div>
          </div>

          <div class="cs-receipt-meta">
            <div><strong>Contract No: MER-512874</strong> &mdash; Saturday, 6/6/2026 2:38 PM</div>
            <div class="cs-muted">MERIDIAN MOVING &amp; STORAGE OF NORTHWEST SAN ANTONIO 871078 &middot; 8124 Culebra Rd &middot; San Antonio, TX 78251</div>
          </div>

          <div class="cs-receipt-cust">
            <div><span class="cs-k">Customer Name:</span> Greg Foster, 2317 Hunters Creek Dr, San Antonio, TX 78231</div>
            <div><span class="cs-k">Cust Ph - Email:</span> (210) 555-7193 &middot; greg.foster.satx@gmail.com</div>
            <div><span class="cs-k">Authorized Driver(s):</span> Greg Foster</div>
            <div><span class="cs-k">Rental Date/Time:</span> 6/6/2026 8:52 AM &nbsp; <span class="cs-k">Return Date/Time:</span> 6/6/2026 2:38 PM &nbsp; <span class="cs-k">Chargeable Rental Periods:</span> 1</div>
          </div>

          <table class="cs-table cs-equip-table">
            <thead><tr>
              <th>Equipment</th><th>MI Out</th><th>MI In</th><th>MI Rate</th><th>MI Charge</th><th>Coverage</th><th>Missing/Damage Charge</th><th>Rental Rate</th><th>Rental Charge</th><th>Actual Charges</th>
            </tr></thead>
            <tbody><tr>
              <td>DC4821H / TM15-204</td><td>18,442.0</td><td>18,498.0</td><td>$0.99 x 56.0 MI</td><td>$55.44</td><td>Safe Move: $15.00</td><td>$0.00</td><td>$19.95</td><td>$19.95</td><td>$90.39</td>
            </tr></tbody>
          </table>

          <div class="cs-fuel">
            <div class="cs-fuel-gauge" aria-hidden="true">
              <span class="cs-fuel-tick" style="left:0%"></span>
              <span class="cs-fuel-tick" style="left:25%"></span>
              <span class="cs-fuel-tick" style="left:50%"></span>
              <span class="cs-fuel-tick" style="left:75%"></span>
              <span class="cs-fuel-tick" style="left:100%"></span>
              <span class="cs-fuel-marker" style="left:43.75%"></span>
              <span class="cs-fuel-cap cs-fuel-cap-e">E</span>
              <span class="cs-fuel-cap cs-fuel-cap-q" style="left:25%">1/4</span>
              <span class="cs-fuel-cap cs-fuel-cap-h" style="left:50%">1/2</span>
              <span class="cs-fuel-cap cs-fuel-cap-t" style="left:75%">3/4</span>
              <span class="cs-fuel-cap cs-fuel-cap-f">F</span>
            </div>
            <div class="cs-muted">Fuel level at return: 7/16 (out at 3/4)</div>
          </div>

          <div class="cs-charges">
            <div class="cs-charge"><span>Fuel Service Fee:</span><span><strong>$30.00</strong></span></div>
            <div class="cs-charge"><span>Vehicle License Recovery Fee - TX Pickup/Van:</span><span>$1.20</span></div>
            <div class="cs-charge"><span>Environmental Fee:</span><span>$1.00</span></div>
            <div class="cs-charge cs-charge-sub"><span>Subtotal:</span><span><strong>$122.59</strong></span></div>
            <div class="cs-charge"><span>Rental Tax:</span><span>$1.92</span></div>
            <div class="cs-charge cs-charge-sub"><span>Total Rental Charges:</span><span><strong>$124.51</strong></span></div>
            <div class="cs-charge"><span>Credit Card Payment:</span><span>$124.51</span></div>
            <div class="cs-charge cs-charge-net"><span>Net Paid Today:</span><span><strong>$124.51</strong></span></div>
          </div>

          <div class="cs-paymentblock mono">
            <div>Card Type/Account: VISA xxxx-xxxx-xxxx-6467</div>
            <div>Payment: 143807</div>
            <div>Entry Method: Chip</div>
            <div>Application Label: VISA CREDIT</div>
            <div>Merchant ID: 1449M66582507</div>
            <div>AID: A0000000031010</div>
            <div>TVR: 8000048000</div>
            <div>TSI: 6800</div>
            <div>Verified By PIN</div>
          </div>

          <ul class="cs-terms">${termsHtml}</ul>

          <div class="cs-sign">X ________________ &nbsp; Greg Foster &mdash; e-Signature on file</div>
        </article>
      </div>
    </section>`;

  return `
    <div class="cs-tool" data-cs-current="customer">
      <template data-cs-past-rows>${pastRowsHtml}</template>
      <nav class="cs-nav">
        <span class="cs-nav-brand">meridian.net</span>
        <div class="cs-nav-items">${nav}</div>
      </nav>
      <div class="cs-nav-accent" aria-hidden="true"></div>
      <div class="cs-body">
        ${customerView}
        ${contractView}
        ${receiptsView}
        ${receiptView}
      </div>
    </div>`;
}

// Wire the Customer Service tool: event delegation on the .cs-tool container.
// View switching toggles [data-cs-view] panels (no call re-render). The search
// form reveals Greg's profile + past orders; [data-cs-go] links jump between
// views; the receipt's Email/Print buttons flash a no-op "Sent" confirmation.
export function wireCsTool(root) {
  if (!root) return;

  function showView(name) {
    root.querySelectorAll('[data-cs-view]').forEach((v) => {
      v.hidden = v.getAttribute('data-cs-view') !== name;
    });
    root.dataset.csCurrent = name;
    // Scroll the tool back to the top on each view switch (the call body scrolls).
    try { root.scrollTop = 0; root.parentElement && (root.parentElement.scrollTop = 0); } catch {}
  }

  function runSearch() {
    const railEmpty = root.querySelector('[data-cs-rail-empty]');
    const railResults = root.querySelector('[data-cs-rail-results]');
    const pastBody = root.querySelector('[data-cs-past-body]');
    const pastFoot = root.querySelector('[data-cs-past-foot]');
    const pastRowsTpl = root.querySelector('[data-cs-past-rows]');
    if (railEmpty) railEmpty.hidden = true;
    if (railResults) railResults.hidden = false;
    if (pastBody && pastRowsTpl) {
      pastBody.innerHTML = '';
      pastBody.appendChild(pastRowsTpl.content.cloneNode(true));
    }
    if (pastFoot) pastFoot.innerHTML = '<span>Showing 1 to 2 of 2 entries</span><span class="cs-pager">Previous 1 Next</span>';
  }

  root.addEventListener('submit', (e) => {
    if (!e.target.closest('[data-cs-search]')) return;
    e.preventDefault();
    runSearch();
  });

  root.addEventListener('click', (e) => {
    const go = e.target.closest('[data-cs-go]');
    if (go) {
      e.preventDefault();
      showView(go.getAttribute('data-cs-go'));
      return;
    }
    const email = e.target.closest('[data-cs-email]');
    if (email) {
      e.preventDefault();
      const sent = root.querySelector('[data-cs-email-sent]');
      if (sent) {
        sent.hidden = false;
        setTimeout(() => { sent.hidden = true; }, 1800);
      }
    }
  });
}
