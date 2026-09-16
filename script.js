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

// USTAWIENIA ADMINA / KODÓW
const ADMIN_PIN = "0000"; // Tajny PIN Trenera
var isAdmin = localStorage.getItem('koziar_is_admin') === 'true';

var deviceId = localStorage.getItem('koziar_device_id');
if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('koziar_device_id', deviceId);
}

// STANY APLIKACJI
var currentMode = 'basic';
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

// ZAPIS LOKALNY I W CHMURZE
function saveAll() {
    // W trybie Admina NIE zapisujemy planów innych osób do stałego localStorage zwykłego usera
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

        const { error } = await window.sbClient
            .from('user_plans')
            .upsert(payload, { onConflict: 'user_device_id, plan_name' });

        if (error) console.error("Błąd zapisu w Supabase:", error.message);
        else console.log(`Plan "${planName}" pomyślnie zsynchronizowany.`);
    } catch (err) {
        console.warn("Brak połączenia z chmurą.");
    }
}

// POBIERANIE PLANÓW W ZALEŻNOŚCI OD UPRAWNIEŃ
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

        if (!error && data && data.length > 0) {
            // Czyścimy obecną listę dynamicznych planów przed załadowaniem z bazy
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

// LOGIKA ADMINA I KLUCZY
function toggleAdminMode() {
    if (isAdmin) {
        isAdmin = false;
        localStorage.setItem('koziar_is_admin', 'false');
        // Resetujemy zapisane lokalnie plany do domyślnych, aby czyściło plany podopiecznych!
        localStorage.removeItem('koziar_plans');
        alert("Wylogowano z trybu Trenera. Przywracanie widoku użytkownika...");
        location.reload();
    } else {
        const pin = prompt("Wprowadź PIN Trenera:");
        if (pin === ADMIN_PIN) {
            isAdmin = true;
            localStorage.setItem('koziar_is_admin', 'true');
            alert("Zalogowano jako TRENER!");
            location.reload();
        } else if (pin) {
            alert("Błędny PIN!");
        }
    }
}

function unlockPlanWithKey() {
    const key = prompt("Wpisz Klucz Dostępu do Planu odebranego od Trenera:");
    if (key && key.trim()) {
        const cleanKey = key.trim();
        if (!unlockedKeys.includes(cleanKey)) {
            unlockedKeys.push(cleanKey);
            localStorage.setItem('koziar_unlocked_keys', JSON.stringify(unlockedKeys));
        }
        loadPlansFromCloud();
        alert("Sprawdzam kod i pobieram plan...");
    }
}

function setPlanAccessKey() {
    if (!isAdmin) {
        alert("Tylko Trener może nadawać kody dostępu! Zaloguj się przyciskiem TRENER.");
        return;
    }
    
    const p = plans[currentPlan];
    if (!p) return alert("Wybierz najpierw plan!");
    if (p.isLocked) return alert("Nie możesz ustawić klucza dla oficjalnego planu domyślnego.");

    const currentKey = p.accessKey || "";
    const key = prompt(`Ustaw Klucz Dostępu dla planu "${currentPlan}":`, currentKey);
    
    if (key !== null) {
        p.accessKey = key.trim();
        saveAll();
        initPlanSelect();
        alert(`Klucz "${p.accessKey}" został przypisany i zapisany w bazie!`);
    }
}

// INTERFEJS I LOGIKA WIDOKU
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
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active', 'active-edit', 'active-pro'));

    const badge = document.getElementById('modeBadge');
    if (badge) {
        badge.className = 'mode-badge mode-' + mode;
        badge.innerText = (isAdmin ? "👑 TRENER | " : "") + (mode === 'edit' ? 'EDYCJA' : 'TRYB ' + mode.toUpperCase());
    }

    const gymView = document.getElementById('gymView');
    const editArea = document.getElementById('editArea');

    if (mode === 'edit') {
        if (document.getElementById('btnEdit')) document.getElementById('btnEdit').classList.add('active-edit');
        gymView.style.display = 'none';
        editArea.style.display = 'block';
        initExcel();
    } else {
        if (mode === 'basic' && document.getElementById('btnBasic')) document.getElementById('btnBasic').classList.add('active');
        if (mode === 'pro' && document.getElementById('btnPro')) document.getElementById('btnPro').classList.add('active', 'active-pro');
        
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

function addRow(count = 5) {
    if (hotInstance && !plans[currentPlan].isLocked) {
        hotInstance.alter('insert_row_below', hotInstance.countRows(), count);
    }
}

function addCol() {
    if (plans[currentPlan].isLocked) return;
    plans[currentPlan].data.forEach((row, idx) => {
        if (idx === 1) row.push("Nowa");
        else row.push("");
    });
    saveAll();
    if (hotInstance) initExcel();
}

function clearSheet() {
    if (plans[currentPlan].isLocked) return;
    if (confirm("Czy na pewno chcesz wyczyścić ten arkusz?")) {
        plans[currentPlan].data = [["Dzień 1", "", "", "", ""], ["Nr", "Ćwiczenie", "S", "P", "KG"]];
        saveAll();
        initExcel();
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

function autoHeight(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
function saveNotes() {
    if (plans[currentPlan] && !plans[currentPlan].isLocked) {
        plans[currentPlan].notes = document.getElementById("planNotes").value;
        saveAll();
    }
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

function openExport() {
    const p = plans[currentPlan];
    let lines = [`!!NOTES!!\t${(p.notes || "").replace(/\n/g, "[BR]")}`];
    p.data.forEach(r => lines.push(r.join("\t")));
    document.getElementById("exportText").value = lines.join("\n");
    document.getElementById("exportModal").classList.add("active");
}

function downloadTSV() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([document.getElementById("exportText").value], { type: "text/tab-separated-values" }));
    a.download = currentPlan.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".tsv";
    a.click();
}

function openImport() { document.getElementById("importModal").classList.add("active"); }

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { document.getElementById("importText").value = ev.target.result; };
    reader.readAsText(file);
}

function applyImport() {
    const txt = document.getElementById("importText").value.trim();
    if (!txt) return;

    const lines = txt.split("\n");
    let notes = "";
    let data = [];

    lines.forEach(l => {
        if (l.startsWith("!!NOTES!!")) {
            notes = l.split("\t")[1]?.replace(/\[BR\]/g, "\n") || "";
        } else {
            data.push(l.split("\t"));
        }
    });

    const name = prompt("Podaj nazwę dla importowanego planu:", "Importowany Plan");
    if (name && name.trim()) {
        plans[name] = { isLocked: false, notes, data, ownerDeviceId: deviceId };
        currentPlan = name;
        saveAll();
        initPlanSelect();
        closeModals();
        renderGymView();
    }
}

function openAbout() { document.getElementById("aboutModal").classList.add("active"); }
function closeModals() { document.querySelectorAll(".modal").forEach(m => m.classList.remove("active")); }

// INICJALIZACJA
document.addEventListener("DOMContentLoaded", () => {
    initPlanSelect();
    renderGymView();
    loadPlansFromCloud();
});