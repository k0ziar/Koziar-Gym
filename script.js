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
var expandedExercises = {};

var unlockedKeys = JSON.parse(localStorage.getItem('koziar_unlocked_keys')) || [];

var defaultPlans = {
    "FBW 3-Dniowy (Domyślny) - by Koziar": {
        isLocked: true,
        notes: "Plan ogólny dostępny dla każdego.",
        data: [
            ["Dzień 1 - FBW A", "", "", "", "", "", ""],
            ["Nr", "Ćwiczenie", "S", "P", "KG", "RIR", "REST"],
            ["1", "Przysiady ze sztangą na plecach", "4", "8-10", "100", "2", "120s"]
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
                loadedPlans[row.plan_name] = {
                    isLocked: false,
                    notes: row.notes,
                    data: row.data,
                    accessKey: row.access_key,
                    ownerDeviceId: row.user_device_id
                };
                if (row.checks) checks = { ...checks, ...row.checks };
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

// PRZEŁĄCZANIE TRYBU BASIC / PRO W JEDNYM PRZYCISKU
function toggleViewMode() {
    if (currentMode === 'basic') {
        currentMode = 'pro';
    } else {
        currentMode = 'basic';
    }
    
    const btn = document.getElementById('btnToggleMode');
    if (btn) {
        btn.innerHTML = currentMode === 'pro' 
            ? `<i data-lucide="layers"></i> Tryb: PRO` 
            : `<i data-lucide="check-square"></i> Tryb: BASIC`;
    }

    setMode(currentMode);
}

// SKUTECZNE USUWANIE PLANU
async function deleteCurrentPlan() {
    const p = plans[currentPlan];
    if (!p) return alert("Nie wybrano planu.");
    if (p.isLocked) return alert("Nie możesz usunąć oficjalnego planu domyślnego.");

    if (confirm(`Czy na pewno chcesz usunąć plan "${currentPlan}"?`)) {
        // 1. Usunięcie z bazy Supabase
        if (window.sbClient) {
            try {
                const targetDeviceId = p.ownerDeviceId || deviceId;
                await window.sbClient
                    .from('user_plans')
                    .delete()
                    .eq('user_device_id', targetDeviceId)
                    .eq('plan_name', currentPlan);
            } catch (err) {
                console.error("Błąd bazy danych:", err);
            }
        }

        // 2. Czyszczenie klucza dostępu, aby plan nie wracał przy pobieraniu z chmury
        if (p.accessKey) {
            unlockedKeys = unlockedKeys.filter(k => k !== p.accessKey);
            localStorage.setItem('koziar_unlocked_keys', JSON.stringify(unlockedKeys));
        }

        // 3. Usunięcie ze stanu lokalnego
        delete plans[currentPlan];
        localStorage.setItem('koziar_plans', JSON.stringify(plans));

        // 4. Przełączenie na plan domyślny
        currentPlan = Object.keys(plans)[0];
        localStorage.setItem('koziar_current_plan', currentPlan);

        initPlanSelect();
        renderGymView();
        alert("Plan został pomyślnie usunięty.");
    }
}

// DYSKRETNE WEJŚCIE W TRYB ADMINA
function secretAdminPrompt() {
    const pin = prompt("Wprowadź Kod Dostępu / PIN Trenera:");
    if (pin === ADMIN_PIN) {
        isAdmin = true;
        localStorage.setItem('koziar_is_admin', 'true');
        alert("Zalogowano w trybie TRENERA!");
        location.reload();
    } else if (pin) {
        // Jeśli wpisano jakikolwiek inny ciąg znaków, traktujemy go jako Klucz Planu!
        unlockedKeys.push(pin.trim());
        localStorage.setItem('koziar_unlocked_keys', JSON.stringify(unlockedKeys));
        loadPlansFromCloud();
        alert("Sprawdzam kod i pobieram plan...");
    }
}

function logoutAdmin() {
    isAdmin = false;
    localStorage.setItem('koziar_is_admin', 'false');
    localStorage.removeItem('koziar_plans');
    alert("Wylogowano z trybu Trenera.");
    location.reload();
}

function setPlanAccessKey() {
    if (!isAdmin) return alert("Wymagany tryb Trenera!");
    const p = plans[currentPlan];
    if (!p || p.isLocked) return alert("Wybierz własny plan.");

    const key = prompt(`Ustaw Klucz Dostępu dla podopiecznego dla planu "${currentPlan}":`, p.accessKey || "");
    if (key !== null) {
        p.accessKey = key.trim();
        saveAll();
        initPlanSelect();
        alert(`Klucz "${p.accessKey}" został zapisany!`);
    }
}

// POLĄCZONY MODAL IMPORTU / KODÓW
function openImport() {
    document.getElementById("importModal").classList.add("active");
}

function handleImportOrKey() {
    const val = document.getElementById("importInputVal").value.trim();
    if (!val) return;

    if (val === ADMIN_PIN) {
        secretAdminPrompt();
        closeModals();
        return;
    }

    // Sprawdzamy czy to kod czy wklejony tekst TSV
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
        // Traktuj jako kod dostępu
        if (!unlockedKeys.includes(val)) {
            unlockedKeys.push(val);
            localStorage.setItem('koziar_unlocked_keys', JSON.stringify(unlockedKeys));
        }
        loadPlansFromCloud();
        closeModals();
        alert("Pobieram plan przypisany do kodu...");
    }
}

// POŁĄCZONY MODAL EKSPORTU I KODU NADAWANIA
function openExport() {
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

// RENDEROWANIE I INTERFEJS
function initPlanSelect() {
    const select = document.getElementById("planSelect");
    if (!select) return;
    select.innerHTML = "";
    
    const gOfficial = document.createElement("optgroup");
    gOfficial.label = "📋 KLASYKI KOZIARA";
    const gUser = document.createElement("optgroup");
    gUser.label = isAdmin ? "👑 WSZYSTKIE PLANY (TRENER)" : "💪 TWOJE PLANY";

    Object.keys(plans).forEach(name => {
        const keyTag = plans[name].accessKey ? ` 🔑[${plans[name].accessKey}]` : '';
        const opt = new Option(name + keyTag, name);
        if (plans[name].isLocked) gOfficial.appendChild(opt);
        else gUser.appendChild(opt);
    });

    if (gOfficial.children.length > 0) select.appendChild(gOfficial);
    if (gUser.children.length > 0) select.appendChild(gUser);

    if (!plans[currentPlan]) currentPlan = Object.keys(plans)[0];
    select.value = currentPlan;
}

function loadPlan() {
    currentPlan = document.getElementById("planSelect").value;
    saveAll();
    renderGymView();
}

function setMode(mode) {
    currentMode = mode;
    const gymView = document.getElementById('gymView');
    const editArea = document.getElementById('editArea');

    if (mode === 'edit') {
        gymView.style.display = 'none';
        editArea.style.display = 'block';
        initExcel();
    } else {
        if (hotInstance) saveSheetData();
        editArea.style.display = 'none';
        gymView.style.display = 'block';
        renderGymView();
    }
}

function initExcel() {
    const container = document.getElementById('excelContainer');
    if (!container) return;
    container.style.display = 'block';
    container.innerHTML = '';

    const p = plans[currentPlan];
    hotInstance = new Handsontable(container, {
        data: JSON.parse(JSON.stringify(p.data)),
        rowHeaders: true,
        colHeaders: true,
        height: '60vh',
        licenseKey: 'non-commercial-and-evaluation',
        contextMenu: true,
        manualColumnResize: true,
        manualRowResize: true,
        stretchH: 'all',
        readOnly: p.isLocked,
        afterChange: () => saveSheetData()
    });
}

function saveSheetData() {
    if (hotInstance && plans[currentPlan] && !plans[currentPlan].isLocked) {
        plans[currentPlan].data = hotInstance.getData();
        saveAll();
    }
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

function renderGymView() {
    const p = plans[currentPlan];
    if (!p) return;

    const notesEl = document.getElementById("planNotes");
    if (notesEl) {
        notesEl.value = p.notes || "";
        notesEl.readOnly = p.isLocked;
    }

    const lockedFooter = document.getElementById("lockedFooter");
    if (lockedFooter) lockedFooter.style.display = p.isLocked ? "block" : "none";

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
                                            const cellData = ex.data[h.name] || { val: '' };
                                            return `
                                                <div class="col-cell">
                                                    <input type="text" class="cell-input" value="${cellData.val}" ${isReadOnlyAttr} placeholder="${h.name}">
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                `;
                            }).join('') : ''}
                        `;
                    }).join('')}
                </div>
            </div>` : '<div style="padding:16px; text-align:center; color:var(--text-dim); font-size:12px; font-weight:600;">Dzień na regenerację 💪</div>'}
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
    const name = prompt("Nazwa nowego planu:");
    if (name && name.trim()) {
        plans[name] = {
            isLocked: false,
            notes: "",
            ownerDeviceId: deviceId,
            data: [
                ["Dzień 1 - Trening A", "", "", "", "", ""],
                ["Nr", "Ćwiczenie", "S", "P", "KG", "REST"],
                ["1", "Nowe Ćwiczenie", "3", "10", "50", "90s"]
            ]
        };
        currentPlan = name;
        saveAll();
        initPlanSelect();
        renderGymView();
    }
}

function resetWeek() {
    if (confirm("Resetować zaznaczone serie?")) {
        checks = {};
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
    
    // Obsługa ukrytego wejścia w Admina (Kliknięcie logo w nagłówku)
    const logoHeader = document.querySelector('.app-header h1, .brand-logo');
    if (logoHeader) {
        logoHeader.addEventListener('click', secretAdminPrompt);
    }
});