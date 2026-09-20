const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:5001/api'
  : 'https://admin.littiwale.co.in/api';

const state = { token: localStorage.getItem('littiwale_rider_token') || '', rider: null, orders: [], filter: 'active' };
const $ = (id) => document.getElementById(id);
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  $('install-app-button')?.classList.remove('hidden');
});

$('install-app-button')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $('install-app-button')?.classList.add('hidden');
});

window.addEventListener('appinstalled', () => $('install-app-button')?.classList.add('hidden'));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2800);
}

function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

function setLoggedIn(visible) {
  $('login-screen').classList.toggle('hidden', visible);
  $('app-screen').classList.toggle('hidden', !visible);
}

function formatMoney(value) {
  return `Rs ${Number(value || 0).toLocaleString('en-IN')}`;
}

function cleanStatus(status) {
  return status === 'dispatched' ? 'Out for delivery' : status === 'delivered' ? 'Delivered' : 'Assigned';
}

function isActive(order) { return String(order.status || '').toLowerCase() !== 'delivered'; }

function renderStats() {
  const active = state.orders.filter(isActive);
  const delivered = state.orders.filter(order => !isActive(order));
  const earnings = state.orders.reduce((sum, order) => sum + Number(order.riderEarning || 0), 0);
  $('active-count').textContent = `${active.length} ${active.length === 1 ? 'delivery' : 'deliveries'}`;
  $('route-caption').textContent = active.length ? 'Stay sharp. Every handoff matters.' : 'No active deliveries assigned right now.';
  $('stat-active').textContent = active.length;
  $('stat-delivered').textContent = delivered.length;
  $('stat-earnings').textContent = formatMoney(earnings);
}

function renderOrders() {
  const list = $('orders-list');
  const visible = state.orders.filter(order => state.filter === 'all' || (state.filter === 'delivered' ? !isActive(order) : isActive(order)));
  if (!visible.length) {
    list.innerHTML = `<div class="empty-state"><strong>${state.filter === 'delivered' ? 'No completed deliveries yet' : 'Your queue is clear'}</strong>${state.filter === 'delivered' ? 'Completed orders will stay here for your earning history.' : 'New assignments will appear automatically when the admin dispatches them.'}</div>`;
    return;
  }
  list.innerHTML = visible.map(order => {
    const id = order.orderId || order._id || order.id;
    const status = String(order.status || 'pending').toLowerCase();
    const done = status === 'delivered';
    const items = (order.items || []).map(item => `${item.quantity || 1}x ${item.name || 'Item'}`).join(', ');
    const address = order.deliveryAddress || order.customerAddress || order.address || 'Address not provided';
    const phone = String(order.customerPhone || '').replace(/\D/g, '').slice(-10);
    const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
    const action = done
      ? '<span class="action-button">Completed</span>'
      : `<button class="action-button primary" data-action="status" data-id="${id}" data-next="${status === 'dispatched' ? 'delivered' : 'out_for_delivery'}">${status === 'dispatched' ? 'Mark delivered' : 'Start delivery'}</button>`;
    return `<article class="order-card ${done ? 'delivered' : ''}">
      <div class="order-top"><span class="order-id">#${String(id).slice(-6).toUpperCase()}</span><span class="status-pill ${done ? 'done' : ''}">${cleanStatus(status)}</span></div>
      <div class="customer-name">${escapeHtml(order.customerName || 'Customer')}</div>
      <div class="address">${escapeHtml(address)}</div>
      <div class="item-line">${escapeHtml(items || 'Order items unavailable')}</div>
      <div class="order-meta">
        <div><span class="meta-label">Customer payment</span><span class="meta-value">${order.paymentCollectedByStore || order.paymentMethod === 'UPI' ? 'Already paid' : formatMoney(order.finalTotal)} </span></div>
        <div><span class="meta-label">My earning</span><span class="meta-value earning">${formatMoney(order.riderEarning)}</span></div>
      </div>
      <div class="order-actions"><a class="action-button" href="tel:+91${phone}">Call customer</a><a class="action-button" href="${maps}" target="_blank" rel="noopener">Open maps</a>${action}</div>
    </article>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
}

async function loadProfile() {
  const response = await api('/rider/me');
  if (!response.ok) throw new Error('Session expired');
  const data = await response.json();
  state.rider = data.rider;
  $('rider-name').textContent = state.rider.name || 'Rider';
}

async function loadOrders() {
  const response = await api('/rider/orders');
  if (!response.ok) throw new Error('Could not load orders');
  const data = await response.json();
  state.orders = data.orders || [];
  renderStats();
  renderOrders();
}

async function openApp() {
  try {
    await loadProfile();
    setLoggedIn(true);
    await loadOrders();
    if (state.rider.mustChangePassword) $('password-panel').classList.remove('hidden');
  } catch (error) {
    localStorage.removeItem('littiwale_rider_token');
    state.token = '';
    setLoggedIn(false);
    $('login-error').textContent = 'Please sign in again.';
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $('login-error').textContent = '';
  try {
    const response = await fetch(`${API_BASE}/rider/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ identifier:$('login-identifier').value.trim(), password:$('login-password').value }) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Login failed');
    state.token = data.token;
    localStorage.setItem('littiwale_rider_token', state.token);
    state.rider = data.rider;
    await openApp();
  } catch (error) { $('login-error').textContent = error.message; }
  button.disabled = false;
});

$('show-join-form').addEventListener('click', () => {
  $('login-form').classList.add('hidden');
  $('show-join-form').classList.add('hidden');
  $('join-form').classList.remove('hidden');
});

$('hide-join-form').addEventListener('click', () => {
  $('join-form').classList.add('hidden');
  $('login-form').classList.remove('hidden');
  $('show-join-form').classList.remove('hidden');
});

$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const message = $('join-message');
  button.disabled = true;
  message.style.color = '';
  message.textContent = '';
  try {
    const response = await fetch(`${API_BASE}/rider/applications`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name:$('join-name').value.trim(), phone:$('join-phone').value.trim(), email:$('join-email').value.trim() }) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Could not submit request');
    message.style.color = 'var(--green)';
    message.textContent = 'Request sent. Littiwale admin will review your details and share login access after approval.';
    $('join-form').reset();
  } catch (error) { message.textContent = error.message; }
  button.disabled = false;
});

$('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('password-error').textContent = '';
  try {
    const response = await api('/rider/password', { method:'PUT', body:JSON.stringify({ newPassword:$('new-password').value }) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Password update failed');
    state.rider = data.rider;
    $('password-panel').classList.add('hidden');
    $('password-form').reset();
    showToast('Password updated securely.');
  } catch (error) { $('password-error').textContent = error.message; }
});

$('orders-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="status"]');
  if (!button) return;
  button.disabled = true;
  try {
    const response = await api(`/rider/orders/${encodeURIComponent(button.dataset.id)}/status`, { method:'PATCH', body:JSON.stringify({ status:button.dataset.next }) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Could not update delivery');
    showToast(data.status === 'delivered' ? 'Delivery completed and admin updated.' : 'Delivery started.');
    await loadOrders();
  } catch (error) { showToast(error.message); button.disabled = false; }
});

document.querySelectorAll('.filter-tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.filter-tab').forEach(item => item.classList.remove('active'));
  tab.classList.add('active');
  state.filter = tab.dataset.filter;
  renderOrders();
}));

$('refresh-button').addEventListener('click', async () => { $('refresh-button').textContent = 'Loading...'; await loadOrders(); $('refresh-button').textContent = 'Refresh'; });
$('logout-button').addEventListener('click', () => { localStorage.removeItem('littiwale_rider_token'); state.token = ''; setLoggedIn(false); });

if (state.token) openApp();
