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

var defaultPlans = {
    "FBW 3-Dniowy (Domyślny) - by Koziar": {
        isLocked: true,
        notes: "Gryf długi 20kg\nGryf krótki 15kg\nGryfy łamane 10kg\n\nPo zmianie prostego chwytu na warkocz w tricepsie, wyniki drastycznie skoczyły w górę\nPrzysiad na smithie 170x2 nie pełny zakres\nMartwy 190x1 PR - technika do poprawy",
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
                        notes: row.notes || "",
                        data: row.data || [],
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

function deleteCurrentPlan() {
    if (currentMode === 'edit') return;
    const p = plans[currentPlan];
    if (!p) return alert("Nie wybrano planu.");
    if (p.isLocked) return alert("Nie możesz usunąć oficjalnego planu domyślnego.");

    if (confirm(`Czy na pewno chcesz usunąć plan "${currentPlan}" lokalnie?`)) {
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
        alert("Plan został usunięty.");
    }
}

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
        alert(`Klucz "${p.accessKey}" został przypisany!`);
    }
}

function checkAdminBadge() {
    const badge = document.getElementById("adminBadge");
    if (badge) {
        badge.style.display = isAdmin ? "flex" : "none";
    }
}

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
                const parts = l.split("\t");
                notes = parts[1] ? parts[1].replace(/\[BR\]/g, "\n") : "";
            } else if (l.trim() !== "") {
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
        alert("Pobieram plan...");
    }
}

function openExport() {
    if (currentMode === 'edit') return;
    const p = plans[currentPlan];
    if (!p) return;

    let lines = [`!!NOTES!!\t${(p.notes || "").replace(/\n/g, "[BR]")}`];
    (p.data || []).forEach(r => lines.push(r.join("\t")));
    
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

function addExcelRow() { if (hotInstance) hotInstance.alter('insert_row_below'); }
function addExcelCol() { if (hotInstance) hotInstance.alter('insert_col_right'); }

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

// STRUKTURA PLANU
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

        const isRestWord = (str) => {
            const s = str.toLowerCase();
            return s.includes('rest') || s.includes('wolne') || s.includes('pauza') || s.includes('regeneracja');
        };

        if (col0.toLowerCase().startsWith('dzień') || (col0 && !col1 && isNaN(col0))) {
            const isRest = isRestWord(col0) || isRestWord(col1);
            const fullDayTitle = col1 ? `${col0} - ${col1}` : col0;
            currentDay = { name: fullDayTitle, isRest, exercises: [] };
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
                data: rowData,
                rawRow: row
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

function ensurePlanEditable() {
    if (plans[currentPlan].isLocked) {
        const copyName = currentPlan.replace(" - by Koziar", "").replace(" (Domyślny)", "") + " (Mój Plan)";
        plans[copyName] = JSON.parse(JSON.stringify(plans[currentPlan]));
        plans[copyName].isLocked = false;
        currentPlan = copyName;
        initPlanSelect();
    }
}

function updateCellDirectly(rowIndex, colIndex, value) {
    ensurePlanEditable();
    plans[currentPlan].data[rowIndex][colIndex] = value;

    if (colIndex === 0) {
        reorderExercisesInDay(rowIndex, value);
    }

    saveAll();
    renderGymView();
}

function reorderExercisesInDay(targetRowIdx, newNrVal) {
    const sheetData = plans[currentPlan].data;
    const targetNr = parseFloat(newNrVal);
    if (isNaN(targetNr)) return;

    let dayStart = targetRowIdx;
    while (dayStart > 0 && !String(sheetData[dayStart][0]).toLowerCase().startsWith('dzień')) {
        dayStart--;
    }

    let dayEnd = targetRowIdx;
    while (dayEnd < sheetData.length - 1 && !String(sheetData[dayEnd + 1][0]).toLowerCase().startsWith('dzień')) {
        dayEnd++;
    }

    let exRows = [];
    for (let i = dayStart; i <= dayEnd; i++) {
        const nr = parseFloat(sheetData[i][0]);
        if (!isNaN(nr)) {
            exRows.push(sheetData[i]);
        }
    }

    exRows.sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

    let exCounter = 0;
    for (let i = dayStart; i <= dayEnd; i++) {
        const isExRow = !isNaN(parseFloat(sheetData[i][0]));
        if (isExRow && exRows[exCounter]) {
            sheetData[i] = exRows[exCounter];
            exCounter++;
        }
    }
}

function updateSubSetCellDirectly(parentRowIndex, setIdx, headerName, value) {
    ensurePlanEditable();
    const sheetData = plans[currentPlan].data;
    const parentRow = sheetData[parentRowIndex];
    const parentNr = parentRow[0];
    const targetNr = `${parentNr}.${setIdx + 1}`;

    const headers = parseSheetToStructure().headers;
    const colIdx = headers.find(h => h.name === headerName)?.colIdx;
    if (colIdx === undefined) return;

    let subRowIndex = -1;
    for (let i = parentRowIndex + 1; i < sheetData.length; i++) {
        if (sheetData[i][0] === targetNr) {
            subRowIndex = i;
            break;
        }
        if (sheetData[i][0] && !String(sheetData[i][0]).includes('.')) break;
    }

    if (subRowIndex !== -1) {
        sheetData[subRowIndex][colIdx] = value;
    } else {
        let newRow = new Array(parentRow.length).fill("");
        newRow[0] = targetNr;
        newRow[1] = `${parentRow[1]} (Seria ${setIdx + 1})`;
        newRow[colIdx] = value;
        sheetData.splice(parentRowIndex + 1 + setIdx, 0, newRow);
    }

    saveAll();
}

function toggleCheck(key, target, value, totalSubSets = 0) {
    if (!checks[key]) checks[key] = {};

    if (target === 'main') {
        checks[key].main = value;
        for (let s = 0; s < totalSubSets; s++) {
            checks[key][`sub_${s}`] = value;
        }
    } else if (target.startsWith('sub_')) {
        checks[key][target] = value;
        let allSubsChecked = true;
        for (let s = 0; s < totalSubSets; s++) {
            if (!checks[key][`sub_${s}`]) {
                allSubsChecked = false;
                break;
            }
        }
        checks[key].main = allSubsChecked;
    }

    saveAll();
    renderGymView();
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

    gymView.innerHTML = days.map((day, di) => {
        let hasAnyCheckedInDay = false;

        if (!day.isRest) {
            day.exercises.forEach((ex, ei) => {
                const key = `${currentPlan}-${di}-${ei}`;
                if (checks[key]?.main) hasAnyCheckedInDay = true;
                
                const count = parseInt(ex.data['S']?.val || ex.data['s']?.val) || 1;
                for (let s = 0; s < count; s++) {
                    if (checks[key]?.[`sub_${s}`]) hasAnyCheckedInDay = true;
                }
            });
        }

        return `
        <div class="day-card ${day.isRest ? 'rest-day' : ''} ${hasAnyCheckedInDay ? 'active-day' : ''}">
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
                        if (String(ex.nr).includes('.')) return '';

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
                                    <input type="checkbox" ${mainChecked ? 'checked' : ''} onchange="toggleCheck('${key}', 'main', this.checked, ${count})">
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
                                            <input type="text" class="cell-input" value="${cellData.val}" ${isReadOnlyAttr} onchange="updateCellDirectly(${ex.rowIndex},${cellData.colIdx}, this.value)">
                                        </div>
                                    `;
                                }).join('')}
                            </div>

                            ${(isExpanded && currentMode === 'pro') ? Array.from({length: count}).map((_, s) => {
                                const subChecked = checks[key]?.[`sub_${s}`] || false;
                                const subNr = `${ex.nr}.${s+1}`;

                                const existingSubRow = plans[currentPlan].data.find(r => r && r[0] === subNr);

                                return `
                                    <div class="row-grid sub-row ${subChecked ? 'done' : ''}">
                                        <div class="col-cell expand-col"></div>
                                        <div class="col-cell check-col">
                                            <input type="checkbox" ${subChecked ? 'checked' : ''} onchange="toggleCheck('${key}', 'sub_${s}', this.checked, ${count})">
                                        </div>
                                        <div class="col-cell nr-col" style="font-size:10px;">${subNr}</div>
                                        <div class="col-cell name-col" style="font-size:11px; color:var(--text-dim);">Seria ${s+1}</div>${activeHeaders.map(h => {
                                            if (h.name.toUpperCase() === 'S') return `<div class="col-cell" style="color:var(--text-dim);">-</div>`;
                                            const subVal = existingSubRow ? (existingSubRow[h.colIdx] || '') : '';
                                            return `
                                                <div class="col-cell">
                                                    <input type="text" class="cell-input" value="${subVal}" ${isReadOnlyAttr} placeholder="-" onchange="updateSubSetCellDirectly(${ex.rowIndex}, ${s}, '${h.name}', this.value)">
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                `;
                            }).join('') : ''}
                        `;
                    }).join('')}
                </div>
            </div>` : '<div class="rest-day-box"><i data-lucide="coffee"></i><span>Dzień na regenerację i odpoczynek 💪</span></div>'}
        </div>
    `;
    }).join('');

    if (window.lucide) lucide.createIcons();
}

function toggleExpand(key) { expandedExercises[key] = !expandedExercises[key]; renderGymView(); }

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
    if (confirm("Resetować zaznaczone serie i podświetlenia?")) {
        checks = {};
        saveAll();
        renderGymView();
    }
}

function downloadXLSXStyled() {
    const p = plans[currentPlan];
    if (!p) return;

    const rawData = p.data || [];

    // Kolory MSO zgodne z Excel / OpenOffice / LibreOffice
    const COLOR_GOLD_HEADER = "#E5B024"; 
    const COLOR_DAY_ACTIVE = "#F1C232";  
    const COLOR_DAY_REST = "#666666";    
    const COLOR_TEXT_DARK = "#000000";
    const COLOR_TEXT_LIGHT = "#FFFFFF";
    const COLOR_ROW_ALT = "#EFEFEF";    
    const COLOR_BORDER = "#000000";     

    let htmlContent = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <!--[if gte mso 9]>
        <xml>
            <x:ExcelWorkbook>
                <x:ExcelWorksheets>
                    <x:ExcelWorksheet>
                        <x:Name>Plan Treningowy</x:Name>
                        <x:WorksheetOptions>
                            <x:DisplayGridlines/>
                        </x:WorksheetOptions>
                    </x:ExcelWorksheet>
                </x:ExcelWorksheets>
            </x:ExcelWorkbook>
        </xml>
        <![endif]-->
    </head>
    <body style="background-color:#ffffff; font-family:Arial, sans-serif;">
        <table border="1" cellspacing="0" cellpadding="5" style="border-collapse:collapse; border:1px solid ${COLOR_BORDER}; font-family:Arial, sans-serif; font-size:10pt;">
            
            <!-- DEFINICJA SZEROKOŚCI KOLUMN (Brak zawijania + zapas miejsca) -->
            <colgroup>
                <col width="50" style="width:50px;" />
                <col width="320" style="width:320px;" />
                <col width="50" style="width:50px;" />
                <col width="80" style="width:80px;" />
                <col width="60" style="width:60px;" />
            </colgroup>

            <!-- WIERSZ GŁÓWNY NAGŁÓWKOWY (ZŁOTY) -->
            <tr style="background-color:${COLOR_GOLD_HEADER}; font-weight:bold; color:${COLOR_TEXT_DARK};">
                <td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${COLOR_GOLD_HEADER}; white-space:nowrap;">Nr</td>
                <td style="border:1px solid ${COLOR_BORDER}; text-align:left; background-color:${COLOR_GOLD_HEADER}; white-space:nowrap;">Ćwiczenie</td>
                <td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${COLOR_GOLD_HEADER}; white-space:nowrap;">S</td>
                <td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${COLOR_GOLD_HEADER}; white-space:nowrap;">P</td>
                <td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${COLOR_GOLD_HEADER}; white-space:nowrap;">KG</td>
            </tr>
    `;

    let dataRowCounter = 0;

    rawData.forEach((row) => {
        if (!row || row.every(c => c === null || c === '')) return;

        const col0 = String(row[0] || '').trim();
        const col1 = String(row[1] || '').trim();

        const isRest = col0.toLowerCase().includes('rest') || col1.toLowerCase().includes('rest');

        // NAGŁÓWEK DZIEŃ (NP. DZIEŃ 1 - FBW A / DZIEŃ 2 REST)
        if (col0.toLowerCase().startsWith('dzień') || (col0 && !col1 && isNaN(col0))) {
            const dayTitle = col1 ? `${col0} ${col1}` : col0;
            const bgDay = isRest ? COLOR_DAY_REST : COLOR_DAY_ACTIVE;
            const textDay = isRest ? COLOR_TEXT_LIGHT : COLOR_TEXT_DARK;

            htmlContent += `
                <tr style="background-color:${bgDay}; font-weight:bold; color:${textDay};">
                    <td colspan="2" style="border:1px solid ${COLOR_BORDER}; text-align:left; background-color:${bgDay}; color:${textDay}; font-weight:bold; white-space:nowrap;">${dayTitle.toUpperCase()}</td>
                    <td style="border:1px solid ${COLOR_BORDER}; background-color:${bgDay};"></td>
                    <td style="border:1px solid ${COLOR_BORDER}; background-color:${bgDay};"></td>
                    <td style="border:1px solid ${COLOR_BORDER}; background-color:${bgDay};"></td>
                </tr>
            `;
            dataRowCounter = 0;
        } 
        // POMIJA POWTÓRZONE NAGŁÓWKI DANYCH W KODZIE
        else if (col0.toLowerCase() === 'nr' || col1.toLowerCase() === 'ćwiczenie') {
            return;
        } 
        // WIERSZE DANYCH (ĆWICZENIA)
        else {
            const bgRow = (dataRowCounter % 2 === 1) ? COLOR_ROW_ALT : "#FFFFFF";
            const isSubRow = col0.includes('.');

            htmlContent += `
                <tr style="background-color:${bgRow};">
                    <td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${bgRow}; white-space:nowrap; ${isSubRow ? 'font-size:9pt; color:#555;' : ''}">${row[0] || ''}</td>
                    <td style="border:1px solid ${COLOR_BORDER}; text-align:left; background-color:${bgRow}; white-space:nowrap; font-weight:${isSubRow ? 'normal' : 'bold'};">${row[1] || ''}</td>
                    <td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${bgRow}; white-space:nowrap;">${row[2] || ''}</td>
                    <td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${bgRow}; white-space:nowrap;">${row[3] || ''}</td>
                    <td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${bgRow}; white-space:nowrap;">${row[4] || ''}</td>
                </tr>
            `;
            dataRowCounter++;
        }
    });

    htmlContent += `
        </table>
    </body>
    </html>
    `;

    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = "KOZIAR_FIT_" + currentPlan.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".xls";
    link.click();
}

function downloadTSV() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([document.getElementById("exportText").value], { type: "text/tab-separated-values" }));
    a.download = "KOZIAR_FIT_" + currentPlan.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".tsv";
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