import { supabase } from './supabase-config.js';

// Variables globales
let currentAdmin = null;
let activityChartInstance = null;
let assetsChartInstance = null;

// Referencias del DOM
const loginScreen = document.getElementById('loginScreen');
const adminPanel = document.getElementById('adminPanel');
const adminLoginForm = document.getElementById('adminLoginForm');
const loginError = document.getElementById('loginError');
const btnLogout = document.getElementById('btnLogout');
const sidebarAdminEmail = document.getElementById('sidebarAdminEmail');
const navLinks = document.querySelectorAll('.nav-link');
const adminSections = document.querySelectorAll('.admin-section');

// ==================== AUTENTICACIÓN ====================

// Verificar sesión al cargar
async function checkAdminSession() {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
        const isAdmin = await verifyAdmin(session.user.id);
        if (isAdmin) {
            currentAdmin = session.user;
            showPanel();
        } else {
            showLogin('No tienes permisos de administrador');
        }
    } else {
        showLogin();
    }
}

// Verificar si el usuario es admin
async function verifyAdmin(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('is_admin, email')
        .eq('id', userId)
        .single();
    
    if (error || !data || !data.is_admin) {
        return false;
    }
    return true;
}

// Mostrar login
function showLogin(errorMsg = '') {
    loginScreen.classList.remove('hidden');
    adminPanel.classList.add('hidden');
    if (errorMsg) {
        loginError.textContent = errorMsg;
    }
}

// Mostrar panel
function showPanel() {
    loginScreen.classList.add('hidden');
    adminPanel.classList.remove('hidden');
    sidebarAdminEmail.textContent = currentAdmin.email;
    loadDashboard();
}

// Login form submit
adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;
    
    const btn = adminLoginForm.querySelector('button');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verificando...';
    
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) throw error;
        
        const isAdmin = await verifyAdmin(data.user.id);
        
        if (!isAdmin) {
            await supabase.auth.signOut();
            throw new Error('Acceso denegado: No eres administrador');
        }
        
        currentAdmin = data.user;
        showPanel();
        loginError.textContent = '';
    } catch (error) {
        loginError.textContent = error.message;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Ingresar al Panel';
    }
});

// Logout
btnLogout.addEventListener('click', async () => {
    await supabase.auth.signOut();
    currentAdmin = null;
    showLogin();
});

// ==================== NAVEGACIÓN ====================

navLinks.forEach(link => {
    link.addEventListener('click', () => {
        const section = link.dataset.section;
        showSection(section);
    });
});

function showSection(sectionName) {
    // Actualizar nav links
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.dataset.section === sectionName) {
            link.classList.add('active');
        }
    });
    
    // Mostrar sección
    adminSections.forEach(section => {
        section.classList.add('hidden');
        if (section.id === `section-${sectionName}`) {
            section.classList.remove('hidden');
        }
    });
    
    // Cargar datos según sección
    switch(sectionName) {
        case 'dashboard': loadDashboard(); break;
        case 'users': loadUsers(); break;
        case 'transactions': loadTransactions(); break;
        case 'balances': loadBalances(); break;
        case 'settings': loadSettings(); break;
    }
}

// ==================== DASHBOARD ====================

async function loadDashboard() {
    // Cargar estadísticas
    await loadStats();
    await loadRecentUsers();
    await loadCharts();
}

async function loadStats() {
    // Usuarios totales
    const { count: userCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });
    
    // Transacciones totales
    const { count: txCount } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true });
    
    // Volumen total (suma de transacciones)
    const { data: txData } = await supabase
        .from('transactions')
        .select('amount');
    
    const volume = txData ? txData.reduce((sum, tx) => sum + (tx.amount || 0), 0) : 0;
    
    // Usuarios activos (con saldo > 0)
    const { data: activeUsers } = await supabase
        .from('profiles')
        .select('balance_usd')
        .gt('balance_usd', 0);
    
    // Actualizar UI
    document.getElementById('statUsers').textContent = userCount || 0;
    document.getElementById('statTransactions').textContent = txCount || 0;
    document.getElementById('statVolume').textContent = `$${volume.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('statActive').textContent = activeUsers ? activeUsers.length : 0;
}

async function loadRecentUsers() {
    const { data, error } = await supabase
        .from('profiles')
        .select('email, balance_usd, created_at')
        .order('created_at', { ascending: false })
        .limit(5);
    
    const tbody = document.getElementById('recentUsersTable');
    
    if (error || !data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #94a3b8;">Sin usuarios registrados</td></tr>';
        return;
    }
    
    tbody.innerHTML = data.map(user => {
        const initials = user.email.charAt(0).toUpperCase();
        const date = new Date(user.created_at).toLocaleDateString('es-ES');
        return `
            <tr>
                <td>
                    <div class="user-cell">
                        <div class="user-avatar">${initials}</div>
                        <div class="user-info">
                            <h4>${user.email.split('@')[0]}</h4>
                        </div>
                    </div>
                </td>
                <td style="color: #94a3b8;">${user.email}</td>
                <td>$${user.balance_usd?.toFixed(2) || '0.00'}</td>
                <td>${date}</td>
                <td><span class="badge badge-success">Activo</span></td>
            </tr>
        `;
    }).join('');
}

async function loadCharts() {
    // Activity Chart
    const ctxActivity = document.getElementById('activityChart');
    if (activityChartInstance) activityChartInstance.destroy();
    
    activityChartInstance = new Chart(ctxActivity, {
        type: 'line',
        data: {
            labels: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
            datasets: [{
                label: 'Transacciones',
                data: [12, 19, 15, 25, 22, 30, 28],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#94a3b8' }
                }
            }
        }
    });
    
    // Assets Chart
    const ctxAssets = document.getElementById('assetsChart');
    if (assetsChartInstance) assetsChartInstance.destroy();
    
    assetsChartInstance = new Chart(ctxAssets, {
        type: 'doughnut',
        data: {
            labels: ['USD', 'BTC', 'ETH'],
            datasets: [{
                data: [65, 20, 15],
                backgroundColor: ['#3b82f6', '#f59e0b', '#8b5cf6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8' }
                }
            }
        }
    });
}

// ==================== USUARIOS ====================

async function loadUsers() {
    const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
    
    const tbody = document.getElementById('usersTableBody');
    
    if (error || !data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8;">Sin usuarios</td></tr>';
        return;
    }
    
    tbody.innerHTML = data.map(user => {
        const initials = user.email.charAt(0).toUpperCase();
        const date = new Date(user.created_at).toLocaleDateString('es-ES');
        const adminBadge = user.is_admin ? '<span class="badge badge-warning" style="margin-left: 0.5rem;">ADMIN</span>' : '';
        return `
            <tr>
                <td>
                    <div class="user-cell">
                        <div class="user-avatar">${initials}</div>
                        <div class="user-info">
                            <h4>${user.email.split('@')[0]} ${adminBadge}</h4>
                        </div>
                    </div>
                </td>
                <td style="color: #94a3b8;">${user.email}</td>
                <td>$${user.balance_usd?.toFixed(2) || '0.00'}</td>
                <td>${user.balance_btc?.toFixed(6) || '0.000000'}</td>
                <td>${user.balance_eth?.toFixed(6) || '0.000000'}</td>
                <td style="color: #94a3b8;">${date}</td>
                <td>
                    <div class="action-buttons">
                        <button class="action-btn edit" onclick="openEditBalance('${user.id}', '${user.email}', ${user.balance_usd || 0}, ${user.balance_btc || 0}, ${user.balance_eth || 0})">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        ${!user.is_admin ? `
                        <button class="action-btn delete" onclick="deleteUser('${user.id}')">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== TRANSACCIONES ====================

async function loadTransactions() {
    const { data, error } = await supabase
        .from('transactions')
        .select('*, profiles(email)')
        .order('created_at', { ascending: false })
        .limit(50);
    
    const tbody = document.getElementById('transactionsTableBody');
    
    if (error || !data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #94a3b8;">Sin transacciones</td></tr>';
        return;
    }
    
    tbody.innerHTML = data.map(tx => {
        const date = new Date(tx.created_at).toLocaleString('es-ES');
        const typeBadge = tx.type === 'swap' ? 'badge-warning' : tx.type === 'deposit' ? 'badge-success' : 'badge-danger';
        return `
            <tr>
                <td style="font-family: monospace; color: #94a3b8;">${tx.id.slice(0, 8)}...</td>
                <td>${tx.profiles?.email || 'Desconocido'}</td>
                <td><span class="badge ${typeBadge}">${tx.type?.toUpperCase()}</span></td>
                <td>${tx.from_currency || '-'}</td>
                <td>${tx.to_currency || '-'}</td>
                <td>${tx.amount?.toFixed(4) || '0.0000'}</td>
                <td style="color: #94a3b8;">${date}</td>
                <td><span class="badge badge-success">${tx.status?.toUpperCase()}</span></td>
            </tr>
        `;
    }).join('');
}

// ==================== SALDOS ====================

async function loadBalances() {
    await loadUsers(); // Reutilizamos la tabla de usuarios
}

// ==================== EDITAR SALDO ====================

window.openEditBalance = function(userId, email, usd, btc, eth) {
    document.getElementById('editUserId').value = userId;
    document.getElementById('editUserEmail').value = email;
    document.getElementById('editBalanceUSD').value = usd;
    document.getElementById('editBalanceBTC').value = btc;
    document.getElementById('editBalanceETH').value = eth;
    document.getElementById('editBalanceModal').classList.remove('hidden');
};

// Cerrar modal
document.querySelector('#editBalanceModal .close-modal').addEventListener('click', () => {
    document.getElementById('editBalanceModal').classList.add('hidden');
    document.getElementById('editBalanceError').textContent = '';
});

// Guardar saldo
document.getElementById('btnSaveBalance').addEventListener('click', async () => {
    const userId = document.getElementById('editUserId').value;
    const usd = parseFloat(document.getElementById('editBalanceUSD').value) || 0;
    const btc = parseFloat(document.getElementById('editBalanceBTC').value) || 0;
    const eth = parseFloat(document.getElementById('editBalanceETH').value) || 0;
    
    const btn = document.getElementById('btnSaveBalance');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
    
    try {
        const { error } = await supabase
            .from('profiles')
            .update({ balance_usd: usd, balance_btc: btc, balance_eth: eth })
            .eq('id', userId);
        
        if (error) throw error;
        
        // Registrar en logs de admin
        await supabase.from('admin_logs').insert({
            admin_id: currentAdmin.id,
            action: 'UPDATE_BALANCE',
            details: `Usuario: ${userId}, USD: ${usd}, BTC: ${btc}, ETH: ${eth}`
        });
        
        document.getElementById('editBalanceModal').classList.add('hidden');
        loadUsers();
        loadDashboard();
    } catch (error) {
        document.getElementById('editBalanceError').textContent = error.message;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar Cambios';
    }
});

// ==================== CONFIGURACIÓN ====================

async function loadSettings() {
    // Cargar precios actuales (simulados por ahora)
    document.getElementById('priceBTC').value = '45000.00';
    document.getElementById('priceETH').value = '3200.00';
}

window.updatePrices = function() {
    alert('Precios actualizados (simulación)');
};

window.toggleMaintenance = function() {
    alert('Modo mantenimiento cambiado (simulación)');
};

// ==================== ELIMINAR USUARIO ====================

window.deleteUser = async function(userId) {
    if (!confirm('¿Estás seguro de eliminar este usuario? Esta acción no se puede deshacer.')) {
        return;
    }
    
    try {
        // Primero eliminar transacciones
        await supabase.from('transactions').delete().eq('user_id', userId);
        
        // Luego eliminar perfil
        const { error } = await supabase.from('profiles').delete().eq('id', userId);
        
        if (error) throw error;
        
        // Registrar en logs
        await supabase.from('admin_logs').insert({
            admin_id: currentAdmin.id,
            action: 'DELETE_USER',
            details: `Usuario eliminado: ${userId}`
        });
        
        loadUsers();
        loadDashboard();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

// ==================== AGREGAR ADMINISTRADOR ====================

window.addAdmin = async function() {
    const email = prompt('Ingresa el correo del nuevo administrador:');
    if (!email) return;
    
    try {
        // Buscar el perfil por email
        const { data: profile, error: findError } = await supabase
            .from('profiles')
            .select('id, email')
            .eq('email', email)
            .single();
        
        if (findError || !profile) {
            throw new Error('Usuario no encontrado. Debe registrarse primero en la plataforma.');
        }
        
        // Actualizar a admin
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ is_admin: true })
            .eq('id', profile.id);
        
        if (updateError) throw updateError;
        
        // Registrar en logs
        await supabase.from('admin_logs').insert({
            admin_id: currentAdmin.id,
            action: 'ADD_ADMIN',
            details: `Nuevo admin: ${email}`
        });
        
        alert(`✅ ${email} ahora es administrador`);
        loadUsers();
    } catch (error) {
        alert('Error: ' + error.message);
    }
};

// ==================== REFRESCAR DATOS ====================

window.refreshData = function() {
    loadDashboard();
};

// ==================== INICIAR ====================

checkAdminSession();
