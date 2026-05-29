import { db, auth, storage, googleProvider } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, onSnapshot, updateDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  signInWithPopup, signOut, onAuthStateChanged
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
  lastBackup: null
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
  document.getElementById('google-login-btn').addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      showToast('登入失敗：' + e.message);
    }
  });

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
  // Make avatar clickable
  document.getElementById('shop-avatar-img').onclick = () => showShopAvatarOptions();
  document.getElementById('shop-avatar-img').style.cursor = 'pointer';
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

window.logout = async () => {
  showConfirm('確定要登出嗎？', async () => {
    await signOut(auth);
    showLoginScreen();
  });
};

// ==================== DATA LOADING ====================
async function loadAllData() {
  if (!currentUser) return;
  const uid = currentUser.uid;

  // Load settings
  try {
    const settingsDoc = await getDoc(doc(db, 'users', uid, 'settings', 'main'));
    if (settingsDoc.exists()) {
      userSettings = { ...userSettings, ...settingsDoc.data() };
      applySettings();
    }
  } catch (e) { console.log('Settings load error:', e); }

  // Load products
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'products'));
    products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.log('Products load error:', e); }

  // Load customers
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'customers'));
    customers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.log('Customers load error:', e); }

  // Load expenses
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'expenses'));
    expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.log('Expenses load error:', e); }

  // Load stock in orders
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'stockIn'));
    stockInOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.log('StockIn load error:', e); }

  // Load stock out orders
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'stockOut'));
    stockOutOrders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.log('StockOut load error:', e); }

  // Load categories
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'categories'));
    if (snap.exists()) {
      productCategories = snap.data().product || [];
      expenseCategories = snap.data().expense || expenseCategories;
      suppliers = snap.data().suppliers || [];
    }
  } catch (e) { console.log('Categories load error:', e); }

  updateHomePage();
  renderProductList();
  renderCustomerList();
  renderExpenseList();
  checkBackupReminder();
}

async function saveSettings() {
  if (!currentUser) return;
  await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'main'), userSettings);
}

async function saveCategories() {
  if (!currentUser) return;
  await setDoc(doc(db, 'users', currentUser.uid, 'settings', 'categories'), {
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
  if (page === 'customers') renderCustomerList();
  if (page === 'expenses') renderExpenseList();
  if (page === 'reports') renderReports();
  if (page === 'report-stock-out') renderReportStockOut();
  if (page === 'report-stock-in') renderReportStockIn();
  if (page === 'report-profit-ranking') renderProfitRanking();
  if (page === 'report-platform') renderPlatformReport();
  if (page === 'report-expenses') renderExpenseReport();
  if (page === 'settings') renderSettings();
  if (page === 'manage-categories') renderCategoriesManagement();
  if (page === 'manage-expense-categories') renderExpenseCategoriesManagement();
  if (page === 'manage-suppliers') renderSuppliersManagement();
  if (page === 'add-product' && !editingProductId) initAddProduct();
  if (page === 'add-customer') initAddCustomer();
  if (page === 'add-expense') initAddExpense();
  if (page === 'stock-in') initStockIn();
  if (page === 'stock-out') initStockOut();
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
  const totalInventoryValue = products.reduce((sum, p) => sum + ((p.cost || 0) * (p.stock || 0)), 0);

  // Month out count
  const monthOutCount = stockOutOrders.filter(o => o.date && o.date.startsWith(thisMonth)).length;

  document.getElementById('today-in').textContent = `$${todayIn.toLocaleString()}`;
  document.getElementById('today-out').textContent = `$${todayOut.toLocaleString()}`;
  document.getElementById('month-profit').textContent = `$${monthProfit.toLocaleString()}`;
  document.getElementById('total-inventory-value').textContent = `$${totalInventoryValue.toLocaleString()}`;
  document.getElementById('month-out-count').textContent = `${monthOutCount} 筆`;
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
        <div class="alert-list-item" onclick="closeModal();showProductDetail('${p.id}')">
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
        <div class="alert-list-item" onclick="closeModal();showProductDetail('${p.id}')">
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
  document.getElementById('product-supplier-display').textContent = '請選擇供應商';
  document.getElementById('product-supplier-display').dataset.value = '';
  document.getElementById('product-notes').value = '';
  document.getElementById('product-img-preview').style.display = 'none';
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
    // Save original for download later
    document.getElementById('product-img-upload').dataset.originalData = original;
    // Compress for display
    compressImage(original, 800, 0.75, (compressed) => {
      document.getElementById('product-img-upload').dataset.imageData = compressed;
      document.getElementById('product-img-upload').style.display = 'none';
      document.getElementById('product-img-preview').src = compressed;
      document.getElementById('product-img-preview').style.display = 'block';
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
    supplierName: document.getElementById('product-supplier-display').textContent,
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

  // Save images as base64 directly in Firestore (avoids CORS issues)
  const imageData = document.getElementById('product-img-upload').dataset.imageData;
  const originalData = document.getElementById('product-img-upload').dataset.originalData;
  if (imageData) {
    productData.imageUrl = imageData; // compressed base64
    if (originalData) {
      productData.imageOriginalUrl = originalData; // original base64
    }
  }

  try {
    if (editingProductId) {
      await updateDoc(doc(db, 'users', currentUser.uid, 'products', editingProductId), productData);
      const idx = products.findIndex(p => p.id === editingProductId);
      if (idx > -1) products[idx] = { id: editingProductId, ...products[idx], ...productData };
      showToast('商品已更新！');
    } else {
      const docRef = await addDoc(collection(db, 'users', currentUser.uid, 'products'), productData);
      products.push({ id: docRef.id, ...productData });
      if (category && !productCategories.includes(category)) {
        productCategories.push(category);
        await saveCategories();
      }
      showToast('商品已新增！');
    }
    navigate('products');
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
  return 'P' + Date.now().toString().slice(-10);
}

// ==================== PRODUCT DETAIL ====================
window.showProductDetail = (productId) => {
  currentProductDetailId = productId;
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
          <span class="form-label">進價</span>
          <span class="form-input">$${(p.cost || 0).toLocaleString()}</span>
        </div>
        <div class="form-row">
          <span class="form-label">實際成本</span>
          <span class="form-input">$${(p.avgCost || p.cost || 0).toLocaleString()}</span>
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
        <button class="action-btn edit" onclick="editProduct('${p.id}')">✏️ 編輯</button>
        <button class="action-btn in" onclick="quickStockIn('${p.id}')">📦 入庫</button>
        <button class="action-btn out" onclick="quickStockOut('${p.id}')">🚚 出庫</button>
      </div>
      <div style="height:20px"></div>
    </div>`;

  navigate('product-detail');
};

window.editProduct = (productId) => {
  editingProductId = productId;
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
  document.getElementById('product-supplier-display').textContent = p.supplierName || '請選擇供應商';
  document.getElementById('product-supplier-display').dataset.value = p.supplierId || '';
  document.getElementById('product-notes').value = p.notes || '';

  if (p.imageUrl) {
    document.getElementById('product-img-upload').style.display = 'none';
    document.getElementById('product-img-preview').src = p.imageUrl;
    document.getElementById('product-img-preview').style.display = 'block';
  } else {
    document.getElementById('product-img-preview').style.display = 'none';
    document.getElementById('product-img-upload').style.display = 'flex';
  }
  document.getElementById('product-img-upload').dataset.imageData = '';

  navigate('add-product');
};

window.showProductDetailMenu = () => {
  showModal(`<div class="modal-handle"></div>
    <div class="picker-item" onclick="closeModal();editProduct('${currentProductDetailId}')"><i class="ti ti-edit"></i> 編輯商品</div>
    <div class="picker-item" style="color:var(--red)" onclick="closeModal();deleteProduct('${currentProductDetailId}')"><i class="ti ti-trash"></i> 刪除商品</div>`);
};

window.deleteProduct = (productId) => {
  showConfirm('確定要刪除這個商品嗎？此操作無法復原。', async () => {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'products', productId));
    products = products.filter(p => p.id !== productId);
    navigate('products');
    showToast('商品已刪除');
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
    drawBarcode('barcode-canvas', barcode);
  }, 100);
};

function drawBarcode(canvasId, barcode) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = 300;
  canvas.height = 80;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 300, 80);
  ctx.fillStyle = 'black';
  const barWidth = 2;
  let x = 10;
  for (let i = 0; i < barcode.length; i++) {
    const charCode = barcode.charCodeAt(i);
    for (let b = 0; b < 8; b++) {
      if ((charCode >> b) & 1) {
        ctx.fillRect(x, 5, barWidth, 60);
      }
      x += barWidth + 1;
    }
  }
}

window.downloadOriginalImage = (url, name) => {
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}_原圖.jpg`;
  a.target = '_blank';
  a.click();
  showToast('原圖下載中...');
};

window.saveBarcodeImage = () => {
  const canvas = document.getElementById('barcode-canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  link.download = 'barcode.png';
  link.href = canvas.toDataURL();
  link.click();
  showToast('條碼圖片已儲存');
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
  document.getElementById('stock-in-supplier-display').textContent = '請選擇供應商';
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
  const date = document.getElementById('stock-in-date-display').dataset.value;
  const notes = document.getElementById('stock-in-notes').value;
  const shipping = parseFloat(document.getElementById('stock-in-shipping').value) || 0;
  const totalCost = stockInItems.reduce((sum, i) => sum + (i.qty * i.cost), 0);

  // Calculate shipping per item based on cost ratio
  const orderItems = stockInItems.map(item => {
    const itemTotalCost = item.qty * item.cost;
    const shippingForItem = totalCost > 0 ? (itemTotalCost / totalCost) * shipping : 0;
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
    const docRef = await addDoc(collection(db, 'users', currentUser.uid, 'stockIn'), orderData);
    stockInOrders.push({ id: docRef.id, ...orderData });

    // Update product stock and avg cost
    for (const item of orderItems) {
      const p = products.find(x => x.id === item.productId);
      if (p) {
        const newStock = (p.stock || 0) + item.qty;
        const oldTotalCost = (p.avgCost || p.cost || 0) * (p.stock || 0);
        const newTotalCost = oldTotalCost + (item.actualCost * item.qty);
        const newAvgCost = newStock > 0 ? newTotalCost / newStock : item.actualCost;
        await updateDoc(doc(db, 'users', currentUser.uid, 'products', p.id), {
          stock: newStock, avgCost: parseFloat(newAvgCost.toFixed(2))
        });
        p.stock = newStock;
        p.avgCost = parseFloat(newAvgCost.toFixed(2));
      }
    }

    showToast(`入庫成功！單號：${orderNum}`);
    navigate('home');
  } catch (e) {
    showToast('入庫失敗：' + e.message);
  }
};

// ==================== STOCK OUT ====================
function initStockOut() {
  stockOutItems = [];
  stockOutCustomerId = null;
  document.getElementById('stock-out-customer-display').textContent = '請選擇客戶';
  document.getElementById('stock-out-customer-display').dataset.value = '';
  document.getElementById('stock-out-notes').value = '';
  renderStockOutItems();
  setDateDisplay('stock-out-date', new Date());
}

function renderStockOutItems() {
  const container = document.getElementById('stock-out-items-container');
  if (!container) return;
  container.innerHTML = stockOutItems.map((item, idx) => {
    const p = products.find(x => x.id === item.productId);
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
            <div class="stock-hint">庫存剩 ${p ? p.stock : 0} 件</div>
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
    const docRef = await addDoc(collection(db, 'users', currentUser.uid, 'stockOut'), orderData);
    stockOutOrders.push({ id: docRef.id, ...orderData });

    // Update product stock
    for (const item of stockOutItems) {
      const p = products.find(x => x.id === item.productId);
      if (p) {
        const newStock = (p.stock || 0) - item.qty;
        await updateDoc(doc(db, 'users', currentUser.uid, 'products', p.id), {
          stock: Math.max(0, newStock),
          lastOutDate: date
        });
        p.stock = Math.max(0, newStock);
        p.lastOutDate = date;
      }
    }

    // Update customer stats
    await updateDoc(doc(db, 'users', currentUser.uid, 'customers', stockOutCustomerId), {
      totalAmount: (customer?.totalAmount || 0) + totalAmount
    });
    if (customer) customer.totalAmount = (customer.totalAmount || 0) + totalAmount;

    showToast(`出庫成功！單號：${orderNum}`);
    navigate('home');
  } catch (e) {
    showToast('出庫失敗：' + e.message);
  }
};

function generateOrderNumber(prefix, date) {
  const dateStr = (date || formatDate(new Date())).replace(/-/g, '');
  const orders = prefix === 'O' ? stockOutOrders : stockInOrders;
  const todayOrders = orders.filter(o => o.date === (date || formatDate(new Date())));
  const seq = String(todayOrders.length + 1).padStart(4, '0');
  return `${prefix}${dateStr}${seq}`;
}

// ==================== CUSTOMERS ====================
function renderCustomerList() {
  const search = document.getElementById('customer-search')?.value?.toLowerCase() || '';
  const container = document.getElementById('customer-list-container');
  if (!container) return;

  const filtered = customers.filter(c =>
    !search || c.name?.toLowerCase().includes(search)
  );

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-users"></i><p>沒有客戶</p></div>`;
    return;
  }

  const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  container.innerHTML = `<div class="form-card" style="margin:0">${filtered.map(c => {
    const monthOrders = stockOutOrders.filter(o => o.customerId === c.id && o.date?.startsWith(thisMonth));
    const monthAmount = monthOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const initials = c.name.substring(0, 2);
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

window.filterCustomers = () => renderCustomerList();

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
      await updateDoc(doc(db, 'users', currentUser.uid, 'customers', editingCustomerId), data);
      const idx = customers.findIndex(c => c.id === editingCustomerId);
      if (idx > -1) customers[idx] = { ...customers[idx], ...data };
      showToast('客戶已更新！');
    } else {
      data.createdAt = Date.now();
      data.totalAmount = 0;
      const docRef = await addDoc(collection(db, 'users', currentUser.uid, 'customers'), data);
      customers.push({ id: docRef.id, ...data });
      showToast('客戶已新增！');
    }
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
  const totalAmount = c.totalAmount || stockOutOrders.filter(o => o.customerId === customerId).reduce((sum, o) => sum + (o.totalAmount || 0), 0);
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

      <button class="submit-btn red" onclick="deleteCustomer('${c.id}')">🗑️ 刪除客戶</button>
      <div style="height:20px"></div>
    </div>`;

  navigate('customer-detail');
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
    await deleteDoc(doc(db, 'users', currentUser.uid, 'customers', customerId));
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

window.showExpenseDetail = (expenseId) => {
  const e = expenses.find(x => x.id === expenseId);
  if (!e) return;
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">支出詳細</div>
    <div class="form-card" style="margin:0 0 16px">
      <div class="form-row"><span class="form-label">類別</span><span class="form-input">${e.category}</span></div>
      <div class="form-row"><span class="form-label">金額</span><span class="form-input" style="color:var(--red)">$${(e.amount||0).toLocaleString()}</span></div>
      <div class="form-row"><span class="form-label">日期</span><span class="form-input">${e.date}</span></div>
      <div class="form-row" style="border-bottom:none"><span class="form-label">備註</span><span class="form-input">${e.notes || '無'}</span></div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="submit-btn" style="background:var(--bg3);color:var(--red)" onclick="deleteExpense('${e.id}')">🗑️ 刪除</button>
      <button class="submit-btn" onclick="forceCloseModal()">關閉</button>
    </div>`);
};

window.deleteExpense = (expenseId) => {
  closeModal();
  showConfirm('確定要刪除這筆支出嗎？', async () => {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'expenses', expenseId));
    expenses = expenses.filter(e => e.id !== expenseId);
    renderExpenseList();
    showToast('支出已刪除');
  });
};

function initAddExpense() {
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
    const docRef = await addDoc(collection(db, 'users', currentUser.uid, 'expenses'), data);
    expenses.push({ id: docRef.id, ...data });
    showToast('支出已新增！');
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
  const orders = stockOutOrders.filter(o => o.date?.startsWith(monthStr))
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
  const orders = stockInOrders.filter(o => o.date?.startsWith(monthStr))
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
      <button class="submit-btn red" onclick="deleteStockOutOrder('${o.id}')">🗑️ 刪除此出庫單</button>
      <div style="height:20px"></div>
    </div>`;
  navigate('stock-out-detail');
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
        await updateDoc(doc(db, 'users', currentUser.uid, 'products', p.id), { stock: newStock });
        p.stock = newStock;
      }
    }
    await deleteDoc(doc(db, 'users', currentUser.uid, 'stockOut', orderId));
    stockOutOrders = stockOutOrders.filter(x => x.id !== orderId);
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
      <div style="height:20px"></div>
    </div>`;
  navigate('stock-in-detail');
};

function renderProfitRanking() {
  const monthStr = getReportMonthStr();
  const monthOut = stockOutOrders.filter(o => o.date?.startsWith(monthStr));

  // Calculate profit per product
  const productProfits = {};
  monthOut.forEach(order => {
    (order.items || []).forEach(item => {
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
  const monthOut = stockOutOrders.filter(o => o.date?.startsWith(monthStr));

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
  const monthExp = expenses.filter(e => e.date?.startsWith(monthStr));
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

window.showStockOutFilter = () => {};
window.showStockInFilter = () => {};
window.showProfitRankingFilter = () => {};
window.showPlatformFilter = () => {};
window.showExpenseReportFilter = () => {};

// ==================== SETTINGS ====================
function renderSettings() {
  document.getElementById('setting-company-name-display').textContent = userSettings.companyName || '我的店';
  document.getElementById('setting-sort-display').textContent = getSortLabel(userSettings.sortBy);
  document.getElementById('setting-low-stock-display').textContent = `低於 ${userSettings.lowStockThreshold || 5} 件`;
  document.getElementById('setting-stale-days-display').textContent = `超過 ${userSettings.staleDays || 30} 天`;
  document.getElementById('setting-email-display').textContent = currentUser?.email || '';
  document.getElementById('last-backup-display').textContent = userSettings.lastBackup ? `上次備份：${userSettings.lastBackup}` : '尚未備份';
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

window.backupData = async () => {
  showToast('備份中...');
  try {
    const backupData = { products, customers, expenses, stockInOrders, stockOutOrders, productCategories, expenseCategories, suppliers };
    await setDoc(doc(db, 'users', currentUser.uid, 'backup', 'latest'), {
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
      const snap = await getDoc(doc(db, 'users', currentUser.uid, 'backup', 'latest'));
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
      ${productCategories.map((cat, idx) => `
        <div class="manage-item">
          <span class="manage-item-name">${cat}</span>
          <button class="manage-item-delete" onclick="deleteCategoryItem(${idx})"><i class="ti ti-trash"></i></button>
        </div>`).join('')}
    </div>`;
}

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
  showConfirm(`確定要刪除「${productCategories[idx]}」類別嗎？`, async () => {
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
    ${expenseCategories.map((cat, idx) => `
      <div class="manage-item">
        <span class="manage-item-name">${cat}</span>
        <button class="manage-item-delete" onclick="deleteExpenseCategoryItem(${idx})"><i class="ti ti-trash"></i></button>
      </div>`).join('')}
  </div>`;
}

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
  showConfirm(`確定要刪除「${expenseCategories[idx]}」嗎？`, async () => {
    expenseCategories.splice(idx, 1);
    await saveCategories();
    renderExpenseCategoriesManagement();
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
          <span class="manage-item-name">${s.name}</span>
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
  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">選擇商品</div>
    <div class="search-bar" style="margin-bottom:8px">
      <i class="ti ti-search"></i>
      <input type="text" placeholder="搜尋商品" id="picker-search"
        oninput="filterPickerProducts()" style="background:none;border:none;outline:none;color:var(--text2);font-size:17px;flex:1;width:100%">
    </div>
    <div id="picker-product-list">
      ${renderPickerList(sorted, callback)}
    </div>`);
  window._pickerCallback = callback;
  window._pickerProducts = sorted;
}

window.filterPickerProducts = () => {
  const search = document.getElementById('picker-search')?.value?.toLowerCase() || '';
  const filtered = (window._pickerProducts || products).filter(p =>
    p.name?.toLowerCase().includes(search) || p.model?.toLowerCase().includes(search)
  );
  document.getElementById('picker-product-list').innerHTML = renderPickerList(filtered, window._pickerCallback);
};

function renderPickerList(prods, callback) {
  return prods.map(p => `
    <div class="picker-item" onclick="selectPickerProduct('${p.id}')">
      <div class="product-thumb" style="width:36px;height:36px">
        ${p.imageUrl ? `<img src="${p.imageUrl}">` : `<i class="ti ti-photo"></i>`}
      </div>
      <div style="flex:1">
        <div style="color:var(--text2);font-size:17px">${p.name}</div>
        <div style="color:var(--text4);font-size:15px">${p.model || ''} 庫存: ${p.stock}</div>
      </div>
    </div>`).join('') || '<p style="text-align:center;color:var(--text4);padding:20px">沒有商品</p>';
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
    ${customers.map(c => `
      <div class="picker-item" onclick="selectCustomerFromPicker('${c.id}','${c.name}')">
        ${c.name}
      </div>`).join('')}
    <div class="picker-item" style="color:var(--blue)" onclick="closeModal();navigate('add-customer')">
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
window.showNotifications = () => {
  const notifications = [];
  // Low stock
  const lowStock = products.filter(p => p.stock <= userSettings.lowStockThreshold && p.stock >= 0);
  if (lowStock.length > 0) notifications.push({ icon: 'ti ti-alert-triangle', color: 'var(--amber)', text: `${lowStock.length} 件商品庫存偏低` });
  // Stale
  const staleDays = userSettings.staleDays || 30;
  const stale = products.filter(p => {
    if (!p.lastOutDate) return p.stock > 0;
    return ((Date.now() - new Date(p.lastOutDate)) / (1000*60*60*24)) > staleDays && p.stock > 0;
  });
  if (stale.length > 0) notifications.push({ icon: 'ti ti-clock', color: 'var(--blue)', text: `${stale.length} 件商品超過${staleDays}天未出庫` });
  // Backup
  if (!userSettings.lastBackup) {
    notifications.push({ icon: 'ti ti-cloud-upload', color: 'var(--purple)', text: '尚未備份資料，建議立即備份' });
  } else {
    const lastBackup = new Date(userSettings.lastBackup);
    const daysSince = (Date.now() - lastBackup) / (1000*60*60*24);
    if (daysSince > 7) notifications.push({ icon: 'ti ti-cloud-upload', color: 'var(--purple)', text: `距離上次備份已超過7天` });
  }

  showModal(`<div class="modal-handle"></div>
    <div class="modal-title">通知</div>
    ${notifications.length === 0
      ? '<div class="empty-state"><i class="ti ti-bell"></i><p>沒有通知</p></div>'
      : notifications.map(n => `
        <div class="alert-item" style="background:var(--bg3);border-color:var(--border);margin-bottom:8px">
          <i class="${n.icon}" style="color:${n.color}"></i>
          <span style="color:var(--text2)">${n.text}</span>
        </div>`).join('')}
    <button class="submit-btn" style="margin-top:8px" onclick="forceCloseModal()">關閉</button>`);

  // Hide badge after viewing
  document.getElementById('notification-badge').style.display = 'none';
  // Re-check after a moment in case still relevant
  setTimeout(checkBackupReminder, 500);
};

function checkBackupReminder() {
  // Only show badge if there are real notifications (low stock, stale, overdue backup)
  const lowStock = products.filter(p => p.stock <= userSettings.lowStockThreshold && p.stock >= 0);
  const staleDays = userSettings.staleDays || 30;
  const stale = products.filter(p => {
    if (p.stock <= 0) return false;
    const baseDate = p.lastOutDate
      ? new Date(p.lastOutDate)
      : new Date(p.createdAt || Date.now());
    return ((Date.now() - baseDate) / (1000*60*60*24)) > staleDays;
  });
  const backupOverdue = userSettings.lastBackup &&
    ((Date.now() - new Date(userSettings.lastBackup)) / (1000*60*60*24)) > 7;

  const hasNotif = lowStock.length > 0 || stale.length > 0 || backupOverdue;
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

// ==================== UTILS ====================
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
