const STATES = ['REQUESTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];
let vendors = [];
let summaryCache = {};

async function loadVendors() {
  const res = await fetch('/api/vendors');
  vendors = await res.json();
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 2000);
}

function vendorOptionsHtml(currentVendorId) {
  // BUG: inactive vendors are listed right alongside active ones with no
  // filtering and no visual distinction.
  const opts = ['<option value="">Unassigned</option>']
    .concat(vendors.map((v) => `<option value="${v.id}">${v.name}</option>`));
  return opts.join('');
}

function cardHtml(r) {
  const stateButtons = STATES.map((s) => {
    // BUG: only the button matching the request's OWN current state is
    // disabled. Every other state's button stays clickable, including
    // states that are not the single valid "next" state.
    const disabled = s === r.state ? 'disabled' : '';
    return `<button class="state-btn" data-id="${r.id}" data-to="${s}" ${disabled}>${s}</button>`;
  }).join('');

  // BUG: the vendor-select is never disabled, even once the request has
  // reached the terminal COMPLETED state - the spec requires it to be
  // disabled at that point, same as the state-transition buttons are.

  return `
    <div class="card" data-id="${r.id}">
      <div class="card-title">${r.candidateName}</div>
      <div class="card-sub">${r.checkType}</div>
      <select class="vendor-select" data-id="${r.id}">${vendorOptionsHtml(r.vendorId)}</select>
      <div class="state-buttons">${stateButtons}</div>
    </div>
  `;
}

async function loadBoard() {
  const [summaryRes, ...stateResults] = await Promise.all([
    fetch('/api/requests/summary'),
    ...STATES.map((s) => fetch(`/api/requests?state=${s}`))
  ]);
  summaryCache = await summaryRes.json();
  const byState = {};
  for (let i = 0; i < STATES.length; i++) {
    byState[STATES[i]] = await stateResults[i].json();
  }

  const board = document.getElementById('board');
  board.innerHTML = STATES.map((s) => `
    <div class="column">
      <div class="column-header">${s} <span class="count">${summaryCache[s] ?? 0}</span></div>
      <div class="column-body">${byState[s].map(cardHtml).join('') || '<div class="empty">No requests</div>'}</div>
    </div>
  `).join('');

  board.querySelectorAll('.vendor-select').forEach((sel) => {
    sel.addEventListener('change', () => onAssign(sel));
  });
  board.querySelectorAll('.state-btn').forEach((btn) => {
    btn.addEventListener('click', () => onTransition(btn));
  });
}

async function onTransition(btn) {
  const id = btn.dataset.id;
  const to = btn.dataset.to;
  const res = await fetch(`/api/requests/${id}/transition`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to })
  });
  // BUG: toast always reports success, even when the API responded with
  // a 400 for an invalid transition.
  showToast(`Moved to ${to}`);
  // BUG: the board is not reloaded after a transition, so the card stays
  // in its old column until the page is manually refreshed.
}

async function onAssign(sel) {
  const id = sel.dataset.id;
  const res = await fetch(`/api/requests/${id}/assign`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vendorId: sel.value || null })
  });
  // BUG: toast always reports success, even when the API responded with a
  // 400 (inactive vendor, unknown vendor, or request already COMPLETED).
  showToast('Vendor assigned');
  await loadBoard();
}

document.getElementById('new-request-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const checkType = document.getElementById('new-checkType').value;
  const candidateName = document.getElementById('new-candidateName').value;
  await fetch('/api/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ checkType, candidateName })
  });
  document.getElementById('new-candidateName').value = '';
  await loadBoard();
});

async function init() {
  await loadVendors();
  await loadBoard();
}

init();

// Testing utility — not part of the app under test.
document.getElementById('reset-data-btn').addEventListener('click', async () => {
  await fetch('/api/reset', { method: 'POST' });
  await loadVendors();
  await loadBoard();
  showToast('Data reset');
});
