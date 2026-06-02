const BASE_URL = 'https://link-analytics-platform-production.up.railway.app';

// Global state
let token = localStorage.getItem('jwt_token');

// DOM Elements
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const loginCard = document.getElementById('login-card');
const registerCard = document.getElementById('register-card');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const createLinkForm = document.getElementById('create-link-form');

const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const registerEmailInput = document.getElementById('register-email');
const registerPasswordInput = document.getElementById('register-password');
const originalUrlInput = document.getElementById('original-url-input');
const customAliasInput = document.getElementById('custom-alias-input');

const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');
const registerSuccess = document.getElementById('register-success');
const createError = document.getElementById('create-error');
const createSuccess = document.getElementById('create-success');

const userDisplayEmail = document.getElementById('user-display-email');
const linksTableBody = document.getElementById('links-table-body');
const linksTable = document.getElementById('links-table');
const noLinksMsg = document.getElementById('no-links-msg');

const analyticsModal = document.getElementById('analytics-modal');
const modalTitle = document.getElementById('modal-title');
const modalSubtitle = document.getElementById('modal-subtitle');
const metricTotalClicks = document.getElementById('metric-total-clicks');
const metricUniqueVisitors = document.getElementById('metric-unique-visitors');
const countryStatsList = document.getElementById('country-stats-list');
const deviceStatsList = document.getElementById('device-stats-list');

// View Switching Functions
function showAuthView() {
  authView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
  loginCard.classList.remove('hidden');
  registerCard.classList.add('hidden');
  clearAlerts();
}

function showDashboardView(userEmail) {
  authView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  userDisplayEmail.textContent = userEmail || 'Authenticated User';
  clearAlerts();
  loadLinks();
}

function clearAlerts() {
  loginError.classList.add('hidden');
  loginError.textContent = '';
  registerError.classList.add('hidden');
  registerError.textContent = '';
  registerSuccess.classList.add('hidden');
  registerSuccess.textContent = '';
  createError.classList.add('hidden');
  createError.textContent = '';
  createSuccess.classList.add('hidden');
  createSuccess.textContent = '';
}

// Initial Bootstrapping Auth Check
function checkAuth() {
  if (token) {
    // Attempt to parse JWT claims locally to show email
    try {
      const payloadBase64 = token.split('.')[1];
      const payloadDecoded = JSON.parse(atob(payloadBase64));
      showDashboardView(payloadDecoded.email);
    } catch (e) {
      // Invalid token, force re-login
      logout();
    }
  } else {
    showAuthView();
  }
}

function logout() {
  localStorage.removeItem('jwt_token');
  token = null;
  showAuthView();
}

// 1. Authentication Handlers
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  console.log("Login button clicked");
  loginError.classList.add('hidden');
  
  const email = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;
  console.log("Form data captured");

  try {
    console.log("Fetch request started");
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    console.log("Response received");
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    console.log("Login success");
    token = data.accessToken;
    localStorage.setItem('jwt_token', token);
    loginEmailInput.value = '';
    loginPasswordInput.value = '';
    checkAuth();
  } catch (err) {
    console.log("Login failure:", err.message);
    loginError.textContent = err.message;
    loginError.classList.remove('hidden');
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  registerError.classList.add('hidden');
  registerSuccess.classList.add('hidden');

  const email = registerEmailInput.value.trim();
  const password = registerPasswordInput.value;

  try {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    registerSuccess.textContent = 'Account created successfully! Switching to Login view...';
    registerSuccess.classList.remove('hidden');
    registerEmailInput.value = '';
    registerPasswordInput.value = '';

    setTimeout(() => {
      loginCard.classList.remove('hidden');
      registerCard.classList.add('hidden');
      clearAlerts();
    }, 2000);
  } catch (err) {
    registerError.textContent = err.message;
    registerError.classList.remove('hidden');
  }
});

// Switch links inside cards
document.getElementById('to-register-btn').addEventListener('click', (e) => {
  e.preventDefault();
  loginCard.classList.add('hidden');
  registerCard.classList.remove('hidden');
  clearAlerts();
});

document.getElementById('to-login-btn').addEventListener('click', (e) => {
  e.preventDefault();
  loginCard.classList.remove('hidden');
  registerCard.classList.add('hidden');
  clearAlerts();
});

document.getElementById('logout-btn').addEventListener('click', logout);

// 2. Dashboard Link Actions
async function loadLinks() {
  try {
    const res = await fetch(`${BASE_URL}/links`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.status === 401) {
      logout();
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load links');
    }

    renderLinks(data);
  } catch (err) {
    console.error(err);
  }
}

function renderLinks(links) {
  linksTableBody.innerHTML = '';
  
  if (links.length === 0) {
    linksTable.classList.add('hidden');
    noLinksMsg.classList.remove('hidden');
    return;
  }

  linksTable.classList.remove('hidden');
  noLinksMsg.classList.add('hidden');

  links.forEach(link => {
    const tr = document.createElement('tr');
    
    // 1. Original URL column (truncating long URLs natively)
    const tdOriginal = document.createElement('td');
    const divOriginal = document.createElement('div');
    divOriginal.className = 'original-url-cell';
    divOriginal.textContent = link.originalUrl;
    divOriginal.title = link.originalUrl;
    tdOriginal.appendChild(divOriginal);
    tr.appendChild(tdOriginal);

    // 2. Short Code column with inline copy button
    const tdShort = document.createElement('td');

    const shortCellWrapper = document.createElement('div');
    shortCellWrapper.className = 'short-code-cell';
    
    const redirectUrl = `${BASE_URL}/${link.shortCode}`;
    const a = document.createElement('a');
    a.href = redirectUrl;
    a.target = '_blank';
    a.className = 'short-link-tag';
    a.textContent = link.shortCode;
    shortCellWrapper.appendChild(a);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn success-btn action-btn';
    copyBtn.style.padding = '3px 8px';
    copyBtn.style.fontSize = '11px';
    copyBtn.textContent = '📋 Copy';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(redirectUrl).then(() => {
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => {
          copyBtn.textContent = '📋 Copy';
        }, 1500);
      });
    });
    shortCellWrapper.appendChild(copyBtn);
    tdShort.appendChild(shortCellWrapper);
    tr.appendChild(tdShort);

    // 3. Created At column
    const tdCreated = document.createElement('td');
    tdCreated.textContent = new Date(link.createdAt).toLocaleString();
    tr.appendChild(tdCreated);

    // 4. Action buttons column (Stats & Delete)
    const tdActions = document.createElement('td');
    tdActions.className = 'actions-column';

    // Stats button
    const statsBtn = document.createElement('button');
    statsBtn.className = 'btn primary-btn action-btn';
    statsBtn.textContent = '📊 Stats';
    statsBtn.addEventListener('click', () => {
      openAnalyticsModal(link.id, link.shortCode, link.originalUrl);
    });
    tdActions.appendChild(statsBtn);

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn danger-btn action-btn';
    deleteBtn.textContent = '🗑️ Delete';
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete short link "${link.shortCode}"?`)) {
        deleteLink(link.id);
      }
    });
    tdActions.appendChild(deleteBtn);

    tr.appendChild(tdActions);
    linksTableBody.appendChild(tr);
  });
}

// Create Short URL
createLinkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  createError.classList.add('hidden');
  createSuccess.classList.add('hidden');

  const originalUrl = originalUrlInput.value.trim();
  const customAlias = customAliasInput.value.trim() || null;

  try {
    const payload = { originalUrl };
    if (customAlias) {
      payload.customAlias = customAlias;
    }

    const res = await fetch(`${BASE_URL}/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to create short link');
    }

    createSuccess.textContent = `Link created! Short code: ${data.shortCode}`;
    createSuccess.classList.remove('hidden');
    originalUrlInput.value = '';
    customAliasInput.value = '';
    loadLinks();
  } catch (err) {
    createError.textContent = err.message;
    createError.classList.remove('hidden');
  }
});

// Delete Link Action
async function deleteLink(id) {
  try {
    const res = await fetch(`${BASE_URL}/links/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete link');
    }

    loadLinks();
  } catch (err) {
    alert(err.message);
  }
}

// Refresh List
document.getElementById('refresh-links-btn').addEventListener('click', loadLinks);

// 3. Modal Analytics Action
async function openAnalyticsModal(id, shortCode, originalUrl) {
  modalTitle.textContent = `Link Analytics: /${shortCode}`;
  modalSubtitle.textContent = originalUrl;
  metricTotalClicks.textContent = '...';
  metricUniqueVisitors.textContent = '...';
  countryStatsList.innerHTML = '<div class="breakdown-empty">Loading country stats...</div>';
  deviceStatsList.innerHTML = '<div class="breakdown-empty">Loading device stats...</div>';
  
  analyticsModal.classList.remove('hidden');

  try {
    const res = await fetch(`${BASE_URL}/links/${id}/stats`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (res.status === 401) {
      logout();
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to load statistics');
    }

    // Populate standard values
    metricTotalClicks.textContent = data.totalClicks;
    metricUniqueVisitors.textContent = data.uniqueVisitors;

    // Render Country breakdown list
    countryStatsList.innerHTML = '';
    if (data.topCountries.length === 0) {
      countryStatsList.innerHTML = '<div class="breakdown-empty">No country records found yet.</div>';
    } else {
      data.topCountries.forEach(item => {
        const row = document.createElement('div');
        row.className = 'breakdown-row';
        row.innerHTML = `
          <span class="breakdown-row-name">${item.country}</span>
          <span class="breakdown-row-val">${item.clicks} clicks</span>
        `;
        countryStatsList.appendChild(row);
      });
    }

    // Render Device breakdown list
    deviceStatsList.innerHTML = '';
    if (data.topDevices.length === 0) {
      deviceStatsList.innerHTML = '<div class="breakdown-empty">No device records found yet.</div>';
    } else {
      data.topDevices.forEach(item => {
        const row = document.createElement('div');
        row.className = 'breakdown-row';
        row.innerHTML = `
          <span class="breakdown-row-name">${item.device}</span>
          <span class="breakdown-row-val">${item.clicks} clicks</span>
        `;
        deviceStatsList.appendChild(row);
      });
    }

  } catch (err) {
    modalSubtitle.textContent = `Error: ${err.message}`;
    metricTotalClicks.textContent = 'Err';
    metricUniqueVisitors.textContent = 'Err';
    countryStatsList.innerHTML = '<div class="breakdown-empty">Error loading statistics</div>';
    deviceStatsList.innerHTML = '<div class="breakdown-empty">Error loading statistics</div>';
  }
}

// Modal closing helpers
function closeAnalyticsModal() {
  analyticsModal.classList.add('hidden');
}

document.getElementById('modal-close-btn').addEventListener('click', closeAnalyticsModal);
analyticsModal.addEventListener('click', (e) => {
  // If clicked exactly on the background overlay, close it
  if (e.target === analyticsModal) {
    closeAnalyticsModal();
  }
});

// Document setup load
window.addEventListener('DOMContentLoaded', checkAuth);
