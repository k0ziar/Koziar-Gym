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
var editView = 'visual';
var hotInstance = null;
var tempExcelData = null;
var expandedExercises = {};

var unlockedKeys = JSON.parse(localStorage.getItem('koziar_unlocked_keys')) || [];
var hiddenPlans = JSON.parse(localStorage.getItem('koziar_hidden_plans')) || [];

// BAZA PLANÓW W PAMIĘCI APLIKACJI (POBIERANA Z SUPABASE)
var plans = JSON.parse(localStorage.getItem('koziar_plans')) || {};
var currentPlan = localStorage.getItem('koziar_current_plan') || '';
var checks = JSON.parse(localStorage.getItem('koziar_checks')) || {};
var resetCheckPlans = JSON.parse(localStorage.getItem('koziar_reset_check_plans')) || [];

const CLASSIC_PLAN_NAMES = [
    '3-dniowy FBW - by Koziar',
    '4-dniowy Upper/Lower - by Koziar',
    '5-dniowy U/L/PPL - by Koziar'
];
const CLASSIC_PLAN_NAME_KEYS = new Set(CLASSIC_PLAN_NAMES.map(name => name.toLowerCase()));

function isClassicPlan(planName) {
    return typeof planName === 'string' && CLASSIC_PLAN_NAME_KEYS.has(planName.trim().toLowerCase());
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function fitBasicExerciseNames() {
    document.querySelectorAll('.basic-table-grid .name-input').forEach(input => {
        input.style.height = 'auto';
        input.style.height = `${input.scrollHeight + 2}px`;
    });
}

function inlineStringArgument(value) {
    return escapeHtml(JSON.stringify(String(value)));
}

function saveAll() {
    if (!isAdmin) {
        localStorage.setItem('koziar_plans', JSON.stringify(plans));
    }
    localStorage.setItem('koziar_current_plan', currentPlan);
    localStorage.setItem('koziar_checks', JSON.stringify(checks));
    localStorage.setItem('koziar_reset_check_plans', JSON.stringify(resetCheckPlans));
    localStorage.setItem('koziar_hidden_plans', JSON.stringify(hiddenPlans));

    syncPlanToCloud(currentPlan);
}

async function syncPlanToCloud(planName) {
    if (!window.sbClient || !planName) return;
    const p = plans[planName];
    if (!p || (isClassicPlan(planName) && !isAdmin)) return;

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
        if (error) console.warn("Nie udało się zapisać planu w chmurze:", error.message);
    } catch (err) {
        console.warn("Brak połączenia z chmurą:", err);
    }
}

async function loadPlansFromCloud() {
    if (!window.sbClient) return;
    try {
        let queries = [];
        if (!isAdmin) {
            let userPlansQuery = window.sbClient.from('user_plans').select('*');
            if (unlockedKeys.length > 0) {
                userPlansQuery = userPlansQuery.or(
                    `user_device_id.eq.${deviceId},access_key.in.("${unlockedKeys.join('","')}")`
                );
            } else {
                userPlansQuery = userPlansQuery.eq('user_device_id', deviceId);
            }
            queries = [
                userPlansQuery,
                ...CLASSIC_PLAN_NAMES.map(planName =>
                    window.sbClient.from('user_plans').select('*').eq('plan_name', planName)
                )
            ];
        } else {
            queries = [window.sbClient.from('user_plans').select('*')];
        }

        const results = await Promise.all(queries);
        const failedResult = results.find(result => result.error);
        if (failedResult) {
            console.warn("Nie udało się pobrać planów z chmury:", failedResult.error.message);
            return;
        }
        const rowsById = new Map();
        results.forEach(result => {
            (result.data || []).forEach(row => {
                rowsById.set(`${row.user_device_id}:${row.plan_name}`, row);
            });
        });
        const data = [...rowsById.values()];

        if (data) {
            let loadedPlans = {};

            data.forEach(row => {
                if (!hiddenPlans.includes(row.plan_name) || isAdmin) {
                    loadedPlans[row.plan_name] = {
                        isLocked: isClassicPlan(row.plan_name),
                        notes: row.notes || "",
                        data: row.data || [],
                        accessKey: row.access_key,
                        ownerDeviceId: row.user_device_id
                    };
                    if (row.checks) {
                        const cloudChecks = Object.fromEntries(
                            Object.entries(row.checks).filter(([key]) =>
                                !resetCheckPlans.some(name => key.startsWith(`${name}-`))
                            )
                        );
                        checks = { ...checks, ...cloudChecks };
                    }
                }
            });

            if (isAdmin) {
                plans = loadedPlans;
            } else {
                const localUserPlans = Object.fromEntries(
                    Object.entries(plans).filter(([name, plan]) =>
                        !hiddenPlans.includes(name) && plan.ownerDeviceId === deviceId
                    )
                );
                plans = { ...localUserPlans, ...loadedPlans };
            }

            if (!isAdmin) {
                localStorage.setItem('koziar_plans', JSON.stringify(plans));
            }
            
            const availableKeys = Object.keys(plans);
            if (availableKeys.length > 0 && (!currentPlan || !plans[currentPlan])) {
                currentPlan = availableKeys[0];
            }

            initPlanSelect();
            renderGymView();
        }
    } catch (err) {
        console.log("Błąd ładowania z chmury:", err);
    }
}

function toggleViewMode() {
    if (currentMode === 'edit') return;
    if (!isAdmin && isClassicPlan(currentPlan)) {
        alert("Klasyki są zablokowane. Odblokuj plan, aby przełączać tryby.");
        return;
    }
    currentMode = (currentMode === 'basic') ? 'pro' : 'basic';
    updateNavButtons();
    setMode(currentMode);
}

function toggleEditMode() {
    if (currentMode === 'edit') return;
    if (!isAdmin && isClassicPlan(currentPlan)) {
        alert("Klasyki są w trybie podglądu. Kliknij 'Odblokuj plan', aby stworzyć edytowalną kopię.");
        return;
    }
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
    if (p.isLocked || isClassicPlan(currentPlan)) {
        return alert("Nie możesz usunąć oficjalnego planu klasycznego.");
    }

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

        currentPlan = Object.keys(plans)[0] || '';
        localStorage.setItem('koziar_current_plan', currentPlan);

        initPlanSelect();
        renderGymView();
        alert("Plan został usunięty.");
    }
}

function secretAdminPrompt(prefilledPin = null) {
    const pin = prefilledPin === null ? prompt("Wprowadź Kod Dostępu / PIN Trenera:") : prefilledPin;
    if (pin && pin.trim() === ADMIN_PIN) {
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
    if (!p || p.isLocked || isClassicPlan(currentPlan)) return alert("Wybierz własny odblokowany plan.");

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

function openIndividualPlanModal() {
    document.getElementById("individualModal").classList.add("active");
}

function unlockClassicPlanCopy() {
    const sourcePlan = plans[currentPlan];
    if (!sourcePlan || !isClassicPlan(currentPlan)) return;

    const suggestedName = `${currentPlan} (Mój Plan)`;
    const enteredName = prompt("Podaj własną nazwę dla swojej kopii planu:", suggestedName);
    if (enteredName === null) return;

    const copyName = enteredName.trim();
    if (!copyName) {
        alert("Nazwa kopii nie może być pusta.");
        return;
    }

    const normalizedCopyName = copyName.toLowerCase();
    if (
        Object.keys(plans).some(name => name.toLowerCase() === normalizedCopyName) ||
        hiddenPlans.some(name => name.toLowerCase() === normalizedCopyName)
    ) {
        alert(`Plan "${copyName}" już istnieje. Wybierz inną nazwę, aby nie tworzyć duplikatu.`);
        return;
    }

    plans[copyName] = {
        isLocked: false,
        notes: sourcePlan.notes || "",
        data: JSON.parse(JSON.stringify(sourcePlan.data || [])),
        ownerDeviceId: deviceId
    };

    currentPlan = copyName;
    saveAll();
    initPlanSelect();
    renderGymView();

    alert(`Utworzono Twoją prywatną kopię: "${copyName}".\n\n📌 Pamiętaj: Plan darmowy/gotowiec warto delikatnie dostosować do swoich możliwości i sprzętu. W razie pytań skontaktuj się ze mną!`);
}

function importPlanData(suggestedName, notes, data) {
    const defaultName = suggestedName || "Importowany Plan";
    const name = prompt("Nazwa dla importowanego planu:", defaultName);
    if (name && name.trim()) {
        const finalName = name.trim();
        if (plans[finalName] && !confirm(`Plan "${finalName}" już istnieje. Czy chcesz go zastąpić?`)) return;
        plans[finalName] = { isLocked: false, notes: notes || "", data: data || [], ownerDeviceId: deviceId };
        currentPlan = finalName;
        saveAll();
        initPlanSelect();
        closeModals();
        renderGymView();
        alert(`Plan "${finalName}" został pomyślnie zaimportowany!`);
    }
}

function handleImportOrKey() {
    const val = document.getElementById("importInputVal").value.trim();
    if (!val) return;

    if (val === ADMIN_PIN) {
        secretAdminPrompt(val);
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

        importPlanData("Importowany Plan", notes, data);
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
    (p.data || []).forEach(r => lines.push((r || []).map(cell => (cell === null || cell === undefined || cell === "null") ? "" : cell).join("\t")));
    
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
    gOfficial.label = "PLANY BEZPŁATNE";
    const gUser = document.createElement("optgroup");
    gUser.label = isAdmin ? "👑 WSZYSTKIE PLANY (TRENER)" : "💪 TWOJE PLANY";

    Object.keys(plans).forEach(name => {
        if (!hiddenPlans.includes(name) || isAdmin) {
            const keyTag = plans[name].accessKey ? ` 🔑[${plans[name].accessKey}]` : '';
            const isClassic = isClassicPlan(name);
            const opt = new Option(name + keyTag, name);
            if (isClassic) {
                gOfficial.appendChild(opt);
            } else {
                gUser.appendChild(opt);
            }
        }
    });

    if (gOfficial.children.length > 0) select.appendChild(gOfficial);
    if (gUser.children.length > 0) select.appendChild(gUser);

    if (!plans[currentPlan] && Object.keys(plans).length > 0) {
        currentPlan = Object.keys(plans)[0];
    }
    
    if (currentPlan) {
        select.value = currentPlan;
    }

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
    if (el && plans[currentPlan] && (isAdmin || !isClassicPlan(currentPlan))) {
        plans[currentPlan].notes = el.value;
        saveAll();
    }
}

function setMode(mode) {
    if (mode === 'edit' && !tempExcelData) {
        const plan = plans[currentPlan];
        if (!plan) return;
        tempExcelData = JSON.parse(JSON.stringify(plan.data || []));
        ensureVisualPlanStructure();
    }

    currentMode = mode;
    updateNavButtons();

    const gymView = document.getElementById('gymView');
    const editArea = document.getElementById('editArea');
    const notesContainer = document.getElementById('notesContainer');
    const bottomNav = document.getElementById('mainBottomNav');
    const planSelect = document.getElementById('planSelect');

    if (mode === 'edit') {
        document.body.classList.add('editing-active');
        gymView.style.display = 'none';
        notesContainer.style.display = 'none';
        editArea.style.display = 'block';
        bottomNav.classList.add('nav-locked');
        planSelect.disabled = true;
        changeEditView('visual');
    } else {
        document.body.classList.remove('editing-active');
        destroyExcelEditor();
        tempExcelData = null;
        editArea.style.display = 'none';
        notesContainer.style.display = 'block';
        gymView.style.display = 'block';
        bottomNav.classList.remove('nav-locked');
        planSelect.disabled = false;
        renderGymView();
    }
}

function isHeaderRow(row) {
    const first = String(row?.[0] || '').trim().toLowerCase();
    const second = String(row?.[1] || '').trim().toLowerCase();
    return first === 'nr' || second === 'ćwiczenie';
}

function ensureVisualPlanStructure() {
    if (!Array.isArray(tempExcelData)) tempExcelData = [];
    tempExcelData = tempExcelData.map(row => Array.isArray(row) ? row : []);

    let parsed = parseSheetToStructure(tempExcelData);
    if (parsed.days.length === 0) {
        tempExcelData.unshift(["Dzień 1 - Trening A", "", "", "", ""]);
        parsed = parseSheetToStructure(tempExcelData);
    }

    if (!tempExcelData.some(isHeaderRow)) {
        const firstDay = parsed.days[0];
        tempExcelData.splice(firstDay.rowIndex + 1, 0, ["Nr", "Ćwiczenie", "S", "P", "KG"]);
    }
}

function destroyExcelEditor() {
    if (hotInstance) {
        hotInstance.destroy();
        hotInstance = null;
    }
}

function changeEditView(view) {
    if (currentMode !== 'edit') return;
    if (hotInstance) {
        tempExcelData = hotInstance.getData();
        destroyExcelEditor();
    }

    editView = view === 'excel' ? 'excel' : 'visual';
    const visualContainer = document.getElementById('visualEditorContainer');
    const excelPanel = document.getElementById('excelEditorPanel');
    const visualTab = document.getElementById('visualEditTab');
    const excelTab = document.getElementById('excelEditTab');
    const isVisual = editView === 'visual';

    visualContainer.style.display = isVisual ? 'block' : 'none';
    excelPanel.style.display = isVisual ? 'none' : 'block';
    visualTab.classList.toggle('active', isVisual);
    visualTab.setAttribute('aria-selected', String(isVisual));
    excelTab.classList.toggle('active', !isVisual);
    excelTab.setAttribute('aria-selected', String(!isVisual));

    if (isVisual) renderVisualEditor();
    else initExcel();
}

function initExcel() {
    const container = document.getElementById('excelContainer');
    if (!container) return;
    destroyExcelEditor();
    container.style.display = 'block';
    container.innerHTML = '';

    if (!plans[currentPlan]) return;
    if (!tempExcelData) tempExcelData = [];

    hotInstance = new Handsontable(container, {
        data: tempExcelData,
        rowHeaders: true,
        colHeaders: true,
        height: window.matchMedia('(max-width: 700px)').matches ? '58vh' : '60vh',
        licenseKey: 'non-commercial-and-evaluation',
        contextMenu: true,
        minSpareRows: 1,
        minSpareCols: 1,
        manualColumnResize: true,
        manualRowResize: true,
        stretchH: 'all',
        readOnly: !isAdmin && isClassicPlan(currentPlan),
        editor: 'text',
        outsideClickDeselects: false,
        enterBeginsEditing: true,
        enterMoves: { row: 1, col: 0 },
        tabMoves: { row: 0, col: 1 },
        autoWrapRow: false,
        autoWrapCol: false,
        imeFastEdit: true,
        viewportRowRenderingOffset: 'auto',
        viewportColumnRenderingOffset: 'auto',
        observeDOMVisibility: true
    });
}

function addExcelRow() { if (hotInstance) hotInstance.alter('insert_row_below'); }
function addExcelCol() { if (hotInstance) hotInstance.alter('insert_col_right'); }

function saveEditChanges() {
    if (!plans[currentPlan] || (!isAdmin && isClassicPlan(currentPlan))) return;
    if (hotInstance) tempExcelData = hotInstance.getData();
    plans[currentPlan].data = tempExcelData || [];
    const notes = document.getElementById('visualPlanNotes');
    if (notes) plans[currentPlan].notes = notes.value;
    saveAll();
    setMode('basic');
}

function cancelEditChanges() {
    setMode('basic');
}

function saveExcelChanges() { saveEditChanges(); }
function cancelExcelChanges() { cancelEditChanges(); }

function parseSheetToStructure(raw = plans[currentPlan]?.data || []) {
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
                const headerName = String(row[i] || '').trim();
                if (headerName !== '') {
                    customHeaders.push({ name: headerName, colIdx: i });
                }
            }
            if (currentDay && currentDay.headerRowIndex === null) {
                currentDay.headerRowIndex = rowIndex;
                currentDay.headers = customHeaders.slice();
            }
            return;
        }

        const isRestWord = (str) => {
            const s = str.toLowerCase();
            return s.includes('rest') || s.includes('wolne') || s.includes('pauza') || s.includes('regeneracja');
        };

        if (col0.toLowerCase().startsWith('dzień') || col0.startsWith('#') || (col0 && !col1 && isNaN(col0))) {
            const isRest = isRestWord(col0) || isRestWord(col1);
            let fullDayTitle = col1 ? `${col0} - ${col1}` : col0;
            if (fullDayTitle.startsWith('# ')) fullDayTitle = fullDayTitle.substring(2);
            currentDay = {
                name: fullDayTitle,
                isRest,
                rowIndex,
                headerRowIndex: null,
                headers: customHeaders.slice(),
                exercises: []
            };
            days.push(currentDay);
        } else if (currentDay && (col0 !== '' || col1 !== '')) {
            let rowData = {};
            customHeaders.forEach(h => {
                const val = (row[h.colIdx] !== undefined && row[h.colIdx] !== null && row[h.colIdx] !== 'null') ? row[h.colIdx] : '';
                rowData[h.name] = { val, colIdx: h.colIdx };
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

    const allHeaders = [];
    raw.forEach(row => {
        if (!isHeaderRow(row)) return;
        for (let i = 2; i < row.length; i++) {
            const name = String(row[i] || '').trim();
            if (name && !allHeaders.some(header => header.name === name)) {
                allHeaders.push({ name, colIdx: i });
            }
        }
    });

    return { days, headers: allHeaders.length ? allHeaders : customHeaders };
}

function renderVisualEditor() {
    const container = document.getElementById('visualEditorContainer');
    if (!container) return;

    ensureVisualPlanStructure();
    const { days, headers } = parseSheetToStructure(tempExcelData);
    const plan = plans[currentPlan];

    container.innerHTML = `
        <div class="visual-toolbar">
            <details class="visual-settings">
                <summary>Notatki i parametry <span>${headers.map(header => escapeHtml(header.name)).join(' · ')}</span></summary>
                <div class="visual-settings-content">
                    <label class="visual-notes-label" for="visualPlanNotes">Notatki do planu</label>
                    <textarea id="visualPlanNotes" placeholder="Notatki do planu...">${escapeHtml(plan?.notes || '')}</textarea>
                    <div class="visual-parameters">
                        <strong>Kolumny w tabeli</strong>
                        <div class="visual-parameter-chips">
                            ${headers.map(header => `
                                <span class="visual-parameter-chip">
                                    <input aria-label="Nazwa parametru ${escapeHtml(header.name)}" value="${escapeHtml(header.name)}" onchange="renameVisualParameter(${header.colIdx}, this.value)">
                                    <button type="button" aria-label="Usuń parametr ${escapeHtml(header.name)}" onclick="removeVisualParameter(${header.colIdx})">×</button>
                                </span>
                            `).join('')}
                        </div>
                        <form class="visual-add-parameter" onsubmit="addVisualParameterFromForm(event)">
                            <input name="parameterName" placeholder="Nowy parametr (np. RIR)" aria-label="Nazwa nowego parametru">
                            <button class="btn btn-sm" type="submit">+ Dodaj parametr</button>
                        </form>
                    </div>
                </div>
            </details>
        </div>
        ${days.map((day, dayIndex) => `
            <section class="visual-day-card ${day.isRest ? 'rest-day' : ''}">
                <div class="visual-day-heading">
                    <div class="visual-day-title">
                        <span class="visual-day-number">${dayIndex + 1}.</span>
                        <input aria-label="Nazwa dnia treningowego" value="${escapeHtml(day.name)}" onchange="updateVisualCell(${day.rowIndex}, 0, this.value)">
                    </div>
                    <div class="visual-day-actions">
                        <button class="btn btn-sm" onclick="toggleVisualRest(${dayIndex})">${day.isRest ? 'Przywróć trening' : 'Dzień wolny'}</button>
                        <button class="btn btn-sm btn-danger" aria-label="Usuń dzień" onclick="removeVisualDay(${dayIndex})">Usuń</button>
                    </div>
                </div>
                ${day.isRest ? '<div class="visual-rest-hint">Dzień regeneracji</div>' : `
                    <div class="table-wrapper visual-plan-table">
                        <div class="table-grid">
                            <div class="row-grid row-header">
                                <div class="col-cell nr-col">Nr</div>
                                <div class="col-cell name-col">Ćwiczenie</div>
                                ${headers.map(header => `<div class="col-cell">${escapeHtml(header.name)}</div>`).join('')}
                                <div class="col-cell visual-action-col"></div>
                            </div>
                            ${day.exercises.map(exercise => `
                                <div class="row-grid visual-exercise-row">
                                    <div class="col-cell nr-col">
                                        <input class="cell-input" value="${escapeHtml(exercise.nr)}" aria-label="Numer ćwiczenia" onchange="updateVisualExerciseNumber(${exercise.rowIndex}, ${dayIndex}, this.value)">
                                    </div>
                                    <div class="col-cell name-col">
                                        <input class="cell-input name-input" value="${escapeHtml(exercise.name)}" placeholder="Nazwa ćwiczenia" aria-label="Nazwa ćwiczenia" onchange="updateVisualCell(${exercise.rowIndex}, 1, this.value)">
                                    </div>
                                    ${headers.map(header => `
                                        <div class="col-cell">
                                            <input class="cell-input" value="${escapeHtml(exercise.rawRow[header.colIdx] ?? '')}" aria-label="${escapeHtml(header.name)} dla ${escapeHtml(exercise.name || 'ćwiczenia')}" onchange="updateVisualCell(${exercise.rowIndex}, ${header.colIdx}, this.value)">
                                        </div>
                                    `).join('')}
                                    <div class="col-cell visual-action-col">
                                        <button class="btn visual-delete-row" aria-label="Usuń ćwiczenie ${escapeHtml(exercise.name)}" onclick="removeVisualExercise(${exercise.rowIndex})">×</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <button class="btn visual-add-exercise" onclick="addVisualExercise(${dayIndex})">+ Dodaj ćwiczenie</button>
                `}
            </section>
        `).join('')}
        <button class="btn btn-primary visual-add-day" onclick="addVisualDay()">+ Dodaj dzień treningowy</button>
    `;
}

function updateVisualCell(rowIndex, colIndex, value) {
    const row = tempExcelData?.[rowIndex];
    if (!row) return;
    while (row.length <= colIndex) row.push('');
    row[colIndex] = value;
}

function updateVisualExerciseNumber(rowIndex, dayIndex, value) {
    const previousNumber = String(tempExcelData?.[rowIndex]?.[0] || '').trim();
    updateVisualCell(rowIndex, 0, value);
    const nextNumber = String(value || '').trim();
    if (/^\d+$/.test(previousNumber) && /^\d+$/.test(nextNumber)) {
        const { days } = parseSheetToStructure(tempExcelData);
        days[dayIndex]?.exercises.forEach(exercise => {
            const exerciseNumber = String(exercise.nr || '');
            if (exercise.rowIndex !== rowIndex && exerciseNumber.startsWith(`${previousNumber}.`)) {
                tempExcelData[exercise.rowIndex][0] = `${nextNumber}${exerciseNumber.slice(previousNumber.length)}`;
            }
        });
    }
    sortVisualDayRows(dayIndex);
    renderVisualEditor();
}

function sortVisualDayRows(dayIndex) {
    const { days } = parseSheetToStructure(tempExcelData);
    const day = days[dayIndex];
    if (!day || day.exercises.length < 2) return;

    const rowIndexes = day.exercises.map(exercise => exercise.rowIndex);
    const sortedRows = rowIndexes
        .map((rowIndex, originalIndex) => ({ row: tempExcelData[rowIndex], originalIndex }))
        .sort((left, right) => {
            const leftNumber = String(left.row[0] || '').trim();
            const rightNumber = String(right.row[0] || '').trim();
            if (!leftNumber && rightNumber) return 1;
            if (leftNumber && !rightNumber) return -1;
            if (/^\d+(?:\.\d+)*$/.test(leftNumber) && /^\d+(?:\.\d+)*$/.test(rightNumber)) {
                const leftParts = leftNumber.split('.').map(Number);
                const rightParts = rightNumber.split('.').map(Number);
                for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index++) {
                    const difference = (leftParts[index] ?? -1) - (rightParts[index] ?? -1);
                    if (difference !== 0) return difference;
                }
                return left.originalIndex - right.originalIndex;
            }
            return leftNumber.localeCompare(rightNumber, undefined, { numeric: true, sensitivity: 'base' }) ||
                left.originalIndex - right.originalIndex;
        });

    rowIndexes.forEach((rowIndex, index) => {
        tempExcelData[rowIndex] = sortedRows[index].row;
    });
}

function getVisualHeaderRows() {
    return tempExcelData.map((row, index) => isHeaderRow(row) ? index : -1).filter(index => index >= 0);
}

function addVisualParameterFromForm(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.parameterName;
    const normalizedName = input.value.trim();
    if (!normalizedName) {
        input.focus();
        return;
    }
    if (getVisualHeaderRows().length === 0) {
        ensureVisualPlanStructure();
    }

    const currentHeaders = parseSheetToStructure(tempExcelData).headers;
    if (currentHeaders.some(header => header.name.toLowerCase() === normalizedName.toLowerCase())) {
        alert(`Parametr "${normalizedName}" już istnieje.`);
        return;
    }

    const columnIndex = Math.max(2, ...tempExcelData.map(row =>
        row.reduce((lastUsedColumn, cell, index) =>
            String(cell ?? '').trim() ? index + 1 : lastUsedColumn, 2)
    ));
    tempExcelData.forEach(row => {
        while (row.length <= columnIndex) row.push('');
    });
    getVisualHeaderRows().forEach(index => { tempExcelData[index][columnIndex] = normalizedName; });
    renderVisualEditor();
    const settings = document.querySelector('.visual-settings');
    if (settings) settings.open = true;
}

function renameVisualParameter(columnIndex, value) {
    const name = value.trim();
    if (!name) {
        alert('Nazwa parametru nie może być pusta.');
        renderVisualEditor();
        return;
    }
    const duplicate = parseSheetToStructure(tempExcelData).headers.some(header =>
        header.colIdx !== columnIndex && header.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
        alert(`Parametr "${name}" już istnieje.`);
        renderVisualEditor();
        return;
    }
    getVisualHeaderRows().forEach(index => { tempExcelData[index][columnIndex] = name; });
    renderVisualEditor();
    const settings = document.querySelector('.visual-settings');
    if (settings) settings.open = true;
}

function removeVisualParameter(columnIndex) {
    const header = parseSheetToStructure(tempExcelData).headers.find(item => item.colIdx === columnIndex);
    if (!header || !confirm(`Usunąć parametr "${header.name}" ze wszystkich dni planu?`)) return;
    tempExcelData.forEach(row => row.splice(columnIndex, 1));
    renderVisualEditor();
    const settings = document.querySelector('.visual-settings');
    if (settings) settings.open = true;
}

function addVisualDay() {
    const { days, headers } = parseSheetToStructure(tempExcelData);
    const dayNumber = days.length + 1;
    const headerLength = Math.max(2, ...headers.map(header => header.colIdx + 1));
    const dayRow = new Array(headerLength).fill('');
    const headerRow = new Array(headerLength).fill('');
    dayRow[0] = `Dzień ${dayNumber} - Trening`;
    headerRow[0] = 'Nr';
    headerRow[1] = 'Ćwiczenie';
    headers.forEach(header => { headerRow[header.colIdx] = header.name; });
    const newDayRows = [dayRow, headerRow];
    tempExcelData.push(...newDayRows);
    renderVisualEditor();
}

function addVisualExercise(dayIndex) {
    const { days, headers } = parseSheetToStructure(tempExcelData);
    const day = days[dayIndex];
    if (!day) return;
    const nextDay = days[dayIndex + 1];
    const insertionIndex = nextDay ? nextDay.rowIndex : tempExcelData.length;
    const lastNumber = day.exercises.reduce((max, exercise) => {
        const parsed = Number.parseInt(String(exercise.nr).split('.')[0], 10);
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 0);
    const row = new Array(Math.max(2, ...headers.map(header => header.colIdx + 1))).fill('');
    row[0] = String(lastNumber + 1);
    tempExcelData.splice(insertionIndex, 0, row);
    renderVisualEditor();
}

function removeVisualExercise(rowIndex) {
    if (!confirm('Usunąć to ćwiczenie z planu?')) return;
    tempExcelData.splice(rowIndex, 1);
    renderVisualEditor();
}

function removeVisualDay(dayIndex) {
    const { days } = parseSheetToStructure(tempExcelData);
    const day = days[dayIndex];
    if (!day || !confirm(`Usunąć dzień "${day.name}" wraz z ćwiczeniami?`)) return;
    const nextDay = days[dayIndex + 1];
    tempExcelData.splice(day.rowIndex, (nextDay ? nextDay.rowIndex : tempExcelData.length) - day.rowIndex);
    if (parseSheetToStructure(tempExcelData).days.length === 0) {
        tempExcelData.push(["Dzień 1 - Trening", "", "", "", ""], ["Nr", "Ćwiczenie", "S", "P", "KG"]);
    }
    renderVisualEditor();
}

function toggleVisualRest(dayIndex) {
    const day = parseSheetToStructure(tempExcelData).days[dayIndex];
    if (!day) return;
    let title = day.name;
    if (day.isRest) {
        title = title.replace(/\s*[-–]?\s*(wolne|rest|pauza|regeneracja)\s*/ig, '').trim();
        if (!title) title = `Dzień ${dayIndex + 1}`;
    } else if (!/wolne|rest|pauza|regeneracja/i.test(title)) {
        title += ' - Wolne';
    }
    tempExcelData[day.rowIndex][0] = title;
    if (tempExcelData[day.rowIndex].length > 1) tempExcelData[day.rowIndex][1] = '';
    renderVisualEditor();
}

function ensurePlanEditable() {
    if (!isAdmin && isClassicPlan(currentPlan)) {
        unlockClassicPlanCopy();
    }
}

function updateCellDirectly(rowIndex, colIndex, value) {
    ensurePlanEditable();
    plans[currentPlan].data[rowIndex][colIndex] = value;
    saveAll();
    renderGymView();
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
    if (!isAdmin && isClassicPlan(currentPlan)) return;

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
    const overlay = document.getElementById("classicOverlayContainer");
    const notesContainer = document.getElementById("notesContainer");
    const gymView = document.getElementById("gymView");

    if (!p) {
        if (gymView) gymView.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-dim);">Brak dostępnych planów. Pobieranie z bazy danych...</div>';
        if (overlay) overlay.style.display = "none";
        document.body.classList.remove("classic-preview-active");
        return;
    }

    const isLockedClassic = isClassicPlan(currentPlan) && !isAdmin;

    if (isLockedClassic) {
        if (overlay) overlay.style.display = "flex";
        document.body.classList.add("classic-preview-active");
        if (gymView) gymView.classList.add("classic-blurred-view");
    } else {
        if (overlay) overlay.style.display = "none";
        document.body.classList.remove("classic-preview-active");
        if (gymView) gymView.classList.remove("classic-blurred-view");
    }

    if (notesContainer) notesContainer.classList.toggle("classic-preview-notes", isLockedClassic);

    const notesEl = document.getElementById("planNotes");
    if (notesEl) {
        notesEl.value = p.notes || "";
        notesEl.readOnly = isLockedClassic;
    }

    if (!gymView) return;

    const { days, headers } = parseSheetToStructure();

    const activeHeaders = currentMode === 'basic' 
        ? headers.filter(h => ['S','P','KG'].includes(h.name.toUpperCase())) 
        : headers;

    const isReadOnlyAttr = isLockedClassic ? 'readonly' : '';
    const isCheckDisabled = isLockedClassic ? 'disabled' : '';

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
                <span>${escapeHtml(day.name)}</span>
                ${day.isRest ? '<span class="rest-badge">REGENERACJA</span>' : ''}
            </div>
            
            ${!day.isRest ? `
            <div class="table-wrapper ${currentMode === 'basic' ? 'basic-table-wrapper' : ''}">
                <div class="table-grid ${currentMode === 'basic' ? 'basic-table-grid' : ''}" ${currentMode === 'basic' ? `style="--basic-data-columns:${activeHeaders.length}"` : ''}>
                    <div class="row-grid row-header">
                        ${currentMode === 'pro' ? '<div class="col-cell expand-col"></div>' : ''}
                        <div class="col-cell check-col">✔</div>
                        <div class="col-cell nr-col">Nr</div>
                        <div class="col-cell name-col">Ćwiczenie</div>
                        ${activeHeaders.map(h => `<div class="col-cell">${escapeHtml(h.name)}</div>`).join('')}
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
                                    <button class="btn-expand" onclick="toggleExpand(${inlineStringArgument(key)})">
                                        <i data-lucide="${isExpanded ? 'chevron-down' : 'chevron-right'}" style="width:14px"></i>
                                    </button>
                                </div>` : ''}
                                
                                <div class="col-cell check-col">
                                    <input type="checkbox" ${mainChecked ? 'checked' : ''} ${isCheckDisabled} onchange="toggleCheck(${inlineStringArgument(key)}, 'main', this.checked, ${count})">
                                </div>
                                <div class="col-cell nr-col">
                                    <input type="text" class="cell-input" value="${escapeHtml(ex.nr)}" ${isReadOnlyAttr} onchange="updateCellDirectly(${ex.rowIndex}, 0, this.value)">
                                </div>
                                <div class="col-cell name-col">
                                    <textarea class="cell-input name-input" rows="1" ${isReadOnlyAttr} onchange="updateCellDirectly(${ex.rowIndex}, 1, this.value)">${escapeHtml(ex.name)}</textarea>
                                </div>
                                ${activeHeaders.map(h => {
                                    const cellData = ex.data[h.name] || { val: '', colIdx: h.colIdx };
                                    return `
                                        <div class="col-cell">
                                            <input type="text" class="cell-input" value="${escapeHtml(cellData.val)}" ${isReadOnlyAttr} onchange="updateCellDirectly(${ex.rowIndex},${cellData.colIdx}, this.value)">
                                        </div>
                                    `;
                                }).join('')}
                            </div>

                            ${(isExpanded && currentMode === 'pro') ? Array.from({length: count}).map((_, s) => {
                                const subChecked = checks[key]?.[`sub_${s}`] || false;
                                const subNr = `${ex.nr}.${s+1}`;

                                let existingSubRow = null;
                                for (let rowIndex = ex.rowIndex + 1; rowIndex < plans[currentPlan].data.length; rowIndex++) {
                                    const row = plans[currentPlan].data[rowIndex];
                                    if (!row) continue;
                                    const rowNr = String(row[0] || '');
                                    if (rowNr === subNr) {
                                        existingSubRow = row;
                                        break;
                                    }
                                    if (rowNr && !rowNr.includes('.')) break;
                                }

                                return `
                                    <div class="row-grid sub-row ${subChecked ? 'done' : ''}">
                                        <div class="col-cell expand-col"></div>
                                        <div class="col-cell check-col">
                                            <input type="checkbox" ${subChecked ? 'checked' : ''} ${isCheckDisabled} onchange="toggleCheck(${inlineStringArgument(key)}, 'sub_${s}', this.checked, ${count})">
                                        </div>
                                        <div class="col-cell nr-col" style="font-size:10px;">${escapeHtml(subNr)}</div>
                                        <div class="col-cell name-col" style="font-size:11px; color:var(--text-dim);">Seria ${s+1}</div>${activeHeaders.map(h => {
                                            if (h.name.toUpperCase() === 'S') return `<div class="col-cell" style="color:var(--text-dim);">-</div>`;
                                            let subVal = existingSubRow ? (existingSubRow[h.colIdx] ?? '') : '';
                                            if (subVal === 'null' || subVal === null || subVal === undefined) subVal = '';
                                            return `
                                                <div class="col-cell">
                                                    <input type="text" class="cell-input" value="${escapeHtml(subVal)}" ${isReadOnlyAttr} placeholder="-" onchange="updateSubSetCellDirectly(${ex.rowIndex}, ${s}, ${inlineStringArgument(h.name)}, this.value)">
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

    if (currentMode === 'basic') fitBasicExerciseNames();
    if (window.lucide) lucide.createIcons();
}

window.addEventListener('resize', fitBasicExerciseNames);

function toggleExpand(key) { expandedExercises[key] = !expandedExercises[key]; renderGymView(); }

function newPlan() {
    if (currentMode === 'edit') return;
    const name = prompt("Nazwa nowego planu:");
    if (name && name.trim()) {
        const finalName = name.trim();
        if (plans[finalName]) return alert(`Plan "${finalName}" już istnieje. Wybierz inną nazwę.`);
        plans[finalName] = {
            isLocked: false,
            notes: "",
            ownerDeviceId: deviceId,
            data: [
                ["Dzień 1 - Trening A", "", "", "", "", "", ""],
                ["Nr", "Ćwiczenie", "S", "P", "KG", "RIR", "REST"],
                ["1", "Wyciskanie leżąc", "3", "10", "60", "2", "90s"]
            ]
        };
        currentPlan = finalName;
        saveAll();
        initPlanSelect();
        renderGymView();
    }
}

function resetWeek() {
    if (currentMode === 'edit') return;
    if (!isAdmin && isClassicPlan(currentPlan)) return;
    if (confirm("Resetować zaznaczone serie i podświetlenia?")) {
        const planPrefix = `${currentPlan}-`;
        if (!resetCheckPlans.includes(currentPlan)) resetCheckPlans.push(currentPlan);
        Object.keys(checks).forEach(key => {
            if (key.startsWith(planPrefix)) delete checks[key];
        });
        saveAll();
        renderGymView();
    }
}

function formatExcelCell(val) {
    if (val === null || val === undefined || val === 'null') return "";
    if (val instanceof Date) {
        return `${val.getMonth() + 1}.${val.getDate()}`;
    }
    return String(val).trim();
}

function parseExcelToPlan(workbook) {
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });

    let planTitle = "Importowany Plan";
    let notes = "";
    let data = [];
    let readingNotes = false;

    let headers = ["Nr", "Ćwiczenie", "S", "P", "KG"];
    for (let r = 0; r < rawRows.length; r++) {
        const row = rawRows[r].map(c => String(c || '').trim());
        if (row.length >= 2 && row[0].toLowerCase() === "nr" && row[1].toLowerCase() === "ćwiczenie") {
            headers = row.filter(c => c !== "");
            break;
        }
    }

    let currentParentNr = "";
    let subSetIndex = 1;

    for (let r = 0; r < rawRows.length; r++) {
        const rawRow = rawRows[r];
        if (!rawRow || rawRow.every(cell => cell === null || cell === undefined || String(cell).trim() === "")) continue;

        const row = rawRow.map(c => formatExcelCell(c));
        const firstCell = row[0] || "";

        if (firstCell.startsWith("⚡ PLAN:")) {
            planTitle = firstCell.replace("⚡ PLAN:", "").replace(/⚡/g, "").trim();
            continue;
        }

        if (firstCell.includes("📌 NOTATKI DO PLANU:")) {
            readingNotes = true;
            continue;
        }

        if (firstCell.startsWith("⚡ Wygenerowano") || firstCell.toLowerCase() === "nr") {
            readingNotes = false;
            continue;
        }

        if (readingNotes) {
            notes += (notes ? "\n" : "") + firstCell;
            continue;
        }

        let formattedRow = new Array(headers.length).fill("");
        for (let colIdx = 0; colIdx < headers.length; colIdx++) {
            const cVal = row[colIdx];
            formattedRow[colIdx] = (cVal !== undefined && cVal !== null && cVal !== 'null') ? cVal : "";
        }

        const col0 = formattedRow[0];
        const col1 = formattedRow[1];

        if (col0.startsWith("#") || col0.toLowerCase().startsWith("dzień") || (col0 && !col1 && isNaN(col0))) {
            currentParentNr = "";
            subSetIndex = 1;
        } 
        else if (col0.includes(".") || (col0 === "" && formattedRow.slice(2).some(v => v !== ""))) {
            if (currentParentNr !== "") {
                formattedRow[0] = `${currentParentNr}.${subSetIndex}`;
                subSetIndex++;
            }
        } 
        else if (col0 !== "") {
            currentParentNr = col0;
            subSetIndex = 1;
        }

        data.push(formattedRow);
    }

    data.unshift(headers);
    importPlanData(planTitle, notes, data);
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = new Uint8Array(ev.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                parseExcelToPlan(workbook);
            } catch (err) {
                alert("Błąd podczas odczytu pliku Excel: " + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        const reader = new FileReader();
        reader.onload = (ev) => { 
            document.getElementById("importInputVal").value = ev.target.result; 
        };
        reader.readAsText(file);
    }
}

function downloadXLSXStyled() {
    const p = plans[currentPlan];
    if (!p) return;

    const rawData = p.data || [];
    const { headers } = parseSheetToStructure();
    
    const colHeaders = ["Nr", "Ćwiczenie", ...headers.map(h => h.name)];

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
        <style>
            br { mso-data-placement: same-cell; }
            td { mso-number-format:"\\@"; white-space: nowrap; }
        </style>
    </head>
    <body style="background-color:#ffffff; font-family:Arial, sans-serif;">
        <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse; border:1px solid ${COLOR_BORDER}; font-family:Arial, sans-serif; font-size:10pt;">
            
            <colgroup>
                <col width="60" style="width:60pt; mso-width-source:userset;" />
                <col width="350" style="width:350pt; mso-width-source:userset;" />
                ${headers.map(() => '<col width="80" style="width:80pt; mso-width-source:userset;" />').join('')}
            </colgroup>

            <tr height="30" style="height:30pt; background-color:${COLOR_GOLD_HEADER}; font-weight:bold; color:${COLOR_TEXT_DARK};">
                <td colspan="${colHeaders.length}" style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${COLOR_GOLD_HEADER}; font-size:12pt; font-weight:bold; white-space:nowrap;">
                    ⚡ PLAN: ${currentPlan.toUpperCase()} ⚡
                </td>
            </tr>
    `;

    if (p.notes && p.notes.trim()) {
        const formattedNotes = p.notes.replace(/\n/g, '<br>');
        htmlContent += `
            <tr height="20" style="height:20pt; background-color:#1a1a1a;">
                <td colspan="${colHeaders.length}" style="border:1px solid ${COLOR_BORDER}; background-color:#1a1a1a; color:${COLOR_GOLD_HEADER}; font-weight:bold; font-size:9pt;">
                    📌 NOTATKI DO PLANU:
                </td>
            </tr>
            <tr>
                <td colspan="${colHeaders.length}" style="border:1px solid ${COLOR_BORDER}; background-color:#f9f9f9; color:#333333; font-size:9.5pt; text-align:left; white-space:normal; padding:8px;">
                    ${formattedNotes}
                </td>
            </tr>
            <tr height="10"><td colspan="${colHeaders.length}" style="border:none; background-color:#ffffff;"></td></tr>
        `;
    }

    htmlContent += `
            <tr height="25" style="height:25pt; background-color:${COLOR_GOLD_HEADER}; font-weight:bold; color:${COLOR_TEXT_DARK};">
                ${colHeaders.map((h, i) => `<td style="border:1px solid ${COLOR_BORDER}; text-align:${i === 1 ? 'left' : 'center'}; background-color:${COLOR_GOLD_HEADER}; font-weight:bold;">${h}</td>`).join('')}
            </tr>
    `;

    let dataRowCounter = 0;

    rawData.forEach((row) => {
        if (!row || row.every(c => c === null || c === undefined || c === '')) return;

        const col0 = String(row[0] || '').trim();
        const col1 = String(row[1] || '').trim();

        const isRest = col0.toLowerCase().includes('rest') || col1.toLowerCase().includes('rest');

        if (col0.toLowerCase().startsWith('dzień') || col0.startsWith('#') || (col0 && !col1 && isNaN(col0))) {
            const dayTitle = col1 ? `${col0} ${col1}` : col0;
            const bgDay = isRest ? COLOR_DAY_REST : COLOR_DAY_ACTIVE;
            const textDay = isRest ? COLOR_TEXT_LIGHT : COLOR_TEXT_DARK;

            htmlContent += `
                <tr height="25" style="height:25pt; background-color:${bgDay}; font-weight:bold; color:${textDay};">
                    <td colspan="2" style="border:1px solid ${COLOR_BORDER}; text-align:left; background-color:${bgDay}; color:${textDay}; font-weight:bold; white-space:nowrap;">${dayTitle.toUpperCase()}</td>
                    ${headers.map(() => `<td style="border:1px solid ${COLOR_BORDER}; background-color:${bgDay};"></td>`).join('')}
                </tr>
            `;
            dataRowCounter = 0;
        } 
        else if (col0.toLowerCase() === 'nr' || col1.toLowerCase() === 'ćwiczenie') {
            return;
        } 
        else {
            const bgRow = (dataRowCounter % 2 === 1) ? COLOR_ROW_ALT : "#FFFFFF";
            const isSubRow = col0.includes('.') || col1.toLowerCase().includes('(seria');
            const exerciseNameDisplay = isSubRow ? '' : (row[1] || '');

            const cleanCell = (val) => (val === null || val === undefined || val === 'null') ? '' : val;

            htmlContent += `
                <tr height="22" style="height:22pt; background-color:${bgRow};">
                    <td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${bgRow}; white-space:nowrap; ${isSubRow ? 'font-size:8.5pt; color:#666666;' : ''}">${cleanCell(row[0])}</td>
                    <td style="border:1px solid ${COLOR_BORDER}; text-align:left; background-color:${bgRow}; white-space:nowrap; font-weight:${isSubRow ? 'normal' : 'bold'};">${cleanCell(exerciseNameDisplay)}</td>
                    ${headers.map(h => `<td style="border:1px solid ${COLOR_BORDER}; text-align:center; background-color:${bgRow}; white-space:nowrap;">${cleanCell(row[h.colIdx])}</td>`).join('')}
                </tr>
            `;
            dataRowCounter++;
        }
    });

    htmlContent += `
            <tr height="12"><td colspan="${colHeaders.length}" style="border:none; background-color:#ffffff;"></td></tr>
            <tr height="25" style="height:25pt; background-color:#111111;">
                <td colspan="${colHeaders.length}" style="border:1px solid ${COLOR_BORDER}; background-color:#111111; color:${COLOR_GOLD_HEADER}; text-align:center; font-size:9pt; font-weight:bold; white-space:nowrap;">
                    Wygenerowano w aplikacji KZAR Coaching
                </td>
            </tr>
        </table>
    </body>
    </html>
    `;

    const blob = new Blob([htmlContent], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = "KZAR_COACHING_" + currentPlan.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".xls";
    link.click();
}

function downloadTSV() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([document.getElementById("exportText").value], { type: "text/tab-separated-values" }));
    a.download = "KZAR_COACHING_" + currentPlan.replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".tsv";
    a.click();
}

function closeModals() { document.querySelectorAll(".modal").forEach(m => m.classList.remove("active")); }

document.addEventListener("DOMContentLoaded", () => {
    initPlanSelect();
    renderGymView();
    loadPlansFromCloud();
});