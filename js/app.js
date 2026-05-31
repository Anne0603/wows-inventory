import { db, auth, storage, googleProvider } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, onSnapshot, updateDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  ref, uploadString, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// ==================== STATE ====================
let currentUser = null;
let userSettings = {
  companyName: '我的店',
  darkMode: true,
  sortBy: 'name-asc',
  lowStockThreshold: 5,
  staleDays: 30,
  lastBackup: null,
  currency: '$',
  barcodePrefix: 'P',
  stockInPrefix: 'I',
  stockOutPrefix: 'O'
};
let products = [];
let customers = [];
let expenses = [];
let stockInOrders = [];
let stockOutOrders = [];
let productCategories = [];
let expenseCategories = ['包材', '廣告費', '電話費', '印刷費', '雜支'];
let suppliers = [];
let currentPage = 'home';
let _newProductImageData = null;
let _newProductOriginalData = null;
let currentContactTab = 'customers'; // 'customers' or 'suppliers'
let editingProductId = null;
let editingCustomerId = null;
let selectedProductCategory = '全部';
let stockInItems = [];
let stockOutItems = [];
let stockInSupplierId = null;
let stockOutCustomerId = null;
let expenseMonth = new Date();
let reportMonth = new Date();
let currentBarcodeTarget = null;
let barcodeStream = null;
let datePickerTarget = null;
let currentProductDetailId = null;
let currentCustomerDetailId = null;

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      showMainApp();
      loadAllData();
    } else {
      showLoginScreen();
    }
  });

  // Google Login
  // Handle redirect result first (when returning from Google login)
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      console.log('Redirect login success:', result.user.email);
    }
  } catch (e) {
    console.log('Redirect result error:', e.code);
  }

  // Login button uses global function defined below
  ;

  // Settings button
  document.getElementById('settings-btn').addEventListener('click', () => navigate('settings'));
  document.getElementById('notification-btn').addEventListener('click', () => showNotifications());

  // Init dates
  initDates();
  checkBackupReminder();
});

function initDates() {
  const today = new Date();
  setDateDisplay('stock-in-date', today);
  setDateDisplay('stock-out-date', today);
  setDateDisplay('expense-date', today);
  updateExpenseMonthDisplay();
  updateReportMonthDisplay();
}

// ==================== AUTH ====================
function showLoginScreen() {
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('main-app').classList.remove('active');
}

function showMainApp() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('main-app').classList.add('active');
  document.getElementById('setting-email-display').textContent = currentUser.email;
  updateShopAvatar();
  document.getElementById('shop-avatar-img').onclick = () => showShopAvatarOptions();
  document.getElementById('shop-avatar-img').style.cursor = 'pointer';
  // Show loading screen until data is ready
  showLoadingScreen();
}

function showLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (el) el.style.display = 'flex';
}

function hideLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (el) {
    el.style.opacity = '1';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; }, 300);
    }, 200);
  }
}

function updateShopAvatar() {
  const el = document.getElementById('shop-avatar-img');
  const customAvatar = userSettings.shopAvatarUrl;
  if (customAvatar) {
    el.innerHTML = `<img src="${customAvatar}" alt="avatar">`;
  } else if (currentUser && currentUser.photoURL) {
    el.innerHTML = `<img src="${currentUser.photoURL}" alt="avatar">`;
  } else {
    el.innerHTML = `<i class="ti ti-building-store"></i>`;
  }
}

window.showShopAvatarOptions = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">更換店鋪頭貼</div>
    <div class="picker-item" onclick="triggerAvatarUpload()">
      <i class="ti ti-camera" style="color:var(--blue);font-size:20px;margin-right:8px"></i> 上傳自訂圖片
    </div>
    <div class="picker-item" onclick="useGoogleAvatar()">
      <i class="ti ti-brand-google" style="color:var(--amber);font-size:20px;margin-right:8px"></i> 使用 Google 帳號頭貼
    </div>
    <div class="picker-item" onclick="removeAvatar()" style="color:var(--red)">
      <i class="ti ti-trash" style="font-size:20px;margin-right:8px"></i> 移除頭貼
    </div>
    <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="handleAvatarUpload(event)">
  `);
};

window.triggerAvatarUpload = () => {
  document.getElementById('avatar-file-input').click();
};

window.handleAvatarUpload = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    compressImage(e.target.result, 300, 0.85, async (compressed) => {
      userSettings.shopAvatarUrl = compressed;
      await saveSettings();
      updateShopAvatar();
      forceCloseModal();
      showToast('頭貼已更新！');
    });
  };
  reader.readAsDataURL(file);
};

window.useGoogleAvatar = async () => {
  userSettings.shopAvatarUrl = null;
  await saveSettings();
  updateShopAvatar();
  forceCloseModal();
  showToast('已改為 Google 頭貼');
};

window.removeAvatar = async () => {
  userSettings.shopAvatarUrl = null;
  await saveSettings();
  updateShopAvatar();
  forceCloseModal();
  showToast('頭貼已移除');
};

window.handleGoogleLogin = async () => {
  const btn = document.getElementById('google-login-btn');
  if (btn) { btn.textContent = '登入中...'; btn.disabled = true; }

  try {
    // Try popup
    const result = await signInWithPopup(auth, googleProvider);
    console.log('Popup success:', result.user.email);
    return;
  } catch (popupErr) {
    console.log('Popup error code:', popupErr.code);

    // If popup blocked or not supported, use redirect
    const needsRedirect = [
      'auth/popup-blocked',
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/operation-not-supported-in-this-environment',
      'auth/web-storage-unsupported',
      'auth/unauthorized-domain'
    ].includes(popupErr.code);

    if (needsRedirect || !popupErr.code) {
      try {
        console.log('Trying redirect...');
        await signInWithRedirect(auth, googleProvider);
        return;
      } catch (redirectErr) {
        console.log('Redirect error:', redirectErr.code, redirectErr.message);
        if (btn) { btn.disabled = false; btn.textContent = '使用 Google 帳號登入'; }
        alert('錯誤：' + redirectErr.code + ' - ' + redirectErr.message);
        return;
      }
    }

    if (btn) { btn.disabled = false; btn.textContent = '使用 Google 帳號登入'; }
    if (popupErr.code !== 'auth/popup-closed-by-user') {
      alert('登入錯誤：' + popupErr.code);
    }
  }
};

window.logout = async () => {
  showConfirm('確定要登出嗎？', async () => {
    await signOut(auth);
    showLoginScreen();
  });
};

// ==================== DATA LOADING ====================
async function loadAllData() {
  if (!currentUser) return;

  // Check if this user is authorized to access someone else's data
  const uid = await checkAuthorization();

  // Load everything simultaneously with Promise.all
  const [
    settingsSnap, categoriesSnap,
    productsSnap, customersSnap, expensesSnap,
    stockInSnap, stockOutSnap
  ] = await Promise.allSettled([
    getDoc(doc(db, 'users', uid, 'settings', 'main')),
    getDoc(doc(db, 'users', uid, 'settings', 'categories')),
    getDocs(collection(db, 'users', uid, 'products')),
    getDocs(collection(db, 'users', uid, 'customers')),
    getDocs(collection(db, 'users', uid, 'expenses')),
    getDocs(collection(db, 'users', uid, 'stockIn')),
    getDocs(collection(db, 'users', uid, 'stockOut'))
  ]);

  // Apply settings
  if (settingsSnap.status === 'fulfilled' && settingsSnap.value.exists()) {
    userSettings = { ...userSettings, ...settingsSnap.value.data() };
    applySettings();
  }

  // Apply categories
  if (categoriesSnap.status === 'fulfilled' && categoriesSnap.value.exists()) {
    const catData = categoriesSnap.value.data();
    productCategories = catData.product || [];
    expenseCategories = catData.expense || expenseCategories;
    suppliers = catData.suppliers || [];
  }
  if (productCategories.length === 0) {
    productCategories = ['服飾', '配件', '生活用品', '美妝', '電子', '其他'];
  }

  // Apply data
  if (productsSnap.status === 'fulfilled')
    products = productsSnap.value.docs.map(d => ({ id: d.id, ...d.data() }));
  if (customersSnap.status === 'fulfilled')
    customers = customersSnap.value.docs.map(d => ({ id: d.id, ...d.data() }));
  if (expensesSnap.status === 'fulfilled')
    expenses = expensesSnap.value.docs.map(d => ({ id: d.id, ...d.data() }));
  if (stockInSnap.status === 'fulfilled')
    stockInOrders = stockInSnap.value.docs.map(d => ({ id: d.id, ...d.data() }));
  if (stockOutSnap.status === 'fulfilled')
    stockOutOrders = stockOutSnap.value.docs.map(d => ({ id: d.id, ...d.data() }));

  // Load authorized accounts list
  await loadAuthorizedAccounts();
  updateAuthorizedCount();

  updateHomePage();
  renderProductList();
  renderCustomerList();
  renderExpenseList();
  checkBackupReminder();
  hideLoadingScreen();
}

async function saveSettings() {
  if (!currentUser) return;
  await setDoc(doc(db, 'users', getDataUid(), 'settings', 'main'), userSettings);
}

async function saveCategories() {
  if (!currentUser) return;
  await setDoc(doc(db, 'users', getDataUid(), 'settings', 'categories'), {
    product: productCategories,
    expense: expenseCategories,
    suppliers: suppliers
  });
}

// ==================== NAVIGATION ====================
window.navigate = (page) => {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Show target page
  const targetPage = document.getElementById(`page-${page}`);
  if (targetPage) {
    targetPage.classList.add('active');
    targetPage.scrollTop = 0;
    currentPage = page;
  }

  // Page-specific init
  if (page === 'home') updateHomePage();
  if (page === 'products') renderProductList();
  if (page === 'customers') { renderCustomerList(); }
  if (page === 'expenses') renderExpenseList();
  if (page === 'reports') renderReports();
  if (page === 'report-stock-out') renderReportStockOut();
  if (page === 'report-stock-in') renderReportStockIn();
  if (page === 'report-profit-ranking') renderProfitRanking();
  if (page === 'report-platform') renderPlatformReport();
  if (page === 'report-expenses') renderExpenseReport();
  if (page === 'settings') renderSettings();
  if (page === 'add-supplier') {
    if (!editingSupplierId) {
      document.getElementById('add-supplier-title').textContent = '新增供應商';
      document.getElementById('supplier-name').value = '';
      document.getElementById('supplier-phone').value = '';
      document.getElementById('supplier-address').value = '';
      document.getElementById('supplier-notes').value = '';
    }
  }
  if (page === 'manage-categories') renderCategoriesManagement();
  if (page === 'manage-expense-categories') renderExpenseCategoriesManagement();
  if (page === 'manage-suppliers') renderSuppliersManagement();
  if (page === 'add-product' && !editingProductId) initAddProduct();
  if (page === 'add-customer' && !editingCustomerId) initAddCustomer();
  if (page === 'add-expense' && !window._editingExpenseId) initAddExpense();
  if (page === 'stock-in' && !window._editingStockInId) initStockIn();
  if (page === 'stock-out' && !window._editingStockOutId) initStockOut();
};

// ==================== HOME PAGE ====================
function updateHomePage() {
  const today = new Date();
  const todayStr = formatDate(today);
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;

  // Today in/out
  const todayIn = stockInOrders
    .filter(o => o.date === todayStr)
    .reduce((sum, o) => sum + (o.totalCost || 0), 0);
  const todayOut = stockOutOrders
    .filter(o => o.date === todayStr)
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  // Month profit
  const monthOut = stockOutOrders
    .filter(o => o.date && o.date.startsWith(thisMonth))
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const monthInCost = stockOutOrders
    .filter(o => o.date && o.date.startsWith(thisMonth))
    .reduce((sum, o) => sum + (o.totalCost || 0), 0);
  const monthExpenses = expenses
    .filter(e => e.date && e.date.startsWith(thisMonth))
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const monthProfit = monthOut - monthInCost - monthExpenses;

  // Total inventory value
  const totalInventoryValue = products.reduce((sum, p) => sum + ((p.avgCost || p.cost || 0) * (p.stock || 0)), 0);

  // Month out count
  const monthOutCount = stockOutOrders.filter(o => o.date && o.date.startsWith(thisMonth)).length;

  document.getElementById('today-in').textContent = `$${todayIn.toLocaleString()}`;
  document.getElementById('today-out').textContent = `$${todayOut.toLocaleString()}`;
  document.getElementById('month-profit').textContent = `$${monthProfit.toLocaleString()}`;
  document.getElementById('total-inventory-value').textContent = `$${totalInventoryValue.toLocaleString()}`;
  document.getElementById('month-out-count').textContent = `${monthOutCount} 筆`;
  const monthlyBadge = document.querySelector('.monthly-badge');
  if (monthlyBadge) {
    monthlyBadge.style.cursor = 'pointer';
    monthlyBadge.onclick = () => { window._reportStockOutFromHome = true; navigate('reports'); setTimeout(()=>navigate('report-stock-out'),50); };
  }
  document.getElementById('shop-name-display').textContent = userSettings.companyName || '我的店';

  // Low stock alert
  const lowStockProducts = products.filter(p => p.stock <= userSettings.lowStockThreshold && p.stock > 0);
  const zeroStockProducts = products.filter(p => p.stock === 0);
  const totalLow = lowStockProducts.length + zeroStockProducts.length;
  if (totalLow > 0) {
    document.getElementById('alert-low-stock').style.display = 'flex';
    document.getElementById('alert-low-stock-text').textContent = `${totalLow} 件商品庫存偏低`;
  } else {
    document.getElementById('alert-low-stock').style.display = 'none';
  }

  // Stale stock alert - only count products older than staleDays with no recent out
  const staleDays = userSettings.staleDays || 30;
  const staleProducts = products.filter(p => {
    if (p.stock <= 0) return false; // 庫存為0不算滯銷
    const baseDate = p.lastOutDate
      ? new Date(p.lastOutDate)
      : new Date(p.createdAt || Date.now());
    const diff = (today - baseDate) / (1000 * 60 * 60 * 24);
    return diff > staleDays;
  });
  if (staleProducts.length > 0) {
    document.getElementById('alert-stale-stock').style.display = 'flex';
    document.getElementById('alert-stale-stock-text').textContent = `${staleProducts.length} 件商品超過${staleDays}天未出庫`;
  } else {
    document.getElementById('alert-stale-stock').style.display = 'none';
  }
}

window.showLowStockList = () => {
  const lowStockProducts = products.filter(p => p.stock <= userSettings.lowStockThreshold);
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">低庫存商品</div>
    <div class="form-card" style="margin:0">
      ${lowStockProducts.map(p => `
        <div class="alert-list-item" onclick="forceCloseModal();window._fromHomeAlert=true;showProductDetail('${p.id}')">
          <div style="flex:1">
            <div style="color:var(--text2);font-size:17px;font-weight:500">${p.name}</div>
            <div style="color:var(--text4);font-size:15px;margin-top:2px">${p.model || ''}</div>
          </div>
          <div style="color:${p.stock === 0 ? 'var(--red)' : 'var(--amber)'};font-size:17px;font-weight:500">${p.stock} 件</div>
          <i class="ti ti-chevron-right" style="color:var(--text5);margin-left:8px"></i>
        </div>
      `).join('')}
    </div>`);
};

window.showStaleStockList = () => {
  const staleDays = userSettings.staleDays || 30;
  const today = new Date();
  const staleProducts = products.filter(p => {
    if (p.stock <= 0) return false;
    const baseDate = p.lastOutDate
      ? new Date(p.lastOutDate)
      : new Date(p.createdAt || Date.now());
    const diff = (today - baseDate) / (1000 * 60 * 60 * 24);
    return diff > staleDays;
  });
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">滯銷商品</div>
    <div class="form-card" style="margin:0">
      ${staleProducts.map(p => `
        <div class="alert-list-item" onclick="forceCloseModal();window._fromHomeAlert=true;showProductDetail('${p.id}')">
          <div style="flex:1">
            <div style="color:var(--text2);font-size:17px;font-weight:500">${p.name}</div>
            <div style="color:var(--text4);font-size:15px;margin-top:2px">${p.lastOutDate ? '最後出庫：'+p.lastOutDate : '從未出庫'}</div>
          </div>
          <div style="color:var(--text2);font-size:17px;font-weight:500">${p.stock} 件</div>
          <i class="ti ti-chevron-right" style="color:var(--text5);margin-left:8px"></i>
        </div>
      `).join('')}
    </div>`);
};

// ==================== PRODUCTS ====================
window.filterProducts = () => renderProductList();

window.showCategoryFilter = () => {
  const allCategories = ['全部', ...productCategories];
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">選擇類別</div>
    <div class="form-card" style="margin:0">
      ${allCategories.map(c => `
        <div class="picker-item" onclick="selectCategory('${c}')">
          <span style="flex:1">${c}</span>
          ${selectedProductCategory === c ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
        </div>`).join('')}
    </div>`);
};

function renderProductList() {
  const search = document.getElementById('product-search')?.value?.toLowerCase() || '';
  const container = document.getElementById('product-list-container');
  if (!container) return;

  // Update filter button label
  const label = document.getElementById('category-filter-label');
  if (label) label.textContent = selectedProductCategory === '全部' ? '全部類別' : selectedProductCategory;

  // Filter products
  let filtered = products.filter(p => {
    const matchSearch = !search ||
      p.name?.toLowerCase().includes(search) ||
      p.model?.toLowerCase().includes(search);
    const matchCat = selectedProductCategory === '全部' || p.category === selectedProductCategory;
    return matchSearch && matchCat;
  });

  // Sort
  filtered = sortProducts(filtered);

  // Update count badge
  const badge = document.getElementById('product-count-badge');
  if (badge) badge.textContent = `${filtered.length} 件`;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-box"></i><p>沒有商品</p></div>`;
    return;
  }

  // Group by category
  if (selectedProductCategory === '全部') {
    const groups = {};
    filtered.forEach(p => {
      const cat = p.category || '未分類';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    container.innerHTML = Object.entries(groups).map(([cat, prods]) => `
      <div class="category-group">
        <div class="category-group-label">${cat} <span style="color:var(--text4);font-size:12px;font-weight:400">(${prods.length})</span></div>
        <div class="product-list-card">
          ${prods.map(p => renderProductItem(p)).join('')}
        </div>
      </div>
    `).join('');
  } else {
    container.innerHTML = `
      <div class="product-list-card">
        ${filtered.map(p => renderProductItem(p)).join('')}
      </div>`;
  }
}

function renderProductItem(p) {
  const stockClass = p.stock === 0 ? 'zero' : p.stock <= userSettings.lowStockThreshold ? 'low' : 'ok';
  const imgHtml = p.imageUrl
    ? `<img src="${p.imageUrl}" alt="${p.name}">`
    : `<i class="ti ti-photo"></i>`;
  return `
    <div class="product-item" onclick="showProductDetail('${p.id}')">
      <div class="product-thumb">${imgHtml}</div>
      <div class="product-info">
        <div class="product-name">${p.name}</div>
        <div class="product-model-text">${p.model || ''} ${p.color || ''}</div>
      </div>
      <div style="text-align:right;margin-right:4px">
        <div class="stock-badge ${stockClass}">${p.stock}</div>
        <div class="stock-badge-label">庫存量</div>
      </div>
      <i class="ti ti-chevron-right" style="color:var(--text5)"></i>
    </div>`;
}

window.selectCategory = (cat) => {
  selectedProductCategory = cat;
  forceCloseModal();
  renderProductList();
};

function sortProducts(prods) {
  const sort = userSettings.sortBy || 'name-asc';
  return [...prods].sort((a, b) => {
    if (sort === 'name-asc') return (a.name || '').localeCompare(b.name || '');
    if (sort === 'name-desc') return (b.name || '').localeCompare(a.name || '');
    if (sort === 'stock-desc') return (b.stock || 0) - (a.stock || 0);
    if (sort === 'stock-asc') return (a.stock || 0) - (b.stock || 0);
    if (sort === 'price-desc') return (b.price || 0) - (a.price || 0);
    if (sort === 'price-asc') return (a.price || 0) - (b.price || 0);
    if (sort === 'date-desc') return (b.createdAt || 0) - (a.createdAt || 0);
    if (sort === 'date-asc') return (a.createdAt || 0) - (b.createdAt || 0);
    return 0;
  });
}

window.showProductFilter = () => {
  const sorts = [
    { key: 'name-asc', label: '商品名稱 A→Z' },
    { key: 'name-desc', label: '商品名稱 Z→A' },
    { key: 'stock-desc', label: '庫存量由多到少' },
    { key: 'stock-asc', label: '庫存量由少到多' },
    { key: 'price-desc', label: '售價由高到低' },
    { key: 'price-asc', label: '售價由低到高' },
    { key: 'date-desc', label: '新增日期由新到舊' },
    { key: 'date-asc', label: '新增日期由舊到新' },
  ];
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">排序方式</div>
    ${sorts.map(s => `
      <div class="picker-item" onclick="setSortBy('${s.key}')">
        ${s.label}
        ${userSettings.sortBy === s.key ? '<i class="ti ti-check check"></i>' : ''}
      </div>`).join('')}`);
};

window.setSortBy = (sort) => {
  userSettings.sortBy = sort;
  saveSettings();
  closeModal();
  renderProductList();
};

// ==================== ADD/EDIT PRODUCT ====================
function initAddProduct() {
  editingProductId = null;
  _newProductImageData = null;
  _newProductOriginalData = null;
  document.getElementById('add-product-title').textContent = '新增商品';
  document.getElementById('product-name').value = '';
  document.getElementById('product-category-display').textContent = '請選擇類別';
  document.getElementById('product-category-display').dataset.value = '';
  document.getElementById('product-price').value = '0';
  document.getElementById('product-cost').value = '0';
  document.getElementById('product-stock').value = '0';
  document.getElementById('product-model').value = '';
  document.getElementById('product-color').value = '';
  document.getElementById('product-weight').value = '';
  document.getElementById('product-size').value = '';
  document.getElementById('product-min-stock').value = '0';
  document.getElementById('product-supplier-display').textContent = '無（選填）';
  document.getElementById('product-supplier-display').dataset.value = '';
  document.getElementById('product-notes').value = '';
  const _pw = document.getElementById('product-img-preview-wrapper'); if(_pw) _pw.style.display = 'none';
  document.getElementById('product-img-upload').style.display = 'flex';
  document.getElementById('product-img-upload').dataset.imageData = '';
}

window.triggerImageUpload = () => {
  document.getElementById('product-img-input').click();
};

window.handleImageUpload = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const original = e.target.result;
    _newProductOriginalData = original;
    compressImage(original, 800, 0.75, (compressed) => {
      _newProductImageData = compressed;
      // Hide upload button, show preview
      document.getElementById('product-img-upload').style.display = 'none';
      const wrapper = document.getElementById('product-img-preview-wrapper');
      if (wrapper) wrapper.style.display = 'block';
      const preview = document.getElementById('product-img-preview');
      if (preview) {
        preview.src = compressed;
        preview.style.display = 'block';
      }
      showToast('照片已更新！');
    });
  };
  reader.readAsDataURL(file);
};

function compressImage(dataUrl, maxSize, quality, callback) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    let w = img.width, h = img.height;
    if (w > h && w > maxSize) { h = h * maxSize / w; w = maxSize; }
    else if (h > maxSize) { w = w * maxSize / h; h = maxSize; }
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    callback(canvas.toDataURL('image/jpeg', quality));
  };
  img.src = dataUrl;
}

window.saveProduct = async () => {
  const name = document.getElementById('product-name').value.trim();
  const category = document.getElementById('product-category-display').dataset.value || '';
  const price = parseFloat(document.getElementById('product-price').value) || 0;
  const cost = parseFloat(document.getElementById('product-cost').value) || 0;
  const stock = parseInt(document.getElementById('product-stock').value) || 0;

  if (!name) { showToast('請輸入商品名稱'); return; }
  if (!category) { showToast('請選擇商品類別'); return; }

  const productData = {
    name, category, price, cost, stock,
    model: document.getElementById('product-model').value.trim(),
    color: document.getElementById('product-color').value.trim(),
    weight: parseFloat(document.getElementById('product-weight').value) || 0,
    size: document.getElementById('product-size').value.trim(),
    minStock: parseInt(document.getElementById('product-min-stock').value) || 0,
    supplierId: document.getElementById('product-supplier-display').dataset.value || '',
    supplierName: (['無（選填）','請選擇供應商'].includes(document.getElementById('product-supplier-display').textContent) ? '' : document.getElementById('product-supplier-display').textContent),
    notes: document.getElementById('product-notes').value.trim(),
    avgCost: cost,
    updatedAt: Date.now()
  };

  // Generate barcode if new product
  if (!editingProductId) {
    productData.barcode = generateBarcode();
    productData.createdAt = Date.now();
  }

  showToast('儲存中...');

  // Save images using global vars
  console.log('Image data exists:', !!_newProductImageData, 'length:', _newProductImageData?.length);
  if (_newProductImageData) {
    productData.imageUrl = _newProductImageData;
    if (_newProductOriginalData) {
      productData.imageOriginalUrl = _newProductOriginalData;
    }
  } else if (editingProductId) {
    // Keep existing image if no new one uploaded
    const existingProduct = products.find(p => p.id === editingProductId);
    if (existingProduct?.imageUrl) {
      productData.imageUrl = existingProduct.imageUrl;
    }
    if (existingProduct?.imageOriginalUrl) {
      productData.imageOriginalUrl = existingProduct.imageOriginalUrl;
    }
  }

  try {
    if (editingProductId) {
      await updateDoc(doc(db, 'users', getDataUid(), 'products', editingProductId), productData);
      const idx = products.findIndex(p => p.id === editingProductId);
      if (idx > -1) products[idx] = { id: editingProductId, ...products[idx], ...productData };
      _newProductImageData = null; _newProductOriginalData = null;
      showToast('商品已更新！');
    } else {
      const docRef = await addDoc(collection(db, 'users', getDataUid(), 'products'), productData);
      products.push({ id: docRef.id, ...productData });
      if (category && !productCategories.includes(category)) {
        productCategories.push(category);
        await saveCategories();
      }
      _newProductImageData = null; _newProductOriginalData = null;
      showToast('商品已新增！');
    }
    editingProductId = null;
    const origin = window._editProductOrigin || 'products';
    window._editProductOrigin = null;
    navigate(origin);
  } catch (e) {
    console.error('Save product error:', e.code, e.message);
    if (e.code === 'permission-denied') {
      showToast('❌ 權限不足，請確認 Firestore 規則');
    } else if (e.code === 'unavailable') {
      showToast('❌ 網路問題，請重試');
    } else {
      showToast('❌ 儲存失敗：' + (e.code || e.message));
    }
  }
};

function generateBarcode() {
  const prefix = userSettings.barcodePrefix || 'P';
  return prefix + Date.now().toString().slice(-10);
}

// ==================== PRODUCT DETAIL ====================
window.showProductDetail = (productId) => {
  currentProductDetailId = productId;
  // Track if we came from home alert
  if (!window._fromHomeAlert) window._productDetailFromPage = currentPage;
  window._fromHomeAlert = false;
  const p = products.find(x => x.id === productId);
  if (!p) return;

  const profit = (p.price || 0) - (p.avgCost || p.cost || 0);
  const stockClass = p.stock === 0 ? 'red' : p.stock <= userSettings.lowStockThreshold ? 'amber' : 'green';

  document.getElementById('product-detail-content').innerHTML = `
    <div class="product-detail-img">
      ${p.imageUrl
        ? `<img src="${p.imageUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:contain;background:var(--bg2)">`
        : `<i class="ti ti-photo" style="font-size:66px;color:var(--text5)"></i>`}
    </div>
    <div style="padding:14px">
      <div style="margin-bottom:12px">
        <div style="font-size:22px;font-weight:500;color:var(--text);margin-bottom:6px">${p.name}</div>
        <span style="display:inline-block;background:var(--bg2);border:0.5px solid var(--border);border-radius:20px;padding:3px 10px;color:var(--text3);font-size:15px">${p.category || '未分類'}</span>
      </div>

      <div class="form-card">
        <div class="form-row">
          <span class="form-label">目前庫存量</span>
          <span class="form-input ${stockClass}" style="color:var(--${stockClass})">${p.stock} 件</span>
        </div>
        <div class="form-row">
          <span class="form-label">最低庫存量</span>
          <span class="form-input">${p.minStock || 0} 件</span>
        </div>
        <div class="form-row">
          <span class="form-label">售價</span>
          <span class="form-input" style="color:var(--blue)">$${(p.price || 0).toLocaleString()}</span>
        </div>
        <div class="form-row">
          <span class="form-label">參考進價</span>
          <span class="form-input" style="color:var(--text3)">$${(p.cost || 0).toLocaleString()}</span>
        </div>
        <div class="form-row">
          <span class="form-label">實際成本</span>
          <div style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end">
            <span style="color:var(--amber);font-size:17px;font-weight:500">$${(p.avgCost || p.cost || 0).toLocaleString()}</span>
            <div onclick="resetAvgCost('${p.id}',${p.avgCost || p.cost || 0})"
              style="background:var(--bg3);border-radius:6px;padding:4px 10px;cursor:pointer">
              <span style="color:var(--text3);font-size:13px">重設</span>
            </div>
          </div>
        </div>
        <div class="form-row">
          <span class="form-label">單品利潤</span>
          <span class="form-input" style="color:var(--green)">$${profit.toLocaleString()}</span>
        </div>
      </div>

      <div class="form-card">
        ${p.model ? `<div class="form-row"><span class="form-label">型號</span><span class="form-input">${p.model}</span></div>` : ''}
        ${p.color ? `<div class="form-row"><span class="form-label">顏色</span><span class="form-input">${p.color}</span></div>` : ''}
        ${p.weight ? `<div class="form-row"><span class="form-label">重量</span><span class="form-input">${p.weight} 公斤</span></div>` : ''}
        ${p.size ? `<div class="form-row"><span class="form-label">外部尺寸</span><span class="form-input">${p.size}</span></div>` : ''}
        ${p.supplierName && p.supplierName !== '請選擇供應商' ? `<div class="form-row"><span class="form-label">供應商</span><span class="form-input">${p.supplierName}</span></div>` : ''}
        ${p.notes ? `<div class="form-row"><span class="form-label">備註</span><span class="form-input">${p.notes}</span></div>` : ''}
        <div class="form-row" style="border-bottom:none" onclick="showBarcode('${p.barcode}','${p.name}')">
          <span class="form-label">條碼</span>
          <span class="form-input" style="color:var(--text3);font-family:monospace">${p.barcode || '無'}</span>
          <div style="display:flex;align-items:center;gap:4px;background:var(--bg3);border-radius:6px;padding:4px 8px">
            <i class="ti ti-barcode" style="color:var(--blue);font-size:17px"></i>
            <span style="color:var(--blue);font-size:13px">查看列印</span>
          </div>
        </div>
        ${p.imageOriginalUrl ? `
        <div class="form-row" style="border-bottom:none;margin-top:-1px;border-top:0.5px solid var(--border)" onclick="downloadOriginalImage('${p.imageOriginalUrl}','${p.name}')">
          <span class="form-label">原始圖片</span>
          <span class="form-input" style="color:var(--text4)">上架用高畫質原圖</span>
          <div style="display:flex;align-items:center;gap:4px;background:#1a2818;border-radius:6px;padding:4px 8px">
            <i class="ti ti-download" style="color:var(--green);font-size:17px"></i>
            <span style="color:var(--green);font-size:13px">下載</span>
          </div>
        </div>` : ''}
      </div>

      <div class="product-detail-actions">
        <button class="action-btn edit" onclick="editProduct('${p.id}')">編輯</button>
        <button class="action-btn in" onclick="quickStockIn('${p.id}')">快速入庫</button>
        <button class="action-btn out" onclick="quickStockOut('${p.id}')">快速出庫</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr;margin-top:8px">
        <button class="submit-btn red" onclick="deleteProduct('${p.id}')">刪除商品</button>
      </div>
      <div style="height:20px"></div>
    </div>`;

  navigate('product-detail');
};

window.editProduct = (productId) => {
  editingProductId = productId;
  // Remember where to go back after editing
  window._editProductOrigin = window._productDetailFromPage || currentPage;
  const p = products.find(x => x.id === productId);
  if (!p) return;

  document.getElementById('add-product-title').textContent = '編輯商品';
  document.getElementById('product-name').value = p.name || '';
  document.getElementById('product-category-display').textContent = p.category || '請選擇類別';
  document.getElementById('product-category-display').dataset.value = p.category || '';
  document.getElementById('product-price').value = p.price || 0;
  document.getElementById('product-cost').value = p.cost || 0;
  document.getElementById('product-stock').value = p.stock || 0;
  document.getElementById('product-model').value = p.model || '';
  document.getElementById('product-color').value = p.color || '';
  document.getElementById('product-weight').value = p.weight || '';
  document.getElementById('product-size').value = p.size || '';
  document.getElementById('product-min-stock').value = p.minStock || 0;
  document.getElementById('product-supplier-display').textContent = p.supplierName || '無（選填）';
  document.getElementById('product-supplier-display').dataset.value = p.supplierId || '';
  document.getElementById('product-notes').value = p.notes || '';

  if (p.imageUrl) {
    document.getElementById('product-img-upload').style.display = 'none';
    const wrapper = document.getElementById('product-img-preview-wrapper');
    if (wrapper) wrapper.style.display = 'block';
    const preview = document.getElementById('product-img-preview');
    preview.src = p.imageUrl;
    preview.style.cursor = 'pointer';
    preview.onclick = () => document.getElementById('product-img-input').click();
  } else {
    const wrapper = document.getElementById('product-img-preview-wrapper');
    if (wrapper) wrapper.style.display = 'none';
    document.getElementById('product-img-upload').style.display = 'flex';
  }
  _newProductImageData = null;
  _newProductOriginalData = null;

  navigate('add-product');
};

window.goBackFromAddProduct = () => {
  editingProductId = null;
  const origin = window._editProductOrigin || 'products';
  window._editProductOrigin = null;
  navigate(origin);
};

window.goBackFromProductDetail = () => {
  const from = window._productDetailFromPage || 'products';
  window._productDetailFromPage = null;
  if (from === 'home') {
    navigate('home');
  } else {
    navigate('products');
  }
};

window.showProductDetailMenu = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="picker-item" onclick="forceCloseModal();editProduct('${currentProductDetailId}')"><i class="ti ti-edit"></i> 編輯商品</div>
    <div class="picker-item" style="color:var(--red)" onclick="forceCloseModal();deleteProduct('${currentProductDetailId}')"><i class="ti ti-trash"></i> 刪除商品</div>`);
};

window.deleteProduct = (productId) => {
  showConfirm('確定要刪除這個商品嗎？此操作無法復原。', async () => {
    try {
      await deleteDoc(doc(db, 'users', getDataUid(), 'products', productId));
      products = products.filter(p => p.id !== productId);
      forceCloseModal();
      navigate('products');
      showToast('商品已刪除');
    } catch(e) {
      showToast('刪除失敗：' + e.message);
    }
  });
};

window.showBarcode = (barcode, name) => {
  if (!barcode) return;
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">條碼</div>
    <div class="barcode-display">
      <canvas id="barcode-canvas"></canvas>
      <p>${name}</p>
      <p style="color:var(--text4);font-size:14px;margin-top:4px;font-family:monospace">${barcode}</p>
    </div>
    <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:12px">
      <button class="submit-btn" onclick="saveBarcodeImage()">💾 儲存圖片</button>
    </div>`);

  setTimeout(() => {
    drawBarcode('barcode-canvas', barcode, name);
  }, 100);
};

function drawBarcode(canvasId, barcode, productName) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const hasName = productName && productName.length > 0;
  canvas.width = 320;
  canvas.height = hasName ? 98 : 80;

  // White background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw bars
  ctx.fillStyle = 'black';
  const barWidth = 2.2;
  let x = 12;
  for (let i = 0; i < barcode.length; i++) {
    const charCode = barcode.charCodeAt(i);
    for (let b = 0; b < 8; b++) {
      if ((charCode >> b) & 1) {
        ctx.fillRect(x, 8, barWidth, 60);
      }
      x += barWidth + 0.8;
    }
  }

  // Product name only (no barcode number)
  if (hasName) {
    ctx.fillStyle = '#111';
    ctx.font = 'bold 15px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(productName, canvas.width / 2, 85);
  }
}

window.downloadOriginalImage = (url, name) => {
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(`<!DOCTYPE html>
<html><head>
  <title>${name} 原圖</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#111;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;padding:16px}
    img{max-width:100%;max-height:75vh;object-fit:contain;border-radius:12px;display:block}
    .name{color:#fff;font-size:18px;font-weight:600;margin:14px 0 4px;text-align:center}
    .hint{color:#aaa;font-size:13px;margin-bottom:16px;text-align:center}
    .close-btn{background:#fff;color:#111;border:none;border-radius:10px;padding:14px;width:100%;max-width:320px;font-size:16px;font-weight:600;cursor:pointer}
  </style>
</head>
<body>
  <img src="${url}">
  <div class="name">${name}</div>
  <div class="hint">長按圖片儲存到相簿</div>
  <button class="close-btn" onclick="window.close()">✕ 關閉頁面</button>
</body></html>`);
    w.document.close();
  } else {
    showToast('請允許彈出視窗後再試');
  }
};

window.saveBarcodeImage = () => {
  const canvas = document.getElementById('barcode-canvas');
  if (!canvas) return;
  const nameEl = document.querySelector('#modal-body .barcode-display p');
  const productName = nameEl ? nameEl.textContent.trim() : '';
  const dataUrl = canvas.toDataURL('image/png');
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(`<!DOCTYPE html>
<html><head>
  <title>${productName} 條碼</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#111;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;padding:20px}
    .card{background:#fff;border-radius:16px;padding:24px;width:100%;max-width:340px;text-align:center}
    img{width:100%;border-radius:8px;display:block}
    .name{font-size:18px;font-weight:600;color:#111;margin-top:12px}
    .hint{font-size:13px;color:#888;margin-top:6px;margin-bottom:16px}
    .close-btn{background:#222;color:#fff;border:none;border-radius:10px;padding:14px;width:100%;font-size:16px;cursor:pointer}
  </style>
</head>
<body>
  <div class="card">
    <img src="${dataUrl}">
    <div class="name">${productName}</div>
    <div class="hint">長按圖片儲存到相簿</div>
    <button class="close-btn" onclick="window.close()">✕ 關閉頁面</button>
  </div>
</body></html>`);
    w.document.close();
  } else {
    showToast('請允許彈出視窗後再試');
  }
};

window.resetAvgCost = (productId, currentCost) => {
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">重設實際成本</div>
    <p style="color:var(--text3);font-size:14px;margin-bottom:16px;text-align:center">
      目前實際成本：$${currentCost}<br>
      <span style="color:var(--text4);font-size:12px">重設後將以新成本繼續計算加權平均</span>
    </p>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <span class="form-label">新成本</span>
        <input class="form-input" type="number" id="new-avg-cost-input" placeholder="輸入新的成本" value="${currentCost}" style="font-size:18px;font-weight:500;color:var(--amber)">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="forceCloseModal()">取消</button>
      <button class="submit-btn" onclick="confirmResetAvgCost('${productId}')">確認重設</button>
    </div>`);
  setTimeout(() => document.getElementById('new-avg-cost-input')?.focus(), 100);
};

window.confirmResetAvgCost = async (productId) => {
  const newCost = parseFloat(document.getElementById('new-avg-cost-input')?.value);
  if (!newCost || newCost <= 0) { showToast('請輸入有效成本'); return; }
  try {
    await updateDoc(doc(db, 'users', getDataUid(), 'products', productId), { avgCost: newCost });
    const p = products.find(x => x.id === productId);
    if (p) p.avgCost = newCost;
    forceCloseModal();
    showToast('實際成本已重設！');
    showProductDetail(productId); // refresh detail page
  } catch(e) {
    showToast('更新失敗：' + e.message);
  }
};

window.quickStockIn = (productId) => {
  closeModal();
  initStockIn();
  navigate('stock-in');
  setTimeout(() => addProductToStockIn(productId), 100);
};

window.quickStockOut = (productId) => {
  closeModal();
  initStockOut();
  navigate('stock-out');
  setTimeout(() => addProductToStockOut(productId), 100);
};

// ==================== STOCK IN ====================
function initStockIn() {
  stockInItems = [];
  stockInSupplierId = null;
  window._editingStockInId = null;
  document.getElementById('stock-in-supplier-display').textContent = '無（選填）';
  document.getElementById('stock-in-supplier-display').dataset.value = '';
  document.getElementById('stock-in-notes').value = '';
  document.getElementById('stock-in-shipping').value = '0';
  document.getElementById('shipping-per-item').textContent = '$0';
  renderStockInItems();
  setDateDisplay('stock-in-date', new Date());
}

function renderStockInItems() {
  const container = document.getElementById('stock-in-items-container');
  if (!container) return;
  container.innerHTML = stockInItems.map((item, idx) => `
    <div class="stock-item-card">
      <div class="stock-item-top">
        <div class="stock-item-thumb">
          ${item.imageUrl ? `<img src="${item.imageUrl}">` : `<i class="ti ti-photo"></i>`}
        </div>
        <div style="flex:1">
          <div class="stock-item-name">${item.name}</div>
          <div class="stock-item-model">${item.model || ''}</div>
        </div>
        <button class="delete-btn" onclick="removeStockInItem(${idx})"><i class="ti ti-trash"></i></button>
      </div>
      <div class="stock-item-inputs">
        <div class="input-group">
          <div class="input-group-label">數量</div>
          <input type="number" value="${item.qty}" min="1"
            oninput="updateStockInItem(${idx},'qty',this.value)" style="color:var(--text2);font-size:18px;font-weight:500">
        </div>
        <div class="input-group">
          <div class="input-group-label">進價（每件）</div>
          <input type="number" value="${item.cost}" min="0"
            oninput="updateStockInItem(${idx},'cost',this.value)" style="color:var(--amber);font-size:18px;font-weight:500">
          <div id="actual-cost-${idx}" style="color:var(--green);font-size:13px;margin-top:4px"></div>
        </div>
      </div>
    </div>`).join('');
  calcStockInTotal();
}

window.removeStockInItem = (idx) => {
  stockInItems.splice(idx, 1);
  renderStockInItems();
};

window.updateStockInItem = (idx, field, value) => {
  stockInItems[idx][field] = parseFloat(value) || 0;
  calcStockInTotal();
};

function calcStockInTotal() {
  const shipping = parseFloat(document.getElementById('stock-in-shipping')?.value) || 0;
  const itemsTotal = stockInItems.reduce((sum, item) => sum + (item.qty * item.cost), 0);
  const grandTotal = itemsTotal + shipping;
  document.getElementById('stock-in-total').textContent = `$${grandTotal.toLocaleString()}`;
  calcShipping();
}

window.calcShipping = () => {
  const shipping = parseFloat(document.getElementById('stock-in-shipping').value) || 0;
  const totalQty = stockInItems.reduce((sum, item) => sum + (item.qty || 0), 0);
  const totalCost = stockInItems.reduce((sum, item) => sum + (item.qty * item.cost), 0);

  if (shipping > 0 && totalQty > 0) {
    const perItem = (shipping / totalQty).toFixed(1);
    document.getElementById('shipping-per-item').textContent = `$${perItem}（每件加）`;
    // Update each stock item card to show actual cost
    stockInItems.forEach((item, idx) => {
      const shippingShare = shipping / totalQty;
      const actualCost = (item.cost + shippingShare).toFixed(1);
      const el = document.getElementById(`actual-cost-${idx}`);
      if (el) el.textContent = `實際成本 $${actualCost}`;
    });
  } else {
    document.getElementById('shipping-per-item').textContent = '$0';
    stockInItems.forEach((item, idx) => {
      const el = document.getElementById(`actual-cost-${idx}`);
      if (el) el.textContent = '';
    });
  }
};

window.showProductPickerForStockIn = () => {
  showProductPicker((p) => addProductToStockIn(p.id));
};

function addProductToStockIn(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  const existing = stockInItems.findIndex(i => i.productId === productId);
  if (existing > -1) {
    stockInItems[existing].qty++;
  } else {
    stockInItems.push({
      productId: p.id, name: p.name, model: p.model,
      imageUrl: p.imageUrl, qty: 1, cost: p.cost || 0
    });
  }
  renderStockInItems();
}

window.showSupplierPickerForStockIn = () => {
  showSupplierPickerModal((supplier) => {
    stockInSupplierId = supplier.id;
    document.getElementById('stock-in-supplier-display').textContent = supplier.name;
  });
};

window.confirmStockIn = async () => {
  if (stockInItems.length === 0) { showToast('請新增商品'); return; }
  showToast('入庫處理中...');
  const date = document.getElementById('stock-in-date-display').dataset.value;
  const notes = document.getElementById('stock-in-notes').value;
  const shipping = parseFloat(document.getElementById('stock-in-shipping').value) || 0;
  const totalCost = stockInItems.reduce((sum, i) => sum + (i.qty * i.cost), 0);

  // Calculate shipping per item - by cost ratio if possible, else by qty
  const totalQtyAll = stockInItems.reduce((s, i) => s + i.qty, 0);
  const orderItems = stockInItems.map(item => {
    let shippingForItem;
    if (totalCost > 0) {
      shippingForItem = (item.qty * item.cost / totalCost) * shipping;
    } else {
      shippingForItem = totalQtyAll > 0 ? (item.qty / totalQtyAll) * shipping : 0;
    }
    const shippingPerItem = item.qty > 0 ? shippingForItem / item.qty : 0;
    const actualCost = item.cost + shippingPerItem;
    return { ...item, shippingPerItem: parseFloat(shippingPerItem.toFixed(2)), actualCost: parseFloat(actualCost.toFixed(2)) };
  });

  // Generate order number
  const orderNum = generateOrderNumber('I', date);

  const orderData = {
    orderNum, date, notes, shipping, totalCost: totalCost + shipping,
    supplierId: stockInSupplierId,
    supplierName: document.getElementById('stock-in-supplier-display').textContent,
    items: orderItems,
    createdAt: Date.now()
  };

  try {
    const docRef = await addDoc(collection(db, 'users', getDataUid(), 'stockIn'), orderData);
    stockInOrders.push({ id: docRef.id, ...orderData });

    // Update product stock and avg cost
    for (const item of orderItems) {
      const p = products.find(x => x.id === item.productId);
      if (p) {
        const newStock = (p.stock || 0) + item.qty;
        const oldTotalCost = (p.avgCost || p.cost || 0) * (p.stock || 0);
        const newTotalCost = oldTotalCost + (item.actualCost * item.qty);
        const newAvgCost = newStock > 0 ? newTotalCost / newStock : item.actualCost;
        await updateDoc(doc(db, 'users', getDataUid(), 'products', p.id), {
          stock: newStock, avgCost: parseFloat(newAvgCost.toFixed(2))
        });
        p.stock = newStock;
        p.avgCost = parseFloat(newAvgCost.toFixed(2));
      }
    }

    if (window._editingStockInId) {
      // Restore old stock first
      const oldOrder = stockInOrders.find(x => x.id === window._editingStockInId);
      if (oldOrder) {
        for (const oldItem of oldOrder.items || []) {
          const p = products.find(x => x.id === oldItem.productId);
          if (p) {
            const restoredStock = Math.max(0, (p.stock || 0) - oldItem.qty);
            await updateDoc(doc(db, 'users', getDataUid(), 'products', p.id), { stock: restoredStock });
            p.stock = restoredStock;
          }
        }
      }
      await deleteDoc(doc(db, 'users', getDataUid(), 'stockIn', window._editingStockInId));
      stockInOrders = stockInOrders.filter(x => x.id !== window._editingStockInId);
      window._editingStockInId = null;
      showToast('入庫單已更新！');
    } else {
      showToast(`入庫成功！單號：${orderNum}`);
    }
    updateHomePage();
    navigate('home');
  } catch (e) {
    console.error('StockIn error:', e);
    if (e.code === 'permission-denied') showToast('❌ 權限不足，請確認 Firebase 規則');
    else showToast('❌ 入庫失敗：' + (e.code || e.message));
  }
};

// ==================== STOCK OUT ====================
function initStockOut() {
  stockOutItems = [];
  stockOutCustomerId = null;
  window._editingStockOutId = null;
  document.getElementById('stock-out-customer-display').textContent = '請選擇客戶（必填）';
  document.getElementById('stock-out-customer-display').dataset.value = '';
  document.getElementById('stock-out-customer-display').dataset.value = '';
  document.getElementById('stock-out-notes').value = '';
  const btn = document.getElementById('confirm-stock-out-btn');
  if (btn) { btn.disabled = false; btn.textContent = '確認出庫'; }
  renderStockOutItems();
  setDateDisplay('stock-out-date', new Date());
}

function renderStockOutItems() {
  const container = document.getElementById('stock-out-items-container');
  if (!container) return;
  container.innerHTML = stockOutItems.map((item, idx) => {
    const p = products.find(x => x.id === item.productId);
    const stockLeft = p ? p.stock : 0;
    return `
      <div class="stock-item-card">
        <div class="stock-item-top">
          <div class="stock-item-thumb">
            ${item.imageUrl ? `<img src="${item.imageUrl}">` : `<i class="ti ti-photo"></i>`}
          </div>
          <div style="flex:1">
            <div class="stock-item-name">${item.name}</div>
            <div class="stock-item-model">${item.model || ''}</div>
          </div>
          <button class="delete-btn" onclick="removeStockOutItem(${idx})"><i class="ti ti-trash"></i></button>
        </div>
        <div class="stock-item-inputs">
          <div class="input-group">
            <div class="input-group-label">數量</div>
            <input type="number" value="${item.qty}" min="1"
              oninput="updateStockOutItem(${idx},'qty',this.value)" style="color:var(--text2);font-size:18px;font-weight:500">
            <div class="stock-hint" style="color:${stockLeft===0?'var(--red)':stockLeft<=5?'var(--amber)':'var(--text4)'}">庫存剩 ${stockLeft} 件</div>
          </div>
          <div class="input-group">
            <div class="input-group-label">售價（每件）</div>
            <input type="number" value="${item.price}" min="0"
              oninput="updateStockOutItem(${idx},'price',this.value)" style="color:var(--amber);font-size:18px;font-weight:500">
            <div class="stock-hint">預設 $${item.defaultPrice}</div>
          </div>
        </div>
      </div>`;
  }).join('');
  calcStockOutTotal();
  checkStockOutValidity();
}

window.removeStockOutItem = (idx) => {
  stockOutItems.splice(idx, 1);
  renderStockOutItems();
};

window.updateStockOutItem = (idx, field, value) => {
  stockOutItems[idx][field] = parseFloat(value) || 0;
  calcStockOutTotal();
  checkStockOutValidity();
};

function calcStockOutTotal() {
  const total = stockOutItems.reduce((sum, item) => sum + (item.qty * item.price), 0);
  document.getElementById('stock-out-total').textContent = `$${total.toLocaleString()}`;
}

function checkStockOutValidity() {
  const btn = document.getElementById('confirm-stock-out-btn');
  if (!btn) return;
  const hasInsufficientStock = stockOutItems.some(item => {
    const p = products.find(x => x.id === item.productId);
    return p && item.qty > p.stock;
  });
  if (hasInsufficientStock) {
    btn.disabled = true;
    btn.textContent = '⚠️ 庫存不足，無法出庫';
  } else {
    btn.disabled = false;
    btn.textContent = '🚚 確認出庫';
  }
}

window.showProductPickerForStockOut = () => {
  showProductPicker((p) => addProductToStockOut(p.id));
};

function addProductToStockOut(productId) {
  const p = products.find(x => x.id === productId);
  if (!p) return;
  const existing = stockOutItems.findIndex(i => i.productId === productId);
  if (existing > -1) {
    stockOutItems[existing].qty++;
  } else {
    stockOutItems.push({
      productId: p.id, name: p.name, model: p.model,
      imageUrl: p.imageUrl, qty: 1,
      price: p.price || 0, defaultPrice: p.price || 0,
      cost: p.avgCost || p.cost || 0
    });
  }
  renderStockOutItems();
}

window.showCustomerPickerForStockOut = () => {
  showCustomerPickerModal((c) => {
    stockOutCustomerId = c.id;
    document.getElementById('stock-out-customer-display').textContent = c.name;
    document.getElementById('stock-out-customer-display').dataset.value = c.id;
  });
};

window.confirmStockOut = async () => {
  if (stockOutItems.length === 0) { showToast('請新增商品'); return; }
  if (!stockOutCustomerId) { showToast('請選擇客戶'); return; }
  showToast('出庫處理中...');

  const date = document.getElementById('stock-out-date-display').dataset.value;
  const notes = document.getElementById('stock-out-notes').value;
  const totalAmount = stockOutItems.reduce((sum, i) => sum + (i.qty * i.price), 0);
  const totalCost = stockOutItems.reduce((sum, i) => sum + (i.qty * (i.cost || 0)), 0);
  const customer = customers.find(c => c.id === stockOutCustomerId);
  const orderNum = generateOrderNumber('O', date);

  const orderData = {
    orderNum, date, notes, totalAmount, totalCost,
    customerId: stockOutCustomerId,
    customerName: customer?.name || '',
    items: stockOutItems.map(i => ({ ...i })),
    createdAt: Date.now()
  };

  try {
    const docRef = await addDoc(collection(db, 'users', getDataUid(), 'stockOut'), orderData);
    stockOutOrders.push({ id: docRef.id, ...orderData });

    // Update product stock
    for (const item of stockOutItems) {
      const p = products.find(x => x.id === item.productId);
      if (p) {
        const newStock = (p.stock || 0) - item.qty;
        await updateDoc(doc(db, 'users', getDataUid(), 'products', p.id), {
          stock: Math.max(0, newStock),
          lastOutDate: date
        });
        p.stock = Math.max(0, newStock);
        p.lastOutDate = date;
      }
    }

    // Update customer stats
    await updateDoc(doc(db, 'users', getDataUid(), 'customers', stockOutCustomerId), {
      totalAmount: (customer?.totalAmount || 0) + totalAmount
    });
    if (customer) customer.totalAmount = (customer.totalAmount || 0) + totalAmount;

    // If editing, delete old order first
    if (window._editingStockOutId) {
      // Restore old stock first
      const oldOrder = stockOutOrders.find(x => x.id === window._editingStockOutId);
      if (oldOrder) {
        for (const oldItem of oldOrder.items || []) {
          const p = products.find(x => x.id === oldItem.productId);
          if (p) {
            const restoredStock = (p.stock || 0) + oldItem.qty;
            await updateDoc(doc(db, 'users', getDataUid(), 'products', p.id), { stock: restoredStock });
            p.stock = restoredStock;
          }
        }
      }
      await deleteDoc(doc(db, 'users', getDataUid(), 'stockOut', window._editingStockOutId));
      stockOutOrders = stockOutOrders.filter(x => x.id !== window._editingStockOutId);
      window._editingStockOutId = null;
      const btn2 = document.getElementById('confirm-stock-out-btn');
      if (btn2) { btn2.textContent = '確認出庫'; btn2.style.background = ''; }
      showToast('出庫單已更新！');
    } else {
      showToast(`出庫成功！單號：${orderNum}`);
    }
    updateHomePage();
    navigate('home');
  } catch (e) {
    console.error('StockOut error:', e);
    if (e.code === 'permission-denied') showToast('❌ 權限不足，請確認 Firebase 規則');
    else showToast('❌ 出庫失敗：' + (e.code || e.message));
  }
};

function generateOrderNumber(type, date) {
  const prefix = type === 'O'
    ? (userSettings.stockOutPrefix || 'O')
    : (userSettings.stockInPrefix || 'I');
  const dateStr = (date || formatDate(new Date())).replace(/-/g, '');
  const orders = type === 'O' ? stockOutOrders : stockInOrders;
  const todayOrders = orders.filter(o => o.date === (date || formatDate(new Date())));
  const seq = String(todayOrders.length + 1).padStart(4, '0');
  return `${prefix}${dateStr}${seq}`;
}

// ==================== CUSTOMERS ====================
function renderCustomerList() {
  const search = document.getElementById('customer-search')?.value?.toLowerCase() || '';
  const container = document.getElementById('customer-list-container');
  if (!container) return;

  // Switch between customer and supplier tab
  if (currentContactTab === 'suppliers') {
    renderSupplierList(search, container);
    return;
  }

  const filtered = customers.filter(c =>
    !search || c.name?.toLowerCase().includes(search)
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-users"></i><p>沒有客戶<br><span style="font-size:15px;color:var(--text4)">點右下角 + 新增</span></p></div>`;
    return;
  }

  const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  container.innerHTML = `<div class="form-card" style="margin:0">${filtered.map(c => {
    const monthOrders = stockOutOrders.filter(o => o.customerId === c.id && o.date?.startsWith(thisMonth));
    const monthAmount = monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    // Calculate from orders directly (don't rely on cached totalAmount)
    const totalAmount = stockOutOrders.filter(o => o.customerId === c.id).reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const initials = (c.name || '?').substring(0, 2);
    const color = getAvatarColor(c.name);
    return `
      <div class="customer-item" onclick="showCustomerDetail('${c.id}')">
        <div class="customer-avatar-circle" style="background:${color}22;color:${color}">${initials}</div>
        <div style="flex:1">
          <div style="color:var(--text2);font-size:17px;font-weight:500">${c.name}</div>
          <div style="color:var(--text4);font-size:15px;margin-top:2px">本月 ${monthOrders.length} 筆出庫</div>
        </div>
        <div style="text-align:right;margin-right:4px">
          <div style="color:var(--green);font-size:17px;font-weight:500">$${monthAmount.toLocaleString()}</div>
          <div style="color:var(--text4);font-size:14px">本月消費</div>
        </div>
        <i class="ti ti-chevron-right" style="color:var(--text5)"></i>
      </div>`;
  }).join('')}</div>`;
}

function renderSupplierList(search, container) {
  const filtered = suppliers.filter(s =>
    !search || s.name?.toLowerCase().includes(search)
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-building-store"></i><p>沒有供應商<br><span style="font-size:15px;color:var(--text4)">點右下角 + 新增</span></p></div>`;
    return;
  }

  const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  container.innerHTML = `<div class="form-card" style="margin:0">${filtered.map(s => {
    const monthOrders = stockInOrders.filter(o => o.supplierId === s.id && o.date?.startsWith(thisMonth));
    const monthCost = monthOrders.reduce((sum, o) => sum + (o.totalCost || 0), 0);
    const initials = (s.name || '?').substring(0, 2);
    const color = getAvatarColor(s.name);
    return `
      <div class="customer-item" onclick="showSupplierDetail('${s.id}')">
        <div class="customer-avatar-circle" style="background:${color}22;color:${color}">${initials}</div>
        <div style="flex:1">
          <div style="color:var(--text2);font-size:17px;font-weight:500">${s.name}</div>
          <div style="color:var(--text4);font-size:15px;margin-top:2px">本月 ${monthOrders.length} 筆入庫</div>
        </div>
        <div style="text-align:right;margin-right:4px">
          <div style="color:var(--blue);font-size:17px;font-weight:500">$${monthCost.toLocaleString()}</div>
          <div style="color:var(--text4);font-size:14px">本月進貨</div>
        </div>
        <i class="ti ti-chevron-right" style="color:var(--text5)"></i>
      </div>`;
  }).join('')}</div>`;
}

window.filterCustomers = () => renderCustomerList();

window.switchContactTab = (tab) => {
  currentContactTab = tab;
  // Update tab styles
  const tabC = document.getElementById('tab-customers');
  const tabS = document.getElementById('tab-suppliers');
  if (tabC && tabS) {
    if (tab === 'customers') {
      tabC.style.background = 'var(--blue)'; tabC.style.borderColor = 'var(--blue)'; tabC.style.color = 'white';
      tabS.style.background = 'var(--bg2)'; tabS.style.borderColor = 'var(--border)'; tabS.style.color = 'var(--text3)';
    } else {
      tabS.style.background = 'var(--blue)'; tabS.style.borderColor = 'var(--blue)'; tabS.style.color = 'white';
      tabC.style.background = 'var(--bg2)'; tabC.style.borderColor = 'var(--border)'; tabC.style.color = 'var(--text3)';
    }
  }
  // Update search placeholder
  const search = document.getElementById('customer-search');
  if (search) search.placeholder = tab === 'customers' ? '搜尋客戶名稱' : '搜尋供應商名稱';
  // Update FAB
  const fab = document.getElementById('contact-fab');
  if (fab) fab.onclick = tab === 'customers' ? () => navigate('add-customer') : () => navigate('add-supplier');
  renderCustomerList();
};

function getAvatarColor(name) {
  const colors = ['#5ba8e8','#4ccc88','#c088f8','#f0b030','#e05545','#40c0a0'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return colors[hash % colors.length];
}

function initAddCustomer() {
  editingCustomerId = null;
  document.getElementById('add-customer-title').textContent = '新增客戶';
  document.getElementById('customer-name').value = '';
  document.getElementById('customer-phone').value = '';
  document.getElementById('customer-address').value = '';
  document.getElementById('customer-notes').value = '';
}

window.saveCustomer = async () => {
  const name = document.getElementById('customer-name').value.trim();
  if (!name) { showToast('請輸入客戶名稱'); return; }

  const data = {
    name,
    phone: document.getElementById('customer-phone').value.trim(),
    address: document.getElementById('customer-address').value.trim(),
    notes: document.getElementById('customer-notes').value.trim(),
    updatedAt: Date.now()
  };

  showToast('儲存中...');
  try {
    if (editingCustomerId) {
      await updateDoc(doc(db, 'users', getDataUid(), 'customers', editingCustomerId), data);
      const idx = customers.findIndex(c => c.id === editingCustomerId);
      if (idx > -1) customers[idx] = { ...customers[idx], ...data };
      showToast('客戶已更新！');
    } else {
      data.createdAt = Date.now();
      data.totalAmount = 0;
      const docRef = await addDoc(collection(db, 'users', getDataUid(), 'customers'), data);
      customers.push({ id: docRef.id, ...data });
      showToast('客戶已新增！');
    }
    editingCustomerId = null;
    navigate('customers');
  } catch (e) {
    showToast('儲存失敗：' + e.message);
    console.error('Save customer error:', e);
  }
};

window.showCustomerDetail = (customerId) => {
  currentCustomerDetailId = customerId;
  const c = customers.find(x => x.id === customerId);
  if (!c) return;

  const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  const monthOrders = stockOutOrders.filter(o => o.customerId === customerId && o.date?.startsWith(thisMonth));
  const monthAmount = monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  // Always calculate from orders directly to stay accurate after deletes
  const totalAmount = stockOutOrders.filter(o => o.customerId === customerId).reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const totalOrders = stockOutOrders.filter(o => o.customerId === customerId).length;
  const color = getAvatarColor(c.name);
  const initials = c.name.substring(0, 2);

  document.getElementById('customer-detail-content').innerHTML = `
    <div style="padding:14px">
      <div class="customer-header-card">
        <div class="customer-avatar-circle" style="background:${color}22;color:${color};width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:500;flex-shrink:0">${initials}</div>
        <div style="flex:1">
          <div style="color:var(--text);font-size:20px;font-weight:500">${c.name}</div>
          <div style="color:var(--text4);font-size:14px;margin-top:3px">${c.phone || '未填寫電話'}</div>
        </div>
        <button class="text-btn" onclick="editCustomer('${c.id}')">編輯</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">本月消費</div>
          <div class="stat-value green">$${monthAmount.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">本月筆數</div>
          <div class="stat-value blue">${monthOrders.length} 筆</div>
        </div>
        <div class="stat-card" onclick="showCustomerOrders('${c.id}','all')">
          <div class="stat-label">累計消費</div>
          <div class="stat-value purple">$${totalAmount.toLocaleString()}</div>
        </div>
        <div class="stat-card" onclick="showCustomerOrders('${c.id}','all')">
          <div class="stat-label">累計筆數</div>
          <div class="stat-value amber">${totalOrders} 筆</div>
        </div>
      </div>

      <div class="form-card">
        <div class="form-row">
          <span class="form-label">電話</span>
          <span class="form-input" style="${!c.phone ? 'color:var(--text5)' : ''}">${c.phone || '未填寫'}</span>
        </div>
        <div class="form-row">
          <span class="form-label">地址</span>
          <span class="form-input" style="${!c.address ? 'color:var(--text5)' : ''}">${c.address || '未填寫'}</span>
        </div>
        <div class="form-row" style="border-bottom:none">
          <span class="form-label">備註</span>
          <span class="form-input" style="${!c.notes ? 'color:var(--text5)' : ''}">${c.notes || '未填寫'}</span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
        <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="editCustomer('${c.id}')">修改</button>
        <button class="submit-btn red" onclick="deleteCustomer('${c.id}')">刪除客戶</button>
      </div>
      <div style="height:20px"></div>
    </div>`;

  navigate('customer-detail');
};

// ==================== SUPPLIERS ====================
let editingSupplierId = null;
let currentSupplierDetailId = null;

window.showSupplierDetail = (supplierId) => {
  currentSupplierDetailId = supplierId;
  const s = suppliers.find(x => x.id === supplierId);
  if (!s) return;

  const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  const monthOrders = stockInOrders.filter(o => o.supplierId === supplierId && o.date?.startsWith(thisMonth));
  const monthCost = monthOrders.reduce((sum, o) => sum + (o.totalCost || 0), 0);
  const totalOrders = stockInOrders.filter(o => o.supplierId === supplierId).length;
  const totalCost = stockInOrders.filter(o => o.supplierId === supplierId).reduce((sum, o) => sum + (o.totalCost || 0), 0);
  const color = getAvatarColor(s.name);
  const initials = s.name.substring(0, 2);

  document.getElementById('supplier-detail-content').innerHTML = `
    <div style="padding:14px">
      <div class="customer-header-card">
        <div style="width:56px;height:56px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:500;flex-shrink:0">${initials}</div>
        <div style="flex:1">
          <div style="color:var(--text);font-size:16px;font-weight:500">${s.name}</div>
          <div style="color:var(--text4);font-size:12px;margin-top:3px">${s.phone || '未填寫電話'}</div>
        </div>
        <button class="text-btn" onclick="editSupplier('${s.id}')">編輯</button>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">本月進貨額</div>
          <div class="stat-value blue">$${monthCost.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">本月筆數</div>
          <div class="stat-value amber">${monthOrders.length} 筆</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">累計進貨額</div>
          <div class="stat-value purple">$${totalCost.toLocaleString()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">累計筆數</div>
          <div class="stat-value green">${totalOrders} 筆</div>
        </div>
      </div>
      <div class="form-card">
        <div class="form-row"><span class="form-label">電話</span><span class="form-input" style="${!s.phone?'color:var(--text5)':''}">${s.phone||'未填寫'}</span></div>
        <div class="form-row"><span class="form-label">地址</span><span class="form-input" style="${!s.address?'color:var(--text5)':''}">${s.address||'未填寫'}</span></div>
        <div class="form-row" style="border-bottom:none"><span class="form-label">備註</span><span class="form-input" style="${!s.notes?'color:var(--text5)':''}">${s.notes||'未填寫'}</span></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
        <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="editSupplier('${s.id}')">修改</button>
        <button class="submit-btn red" onclick="deleteSupplierDetail('${s.id}')">刪除</button>
      </div>
      <div style="height:20px"></div>
    </div>`;
  navigate('supplier-detail');
};

window.showSupplierDetailMenu = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="picker-item" onclick="closeModal();editSupplier('${currentSupplierDetailId}')"><i class="ti ti-edit"></i> 編輯供應商</div>
    <div class="picker-item" style="color:var(--red)" onclick="closeModal();deleteSupplierDetail('${currentSupplierDetailId}')"><i class="ti ti-trash"></i> 刪除供應商</div>`);
};

window.editSupplier = (supplierId) => {
  editingSupplierId = supplierId;
  const s = suppliers.find(x => x.id === supplierId);
  if (!s) return;
  document.getElementById('add-supplier-title').textContent = '編輯供應商';
  document.getElementById('supplier-name').value = s.name || '';
  document.getElementById('supplier-phone').value = s.phone || '';
  document.getElementById('supplier-address').value = s.address || '';
  document.getElementById('supplier-notes').value = s.notes || '';
  navigate('add-supplier');
};

window.saveSupplier = async () => {
  const name = document.getElementById('supplier-name').value.trim();
  if (!name) { showToast('請輸入供應商名稱'); return; }
  showToast('儲存中...');
  const data = {
    name,
    phone: document.getElementById('supplier-phone').value.trim(),
    address: document.getElementById('supplier-address').value.trim(),
    notes: document.getElementById('supplier-notes').value.trim(),
    updatedAt: Date.now()
  };
  try {
    if (editingSupplierId) {
      const idx = suppliers.findIndex(s => s.id === editingSupplierId);
      if (idx > -1) suppliers[idx] = { ...suppliers[idx], ...data };
      editingSupplierId = null;
      await saveCategories();
      showToast('供應商已更新！');
    } else {
      data.id = Date.now().toString();
      data.createdAt = Date.now();
      suppliers.push(data);
      await saveCategories();
      showToast('供應商已新增！');
    }
    document.getElementById('add-supplier-title').textContent = '新增供應商';
    navigate('customers');
    switchContactTab('suppliers');
  } catch(e) { showToast('儲存失敗：' + e.message); }
};

window.deleteSupplierDetail = (supplierId) => {
  showConfirm('確定要刪除這個供應商嗎？', async () => {
    suppliers = suppliers.filter(s => s.id !== supplierId);
    await saveCategories();
    navigate('customers');
    switchContactTab('suppliers');
    showToast('供應商已刪除');
  });
};

window.editCustomer = (customerId) => {
  editingCustomerId = customerId;
  const c = customers.find(x => x.id === customerId);
  if (!c) return;
  document.getElementById('add-customer-title').textContent = '編輯客戶';
  document.getElementById('customer-name').value = c.name || '';
  document.getElementById('customer-phone').value = c.phone || '';
  document.getElementById('customer-address').value = c.address || '';
  document.getElementById('customer-notes').value = c.notes || '';
  navigate('add-customer');
};

window.showCustomerDetailMenu = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="picker-item" onclick="closeModal();editCustomer('${currentCustomerDetailId}')"><i class="ti ti-edit"></i> 編輯客戶</div>
    <div class="picker-item" style="color:var(--red)" onclick="closeModal();deleteCustomer('${currentCustomerDetailId}')"><i class="ti ti-trash"></i> 刪除客戶</div>`);
};

window.deleteCustomer = (customerId) => {
  showConfirm('確定要刪除這個客戶嗎？此操作無法復原。', async () => {
    await deleteDoc(doc(db, 'users', getDataUid(), 'customers', customerId));
    customers = customers.filter(c => c.id !== customerId);
    navigate('customers');
    showToast('客戶已刪除');
  });
};

window.showCustomerOrders = (customerId, period) => {
  const orders = stockOutOrders.filter(o => o.customerId === customerId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const c = customers.find(x => x.id === customerId);
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">${c?.name || ''} 出庫紀錄</div>
    ${orders.length === 0 ? '<p style="text-align:center;color:var(--text4);padding:20px">沒有出庫紀錄</p>' :
    `<div class="form-card" style="margin:0">
      ${orders.map(o => `
        <div class="order-item">
          <div style="flex:1">
            <div style="color:var(--text3);font-size:15px">${o.date}</div>
            <div style="color:var(--text2);font-size:14px;margin-top:2px">單號：${o.orderNum}</div>
          </div>
          <div style="text-align:right">
            <div style="color:var(--green);font-size:17px;font-weight:500">$${(o.totalAmount||0).toLocaleString()}</div>
            <div style="color:var(--text4);font-size:14px">${(o.items||[]).reduce((s,i)=>s+i.qty,0)} 件</div>
          </div>
        </div>`).join('')}
    </div>`}`);
};

// ==================== EXPENSES ====================
function updateExpenseMonthDisplay() {
  const year = expenseMonth.getFullYear();
  const month = expenseMonth.getMonth() + 1;
  document.getElementById('expense-month-display').textContent = `${year}年 ${month}月`;
}

window.changeExpenseMonth = (dir) => {
  expenseMonth = new Date(expenseMonth.getFullYear(), expenseMonth.getMonth() + dir, 1);
  updateExpenseMonthDisplay();
  renderExpenseList();
};

function renderExpenseList() {
  updateExpenseMonthDisplay();
  const monthStr = `${expenseMonth.getFullYear()}-${String(expenseMonth.getMonth()+1).padStart(2,'0')}`;
  const monthExpenses = expenses.filter(e => e.date?.startsWith(monthStr))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const total = monthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  document.getElementById('expense-total').textContent = `$${total.toLocaleString()}`;
  document.getElementById('expense-count').textContent = `${monthExpenses.length} 筆`;

  const container = document.getElementById('expense-list-container');
  if (!container) return;

  if (monthExpenses.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-receipt"></i><p>本月沒有支出紀錄</p></div>`;
    return;
  }

  container.innerHTML = `<div class="form-card" style="margin:0">
    ${monthExpenses.map(e => {
      const icon = getExpenseIcon(e.category);
      return `
        <div class="expense-item" onclick="showExpenseDetail('${e.id}')">
          <div class="expense-icon" style="background:${icon.bg}"><i class="${icon.icon}" style="color:${icon.color}"></i></div>
          <div style="flex:1">
            <div style="color:var(--text2);font-size:17px;font-weight:500">${e.category}</div>
            <div style="color:var(--text4);font-size:15px;margin-top:2px">${e.date}</div>
          </div>
          <div style="text-align:right">
            <div style="color:var(--red);font-size:17px;font-weight:500">-$${(e.amount||0).toLocaleString()}</div>
            ${e.notes ? `<div style="color:var(--text4);font-size:14px">${e.notes}</div>` : ''}
          </div>
          <i class="ti ti-chevron-right" style="color:var(--text5);margin-left:4px"></i>
        </div>`;
    }).join('')}
  </div>`;
}

function getExpenseIcon(category) {
  const map = {
    '包材': { icon: 'ti ti-package', color: '#f0b030', bg: '#2a1e08' },
    '廣告費': { icon: 'ti ti-speakerphone', color: '#5ba8e8', bg: '#1a1e2a' },
    '電話費': { icon: 'ti ti-phone', color: '#4ccc88', bg: '#1a2a1a' },
    '印刷費': { icon: 'ti ti-printer', color: '#c088f8', bg: '#2a1a2a' },
    '運費': { icon: 'ti ti-truck', color: '#5ba8e8', bg: '#1a1e2a' },
    '稅': { icon: 'ti ti-file-invoice', color: '#f0b030', bg: '#2a1e08' },
  };
  if (map[category]) return map[category];
  if (category?.includes('廣告')) return map['廣告費'];
  if (category?.includes('電話')) return map['電話費'];
  if (category?.includes('印刷')) return map['印刷費'];
  if (category?.includes('運費')) return map['運費'];
  if (category?.includes('包材')) return map['包材'];
  return { icon: 'ti ti-wallet', color: '#f0b030', bg: '#2a1e08' };
}

// Store current editing expense
let _editingExpense = null;

window.showExpenseDetail = (expenseId) => {
  const e = expenses.find(x => x.id === expenseId);
  if (!e) return;
  _editingExpense = { ...e };
  renderExpenseDetailModal();
};

function renderExpenseDetailModal() {
  const e = _editingExpense;
  if (!e) return;
  const icon = getExpenseIcon(e.category);
  showModal(`<div class="modal-handle"></div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <div class="expense-icon" style="background:${icon.bg};width:40px;height:40px">
        <i class="${icon.icon}" style="color:${icon.color};font-size:18px"></i>
      </div>
      <div>
        <div style="color:var(--text);font-size:16px;font-weight:500">${e.category}</div>
        <div style="color:var(--red);font-size:14px">$${(e.amount||0).toLocaleString()}</div>
      </div>
    </div>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" onclick="editExpenseField('category')">
        <span class="form-label">類別</span>
        <span class="form-input">${e.category}</span>
        <i class="ti ti-chevron-right" style="color:var(--text5)"></i>
      </div>
      <div class="form-row" onclick="editExpenseField('amount')">
        <span class="form-label">金額</span>
        <span class="form-input" style="color:var(--red)">$${(e.amount||0).toLocaleString()}</span>
        <i class="ti ti-chevron-right" style="color:var(--text5)"></i>
      </div>
      <div class="form-row" onclick="editExpenseField('date')">
        <span class="form-label">日期</span>
        <span class="form-input">${e.date}</span>
        <i class="ti ti-calendar" style="color:var(--text5)"></i>
      </div>
      <div class="form-row" style="border-bottom:none" onclick="editExpenseField('notes')">
        <span class="form-label">備註</span>
        <span class="form-input" style="color:${e.notes?'var(--text2)':'var(--text5)'}">${e.notes||'點擊新增備註'}</span>
        <i class="ti ti-chevron-right" style="color:var(--text5)"></i>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="forceCloseModal();editExpense('${e.id}')">修改</button>
      <button class="submit-btn red" onclick="deleteExpense('${e.id}')">刪除</button>
    </div>`);
}

window.editExpense = (expenseId) => {
  const e = expenses.find(x => x.id === expenseId);
  if (!e) return;
  window._editingExpenseId = expenseId;
  // Fill the add-expense form with existing data
  document.getElementById('expense-category-display').textContent = e.category;
  document.getElementById('expense-category-display').dataset.value = e.category;
  document.getElementById('expense-amount').value = e.amount || 0;
  document.getElementById('expense-amount-display').textContent = `$${(e.amount||0).toLocaleString()}`;
  document.getElementById('expense-notes').value = e.notes || '';
  document.getElementById('expense-repeat-day').value = e.repeatDay || '';
  setDateDisplay('expense-date', new Date(e.date));
  navigate('add-expense');
  // Update page title
  const titleEl = document.querySelector('#page-add-expense .subpage-title');
  if (titleEl) titleEl.textContent = '修改支出';
  const btnEl = document.querySelector('#page-add-expense .submit-btn');
  if (btnEl) btnEl.textContent = '確認修改';
};

window.editExpenseField = (field) => {
  const e = _editingExpense;
  if (!e) return;
  if (field === 'category') {
    showModal(`<div class="modal-handle"></div>
      <div class="modal-title">選擇類別</div>
      <div class="form-card" style="margin:0">
        ${expenseCategories.map(c => `
          <div class="picker-item" onclick="updateEditingExpense('category','${c}')">
            ${c} ${e.category===c ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
          </div>`).join('')}
      </div>`);
  } else if (field === 'amount') {
    showModal(`<div class="modal-handle"></div>
      <div class="modal-title">修改金額</div>
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-row" style="border-bottom:none">
          <span class="form-label">金額</span>
          <input class="form-input" type="number" id="edit-amt-input" value="${e.amount||0}"
            style="font-size:20px;font-weight:500;color:var(--red)">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="renderExpenseDetailModal()">取消</button>
        <button class="submit-btn" onclick="updateEditingExpense('amount',document.getElementById('edit-amt-input').value)">確認</button>
      </div>`);
    setTimeout(()=>document.getElementById('edit-amt-input')?.focus(),100);
  } else if (field === 'date') {
    const d = new Date(e.date);
    const years = Array.from({length:5},(_,i)=>new Date().getFullYear()-2+i);
    showModal(`<div class="modal-handle"></div>
      <div class="modal-title">選擇日期</div>
      <div class="date-picker-selects">
        <select id="ep-year" style="flex:1.5">${years.map(y=>`<option value="${y}" ${y===d.getFullYear()?'selected':''}>${y}年</option>`).join('')}</select>
        <select id="ep-month">${Array.from({length:12},(_,i)=>i+1).map(m=>`<option value="${m}" ${m===d.getMonth()+1?'selected':''}>${m}月</option>`).join('')}</select>
        <select id="ep-day">${Array.from({length:31},(_,i)=>i+1).map(day=>`<option value="${day}" ${day===d.getDate()?'selected':''}>${day}日</option>`).join('')}</select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="renderExpenseDetailModal()">取消</button>
        <button class="submit-btn" onclick="confirmExpenseDate()">確認</button>
      </div>`);
  } else if (field === 'notes') {
    showModal(`<div class="modal-handle"></div>
      <div class="modal-title">修改備註</div>
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-row" style="border-bottom:none">
          <input class="form-input" type="text" id="edit-notes-input" value="${e.notes||''}"
            placeholder="輸入備註" style="font-size:16px">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="renderExpenseDetailModal()">取消</button>
        <button class="submit-btn" onclick="updateEditingExpense('notes',document.getElementById('edit-notes-input').value)">確認</button>
      </div>`);
    setTimeout(()=>document.getElementById('edit-notes-input')?.focus(),100);
  }
};

window.confirmExpenseDate = () => {
  const y = document.getElementById('ep-year').value;
  const m = String(document.getElementById('ep-month').value).padStart(2,'0');
  const d = String(document.getElementById('ep-day').value).padStart(2,'0');
  updateEditingExpense('date', `${y}-${m}-${d}`);
};

window.updateEditingExpense = async (field, value) => {
  if (!_editingExpense) return;
  if (field === 'amount') value = parseFloat(value) || 0;
  _editingExpense[field] = value;
  try {
    await updateDoc(doc(db, 'users', getDataUid(), 'expenses', _editingExpense.id), { [field]: value });
    const idx = expenses.findIndex(e => e.id === _editingExpense.id);
    if (idx > -1) expenses[idx] = { ...expenses[idx], [field]: value };
    renderExpenseList();
    renderExpenseDetailModal();
    showToast('已更新！');
  } catch(err) { showToast('更新失敗'); }
};



window.deleteExpense = (expenseId) => {
  closeModal();
  showConfirm('確定要刪除這筆支出嗎？', async () => {
    await deleteDoc(doc(db, 'users', getDataUid(), 'expenses', expenseId));
    expenses = expenses.filter(e => e.id !== expenseId);
    renderExpenseList();
    showToast('支出已刪除');
  });
};

function initAddExpense() {
  window._editingExpenseId = null;
  const titleEl2 = document.querySelector('#page-add-expense .subpage-title');
  if (titleEl2) titleEl2.textContent = '新增支出';
  const btnEl2 = document.querySelector('#page-add-expense .submit-btn');
  if (btnEl2) btnEl2.textContent = '確認新增';
  document.getElementById('expense-category-display').textContent = '請選擇類別';
  document.getElementById('expense-category-display').dataset.value = '';
  document.getElementById('expense-amount').value = '';
  document.getElementById('expense-amount-display').textContent = '$0';
  document.getElementById('expense-notes').value = '';
  document.getElementById('expense-repeat-day').value = '';
  setDateDisplay('expense-date', new Date());
}

window.updateExpenseDisplay = () => {
  const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
  document.getElementById('expense-amount-display').textContent = `$${amount.toLocaleString()}`;
};

window.saveExpense = async () => {
  const category = document.getElementById('expense-category-display').dataset.value;
  const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
  const date = document.getElementById('expense-date-display').dataset.value;

  if (!category) { showToast('請選擇支出類別'); return; }
  if (amount <= 0) { showToast('請輸入金額'); return; }

  const data = {
    category, amount, date,
    notes: document.getElementById('expense-notes').value.trim(),
    repeatDay: parseInt(document.getElementById('expense-repeat-day').value) || null,
    createdAt: Date.now()
  };

  showToast('儲存中...');
  try {
    if (window._editingExpenseId) {
      await updateDoc(doc(db, 'users', getDataUid(), 'expenses', window._editingExpenseId), data);
      const idx = expenses.findIndex(e => e.id === window._editingExpenseId);
      if (idx > -1) expenses[idx] = { ...expenses[idx], ...data };
      window._editingExpenseId = null;
      showToast('支出已更新！');
    } else {
      const docRef = await addDoc(collection(db, 'users', getDataUid(), 'expenses'), data);
      expenses.push({ id: docRef.id, ...data });
      showToast('支出已新增！');
    }
    navigate('expenses');
  } catch (e) {
    showToast('儲存失敗：' + e.message);
    console.error('Save expense error:', e);
  }
};

// ==================== REPORTS ====================
function updateReportMonthDisplay() {
  const year = reportMonth.getFullYear();
  const month = reportMonth.getMonth() + 1;
  document.getElementById('report-month-display').textContent = `${year}年 ${month}月`;
}

window.changeReportMonth = (dir) => {
  reportMonth = new Date(reportMonth.getFullYear(), reportMonth.getMonth() + dir, 1);
  updateReportMonthDisplay();
  renderReports();
};

function getReportMonthStr() {
  return `${reportMonth.getFullYear()}-${String(reportMonth.getMonth()+1).padStart(2,'0')}`;
}

function renderReports() {
  updateReportMonthDisplay();
  const monthStr = getReportMonthStr();
  const monthOut = stockOutOrders.filter(o => o.date?.startsWith(monthStr));
  const monthIn = stockInOrders.filter(o => o.date?.startsWith(monthStr));
  const monthExp = expenses.filter(e => e.date?.startsWith(monthStr));

  const outTotal = monthOut.reduce((s, o) => s + (o.totalAmount || 0), 0);
  const inCost = monthOut.reduce((s, o) => s + (o.totalCost || 0), 0);
  const expTotal = monthExp.reduce((s, e) => s + (e.amount || 0), 0);
  const profit = outTotal - inCost - expTotal;
  const margin = outTotal > 0 ? ((profit / outTotal) * 100).toFixed(1) : 0;

  document.getElementById('report-out-total').textContent = `$${outTotal.toLocaleString()}`;
  document.getElementById('report-in-total').textContent = `$${inCost.toLocaleString()}`;
  document.getElementById('report-expense-total').textContent = `$${expTotal.toLocaleString()}`;
  document.getElementById('report-profit').textContent = `$${profit.toLocaleString()}`;
  document.getElementById('report-margin').textContent = `${margin}%`;
  document.getElementById('report-out-count-sub').textContent = `本月 ${monthOut.length} 筆出庫紀錄`;
  document.getElementById('report-in-count-sub').textContent = `本月 ${monthIn.length} 筆入庫紀錄`;
  document.getElementById('report-expense-count-sub').textContent = `本月支出 $${expTotal.toLocaleString()}`;
}

function renderReportStockOut() {
  const monthStr = getReportMonthStr();
  const filterMonth = _stockOutFilterMonth !== undefined ? _stockOutFilterMonth : monthStr;
  const orders = stockOutOrders
    .filter(o => {
      const matchMonth = filterMonth ? o.date?.startsWith(filterMonth) : true;
      const matchCustomer = _stockOutFilterCustomerId ? o.customerId === _stockOutFilterCustomerId : true;
      return matchMonth && matchCustomer;
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const totalItems = orders.reduce((s, o) => s + (o.items || []).reduce((ss, i) => ss + i.qty, 0), 0);
  const totalAmount = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
  document.getElementById('rso-count').textContent = orders.length;
  document.getElementById('rso-items').textContent = totalItems;
  document.getElementById('rso-total').textContent = `$${totalAmount.toLocaleString()}`;

  const container = document.getElementById('report-stock-out-list');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-package-export"></i><p>本月沒有出庫紀錄</p></div>`;
    return;
  }

  // Group by date
  const groups = {};
  orders.forEach(o => {
    if (!groups[o.date]) groups[o.date] = [];
    groups[o.date].push(o);
  });

  container.innerHTML = Object.entries(groups).map(([date, dateOrders]) => `
    <div style="margin-bottom:14px">
      <div style="color:var(--text3);font-size:18px;font-weight:500;margin-bottom:8px">${date}</div>
      <div class="form-card" style="margin:0">
        ${dateOrders.map(o => `
          <div class="order-item" onclick="showStockOutDetail('${o.id}')">
            <div class="order-icon" style="background:#2a1818"><i class="ti ti-package-export" style="color:var(--red)"></i></div>
            <div style="flex:1">
              <div style="color:var(--text2);font-size:17px;font-weight:500">${o.customerName}</div>
              <div style="color:var(--text4);font-size:15px;margin-top:2px">單號：${o.orderNum} ･ ${(o.items||[]).reduce((s,i)=>s+i.qty,0)}件商品</div>
            </div>
            <div style="text-align:right">
              <div style="color:var(--green);font-size:17px;font-weight:500">$${(o.totalAmount||0).toLocaleString()}</div>
            </div>
            <i class="ti ti-chevron-right" style="color:var(--text5);margin-left:4px"></i>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function renderReportStockIn() {
  const monthStr = getReportMonthStr();
  const filterMonth = _stockInFilterMonth !== undefined ? _stockInFilterMonth : monthStr;
  const orders = stockInOrders
    .filter(o => {
      const matchMonth = filterMonth ? o.date?.startsWith(filterMonth) : true;
      const matchSupplier = _stockInFilterSupplierId ? o.supplierId === _stockInFilterSupplierId : true;
      return matchMonth && matchSupplier;
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const totalItems = orders.reduce((s, o) => s + (o.items || []).reduce((ss, i) => ss + i.qty, 0), 0);
  const totalAmount = orders.reduce((s, o) => s + (o.totalCost || 0), 0);
  document.getElementById('rsi-count').textContent = orders.length;
  document.getElementById('rsi-items').textContent = totalItems;
  document.getElementById('rsi-total').textContent = `$${totalAmount.toLocaleString()}`;

  const container = document.getElementById('report-stock-in-list');
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-package-import"></i><p>本月沒有入庫紀錄</p></div>`;
    return;
  }

  const groups = {};
  orders.forEach(o => {
    if (!groups[o.date]) groups[o.date] = [];
    groups[o.date].push(o);
  });

  container.innerHTML = Object.entries(groups).map(([date, dateOrders]) => `
    <div style="margin-bottom:14px">
      <div style="color:var(--text3);font-size:18px;font-weight:500;margin-bottom:8px">${date}</div>
      <div class="form-card" style="margin:0">
        ${dateOrders.map(o => `
          <div class="order-item" onclick="showStockInDetail('${o.id}')">
            <div class="order-icon" style="background:#1a2818"><i class="ti ti-package-import" style="color:var(--green)"></i></div>
            <div style="flex:1">
              <div style="color:var(--text2);font-size:17px;font-weight:500">${o.supplierName || '無供應商'}</div>
              <div style="color:var(--text4);font-size:15px;margin-top:2px">單號：${o.orderNum} ･ ${(o.items||[]).length}款商品</div>
            </div>
            <div style="text-align:right">
              <div style="color:var(--blue);font-size:17px;font-weight:500">$${(o.totalCost||0).toLocaleString()}</div>
            </div>
            <i class="ti ti-chevron-right" style="color:var(--text5);margin-left:4px"></i>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

window.showStockOutDetail = (orderId) => {
  const o = stockOutOrders.find(x => x.id === orderId);
  if (!o) return;
  document.getElementById('stock-out-detail-content').innerHTML = `
    <div style="padding:14px">
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:20px;font-weight:500;color:var(--blue)">出庫單</div>
        <div style="color:var(--text4);font-size:14px;margin-top:4px">單號：${o.orderNum}</div>
        <div style="display:inline-block;background:#1a3828;border:0.5px solid #2a5838;border-radius:20px;padding:4px 16px;color:var(--green);font-size:14px;margin-top:8px">已出庫</div>
      </div>
      <div class="form-card">
        <div class="form-row"><span class="form-label">出庫客戶</span><span class="form-input">${o.customerName}</span></div>
        <div class="form-row"><span class="form-label">出庫日期</span><span class="form-input">${o.date}</span></div>
        ${o.notes ? `<div class="form-row"><span class="form-label">備註</span><span class="form-input">${o.notes}</span></div>` : ''}
      </div>
      <div class="form-card">
        ${(o.items||[]).map(item => `
          <div class="form-row">
            <div class="product-thumb" style="width:36px;height:36px;flex-shrink:0">
              ${item.imageUrl ? `<img src="${item.imageUrl}">` : `<i class="ti ti-photo"></i>`}
            </div>
            <div style="flex:1;margin-left:8px">
              <div style="color:var(--text2);font-size:17px">${item.name}</div>
              <div style="color:var(--text4);font-size:15px">${item.model || ''}</div>
            </div>
            <div style="text-align:right">
              <div style="color:var(--text2);font-size:17px">$${item.price} x${item.qty}</div>
            </div>
          </div>`).join('')}
      </div>
      <div class="form-card">
        <div class="form-row"><span class="form-label">出庫數量</span><span class="form-input">${(o.items||[]).reduce((s,i)=>s+i.qty,0)} 件</span></div>
        <div class="form-row" style="border-bottom:none"><span class="form-label">出庫總價</span><span class="form-input" style="color:var(--green)">$${(o.totalAmount||0).toLocaleString()}</span></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
        <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="editStockOutOrder('${o.id}')">修改</button>
        <button class="submit-btn red" onclick="deleteStockOutOrder('${o.id}')">刪除</button>
      </div>
      <div style="height:20px"></div>
    </div>`;
  navigate('stock-out-detail');
};

window.editStockOutOrder = (orderId) => {
  const o = stockOutOrders.find(x => x.id === orderId);
  if (!o) return;
  // Load items into stock-out form
  stockOutItems = (o.items || []).map(i => ({...i}));
  stockOutCustomerId = o.customerId;
  document.getElementById('stock-out-customer-display').textContent = o.customerName || '請選擇客戶';
  document.getElementById('stock-out-customer-display').dataset.value = o.customerId || '';
  document.getElementById('stock-out-notes').value = o.notes || '';
  setDateDisplay('stock-out-date', new Date(o.date));
  // Mark as editing
  window._editingStockOutId = orderId;
  navigate('stock-out');
  renderStockOutItems();
  const btn = document.getElementById('confirm-stock-out-btn');
  if (btn) { btn.textContent = '確認修改'; btn.style.background = 'var(--amber)'; }
  showToast('修改模式：請調整後重新送出');
};

window.deleteStockOutOrder = (orderId) => {
  showConfirm('確定要刪除此出庫單嗎？庫存將會恢復。', async () => {
    const o = stockOutOrders.find(x => x.id === orderId);
    if (!o) return;
    // Restore stock
    for (const item of o.items || []) {
      const p = products.find(x => x.id === item.productId);
      if (p) {
        const newStock = (p.stock || 0) + item.qty;
        await updateDoc(doc(db, 'users', getDataUid(), 'products', p.id), { stock: newStock });
        p.stock = newStock;
      }
    }
    await deleteDoc(doc(db, 'users', getDataUid(), 'stockOut', orderId));
    stockOutOrders = stockOutOrders.filter(x => x.id !== orderId);
    // Recalculate customer total
    if (o.customerId) {
      const newTotal = stockOutOrders.filter(x => x.customerId === o.customerId).reduce((s, x) => s + (x.totalAmount||0), 0);
      try { await updateDoc(doc(db, 'users', getDataUid(), 'customers', o.customerId), { totalAmount: newTotal }); } catch(e) {}
      const c = customers.find(x => x.id === o.customerId);
      if (c) c.totalAmount = newTotal;
    }
    navigate('report-stock-out');
    showToast('出庫單已刪除');
  });
};

window.showStockInDetail = (orderId) => {
  const o = stockInOrders.find(x => x.id === orderId);
  if (!o) return;
  document.getElementById('stock-in-detail-content').innerHTML = `
    <div style="padding:14px">
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-size:20px;font-weight:500;color:var(--green)">入庫單</div>
        <div style="color:var(--text4);font-size:14px;margin-top:4px">單號：${o.orderNum}</div>
        <div style="display:inline-block;background:#1a3828;border:0.5px solid #2a5838;border-radius:20px;padding:4px 16px;color:var(--green);font-size:14px;margin-top:8px">已入庫</div>
      </div>
      <div class="form-card">
        <div class="form-row"><span class="form-label">入庫日期</span><span class="form-input">${o.date}</span></div>
        <div class="form-row"><span class="form-label">供應商</span><span class="form-input">${o.supplierName || '無'}</span></div>
        ${o.notes ? `<div class="form-row"><span class="form-label">備註</span><span class="form-input">${o.notes}</span></div>` : ''}
      </div>
      <div class="form-card">
        ${(o.items||[]).map(item => `
          <div class="form-row">
            <div class="product-thumb" style="width:36px;height:36px;flex-shrink:0">
              ${item.imageUrl ? `<img src="${item.imageUrl}">` : `<i class="ti ti-photo"></i>`}
            </div>
            <div style="flex:1;margin-left:8px">
              <div style="color:var(--text2);font-size:17px">${item.name}</div>
              <div style="color:var(--text4);font-size:15px">${item.model || ''}</div>
            </div>
            <div style="text-align:right">
              <div style="color:var(--text2);font-size:17px">$${item.cost} x${item.qty}</div>
            </div>
          </div>`).join('')}
      </div>
      <div class="form-card">
        <div class="form-row"><span class="form-label">入庫數量</span><span class="form-input">${(o.items||[]).reduce((s,i)=>s+i.qty,0)} 件</span></div>
        <div class="form-row"><span class="form-label">附加成本</span><span class="form-input">$${(o.shipping||0).toLocaleString()}</span></div>
        <div class="form-row" style="border-bottom:none"><span class="form-label">入庫總金額</span><span class="form-input" style="color:var(--blue)">$${(o.totalCost||0).toLocaleString()}</span></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
        <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="editStockInOrder('${o.id}')">修改</button>
        <button class="submit-btn red" onclick="deleteStockInOrder('${o.id}')">刪除</button>
      </div>
      <div style="height:20px"></div>
    </div>`;
  navigate('stock-in-detail');
};

window.editStockInOrder = (orderId) => {
  const o = stockInOrders.find(x => x.id === orderId);
  if (!o) return;
  stockInItems = (o.items || []).map(i => ({...i}));
  stockInSupplierId = o.supplierId || null;
  document.getElementById('stock-in-supplier-display').textContent = o.supplierName || '請選擇供應商';
  document.getElementById('stock-in-supplier-display').dataset.value = o.supplierId || '';
  document.getElementById('stock-in-notes').value = o.notes || '';
  document.getElementById('stock-in-shipping').value = o.shipping || 0;
  setDateDisplay('stock-in-date', new Date(o.date));
  window._editingStockInId = orderId;
  renderStockInItems();
  navigate('stock-in');
  showToast('修改模式：請調整後重新確認入庫');
};

function renderProfitRanking() {
  const monthStr = getReportMonthStr();
  const filterMonth = _profitRankingMonth !== undefined ? _profitRankingMonth : monthStr;
  const monthOut = stockOutOrders.filter(o => {
    const matchMonth = filterMonth ? o.date?.startsWith(filterMonth) : true;
    return matchMonth;
  });

  // Calculate profit per product
  const productProfits = {};
  monthOut.forEach(order => {
    (order.items || []).forEach(item => {
      // Apply category filter
      if (_profitRankingCategory) {
        const p = products.find(x => x.id === item.productId);
        if (!p || p.category !== _profitRankingCategory) return;
      }
      if (!productProfits[item.productId]) {
        productProfits[item.productId] = {
          name: item.name, model: item.model, imageUrl: item.imageUrl,
          totalRevenue: 0, totalCost: 0, totalQty: 0
        };
      }
      productProfits[item.productId].totalRevenue += item.price * item.qty;
      productProfits[item.productId].totalCost += (item.cost || 0) * item.qty;
      productProfits[item.productId].totalQty += item.qty;
    });
  });

  const ranked = Object.entries(productProfits)
    .map(([id, data]) => ({ id, ...data, profit: data.totalRevenue - data.totalCost }))
    .sort((a, b) => b.profit - a.profit);

  const totalProfit = ranked.reduce((s, p) => s + p.profit, 0);
  const totalRevenue = ranked.reduce((s, p) => s + p.totalRevenue, 0);
  const margin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : 0;

  document.getElementById('rpr-profit').textContent = `$${totalProfit.toLocaleString()}`;
  document.getElementById('rpr-margin').textContent = `${margin}%`;

  const container = document.getElementById('profit-ranking-list');
  if (!container) return;

  if (ranked.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-chart-bar"></i><p>本月沒有出庫紀錄</p></div>`;
    return;
  }

  const maxProfit = ranked[0]?.profit || 1;
  const rankClasses = ['gold', 'silver', 'bronze'];

  container.innerHTML = `<div class="form-card" style="margin:0">
    ${ranked.map((p, idx) => {
      const rankClass = rankClasses[idx] || 'normal';
      const barWidth = Math.max(5, (p.profit / maxProfit) * 100);
      const barColors = ['#4ccc88', '#5ba8e8', '#c088f8', '#f0b030'];
      return `
        <div class="rank-item">
          <div class="rank-top">
            <div class="rank-badge ${rankClass}">${idx+1}</div>
            <div class="product-thumb" style="width:36px;height:36px">
              ${p.imageUrl ? `<img src="${p.imageUrl}">` : `<i class="ti ti-photo"></i>`}
            </div>
            <div style="flex:1">
              <div style="color:var(--text2);font-size:17px;font-weight:500">${p.name}</div>
              <div style="color:var(--text4);font-size:15px;margin-top:2px">已售 ${p.totalQty} 件</div>
            </div>
            <div style="color:var(--green);font-size:18px;font-weight:500">$${p.profit.toLocaleString()}</div>
          </div>
          <div class="bar-wrap">
            <div class="bar-bg"><div class="bar-fill" style="width:${barWidth}%;background:${barColors[idx%4]}"></div></div>
            <div class="bar-label">單品 $${(p.totalQty > 0 ? Math.round(p.profit/p.totalQty) : 0)}</div>
          </div>
        </div>`;
    }).join('')}
  </div>`;
}

function renderPlatformReport() {
  const monthStr = getReportMonthStr();
  const filterMonth = _platformMonth !== undefined ? _platformMonth : monthStr;
  const monthOut = stockOutOrders.filter(o =>
    filterMonth ? o.date?.startsWith(filterMonth) : true
  );

  const platformData = {};
  monthOut.forEach(order => {
    const key = order.customerId;
    const name = order.customerName;
    if (!platformData[key]) {
      platformData[key] = { name, revenue: 0, cost: 0, orders: 0 };
    }
    platformData[key].revenue += order.totalAmount || 0;
    platformData[key].cost += order.totalCost || 0;
    platformData[key].orders++;
  });

  const platforms = Object.entries(platformData)
    .map(([id, data]) => ({ id, ...data, profit: data.revenue - data.cost }))
    .sort((a, b) => b.profit - a.profit);

  const container = document.getElementById('platform-report-content');
  if (!container) return;

  if (platforms.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-users"></i><p>本月沒有出庫紀錄</p></div>`;
    return;
  }

  const totalRevenue = platforms.reduce((s, p) => s + p.revenue, 0);
  const colors = ['#5ba8e8','#4ccc88','#c088f8','#f0b030','#e05545','#40c0a0'];

  // Simple pie chart SVG
  let pieHtml = `<svg width="100" height="100" viewBox="0 0 100 100">`;
  let offset = 0;
  const total = totalRevenue || 1;
  platforms.forEach((p, i) => {
    const pct = (p.revenue / total) * 251;
    pieHtml += `<circle cx="50" cy="50" r="40" fill="none" stroke="${colors[i%colors.length]}" stroke-width="20" stroke-dasharray="${pct} ${251-pct}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"/>`;
    offset += pct;
  });
  pieHtml += `<text x="50" y="54" text-anchor="middle" fill="var(--text)" font-size="10" font-weight="500">利潤</text></svg>`;

  container.innerHTML = `
    <div class="pie-wrap">
      ${pieHtml}
      <div class="pie-legend">
        ${platforms.slice(0,5).map((p, i) => `
          <div class="legend-item">
            <div class="legend-dot" style="background:${colors[i%colors.length]}"></div>
            <div class="legend-name">${p.name}</div>
            <div class="legend-pct">${totalRevenue > 0 ? Math.round((p.revenue/totalRevenue)*100) : 0}%</div>
          </div>`).join('')}
      </div>
    </div>
    <div class="section-label">各平台詳細</div>
    <div class="form-card" style="margin:0">
      ${platforms.map((p, i) => {
        const margin = p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : 0;
        const color = getAvatarColor(p.name);
        const initials = p.name.substring(0, 2);
        return `
          <div style="padding:12px 14px;border-bottom:0.5px solid var(--border)">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <div style="width:36px;height:36px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:500;flex-shrink:0">${initials}</div>
              <div style="flex:1">
                <div style="color:var(--text2);font-size:17px;font-weight:500">${p.name}</div>
                <div style="color:var(--text4);font-size:15px;margin-top:2px">本月 ${p.orders} 筆出庫</div>
              </div>
              <div style="color:var(--green);font-size:18px;font-weight:500">$${p.profit.toLocaleString()}</div>
            </div>
            <div class="platform-stats">
              <div class="pstat"><div class="pstat-label">出庫金額</div><div class="pstat-value">$${p.revenue.toLocaleString()}</div></div>
              <div class="pstat"><div class="pstat-label">商品成本</div><div class="pstat-value">$${p.cost.toLocaleString()}</div></div>
              <div class="pstat"><div class="pstat-label">毛利率</div><div class="pstat-value">${margin}%</div></div>
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function renderExpenseReport() {
  const monthStr = getReportMonthStr();
  const filterMonth = _expenseReportMonth !== undefined ? _expenseReportMonth : monthStr;
  const monthExp = expenses.filter(e => {
    const matchMonth = filterMonth ? e.date?.startsWith(filterMonth) : true;
    const matchCat = _expenseReportCategory ? e.category === _expenseReportCategory : true;
    return matchMonth && matchCat;
  });
  const total = monthExp.reduce((s, e) => s + (e.amount || 0), 0);

  document.getElementById('re-total').textContent = `$${total.toLocaleString()}`;
  document.getElementById('re-count').textContent = monthExp.length;

  const container = document.getElementById('expense-report-list');
  if (!container) return;

  if (monthExp.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-receipt"></i><p>本月沒有支出紀錄</p></div>`;
    return;
  }

  // Group by category
  const catData = {};
  monthExp.forEach(e => {
    if (!catData[e.category]) catData[e.category] = 0;
    catData[e.category] += e.amount || 0;
  });

  const cats = Object.entries(catData).sort((a, b) => b[1] - a[1]);
  const colors = ['#5ba8e8','#f0b030','#4ccc88','#c088f8','#e05545','#40c0a0'];

  let pieHtml = `<svg width="100" height="100" viewBox="0 0 100 100">`;
  let offset = 0;
  cats.forEach(([cat, amount], i) => {
    const pct = (amount / (total||1)) * 251;
    pieHtml += `<circle cx="50" cy="50" r="40" fill="none" stroke="${colors[i%colors.length]}" stroke-width="20" stroke-dasharray="${pct} ${251-pct}" stroke-dashoffset="${-offset}" transform="rotate(-90 50 50)"/>`;
    offset += pct;
  });
  pieHtml += `<text x="50" y="54" text-anchor="middle" fill="var(--text)" font-size="10" font-weight="500">支出</text></svg>`;

  const sorted = [...monthExp].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  container.innerHTML = `
    <div class="pie-wrap">
      ${pieHtml}
      <div class="pie-legend">
        ${cats.slice(0,5).map(([cat, amount], i) => `
          <div class="legend-item">
            <div class="legend-dot" style="background:${colors[i%colors.length]}"></div>
            <div class="legend-name">${cat}</div>
            <div class="legend-pct">${total > 0 ? Math.round((amount/total)*100) : 0}%</div>
          </div>`).join('')}
      </div>
    </div>
    <div class="section-label">支出明細</div>
    <div class="form-card" style="margin:0">
      ${sorted.map(e => {
        const icon = getExpenseIcon(e.category);
        return `
          <div class="expense-item">
            <div class="expense-icon" style="background:${icon.bg}"><i class="${icon.icon}" style="color:${icon.color}"></i></div>
            <div style="flex:1">
              <div style="color:var(--text2);font-size:17px;font-weight:500">${e.category}</div>
              <div style="color:var(--text4);font-size:15px;margin-top:2px">${e.date}</div>
            </div>
            <div style="text-align:right">
              <div style="color:var(--red);font-size:17px;font-weight:500">-$${(e.amount||0).toLocaleString()}</div>
              ${e.notes ? `<div style="color:var(--text4);font-size:14px">${e.notes}</div>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

window.goBackFromReportStockOut = () => {
  if (window._reportStockOutFromHome) {
    window._reportStockOutFromHome = false;
    navigate('home');
  } else {
    navigate('reports');
  }
};

window.showStockOutFilter = () => {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">篩選出庫列表</div>
    <div class="section-label">選擇月份</div>
    <div class="form-card" style="margin-bottom:14px">
      <div class="picker-item" onclick="setStockOutFilter('all','全部','全部客戶')">全部時間</div>
      ${months.map(m => `<div class="picker-item" onclick="setStockOutFilter('${m}','${m}','全部客戶')">${m}</div>`).join('')}
    </div>
    <div class="section-label">選擇客戶</div>
    <div class="form-card" style="margin:0">
      <div class="picker-item" onclick="setStockOutCustomerFilter('全部客戶')">全部客戶</div>
      ${customers.map(c => `<div class="picker-item" onclick="setStockOutCustomerFilter('${c.name}','${c.id}')">${c.name}</div>`).join('')}
    </div>`);
};

let _stockOutFilterMonth = null;
let _stockOutFilterCustomerId = null;

window.setStockOutFilter = (month, label, sub) => {
  _stockOutFilterMonth = month === 'all' ? null : month;
  document.getElementById('stock-out-filter-title').textContent = label;
  forceCloseModal();
  renderReportStockOut();
};

window.setStockOutCustomerFilter = (name, id) => {
  _stockOutFilterCustomerId = id || null;
  document.getElementById('stock-out-filter-sub').textContent = name;
  forceCloseModal();
  renderReportStockOut();
};
window.showStockInFilter = () => {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">篩選入庫列表</div>
    <div class="section-label">選擇月份</div>
    <div class="form-card" style="margin-bottom:14px">
      <div class="picker-item" onclick="setStockInFilter('all','全部')">全部時間</div>
      ${months.map(m => `<div class="picker-item" onclick="setStockInFilter('${m}','${m}')">${m}</div>`).join('')}
    </div>
    <div class="section-label">選擇供應商</div>
    <div class="form-card" style="margin:0">
      <div class="picker-item" onclick="setStockInSupplierFilter('全部供應商')">全部供應商</div>
      ${suppliers.map(s => `<div class="picker-item" onclick="setStockInSupplierFilter('${s.name}','${s.id}')">${s.name}</div>`).join('')}
    </div>`);
};

let _stockInFilterMonth = null;
let _stockInFilterSupplierId = null;

window.setStockInFilter = (month, label) => {
  _stockInFilterMonth = month === 'all' ? null : month;
  document.getElementById('stock-in-filter-title').textContent = label;
  forceCloseModal();
  renderReportStockIn();
};

window.setStockInSupplierFilter = (name, id) => {
  _stockInFilterSupplierId = id || null;
  document.getElementById('stock-in-filter-sub').textContent = name;
  forceCloseModal();
  renderReportStockIn();
};
// Filter state variables
let _profitRankingMonth = null;
let _profitRankingCategory = null;
let _platformMonth = null;
let _expenseReportMonth = null;
let _expenseReportCategory = null;

window.showProfitRankingFilter = () => {
  const months = getRecentMonths();
  const monthStr = getReportMonthStr();
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">篩選商品利潤</div>
    <div class="section-label">選擇月份</div>
    <div class="form-card" style="margin-bottom:14px">
      <div class="picker-item" onclick="setProfitFilter('month','all','全部時間')">
        全部時間 ${!_profitRankingMonth ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>
      ${months.map(m => `<div class="picker-item" onclick="setProfitFilter('month','${m}','${m}')">
        ${m} ${_profitRankingMonth===m ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>`).join('')}
    </div>
    <div class="section-label">選擇類別</div>
    <div class="form-card" style="margin:0">
      <div class="picker-item" onclick="setProfitFilter('cat','all','全部類別')">
        全部類別 ${!_profitRankingCategory ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>
      ${productCategories.map(c => `<div class="picker-item" onclick="setProfitFilter('cat','${c}','${c}')">
        ${c} ${_profitRankingCategory===c ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>`).join('')}
    </div>`);
};

window.setProfitFilter = (type, value, label) => {
  if (type === 'month') {
    _profitRankingMonth = value === 'all' ? null : value;
    document.getElementById('profit-ranking-filter-title').textContent = label;
  } else {
    _profitRankingCategory = value === 'all' ? null : value;
    document.getElementById('profit-ranking-filter-sub').textContent = label;
  }
  forceCloseModal();
  renderProfitRanking();
};

window.showPlatformFilter = () => {
  const months = getRecentMonths();
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">篩選平台比較</div>
    <div class="section-label">選擇月份</div>
    <div class="form-card" style="margin:0">
      <div class="picker-item" onclick="setPlatformFilter('all','全部時間')">
        全部時間 ${!_platformMonth ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>
      ${months.map(m => `<div class="picker-item" onclick="setPlatformFilter('${m}','${m}')">
        ${m} ${_platformMonth===m ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>`).join('')}
    </div>`);
};

window.setPlatformFilter = (value, label) => {
  _platformMonth = value === 'all' ? null : value;
  document.getElementById('platform-filter-title').textContent = label;
  forceCloseModal();
  renderPlatformReport();
};

window.showExpenseReportFilter = () => {
  const months = getRecentMonths();
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">篩選支出明細</div>
    <div class="section-label">選擇月份</div>
    <div class="form-card" style="margin-bottom:14px">
      <div class="picker-item" onclick="setExpenseReportFilter('month','all','全部時間')">
        全部時間 ${!_expenseReportMonth ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>
      ${months.map(m => `<div class="picker-item" onclick="setExpenseReportFilter('month','${m}','${m}')">
        ${m} ${_expenseReportMonth===m ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>`).join('')}
    </div>
    <div class="section-label">選擇類別</div>
    <div class="form-card" style="margin:0">
      <div class="picker-item" onclick="setExpenseReportFilter('cat','all','全部類別')">
        全部類別 ${!_expenseReportCategory ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>
      ${expenseCategories.map(c => `<div class="picker-item" onclick="setExpenseReportFilter('cat','${c}','${c}')">
        ${c} ${_expenseReportCategory===c ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
      </div>`).join('')}
    </div>`);
};

window.setExpenseReportFilter = (type, value, label) => {
  if (type === 'month') {
    _expenseReportMonth = value === 'all' ? null : value;
    document.getElementById('expense-report-filter-title').textContent = label;
  } else {
    _expenseReportCategory = value === 'all' ? null : value;
    document.getElementById('expense-report-filter-sub').textContent = label;
  }
  forceCloseModal();
  renderExpenseReport();
};

function getRecentMonths() {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return months;
}

// ==================== SETTINGS ====================
function renderSettings() {
  document.getElementById('setting-company-name-display').textContent = userSettings.companyName || '我的店';
  document.getElementById('setting-sort-display').textContent = getSortLabel(userSettings.sortBy);
  document.getElementById('setting-low-stock-display').textContent = `低於 ${userSettings.lowStockThreshold || 5} 件`;
  document.getElementById('setting-stale-days-display').textContent = `超過 ${userSettings.staleDays || 30} 天`;
  document.getElementById('setting-email-display').textContent = currentUser?.email || '';
  document.getElementById('last-backup-display').textContent = userSettings.lastBackup ? `上次備份：${userSettings.lastBackup}` : '尚未備份';
  const bpEl = document.getElementById('setting-barcode-prefix-display');
  if (bpEl) bpEl.textContent = userSettings.barcodePrefix || 'P';
  const sipEl = document.getElementById('setting-stockin-prefix-display');
  if (sipEl) sipEl.textContent = userSettings.stockInPrefix || 'I';
  const sopEl = document.getElementById('setting-stockout-prefix-display');
  if (sopEl) sopEl.textContent = userSettings.stockOutPrefix || 'O';
  const curEl = document.getElementById('setting-currency-display');
  if (curEl) curEl.textContent = userSettings.currency || '$';
  const toggle = document.getElementById('dark-mode-toggle');
  if (toggle) {
    toggle.classList.toggle('off', !userSettings.darkMode);
  }
}

function getSortLabel(sort) {
  const map = {
    'name-asc': '商品名稱 A→Z', 'name-desc': '商品名稱 Z→A',
    'stock-desc': '庫存量由多到少', 'stock-asc': '庫存量由少到多',
    'price-desc': '售價由高到低', 'price-asc': '售價由低到高',
    'date-desc': '新增日期由新到舊', 'date-asc': '新增日期由舊到新'
  };
  return map[sort] || '商品名稱 A→Z';
}

function applySettings() {
  document.getElementById('shop-name-display').textContent = userSettings.companyName || '我的店';
  if (userSettings.darkMode === false) {
    document.body.classList.add('light');
  } else {
    document.body.classList.remove('light');
  }
  updateShopAvatar();
}

window.toggleDarkMode = () => {
  userSettings.darkMode = !userSettings.darkMode;
  applySettings();
  saveSettings();
  renderSettings();
};

window.editSetting = (key) => {
  const labels = {
    'company-name': '公司名稱',
    'low-stock-threshold': '低庫存預警數量（件）',
    'stale-days': '滯銷天數'
  };
  const values = {
    'company-name': userSettings.companyName,
    'low-stock-threshold': userSettings.lowStockThreshold,
    'stale-days': userSettings.staleDays
  };
  const types = { 'company-name': 'text', 'low-stock-threshold': 'number', 'stale-days': 'number' };

  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">${labels[key]}</div>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <input class="form-input" type="${types[key]}" id="setting-edit-input" value="${values[key]}" style="font-size:18px">
      </div>
    </div>
    <button class="submit-btn" onclick="saveSetting('${key}')">儲存</button>`);
  setTimeout(() => document.getElementById('setting-edit-input')?.focus(), 100);
};

window.saveSetting = async (key) => {
  const val = document.getElementById('setting-edit-input').value;
  if (key === 'company-name') userSettings.companyName = val;
  if (key === 'low-stock-threshold') userSettings.lowStockThreshold = parseInt(val) || 5;
  if (key === 'stale-days') userSettings.staleDays = parseInt(val) || 30;
  await saveSettings();
  applySettings();
  closeModal();
  renderSettings();
};

window.showSortPicker = () => showProductFilter();

window.editPrefixSetting = (type) => {
  const labels = {
    barcode: '商品條碼前綴',
    stockIn: '入庫單號前綴',
    stockOut: '出庫單號前綴'
  };
  const keys = {
    barcode: 'barcodePrefix',
    stockIn: 'stockInPrefix',
    stockOut: 'stockOutPrefix'
  };
  const examples = {
    barcode: '例：P → P1234567890',
    stockIn: '例：I → I20260529-0001',
    stockOut: '例：O → O20260529-0001'
  };
  const key = keys[type];
  const current = userSettings[key] || (type === 'barcode' ? 'P' : type === 'stockIn' ? 'I' : 'O');
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">${labels[type]}</div>
    <p style="color:var(--text4);font-size:13px;text-align:center;margin-bottom:16px">${examples[type]}</p>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <span class="form-label">前綴字母</span>
        <input class="form-input" type="text" id="prefix-input" value="${current}"
          maxlength="3" style="font-size:20px;font-weight:500;color:var(--blue);letter-spacing:2px"
          oninput="this.value=this.value.toUpperCase().replace(/[^A-Z]/g,'')">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="forceCloseModal()">取消</button>
      <button class="submit-btn" onclick="savePrefix('${key}','${type}')">儲存</button>
    </div>`);
  setTimeout(() => {
    const el = document.getElementById('prefix-input');
    if (el) { el.focus(); el.select(); }
  }, 100);
};

window.savePrefix = async (key, type) => {
  const val = document.getElementById('prefix-input')?.value?.trim().toUpperCase();
  if (!val) { showToast('請輸入前綴字母'); return; }
  userSettings[key] = val;
  await saveSettings();
  renderSettings();
  forceCloseModal();
  showToast(`前綴已更新為 ${val}`);
};

window.showCurrencyPicker = () => {
  const currencies = [
    { symbol: '$', label: '$ 美元/台幣' },
    { symbol: 'NT$', label: 'NT$ 新台幣' },
    { symbol: '¥', label: '¥ 日圓' },
    { symbol: '€', label: '€ 歐元' },
    { symbol: '₩', label: '₩ 韓元' },
  ];
  const current = userSettings.currency || '$';
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">選擇貨幣符號</div>
    <div class="form-card" style="margin:0">
      ${currencies.map(c => `
        <div class="picker-item" onclick="saveCurrency('${c.symbol}')">
          <span style="font-size:18px;font-weight:500;color:var(--blue);width:40px">${c.symbol}</span>
          <span style="flex:1">${c.label}</span>
          ${current === c.symbol ? '<i class="ti ti-check" style="color:var(--blue)"></i>' : ''}
        </div>`).join('')}
    </div>`);
};

window.saveCurrency = async (symbol) => {
  userSettings.currency = symbol;
  await saveSettings();
  renderSettings();
  forceCloseModal();
  showToast(`貨幣符號已更新為 ${symbol}`);
};

window.backupData = async () => {
  showToast('備份中...');
  try {
    const backupData = { products, customers, expenses, stockInOrders, stockOutOrders, productCategories, expenseCategories, suppliers };
    await setDoc(doc(db, 'users', getDataUid(), 'backup', 'latest'), {
      data: JSON.stringify(backupData), timestamp: Date.now()
    });
    userSettings.lastBackup = formatDate(new Date());
    await saveSettings();
    renderSettings();
    showToast('備份成功！');
  } catch (e) {
    showToast('備份失敗：' + e.message);
  }
};

window.restoreData = () => {
  showConfirm('確定要從雲端還原資料嗎？目前資料將被覆蓋。', async () => {
    try {
      const snap = await getDoc(doc(db, 'users', getDataUid(), 'backup', 'latest'));
      if (!snap.exists()) { showToast('沒有備份資料'); return; }
      const backup = JSON.parse(snap.data().data);
      products = backup.products || [];
      customers = backup.customers || [];
      expenses = backup.expenses || [];
      stockInOrders = backup.stockInOrders || [];
      stockOutOrders = backup.stockOutOrders || [];
      productCategories = backup.productCategories || [];
      expenseCategories = backup.expenseCategories || expenseCategories;
      suppliers = backup.suppliers || [];
      updateHomePage();
      renderProductList();
      renderCustomerList();
      renderExpenseList();
      showToast('還原成功！');
    } catch (e) {
      showToast('還原失敗：' + e.message);
    }
  });
};

window.importData = () => {
  showToast('匯入功能即將推出');
};

window.exportData = () => {
  const data = { products, customers, expenses, stockInOrders, stockOutOrders };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `wows-inventory-${formatDate(new Date())}.json`;
  a.click();
  showToast('資料已匯出');
};

window.clearAllData = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title" style="color:var(--red)">清除所有資料</div>
    <p style="color:var(--text2);font-size:16px;margin-bottom:16px;text-align:center">請輸入「確認」兩個字以確認清除所有資料，此操作無法復原。</p>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <input class="form-input" type="text" id="clear-confirm-input" placeholder='輸入「確認」' style="font-size:18px">
      </div>
    </div>
    <button class="submit-btn red" onclick="executeClearData()">清除</button>`);
};

window.executeClearData = async () => {
  const input = document.getElementById('clear-confirm-input').value;
  if (input !== '確認') { showToast('請輸入「確認」'); return; }
  closeModal();
  showToast('清除中...');
  try {
    products = []; customers = []; expenses = [];
    stockInOrders = []; stockOutOrders = [];
    updateHomePage();
    renderProductList();
    renderCustomerList();
    showToast('所有資料已清除');
    navigate('home');
  } catch (e) {
    showToast('清除失敗：' + e.message);
  }
};

// ==================== CATEGORY MANAGEMENT ====================
function renderCategoriesManagement() {
  const container = document.getElementById('categories-content');
  if (!container) return;
  container.innerHTML = productCategories.length === 0
    ? `<div class="empty-state"><i class="ti ti-tag"></i><p>沒有商品類別</p></div>`
    : `<div class="form-card" style="margin:14px">
      ${productCategories.map((cat, idx) => {
        const count = products.filter(p => p.category === cat).length;
        return `
          <div class="manage-item">
            <div style="flex:1">
              <div style="color:var(--text2);font-size:17px;font-weight:500">${cat}</div>
              <div style="color:var(--text4);font-size:14px;margin-top:3px">${count} 件商品</div>
            </div>
            <button onclick="editCategoryItem(${idx})" style="background:none;border:none;color:var(--blue);font-size:16px;cursor:pointer;padding:4px 8px"><i class="ti ti-edit"></i></button>
            <button class="manage-item-delete" onclick="deleteCategoryItem(${idx})"><i class="ti ti-trash"></i></button>
          </div>`;
      }).join('')}
    </div>`;
}

window.editCategoryItem = (idx) => {
  const current = productCategories[idx];
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">修改類別名稱</div>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <input class="form-input" type="text" id="edit-cat-input" value="${current}" style="font-size:16px">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="forceCloseModal()">取消</button>
      <button class="submit-btn" onclick="saveEditCategory(${idx})">儲存</button>
    </div>`);
  setTimeout(() => { const el = document.getElementById('edit-cat-input'); if(el){el.focus();el.select();} }, 100);
};

window.saveEditCategory = async (idx) => {
  const newName = document.getElementById('edit-cat-input')?.value?.trim();
  if (!newName) { showToast('請輸入類別名稱'); return; }
  if (productCategories.includes(newName) && newName !== productCategories[idx]) { showToast('類別名稱已存在'); return; }
  const oldName = productCategories[idx];
  productCategories[idx] = newName;
  // Update all products with this category
  for (const p of products) {
    if (p.category === oldName) {
      p.category = newName;
      try { await updateDoc(doc(db, 'users', getDataUid(), 'products', p.id), { category: newName }); } catch(e) {}
    }
  }
  await saveCategories();
  forceCloseModal();
  renderCategoriesManagement();
  showToast(`類別已更新為「${newName}」`);
};

window.addNewCategory = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">新增商品類別</div>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <input class="form-input" type="text" id="new-category-input" placeholder="輸入類別名稱" style="font-size:18px">
      </div>
    </div>
    <button class="submit-btn" onclick="saveNewCategory()">新增</button>`);
  setTimeout(() => document.getElementById('new-category-input')?.focus(), 100);
};

window.saveNewCategory = async () => {
  const name = document.getElementById('new-category-input').value.trim();
  if (!name) { showToast('請輸入類別名稱'); return; }
  if (productCategories.includes(name)) { showToast('類別已存在'); return; }
  productCategories.push(name);
  await saveCategories();
  closeModal();
  renderCategoriesManagement();
  showToast('類別已新增');
};

window.deleteCategoryItem = (idx) => {
  const cat = productCategories[idx];
  const count = products.filter(p => p.category === cat).length;
  if (count > 0) {
    showModal(`<div class="modal-handle"></div>
      <div class="modal-title" style="color:var(--amber)">無法刪除</div>
      <p style="color:var(--text2);font-size:15px;text-align:center;margin-bottom:20px;line-height:1.6">
        「${cat}」類別還有 <span style="color:var(--red);font-weight:500">${count} 件商品</span><br>
        請先將商品移至其他類別或刪除商品後，才能刪除此類別
      </p>
      <button class="submit-btn" onclick="forceCloseModal()">我知道了</button>`);
    return;
  }
  showConfirm(`確定要刪除「${cat}」類別嗎？`, async () => {
    productCategories.splice(idx, 1);
    await saveCategories();
    renderCategoriesManagement();
    showToast('類別已刪除');
  });
};

function renderExpenseCategoriesManagement() {
  const container = document.getElementById('expense-categories-content');
  if (!container) return;
  container.innerHTML = `<div class="form-card" style="margin:14px">
    ${expenseCategories.map((cat, idx) => {
      const count = expenses.filter(e => e.category === cat).length;
      return `
        <div class="manage-item">
          <div style="flex:1">
            <div style="color:var(--text2);font-size:17px;font-weight:500">${cat}</div>
            <div style="color:var(--text4);font-size:14px;margin-top:3px">${count} 筆支出</div>
          </div>
          <button onclick="editExpenseCategoryItem(${idx})" style="background:none;border:none;color:var(--blue);font-size:16px;cursor:pointer;padding:4px 8px"><i class="ti ti-edit"></i></button>
          <button class="manage-item-delete" onclick="deleteExpenseCategoryItem(${idx})"><i class="ti ti-trash"></i></button>
        </div>`;
    }).join('')}
  </div>`;
}

window.editExpenseCategoryItem = (idx) => {
  const current = expenseCategories[idx];
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">修改支出類別</div>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <input class="form-input" type="text" id="edit-exp-cat-input" value="${current}" style="font-size:16px">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="forceCloseModal()">取消</button>
      <button class="submit-btn" onclick="saveEditExpenseCategory(${idx})">儲存</button>
    </div>`);
  setTimeout(() => { const el = document.getElementById('edit-exp-cat-input'); if(el){el.focus();el.select();} }, 100);
};

window.saveEditExpenseCategory = async (idx) => {
  const newName = document.getElementById('edit-exp-cat-input')?.value?.trim();
  if (!newName) { showToast('請輸入類別名稱'); return; }
  const oldName = expenseCategories[idx];
  expenseCategories[idx] = newName;
  for (const e of expenses) {
    if (e.category === oldName) {
      e.category = newName;
      try { await updateDoc(doc(db, 'users', getDataUid(), 'expenses', e.id), { category: newName }); } catch(err) {}
    }
  }
  await saveCategories();
  forceCloseModal();
  renderExpenseCategoriesManagement();
  showToast(`類別已更新為「${newName}」`);
};

window.addNewExpenseCategory = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">新增支出類別</div>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <input class="form-input" type="text" id="new-expense-cat-input" placeholder="輸入類別名稱" style="font-size:18px">
      </div>
    </div>
    <button class="submit-btn" onclick="saveNewExpenseCategory()">新增</button>`);
  setTimeout(() => document.getElementById('new-expense-cat-input')?.focus(), 100);
};

window.saveNewExpenseCategory = async () => {
  const name = document.getElementById('new-expense-cat-input').value.trim();
  if (!name) { showToast('請輸入類別名稱'); return; }
  expenseCategories.push(name);
  await saveCategories();
  closeModal();
  renderExpenseCategoriesManagement();
};

window.deleteExpenseCategoryItem = (idx) => {
  const cat = expenseCategories[idx];
  const count = expenses.filter(e => e.category === cat).length;
  if (count > 0) {
    showModal(`<div class="modal-handle"></div>
      <div class="modal-title" style="color:var(--amber)">無法刪除</div>
      <p style="color:var(--text2);font-size:15px;text-align:center;margin-bottom:20px;line-height:1.6">
        「${cat}」還有 <span style="color:var(--red);font-weight:500">${count} 筆支出紀錄</span><br>
        請先將支出移至其他類別或刪除紀錄後，才能刪除此類別
      </p>
      <button class="submit-btn" onclick="forceCloseModal()">我知道了</button>`);
    return;
  }
  showConfirm(`確定要刪除「${cat}」嗎？`, async () => {
    expenseCategories.splice(idx, 1);
    await saveCategories();
    renderExpenseCategoriesManagement();
    showToast('類別已刪除');
  });
};

function renderSuppliersManagement() {
  const container = document.getElementById('suppliers-content');
  if (!container) return;
  container.innerHTML = suppliers.length === 0
    ? `<div class="empty-state"><i class="ti ti-building-store"></i><p>沒有供應商</p></div>`
    : `<div class="form-card" style="margin:14px">
      ${suppliers.map((s, idx) => `
        <div class="manage-item">
          <div style="flex:1"><div style="color:var(--text2);font-size:17px;font-weight:500">${s.name}</div></div>
          <button class="manage-item-delete" onclick="deleteSupplierItem(${idx})"><i class="ti ti-trash"></i></button>
        </div>`).join('')}
    </div>`;
}

window.addNewSupplier = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">新增供應商</div>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <input class="form-input" type="text" id="new-supplier-input" placeholder="輸入供應商名稱" style="font-size:18px">
      </div>
    </div>
    <button class="submit-btn" onclick="saveNewSupplier()">新增</button>`);
  setTimeout(() => document.getElementById('new-supplier-input')?.focus(), 100);
};

window.saveNewSupplier = async () => {
  const name = document.getElementById('new-supplier-input').value.trim();
  if (!name) { showToast('請輸入供應商名稱'); return; }
  suppliers.push({ id: Date.now().toString(), name });
  await saveCategories();
  closeModal();
  renderSuppliersManagement();
};

window.deleteSupplierItem = (idx) => {
  showConfirm(`確定要刪除「${suppliers[idx].name}」嗎？`, async () => {
    suppliers.splice(idx, 1);
    await saveCategories();
    renderSuppliersManagement();
  });
};

// ==================== PICKERS ====================
function showProductPicker(callback) {
  const sorted = sortProducts(products);
  const allCats = ['全部', ...productCategories];
  window._pickerCallback = callback;
  window._pickerProducts = sorted;
  window._pickerCategory = '全部';
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">選擇商品</div>
    <div class="search-bar" style="margin-bottom:8px">
      <i class="ti ti-search"></i>
      <input type="text" placeholder="搜尋商品" id="picker-search"
        oninput="filterPickerProducts()" style="background:none;border:none;outline:none;color:var(--text2);font-size:17px;flex:1;width:100%">
    </div>
    <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:10px;padding-bottom:2px;scrollbar-width:none">
      ${allCats.map(c => `<div onclick="pickerSelectCat('${c}')" id="picker-cat-${c.replace(/\s/g,'_')}"
        style="background:${c==='全部'?'var(--blue)':'var(--bg2)'};border:0.5px solid ${c==='全部'?'var(--blue)':'var(--border)'};
        border-radius:20px;padding:6px 14px;color:${c==='全部'?'white':'var(--text3)'};
        font-size:13px;white-space:nowrap;flex-shrink:0;cursor:pointer">${c}</div>`).join('')}
    </div>
    <div id="picker-product-list">
      ${renderPickerList(sorted, callback)}
    </div>`);
}

window.pickerSelectCat = (cat) => {
  window._pickerCategory = cat;
  // Update tab styles
  ['全部', ...productCategories].forEach(c => {
    const el = document.getElementById('picker-cat-' + c.replace(/\s/g,'_'));
    if (!el) return;
    el.style.background = c === cat ? 'var(--blue)' : 'var(--bg2)';
    el.style.borderColor = c === cat ? 'var(--blue)' : 'var(--border)';
    el.style.color = c === cat ? 'white' : 'var(--text3)';
  });
  filterPickerProducts();
};

window.filterPickerProducts = () => {
  const search = document.getElementById('picker-search')?.value?.toLowerCase() || '';
  const cat = window._pickerCategory || '全部';
  const filtered = (window._pickerProducts || products).filter(p => {
    const matchSearch = !search || p.name?.toLowerCase().includes(search) || p.model?.toLowerCase().includes(search);
    const matchCat = cat === '全部' || p.category === cat;
    return matchSearch && matchCat;
  });
  document.getElementById('picker-product-list').innerHTML = renderPickerList(filtered, window._pickerCallback);
};

function renderPickerList(prods, callback) {
  if (prods.length === 0) return '<div class="empty-state" style="padding:20px 0"><i class="ti ti-box" style="font-size:40px;display:block;margin-bottom:8px;color:var(--text4)"></i><p style="color:var(--text4)">沒有符合的商品</p></div>';
  return prods.map(p => `
    <div class="picker-item" onclick="selectPickerProduct('${p.id}')">
      <div class="product-thumb" style="width:50px;height:50px;flex-shrink:0">
        ${p.imageUrl ? `<img src="${p.imageUrl}">` : `<i class="ti ti-photo"></i>`}
      </div>
      <div style="flex:1">
        <div style="color:var(--text2);font-size:16px;font-weight:500">${p.name}</div>
        <div style="color:var(--text4);font-size:13px;margin-top:2px">${p.model || ''} ･ 庫存: <span style="color:${p.stock===0?'var(--red)':p.stock<=5?'var(--amber)':'var(--green)'}">${p.stock}</span></div>
      </div>
      <div style="color:var(--blue);font-size:14px;font-weight:500">$${p.price||0}</div>
    </div>`).join('');
}

window.selectPickerProduct = (productId) => {
  const p = products.find(x => x.id === productId);
  if (p && window._pickerCallback) {
    window._pickerCallback(p);
    closeModal();
  }
};

function showCategoryPicker(type) {
  const cats = productCategories;
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">選擇類別</div>
    ${cats.map(c => `
      <div class="picker-item" onclick="selectCategoryForProduct('${c}')">
        ${c}
      </div>`).join('')}
    <div class="picker-item" style="color:var(--blue)" onclick="addCategoryFromPicker()">
      <i class="ti ti-plus"></i> 新增類別
    </div>`);
}

window.showCategoryPicker = showCategoryPicker;

window.selectCategoryForProduct = (cat) => {
  document.getElementById('product-category-display').textContent = cat;
  document.getElementById('product-category-display').dataset.value = cat;
  closeModal();
};

window.addCategoryFromPicker = () => {
  closeModal();
  setTimeout(() => {
    showModal(`<div class="modal-handle"></div>
      <div class="modal-title">新增商品類別</div>
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-row" style="border-bottom:none">
          <input class="form-input" type="text" id="new-cat-picker-input" placeholder="輸入類別名稱" style="font-size:18px">
        </div>
      </div>
      <button class="submit-btn" onclick="saveCategoryFromPicker()">新增並選擇</button>`);
    setTimeout(() => document.getElementById('new-cat-picker-input')?.focus(), 100);
  }, 300);
};

window.saveCategoryFromPicker = async () => {
  const name = document.getElementById('new-cat-picker-input').value.trim();
  if (!name) return;
  if (!productCategories.includes(name)) {
    productCategories.push(name);
    await saveCategories();
  }
  document.getElementById('product-category-display').textContent = name;
  document.getElementById('product-category-display').dataset.value = name;
  closeModal();
};

function showSupplierPickerModal(callback) {
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">選擇供應商</div>
    ${suppliers.map(s => `
      <div class="picker-item" onclick="selectSupplier('${s.id}','${s.name}')">
        ${s.name}
      </div>`).join('')}
    <div class="picker-item" style="color:var(--blue)" onclick="addSupplierFromPicker()">
      <i class="ti ti-plus"></i> 新增供應商
    </div>`);
  window._supplierCallback = callback;
}

window.showSupplierPicker = () => showSupplierPickerModal((s) => {
  document.getElementById('product-supplier-display').textContent = s.name;
  document.getElementById('product-supplier-display').dataset.value = s.id;
});

window.selectSupplier = (id, name) => {
  if (window._supplierCallback) window._supplierCallback({ id, name });
  closeModal();
};

window.addSupplierFromPicker = () => {
  closeModal();
  setTimeout(() => {
    showModal(`<div class="modal-handle"></div>
      <div class="modal-title">新增供應商</div>
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-row" style="border-bottom:none">
          <input class="form-input" type="text" id="new-supplier-picker-input" placeholder="輸入供應商名稱" style="font-size:18px">
        </div>
      </div>
      <button class="submit-btn" onclick="saveSupplierFromPicker()">新增並選擇</button>`);
    setTimeout(() => document.getElementById('new-supplier-picker-input')?.focus(), 100);
  }, 300);
};

window.saveSupplierFromPicker = async () => {
  const name = document.getElementById('new-supplier-picker-input').value.trim();
  if (!name) return;
  const newSupplier = { id: Date.now().toString(), name };
  suppliers.push(newSupplier);
  await saveCategories();
  if (window._supplierCallback) window._supplierCallback(newSupplier);
  closeModal();
};

function showCustomerPickerModal(callback) {
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">選擇客戶</div>
    ${customers.length === 0
      ? '<div class="empty-state" style="padding:20px 0"><i class="ti ti-users" style="font-size:40px;display:block;margin-bottom:8px;color:var(--text4)"></i><p style="color:var(--text4)">還沒有客戶</p></div>'
      : customers.map(c => `
        <div class="picker-item" onclick="selectCustomerFromPicker('${c.id}','${c.name}')">
          ${c.name}
        </div>`).join('')}
    <div class="picker-item" style="color:var(--blue)" onclick="forceCloseModal();navigate('add-customer')">
      <i class="ti ti-plus"></i> 新增客戶
    </div>`);
  window._customerCallback = callback;
}

window.selectCustomerFromPicker = (id, name) => {
  if (window._customerCallback) window._customerCallback({ id, name });
  closeModal();
};

window.showExpenseCategoryPicker = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">選擇支出類別</div>
    ${expenseCategories.map(c => `
      <div class="picker-item" onclick="selectExpenseCategory('${c}')">
        ${c}
      </div>`).join('')}
    <div class="picker-item" style="color:var(--blue)" onclick="addExpenseCategoryFromPicker()">
      <i class="ti ti-plus"></i> 新增類別
    </div>`);
};

window.selectExpenseCategory = (cat) => {
  document.getElementById('expense-category-display').textContent = cat;
  document.getElementById('expense-category-display').dataset.value = cat;
  closeModal();
};

window.addExpenseCategoryFromPicker = () => {
  closeModal();
  setTimeout(() => {
    showModal(`<div class="modal-handle"></div>
      <div class="modal-title">新增支出類別</div>
      <div class="form-card" style="margin-bottom:16px">
        <div class="form-row" style="border-bottom:none">
          <input class="form-input" type="text" id="new-exp-cat-picker" placeholder="輸入類別名稱" style="font-size:18px">
        </div>
      </div>
      <button class="submit-btn" onclick="saveExpenseCategoryFromPicker()">新增並選擇</button>`);
    setTimeout(() => document.getElementById('new-exp-cat-picker')?.focus(), 100);
  }, 300);
};

window.saveExpenseCategoryFromPicker = async () => {
  const name = document.getElementById('new-exp-cat-picker').value.trim();
  if (!name) return;
  expenseCategories.push(name);
  await saveCategories();
  document.getElementById('expense-category-display').textContent = name;
  document.getElementById('expense-category-display').dataset.value = name;
  closeModal();
};

// ==================== DATE PICKER ====================
window.showDatePicker = (targetId) => {
  datePickerTarget = targetId;
  const current = document.getElementById(`${targetId}-display`)?.dataset?.value
    ? new Date(document.getElementById(`${targetId}-display`).dataset.value)
    : new Date();
  const year = current.getFullYear();
  const month = current.getMonth();
  const day = current.getDate();

  const years = Array.from({length: 10}, (_, i) => year - 5 + i);
  const months = Array.from({length: 12}, (_, i) => i + 1);
  const days = Array.from({length: 31}, (_, i) => i + 1);

  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">選擇日期</div>
    <div class="date-picker-selects">
      <select id="dp-year" style="flex:1.5">
        ${years.map(y => `<option value="${y}" ${y===year?'selected':''}>${y}年</option>`).join('')}
      </select>
      <select id="dp-month">
        ${months.map(m => `<option value="${m}" ${m===month+1?'selected':''}>${m}月</option>`).join('')}
      </select>
      <select id="dp-day">
        ${days.map(d => `<option value="${d}" ${d===day?'selected':''}>${d}日</option>`).join('')}
      </select>
    </div>
    <button class="submit-btn" onclick="confirmDatePicker()">確認</button>`);
};

window.confirmDatePicker = () => {
  const y = document.getElementById('dp-year').value;
  const m = String(document.getElementById('dp-month').value).padStart(2,'0');
  const d = String(document.getElementById('dp-day').value).padStart(2,'0');
  const dateStr = `${y}-${m}-${d}`;
  setDateDisplay(datePickerTarget, new Date(dateStr));
  closeModal();
};

function setDateDisplay(targetId, date) {
  const el = document.getElementById(`${targetId}-display`);
  if (!el) return;
  el.textContent = formatDate(date);
  el.dataset.value = formatDate(date);
}

// ==================== BARCODE SCANNER ====================
window.startBarcodeScan = async (target) => {
  currentBarcodeTarget = target;
  const scanner = document.getElementById('barcode-scanner');
  scanner.style.display = 'flex';
  try {
    barcodeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    document.getElementById('scanner-video').srcObject = barcodeStream;
    startScanning();
  } catch (e) {
    showToast('無法開啟相機');
    scanner.style.display = 'none';
  }
};

function startScanning() {
  const video = document.getElementById('scanner-video');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let scanning = true;

  const scan = () => {
    if (!scanning || !barcodeStream) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      // Simple barcode detection placeholder
      // In production, use a library like ZXing or QuaggaJS
    }
    requestAnimationFrame(scan);
  };
  scan();

  // Manual barcode input as fallback
  setTimeout(() => {
    if (document.getElementById('barcode-scanner').style.display !== 'none') {
      closeBarcodeScan();
      showModal(`<div class="modal-handle"></div>
        <div class="modal-title">輸入條碼</div>
        <div class="form-card" style="margin-bottom:16px">
          <div class="form-row" style="border-bottom:none">
            <input class="form-input" type="text" id="manual-barcode-input" placeholder="輸入條碼號碼" style="font-size:18px">
          </div>
        </div>
        <button class="submit-btn" onclick="submitManualBarcode()">確認</button>`);
      setTimeout(() => document.getElementById('manual-barcode-input')?.focus(), 100);
    }
  }, 3000);
}

window.closeBarcodeScan = () => {
  document.getElementById('barcode-scanner').style.display = 'none';
  if (barcodeStream) {
    barcodeStream.getTracks().forEach(t => t.stop());
    barcodeStream = null;
  }
};

window.submitManualBarcode = () => {
  const barcode = document.getElementById('manual-barcode-input').value.trim();
  if (!barcode) return;
  const p = products.find(x => x.barcode === barcode);
  if (!p) { showToast('找不到此條碼對應的商品'); closeModal(); return; }
  closeModal();
  if (currentBarcodeTarget === 'stock-in') addProductToStockIn(p.id);
  if (currentBarcodeTarget === 'stock-out') addProductToStockOut(p.id);
};

// ==================== NOTIFICATIONS ====================
function getNotifications() {
  const list = [];
  const lowStock = products.filter(p => p.stock !== undefined && p.stock >= 0 && p.stock <= userSettings.lowStockThreshold);
  if (lowStock.length > 0) list.push({ icon: 'ti ti-alert-triangle', color: 'var(--amber)', text: `${lowStock.length} 件商品庫存偏低`, action: 'showLowStockList()' });
  const staleDays = userSettings.staleDays || 30;
  const stale = products.filter(p => {
    if (p.stock <= 0) return false;
    const baseDate = p.lastOutDate ? new Date(p.lastOutDate) : new Date(p.createdAt || Date.now());
    return ((Date.now() - baseDate) / (1000*60*60*24)) > staleDays;
  });
  if (stale.length > 0) list.push({ icon: 'ti ti-clock', color: 'var(--blue)', text: `${stale.length} 件商品超過${staleDays}天未出庫`, action: 'showStaleStockList()' });
  if (userSettings.lastBackup) {
    const daysSince = (Date.now() - new Date(userSettings.lastBackup)) / (1000*60*60*24);
    if (daysSince > 7) list.push({ icon: 'ti ti-cloud-upload', color: 'var(--purple)', text: '距離上次備份已超過7天', action: 'backupData()' });
  }
  return list;
}

window.showNotifications = () => {
  const notifications = getNotifications();
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">通知</div>
    ${notifications.length === 0
      ? '<div class="empty-state" style="padding:30px 0"><i class="ti ti-bell-off" style="font-size:48px;margin-bottom:12px;display:block;color:var(--text4)"></i><p style="color:var(--text4)">目前沒有通知</p></div>'
      : notifications.map(n => `
        <div class="alert-item" style="background:var(--bg3);border-color:var(--border);margin-bottom:8px;cursor:pointer" onclick="forceCloseModal();${n.action}">
          <i class="${n.icon}" style="color:${n.color};font-size:20px"></i>
          <span style="color:var(--text2);flex:1">${n.text}</span>
          <i class="ti ti-chevron-right" style="color:var(--text4)"></i>
        </div>`).join('')}
    <button class="submit-btn" style="margin-top:12px;background:var(--bg3);color:var(--text2);border:0.5px solid var(--border)" onclick="dismissNotifications()">已閱讀，清除紅點 24小時</button>
    <button class="submit-btn" style="margin-top:8px" onclick="forceCloseModal()">關閉</button>`);
};



window.dismissNotifications = () => {
  userSettings.notificationDismissed = Date.now();
  saveSettings();
  document.getElementById('notification-badge').style.display = 'none';
  forceCloseModal();
  showToast('已清除紅點，24小時內不再提醒');
};


function checkBackupReminder() {
  if (userSettings.notificationDismissed) {
    const hoursSince = (Date.now() - userSettings.notificationDismissed) / (1000*60*60);
    if (hoursSince < 24) {
      document.getElementById('notification-badge').style.display = 'none';
      return;
    }
  }
  const hasNotif = getNotifications().length > 0;
  document.getElementById('notification-badge').style.display = hasNotif ? 'block' : 'none';
}

// ==================== MODAL ====================
function showModal(html) {
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('active');
}

window.closeModal = (event) => {
  if (!event || event.target === document.getElementById('modal-overlay') || event === true) {
    document.getElementById('modal-overlay').classList.remove('active');
  }
};

window.forceCloseModal = () => {
  document.getElementById('modal-overlay').classList.remove('active');
};

function showConfirm(message, onConfirm) {
  showModal(`<div class="modal-handle"></div>
    <div class="confirm-dialog">
      <p>${message}</p>
      <div class="confirm-btns">
        <button class="btn-cancel" onclick="forceCloseModal()">取消</button>
        <button class="btn-confirm" id="confirm-yes-btn">確定</button>
      </div>
    </div>`);
  document.getElementById('confirm-yes-btn').onclick = () => {
    forceCloseModal();
    onConfirm();
  };
}

// ==================== TOAST ====================
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

window.deleteStockInOrder = (orderId) => {
  showConfirm('確定要刪除此入庫單嗎？庫存將會扣回。', async () => {
    const o = stockInOrders.find(x => x.id === orderId);
    if (!o) return;
    for (const item of o.items || []) {
      const p = products.find(x => x.id === item.productId);
      if (p) {
        const newStock = Math.max(0, (p.stock || 0) - item.qty);
        await updateDoc(doc(db, 'users', getDataUid(), 'products', p.id), { stock: newStock });
        p.stock = newStock;
      }
    }
    await deleteDoc(doc(db, 'users', getDataUid(), 'stockIn', orderId));
    stockInOrders = stockInOrders.filter(x => x.id !== orderId);
    navigate('report-stock-in');
    showToast('入庫單已刪除');
  });
};

// ==================== AUTHORIZED ACCOUNTS ====================
let authorizedAccounts = []; // list of {email, addedAt}
let _ownerUid = null; // the actual data owner's UID

async function checkAuthorization() {
  if (!currentUser) return null;
  const uid = currentUser.uid;
  const email = currentUser.email.toLowerCase();

  console.log('checkAuthorization for:', email, uid);

  // Check simultaneously: own data + authorized access
  const [ownSnap, authSnap] = await Promise.allSettled([
    getDoc(doc(db, 'users', uid, 'settings', 'main')),
    getDocs(collection(db, 'authorizedAccess'))
  ]);

  console.log('authSnap status:', authSnap.status);
  if (authSnap.status === 'fulfilled') {
    console.log('authorizedAccess docs:', authSnap.value.docs.length);
    for (const d of authSnap.value.docs) {
      const data = d.data();
      console.log('checking doc:', d.id, 'emails:', data.authorizedEmails);
      const emails = (data.authorizedEmails || []).map(e => e.toLowerCase());
      if (emails.includes(email) && d.id !== uid) {
        _ownerUid = d.id;
        console.log('✅ Authorized! Using owner UID:', d.id);
        showToast('以協作者身份登入');
        return d.id;
      }
    }
  }

  console.log('Using own UID:', uid);
  _ownerUid = uid;
  return uid;
}

function getDataUid() {
  return _ownerUid || currentUser?.uid;
}

window.showAuthorizedAccounts = async () => {
  await loadAuthorizedAccounts();
  renderAuthorizedAccountsModal();
};

async function loadAuthorizedAccounts() {
  try {
    const uid = getDataUid();
    console.log('loadAuthorizedAccounts for uid:', uid);
    const snap = await getDoc(doc(db, 'authorizedAccess', uid));
    console.log('snap exists:', snap.exists(), 'data:', snap.data());
    if (snap.exists()) {
      authorizedAccounts = snap.data().authorizedEmails || [];
    } else {
      authorizedAccounts = [];
    }
    console.log('authorizedAccounts loaded:', authorizedAccounts);
  } catch(e) {
    console.error('loadAuthorizedAccounts error:', e);
    authorizedAccounts = [];
  }
}

function renderAuthorizedAccountsModal() {
  const isOwner = _ownerUid === currentUser?.uid;
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">授權帳號管理</div>
    ${!isOwner ? `<div style="background:#1a2818;border:0.5px solid #2a5838;border-radius:10px;padding:12px;margin-bottom:16px;color:var(--green);font-size:14px;text-align:center">
      你正在以協作者身份存取此帳號的資料
    </div>` : ''}
    <p style="color:var(--text4);font-size:14px;margin-bottom:16px;line-height:1.6">
      輸入對方的 Google 帳號 email，對方登入後即可看到你的資料。
    </p>
    <div class="form-card" style="margin-bottom:16px">
      <div class="form-row" style="border-bottom:none">
        <input class="form-input" type="email" id="new-auth-email"
          placeholder="輸入 Google email" style="font-size:16px">
        <button onclick="addAuthorizedAccount()" style="background:var(--blue);color:white;border:none;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer;flex-shrink:0">新增</button>
      </div>
    </div>
    ${authorizedAccounts.length > 0 ? `
      <div class="section-label">已授權帳號（${authorizedAccounts.length}個）</div>
      <div class="form-card" style="margin:0 0 16px">
        ${authorizedAccounts.map((email, idx) => `
          <div class="form-row" style="${idx === authorizedAccounts.length-1 ? 'border-bottom:none' : ''}">
            <div style="flex:1">
              <div style="color:var(--text2);font-size:15px">${email}</div>
            </div>
            <button onclick="removeAuthorizedAccount('${email}')"
              style="background:none;border:none;color:var(--red);font-size:18px;cursor:pointer;padding:4px">
              <i class="ti ti-trash"></i>
            </button>
          </div>`).join('')}
      </div>` : `
      <div class="empty-state" style="padding:20px 0">
        <i class="ti ti-users" style="font-size:36px;display:block;margin-bottom:8px;color:var(--text4)"></i>
        <p style="color:var(--text4)">還沒有授權任何帳號</p>
      </div>`}
    <button class="submit-btn" style="background:var(--bg2);border:0.5px solid var(--border);color:var(--text2)" onclick="forceCloseModal()">關閉</button>`);
}

window.addAuthorizedAccount = async () => {
  const email = document.getElementById('new-auth-email')?.value?.trim().toLowerCase();
  if (!email || !email.includes('@')) { showToast('請輸入有效的 email'); return; }
  if (email === currentUser.email.toLowerCase()) { showToast('不能授權自己的帳號'); return; }
  if (authorizedAccounts.includes(email)) { showToast('此帳號已授權'); return; }

  authorizedAccounts.push(email);
  await saveAuthorizedAccounts();
  updateAuthorizedCount();
  renderAuthorizedAccountsModal();
  showToast(`已授權 ${email}`);
};

window.removeAuthorizedAccount = async (email) => {
  showConfirm(`確定要移除 ${email} 的存取權限嗎？`, async () => {
    authorizedAccounts = authorizedAccounts.filter(e => e !== email);
    await saveAuthorizedAccounts();
    updateAuthorizedCount();
    renderAuthorizedAccountsModal();
    showToast('已移除授權');
  });
};

async function saveAuthorizedAccounts() {
  try {
    await setDoc(doc(db, 'authorizedAccess', getDataUid()), {
      authorizedEmails: authorizedAccounts,
      ownerEmail: currentUser.email,
      updatedAt: Date.now()
    });
  } catch(e) { showToast('儲存失敗：' + e.message); }
}

function updateAuthorizedCount() {
  const el = document.getElementById('authorized-accounts-count');
  if (el) {
    el.textContent = authorizedAccounts.length > 0
      ? `已授權 ${authorizedAccounts.length} 個帳號`
      : '允許其他人存取你的資料';
  }
}

// ==================== UTILS ====================
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
