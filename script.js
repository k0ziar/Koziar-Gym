// --- CONFIG SUPABASE ---
if (typeof window.sbClient === 'undefined') {
    const SUPABASE_URL = 'https://ntulcbraqsmlofeeeyjt.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50dWxjYnJhcXNtbG9mZWVleWp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0OTc0MDcsImV4cCI6MjEwNTA3MzQwN30.q5U6I_ziGHUgz4X1VBu6r4mskmThzkkreRrkEulMgUQ';
    
    if (window.supabase && window.supabase.createClient) {
        window.sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
        window.sbClient = null;
    }
}

const ADMIN_PIN = "0000";
var isAdmin = localStorage.getItem('koziar_is_admin') === 'true';

var deviceId = localStorage.getItem('koziar_device_id');
if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('koziar_device_id', deviceId);
}

var currentMode = 'basic'; // basic / pro / edit
var hotInstance = null;
var tempExcelData = null;
var expandedExercises = {};

var unlockedKeys = JSON.parse(localStorage.getItem('koziar_unlocked_keys')) || [];
var hiddenPlans = JSON.parse(localStorage.getItem('koziar_hidden_plans')) || [];
var subSetData = JSON.parse(localStorage.getItem('koziar_subset_data')) || {};

var defaultPlans = {
    "FBW 3-Dniowy (Domyślny) - by Koziar": {
        isLocked: true,
        notes: "Gryf długi 20kg\nGryf krótki 15kg\nGryfy łamane 10kg",
        data: [
            ["Dzień 1 - PUSH", "", "", "", "", "", ""],
            ["Nr", "Ćwiczenie", "S", "P", "KG", "RIR", "REST"],
            ["1", "Ława płaska pauzowana", "5", "3", "115", "1", "120s"],
            ["2", "Pin Press", "3", "3", "110", "2", "120s"],
            ["3", "Dipy", "3", "6", "20", "2", "90s"],
            ["4", "OHP hantlami", "3", "6", "30", "2", "90s"],
            ["5", "Wznosy wyciąg", "3", "10", "15", "1", "60s"]
        ]
    }
};

var plans = JSON.parse(localStorage.getItem('koziar_plans')) || defaultPlans;
var currentPlan = localStorage.getItem('koziar_current_plan') || Object.keys(plans)[0];
var checks = JSON.parse(localStorage.getItem('koziar_checks')) || {};

function saveAll() {
    if (!isAdmin) {
        localStorage.setItem('koziar_plans', JSON.stringify(plans));
    }
    localStorage.setItem('koziar_current_plan', currentPlan);
    localStorage.setItem('koziar_checks', JSON.stringify(checks));
    localStorage.setItem('koziar_hidden_plans', JSON.stringify(hiddenPlans));
    localStorage.setItem('koziar_subset_data', JSON.stringify(subSetData));

    syncPlanToCloud(currentPlan);
}

async function syncPlanToCloud(planName) {
    if (!window.sbClient) return;
    const p = plans[planName];
    if (!p || p.isLocked) return;

    try {
        const targetDeviceId = p.ownerDeviceId || deviceId;

        const payload = {
            user_device_id: targetDeviceId,
            plan_name: planName,
            notes: p.notes || "",
            data: p.data,
            checks: checks,
            access_key: p.accessKey || null,
            updated_at: new Date().toISOString()
        };

        await window.sbClient
            .from('user_plans')
            .upsert(payload, { onConflict: 'user_device_id, plan_name' });
    } catch (err) {
        console.warn("Brak połączenia z chmurą.");
    }
}

async function loadPlansFromCloud() {
    if (!window.sbClient) return;
    try {
        let query = window.sbClient.from('user_plans').select('*');

        if (!isAdmin) {
            if (unlockedKeys.length > 0) {
                query = query.or(`user_device_id.eq.${deviceId},access_key.in.("${unlockedKeys.join('","')}")`);
            } else {
                query = query.eq('user_device_id', deviceId);
            }
        }

        const { data, error } = await query;

        if (!error && data) {
            let loadedPlans = JSON.parse(JSON.stringify(defaultPlans));

            data.forEach(row => {
                if (!hiddenPlans.includes(row.plan_name) || isAdmin) {
                    loadedPlans[row.plan_name] = {
                        isLocked: false,
                        notes: row.notes,
                        data: row.data,
                        accessKey: row.access_key,
                        ownerDeviceId: row.user_device_id
                    };
                    if (row.checks) checks = { ...checks, ...row.checks };
                }
            });

            plans = loadedPlans;

            if (!isAdmin) {
                localStorage.setItem('koziar_plans', JSON.stringify(plans));
            }
            
            initPlanSelect();
            renderGymView();
        }
    } catch (err) {
        console.log("Tryb offline.");
    }
}

// PRZEŁĄCZANIE TRYBÓW
function toggleViewMode() {
    if (currentMode === 'edit') return;
    currentMode = (currentMode === 'basic') ? 'pro' : 'basic';
    updateNavButtons();
    setMode(currentMode);
}

function toggleEditMode() {
    if (currentMode === 'edit') return;
    setMode('edit');
}

function updateNavButtons() {
    const lbl = document.getElementById('lblToggleMode');
    if (lbl) lbl.innerText = currentMode === 'pro' ? 'PRO' : 'BASIC';
}

// TRWAŁE USUWANIE LOKALNE
function deleteCurrentPlan() {
    if (currentMode === 'edit') return;
    const p = plans[currentPlan];
    if (!p) return alert("Nie wybrano planu.");
    if (p.isLocked) return alert("Nie możesz usunąć oficjalnego planu domyślnego.");

    if (confirm(`Czy na pewno chcesz usunąć plan "${currentPlan}" lokalnie?\n(Backup pozostanie zachowany w chmurze).`)) {
        if (!hiddenPlans.includes(currentPlan)) {
            hiddenPlans.push(currentPlan);
        }

        if (p.accessKey) {
            unlockedKeys = unlockedKeys.filter(k => k !== p.accessKey);
            localStorage.setItem('koziar_unlocked_keys', JSON.stringify(unlockedKeys));
        }

        delete plans[currentPlan];
        saveAll();

        currentPlan = Object.keys(plans)[0];
        localStorage.setItem('koziar_current_plan', currentPlan);

        initPlanSelect();
        renderGymView();
        alert("Plan został pomyślnie usunięty lokalnie.");
    }
}

// ADMIN / TRENER
function secretAdminPrompt() {
    const pin = prompt("Wprowadź Kod Dostępu / PIN Trenera:");
    if (pin === ADMIN_PIN) {
        isAdmin = true;
        localStorage.setItem('koziar_is_admin', 'true');
        alert("Zalogowano w trybie TRENERA!");
        location.reload();
    } else if (pin) {
        unlockedKeys.push(pin.trim());
        localStorage.setItem('koziar_unlocked_keys', JSON.stringify(unlockedKeys));
        loadPlansFromCloud();
        alert("Pobieram plan przypisany do kodu...");
    }
}

function logoutAdmin() {
    if (confirm("Czy chcesz wyjść z trybu Trenera?")) {
        isAdmin = false;
        localStorage.setItem('koziar_is_admin', 'false');
        localStorage.removeItem('koziar_plans');
        alert("Wylogowano z trybu Trenera.");
        location.reload();
    }
}

function setPlanAccessKey() {
    const p = plans[currentPlan];
    if (!p || p.isLocked) return alert("Wybierz własny odblokowany plan.");

    const key = prompt(`Ustaw Klucz Dostępu (kod) dla planu "${currentPlan}":`, p.accessKey || "");
    if (key !== null) {
        p.accessKey = key.trim();
        saveAll();
        initPlanSelect();
        openExport();
        alert(`Klucz "${p.accessKey}" został pomyślnie nadany i zapisany!`);
    }
}

function checkAdminBadge() {
    const badge = document.getElementById("adminBadge");
    if (badge) {
        badge.style.display = isAdmin ? "flex" : "none";
    }
}

// MODALE
function openImport() {
    if (currentMode === 'edit') return;
    document.getElementById("importModal").classList.add("active");
}

function openSocialModal() {
    document.getElementById("socialModal").classList.add("active");
}

function handleImportOrKey() {
    const val = document.getElementById("importInputVal").value.trim();
    if (!val) return;

    if (val === ADMIN_PIN) {
        secretAdminPrompt();
        closeModals();
        return;
    }

    if (val.includes("\t") || val.includes("\n")) {
        const lines = val.split("\n");
        let notes = "";
        let data = [];

        lines.forEach(l => {
            if (l.startsWith("!!NOTES!!")) {
                notes = l.split("\t")[1]?.replace(/\[BR\]/g, "\n") || "";
            } else {
                data.push(l.split("\t"));
            }
        });

        const name = prompt("Nazwa dla importowanego planu:", "Importowany Plan");
        if (name && name.trim()) {
            plans[name] = { isLocked: false, notes, data, ownerDeviceId: deviceId };
            currentPlan = name;
            saveAll();
            initPlanSelect();
            closeModals();
            renderGymView();
        }
    } else {
        if (!unlockedKeys.includes(val)) {
            unlockedKeys.push(val);
            localStorage.setItem('koziar_unlocked_keys', JSON.stringify(unlockedKeys));
        }
        loadPlansFromCloud();
        closeModals();
        alert("Pobieram plan przypisany do kodu...");
    }
}

function openExport() {
    if (currentMode === 'edit') return;
    const p = plans[currentPlan];
    let lines = [`!!NOTES!!\t${(p.notes || "").replace(/\n/g, "[BR]")}`];
    p.data.forEach(r => lines.push(r.join("\t")));
    
    document.getElementById("exportText").value = lines.join("\n");
    
    const keyInfo = document.getElementById("exportKeyInfo");
    if (keyInfo) {
        keyInfo.innerText = p.accessKey ? `Klucz dostępu planu: ${p.accessKey}` : "Brak przypisanego klucza dostępu.";
    }

    document.getElementById("exportModal").classList.add("active");
}

function initPlanSelect() {
    const select = document.getElementById("planSelect");
    if (!select) return;
    select.innerHTML = "";
    
    const gOfficial = document.createElement("optgroup");
    gOfficial.label = "📋 KLASYKI KOZIARA";
    const gUser = document.createElement("optgroup");
    gUser.label = isAdmin ? "👑 WSZYSTKIE PLANY (TRENER)" : "💪 TWOJE PLANY";

    Object.keys(plans).forEach(name => {
        if (!hiddenPlans.includes(name) || isAdmin) {
            const keyTag = plans[name].accessKey ? ` 🔑[${plans[name].accessKey}]` : '';
            const opt = new Option(name + keyTag, name);
            if (plans[name].isLocked) gOfficial.appendChild(opt);
            else gUser.appendChild(opt);
        }
    });

    if (gOfficial.children.length > 0) select.appendChild(gOfficial);
    if (gUser.children.length > 0) select.appendChild(gUser);

    if (!plans[currentPlan]) currentPlan = Object.keys(plans)[0];
    select.value = currentPlan;

    checkAdminBadge();
}

function loadPlan() {
    if (currentMode === 'edit') return;
    currentPlan = document.getElementById("planSelect").value;
    saveAll();
    renderGymView();
}

function saveNotes() {
    const el = document.getElementById("planNotes");
    if (el && plans[currentPlan] && !plans[currentPlan].isLocked) {
        plans[currentPlan].notes = el.value;
        saveAll();
    }
}

// EDYTOR EXCEL & LOCK NAWIGACJI
function setMode(mode) {
    currentMode = mode;
    updateNavButtons();

    const gymView = document.getElementById('gymView');
    const editArea = document.getElementById('editArea');
    const notesContainer = document.getElementById('notesContainer');
    const bottomNav = document.getElementById('mainBottomNav');
    const planSelect = document.getElementById('planSelect');

    if (mode === 'edit') {
        gymView.style.display = 'none';
        notesContainer.style.display = 'none';
        editArea.style.display = 'block';
        bottomNav.classList.add('nav-locked');
        planSelect.disabled = true;
        initExcel();
    } else {
        editArea.style.display = 'none';
        notesContainer.style.display = 'block';
        gymView.style.display = 'block';
        bottomNav.classList.remove('nav-locked');
        planSelect.disabled = false;
        renderGymView();
    }
}

function initExcel() {
    const container = document.getElementById('excelContainer');
    if (!container) return;
    container.style.display = 'block';
    container.innerHTML = '';

    const p = plans[currentPlan];
    tempExcelData = JSON.parse(JSON.stringify(p.data));

    hotInstance = new Handsontable(container, {
        data: tempExcelData,
        rowHeaders: true,
        colHeaders: true,
        height: '100%',
        licenseKey: 'non-commercial-and-evaluation',
        contextMenu: true,
        minSpareRows: 1,
        minSpareCols: 1,
        manualColumnResize: true,
        manualRowResize: true,
        stretchH: 'all',
        readOnly: p.isLocked
    });
}

function addExcelRow() {
    if (hotInstance) hotInstance.alter('insert_row_below');
}

function addExcelCol() {
    if (hotInstance) hotInstance.alter('insert_col_right');
}

function saveExcelChanges() {
    if (hotInstance && plans[currentPlan] && !plans[currentPlan].isLocked) {
        plans[currentPlan].data = hotInstance.getData();
        saveAll();
    }
    setMode('basic');
}

function cancelExcelChanges() {
    tempExcelData = null;
    setMode('basic');
}

function parseSheetToStructure() {
    const raw = plans[currentPlan]?.data || [];
    let days = [];
    let currentDay = null;
    let customHeaders = [];

    raw.forEach((row, rowIndex) => {
        if (!row || row.every(cell => cell === null || cell === '')) return;

        const col0 = String(row[0] || '').trim();
        const col1 = String(row[1] || '').trim();

        if (col0.toLowerCase() === 'nr' || col1.toLowerCase() === 'ćwiczenie') {
            customHeaders = [];
            for (let i = 2; i < row.length; i++) {
                if (row[i] !== null && row[i] !== '') {
                    customHeaders.push({ name: String(row[i]).trim(), colIdx: i });
                }
            }
            return;
        }

        if (col0.toLowerCase().startsWith('dzień') || (col0 && !col1 && isNaN(col0))) {
            const isRest = col0.toLowerCase().includes('rest') || col0.toLowerCase().includes('wolne') || col0.toLowerCase().includes('pauza');
            currentDay = { name: col0, isRest, exercises: [] };
            days.push(currentDay);
        } else if (currentDay && (col0 !== '' || col1 !== '')) {
            let rowData = {};
            customHeaders.forEach(h => {
                rowData[h.name] = {
                    val: row[h.colIdx] !== undefined && row[h.colIdx] !== null ? row[h.colIdx] : '',
                    colIdx: h.colIdx
                };
            });

            currentDay.exercises.push({
                rowIndex,
                nr: col0,
                name: col1,
                data: rowData
            });
        }
    });

    if (customHeaders.length === 0) {
        customHeaders = [
            { name: "S", colIdx: 2 },
            { name: "P", colIdx: 3 },
            { name: "KG", colIdx: 4 }
        ];
    }

    return { days, headers: customHeaders };
}

function updateCellDirectly(rowIndex, colIndex, value) {
    if (plans[currentPlan].isLocked) {
        const copyName = currentPlan.replace(" - by Koziar", "").replace(" (Domyślny)", "") + " (Mój Plan)";
        plans[copyName] = JSON.parse(JSON.stringify(plans[currentPlan]));
        plans[copyName].isLocked = false;
        currentPlan = copyName;
        initPlanSelect();
    }

    plans[currentPlan].data[rowIndex][colIndex] = value;
    saveAll();
    renderGymView();
}

function updateSubSetCell(key, setIdx, headerName, value) {
    const subKey = `${key}_s${setIdx}`;
    if (!subSetData[subKey]) subSetData[subKey] = {};
    subSetData[subKey][headerName] = value;
    saveAll();
}

function renderGymView() {
    const p = plans[currentPlan];
    if (!p) return;

    const notesEl = document.getElementById("planNotes");
    if (notesEl) {
        notesEl.value = p.notes || "";
        notesEl.readOnly = p.isLocked;
    }

    const gymView = document.getElementById('gymView');
    if (!gymView) return;

    const { days, headers } = parseSheetToStructure();

    const activeHeaders = currentMode === 'basic' 
        ? headers.filter(h => ['S','P','KG'].includes(h.name.toUpperCase())) 
        : headers;

    const isReadOnlyAttr = p.isLocked ? 'readonly' : '';

    gymView.innerHTML = days.map((day, di) => `
        <div class="day-card ${day.isRest ? 'rest-day' : ''}">
            <div class="day-header">
                <span>${day.name}</span>
                ${day.isRest ? '<span class="rest-badge">REGENERACJA</span>' : ''}
            </div>
            
            ${!day.isRest ? `
            <div class="table-wrapper">
                <div class="table-grid">
                    <div class="row-grid row-header">
                        ${currentMode === 'pro' ? '<div class="col-cell expand-col"></div>' : ''}
                        <div class="col-cell check-col">✔</div>
                        <div class="col-cell nr-col">Nr</div>
                        <div class="col-cell name-col">Ćwiczenie</div>
                        ${activeHeaders.map(h => `<div class="col-cell">${h.name}</div>`).join('')}
                    </div>

                    ${day.exercises.map((ex, ei) => {
                        const key = `${currentPlan}-${di}-${ei}`;
                        const isExpanded = expandedExercises[key];
                        const mainChecked = checks[key]?.main || false;
                        const count = parseInt(ex.data['S']?.val || ex.data['s']?.val) || 1;

                        return `
                            <div class="row-grid ${mainChecked ? 'done' : ''}">
                                ${currentMode === 'pro' ? `
                                <div class="col-cell expand-col">
                                    <button class="btn-expand" onclick="toggleExpand('${key}')">
                                        <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}" style="width:14px"></i>
                                    </button>
                                </div>` : ''}
                                
                                <div class="col-cell check-col">
                                    <input type="checkbox" ${mainChecked ? 'checked' : ''} onchange="toggleCheck('${key}', 'main', this.checked)">
                                </div>
                                <div class="col-cell nr-col">
                                    <input type="text" class="cell-input" value="${ex.nr}" ${isReadOnlyAttr} onchange="updateCellDirectly(${ex.rowIndex}, 0, this.value)">
                                </div>
                                <div class="col-cell name-col">
                                    <input type="text" class="cell-input" style="text-align:left;" value="${ex.name}" ${isReadOnlyAttr} onchange="updateCellDirectly(${ex.rowIndex}, 1, this.value)">
                                </div>
                                ${activeHeaders.map(h => {
                                    const cellData = ex.data[h.name] || { val: '', colIdx: h.colIdx };
                                    return `
                                        <div class="col-cell">
                                            <input type="text" class="cell-input" value="${cellData.val}" ${isReadOnlyAttr} onchange="updateCellDirectly(${ex.rowIndex}, ${cellData.colIdx}, this.value)">
                                        </div>
                                    `;
                                }).join('')}
                            </div>

                            ${(isExpanded && currentMode === 'pro') ? Array.from({length: count}).map((_, s) => {
                                const subChecked = checks[key]?.[`sub_${s}`] || false;
                                const subKey = `${key}_s${s}`;
                                return `
                                    <div class="row-grid sub-row ${subChecked ? 'done' : ''}">
                                        <div class="col-cell expand-col"></div>
                                        <div class="col-cell check-col">
                                            <input type="checkbox" ${subChecked ? 'checked' : ''} onchange="toggleCheck('${key}', 'sub_${s}', this.checked)">
                                        </div>
                                        <div class="col-cell nr-col" style="font-size:10px;">${ex.nr}.${s+1}</div>
                                        <div class="col-cell name-col" style="font-size:11px; color:var(--text-dim);">Seria ${s+1}</div>
                                        ${activeHeaders.map(h => {
                                            if (h.name.toUpperCase() === 'S') return `<div class="col-cell" style="color:var(--text-dim);">-</div>`;
                                            const savedSubVal = subSetData[subKey]?.[h.name] !== undefined ? subSetData[subKey][h.name] : '';
                                            return `
                                                <div class="col-cell">
                                                    <input type="text" class="cell-input" value="${savedSubVal}" ${isReadOnlyAttr} placeholder="-" onchange="updateSubSetCell('${key}', ${s}, '${h.name}', this.value)">
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                `;
                            }).join('') : ''}
                        `;
                    }).join('')}
                </div>
            </div>` : '<div style="padding:16px; text-align:center; color:var(--text-dim); font-size:12px; font-weight:700;">Dzień na regenerację 💪</div>'}
        </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
}

function toggleExpand(key) { expandedExercises[key] = !expandedExercises[key]; renderGymView(); }
function toggleCheck(key, target, value) {
    if (!checks[key]) checks[key] = {};
    checks[key][target] = value;
    saveAll();
    renderGymView();
}

function newPlan() {
    if (currentMode === 'edit') return;
    const name = prompt("Nazwa nowego planu:");
    if (name && name.trim()) {
        plans[name] = {
            isLocked: false,
            notes: "",
            ownerDeviceId: deviceId,
            data: [
                ["Dzień 1 - Trening A", "", "", "", "", ""],
                ["Nr", "Ćwiczenie", "S", "P", "KG", "REST"],
                ["1", "Wyciskanie leżąc", "3", "10", "60", "90s"]
            ]
        };
        currentPlan = name;
        saveAll();
        initPlanSelect();
        renderGymView();
    }
}

function resetWeek() {
    if (currentMode === 'edit') return;
    if (confirm("Resetować zaznaczone serie?")) {
        checks = {};
        subSetData = {};
        saveAll();
        renderGymView();
    }
}

function downloadTSV() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([document.getElementById("exportText").value], { type: "text/tab-separated-values" }));
    a.download = currentPlan.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".tsv";
    a.click();
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { document.getElementById("importInputVal").value = ev.target.result; };
    reader.readAsText(file);
}

function closeModals() { document.querySelectorAll(".modal").forEach(m => m.classList.remove("active")); }

document.addEventListener("DOMContentLoaded", () => {
    initPlanSelect();
    renderGymView();
    loadPlansFromCloud();
});