import { compileProject, generateBlockAsset, wormCompile } from '../../flash/index.js';

const bedrockDocRegistry = {
    format_version: "1.21.0",
    block_required_components: ["minecraft:destructible_by_mining", "minecraft:friction"],
    item_required_components: ["minecraft:icon"],
    manifest_format: 2
};

let activeWorkspace = {};
let projectConfig = { 
    name: "My Epic Expansion", 
    namespace: "epic", 
    targetVersion: "1.21.0",
    experimental: { betaApis: false, components: false } 
};
let activeFilePath = null;
let chosenPresetType = "blank";
let currentWizardStep = 1;

let directoryCollapseState = {
    "behavior_pack": true,
    "resource_pack": true
};

const fileTreeEl = document.getElementById("project-file-tree");
const codeCanvasEl = document.getElementById("code-canvas");
const fileTabTitleEl = document.getElementById("current-file-tab");
const lineCounterEl = document.getElementById("editor-lines");
const cursorTrackerEl = document.getElementById("status-cursor-position");
const statusProjectNameEl = document.getElementById("status-project-name");
const wizardSidebarEl = document.getElementById("wizard-sidebar-panel");

const modalSetupEl = document.getElementById("modal-setup");
const modalSettingsEl = document.getElementById("modal-settings");
const modalAddFileEl = document.getElementById("modal-add-file");
const wizardProgressFill = document.getElementById("wizard-progress");
const wizardNextBtn = document.getElementById("wizard-btn-next");
const wizardPrevBtn = document.getElementById("wizard-btn-prev");

const presetCards = document.querySelectorAll(".bridge-preset-card");
const newFilePathInput = document.getElementById("new-file-path");

const codeTemplates = {
    blank: () => "",
    block: () => JSON.stringify({
        format_version: projectConfig.targetVersion || bedrockDocRegistry.format_version,
        "minecraft:block": {
            description: { identifier: `${projectConfig.namespace}:custom_block` },
            components: { "minecraft:destructible_by_mining": { seconds_to_destroy: 1.5 }, "minecraft:friction": 0.6 }
        }
    }, null, 2),
    item: () => JSON.stringify({
        format_version: projectConfig.targetVersion || bedrockDocRegistry.format_version,
        "minecraft:item": {
            description: { identifier: `${projectConfig.namespace}:custom_item` },
            components: { "minecraft:icon": "custom_item_texture" }
        }
    }, null, 2),
    script: () => `import { world, system } from "@minecraft/server";\n\nsystem.runTimeout(() => {\n  console.warn("Blast script pipeline operational!");\n}, 20);\n`
};

// ==========================================
// BEDROCK.DEV DOCS MAPPER REFERENCE
// ==========================================
function getDocumentationUrl() {
    const version = projectConfig.targetVersion || "1.21.0";
    return `https://bedrock.dev/docs/${version}/HTML/index.html`;
}

// ==========================================
// LENIENT JSON PRE-PARSER (SELF-HEALING)
// ==========================================
function tryLenientJsonParse(rawString) {
    try {
        return JSON.parse(rawString);
    } catch (initialError) {
        let lines = rawString.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
            let currentLine = lines[i].trim();
            let nextLine = lines[i + 1].trim();

            if (currentLine.length === 0 || nextLine.length === 0) continue;

            if (
                !currentLine.endsWith(",") && 
                !currentLine.endsWith("{") && 
                !currentLine.endsWith("[") && 
                !nextLine.startsWith("}") && 
                !nextLine.startsWith("]")
            ) {
                if (
                    (currentLine.includes(":") || currentLine.startsWith('"') || currentLine.match(/[a-zA-Z0-9"]/)) &&
                    (nextLine.includes(":") || nextLine.startsWith('"') || nextLine.match(/[a-zA-Z0-9"]/))
                ) {
                    lines[i] = lines[i] + ",";
                }
            }
        }

        const repairedString = lines.join("\n");
        return JSON.parse(repairedString);
    }
}

// ==========================================
// FLASH ERROR INTERCEPTION & INTELLIGENT AUTO-FIX
// ==========================================
function interceptAndHealFlashErrors(errors) {
    if (!document.getElementById("settings-chk-autofix").checked) return false;
    
    let resolvedAny = false;
    let patchLog = [];

    errors.forEach(err => {
        const path = err.file;
        const msg = (err.message || "").toLowerCase();
        if (!activeWorkspace[path]) return;

        try {
            if (path.endsWith(".json")) {
                let obj = tryLenientJsonParse(activeWorkspace[path]);

                if (!obj.format_version || msg.includes("format_version") || msg.includes("version mismatch")) {
                    obj.format_version = projectConfig.targetVersion || bedrockDocRegistry.format_version;
                    patchLog.push(`[${path}] Injected missing or fixed format_version`);
                    resolvedAny = true;
                }

                if (obj["minecraft:block"] || msg.includes("block")) {
                    if (!obj["minecraft:block"]) obj["minecraft:block"] = { description: { identifier: `${projectConfig.namespace}:auto_fixed_block` } };
                    if (!obj["minecraft:block"].components) obj["minecraft:block"].components = {};
                    
                    if (msg.includes("destructible") || msg.includes("mining")) {
                        obj["minecraft:block"].components["minecraft:destructible_by_mining"] = { seconds_to_destroy: 1.0 };
                        patchLog.push(`[${path}] Patched missing minecraft:destructible_by_mining component`);
                        resolvedAny = true;
                    }
                    if (msg.includes("friction")) {
                        obj["minecraft:block"].components["minecraft:friction"] = 0.6;
                        patchLog.push(`[${path}] Patched missing minecraft:friction configuration`);
                        resolvedAny = true;
                    }
                }

                if (obj["minecraft:item"] || msg.includes("item")) {
                    if (!obj["minecraft:item"]) obj["minecraft:item"] = { description: { identifier: `${projectConfig.namespace}:auto_fixed_item` } };
                    if (!obj["minecraft:item"].components) obj["minecraft:item"].components = {};

                    if (msg.includes("icon") || msg.includes("texture")) {
                        obj["minecraft:item"].components["minecraft:icon"] = "default_texture";
                        patchLog.push(`[${path}] Applied placeholder asset bind onto item description profile`);
                        resolvedAny = true;
                    }
                }

                if (JSON.stringify(obj, null, 2) !== activeWorkspace[path]) {
                    resolvedAny = true;
                    patchLog.push(`[${path}] Corrected missing comma or delimiter sequence formatting`);
                }

                activeWorkspace[path] = JSON.stringify(obj, null, 2);
            }
        } catch (e) {
            console.error(`Self-healing engine skipped unparsable token stream inside: ${path}`);
        }
    });

    if (resolvedAny) {
        console.log("%c[Blast Auto-Heal]%c Fixed runtime issues:\n" + patchLog.join("\n"), "color:#10b981;font-weight:bold;", "color:default;");
        return true;
    }
    return false;
}

// ==========================================
// VIRTUAL EXPLORER DRAWER ARCHITECTURE
// ==========================================
function updateWorkspaceDirectoryTree() {
    fileTreeEl.innerHTML = "";
    const paths = Object.keys(activeWorkspace).sort();
    
    if (paths.length === 0) {
        fileTreeEl.innerHTML = `<div style="padding:16px; color:#64748b; font-size:11px; text-align:center;">No Project Assets Available</div>`;
        return;
    }

    let structuredDirectories = {};
    let rootLevelFiles = [];

    paths.forEach(path => {
        if (path.includes("/")) {
            const index = path.indexOf("/");
            const topDirectory = path.substring(0, index);
            const nestedPathFile = path.substring(index + 1);
            
            if (!structuredDirectories[topDirectory]) structuredDirectories[topDirectory] = [];
            structuredDirectories[topDirectory].push({ fullPath: path, relPath: nestedPathFile });
        } else {
            rootLevelFiles.push({ fullPath: path, relPath: path });
        }
    });

    Object.keys(structuredDirectories).sort().forEach(dir => {
        if (directoryCollapseState[dir] === undefined) directoryCollapseState[dir] = true;

        const isExpanded = directoryCollapseState[dir];
        const folderBlock = document.createElement("div");
        folderBlock.className = `folder-group ${isExpanded ? '' : 'collapsed'}`;

        const folderRow = document.createElement("div");
        folderRow.className = "folder-row";
        folderRow.innerHTML = `
            <span class="folder-arrow">${isExpanded ? '▼' : '▶'}</span>
            <span>📂 ${dir}</span>
        `;
        
        folderRow.onclick = () => {
            directoryCollapseState[dir] = !directoryCollapseState[dir];
            updateWorkspaceDirectoryTree();
        };
        folderBlock.appendChild(folderRow);

        const contentsBox = document.createElement("div");
        contentsBox.className = "folder-contents";

        structuredDirectories[dir].forEach(fileObj => {
            contentsBox.appendChild(buildFileNodeElement(fileObj.fullPath, fileObj.relPath));
        });

        folderBlock.appendChild(contentsBox);
        fileTreeEl.appendChild(folderBlock);
    });

    rootLevelFiles.forEach(fileObj => {
        fileTreeEl.appendChild(buildFileNodeElement(fileObj.fullPath, fileObj.relPath));
    });
}

function buildFileNodeElement(fullPath, displayLabel) {
    const fileRow = document.createElement("div");
    fileRow.className = `file-item ${fullPath === activeFilePath ? 'active' : ''}`;
    
    let extensionAccent = "#38bdf8";
    if (fullPath.endsWith(".js")) extensionAccent = "#eab308";

    fileRow.innerHTML = `
        <div class="file-label">
            <span style="color:${extensionAccent}; font-weight:800; font-size:10px;">📄</span>
            <span style="overflow:hidden; text-overflow:ellipsis;">${displayLabel}</span>
        </div>
        <span class="file-remove" title="Delete Asset">✕</span>
    `;

    fileRow.querySelector(".file-label").onclick = () => {
        activeFilePath = fullPath;
        fileTabTitleEl.textContent = fullPath;
        codeCanvasEl.value = activeWorkspace[fullPath];
        updateWorkspaceDirectoryTree();
        syncLinesAndCursor();
    };

    fileRow.querySelector(".file-remove").onclick = (e) => {
        e.stopPropagation();
        delete activeWorkspace[fullPath];
        if (activeFilePath === fullPath) {
            activeFilePath = Object.keys(activeWorkspace)[0] || null;
            fileTabTitleEl.textContent = activeFilePath || "No file active";
            codeCanvasEl.value = activeFilePath ? activeWorkspace[activeFilePath] : "";
        }
        updateWorkspaceDirectoryTree();
        syncLinesAndCursor();
    };

    return fileRow;
}

function syncLinesAndCursor() {
    const rows = codeCanvasEl.value.split("\n").length;
    let counts = "";
    for (let i = 1; i <= rows; i++) counts += i + "<br>";
    lineCounterEl.innerHTML = counts;
    const selections = codeCanvasEl.value.substring(0, codeCanvasEl.selectionStart).split("\n");
    cursorTrackerEl.textContent = `Line ${selections.length}, Col ${selections[selections.length - 1].length + 1}`;
}

codeCanvasEl.oninput = () => {
    if (activeFilePath) activeWorkspace[activeFilePath] = codeCanvasEl.value;
    syncLinesAndCursor();
};
codeCanvasEl.onpointerup = () => syncLinesAndCursor();
codeCanvasEl.onkeyup = () => syncLinesAndCursor();
codeCanvasEl.onscroll = () => { lineCounterEl.scrollTop = codeCanvasEl.scrollTop; };

// ==========================================
// UNIFIED MCADDON COMPILE PIPELINE
// ==========================================
document.getElementById("action-compile").onclick = async () => {
    if (Object.keys(activeWorkspace).length === 0) return;

    let res = compileProject(activeWorkspace, { projectName: projectConfig.name, experimental: projectConfig.experimental });
    
    if (!res.success) {
        const resolvedByHealer = interceptAndHealFlashErrors(res.errors);
        if (resolvedByHealer) {
            console.log("%c[Blast Auto-Heal]%c Retrying compilation step with corrected source templates...", "color:#10b981;");
            res = compileProject(activeWorkspace, { projectName: projectConfig.name, experimental: projectConfig.experimental });
        }
        
        if (!res.success) {
            alert("Compilation failed. Flash reported structural components errors inside files.");
            return;
        }
    }

    try {
        const addonPackageBlob = await wormCompile(res.files);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(addonPackageBlob);
        link.download = `${projectConfig.name.toLowerCase().replace(/\s+/g, '_')}.mcaddon`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (activeFilePath) codeCanvasEl.value = activeWorkspace[activeFilePath];
        syncLinesAndCursor();
    } catch (e) { alert("Worm packing error: " + e.message); }
};

// ==========================================
// MODAL CONTROLS & SIDEBAR NAVIGATION
// ==========================================
document.getElementById("tree-add-file").onclick = () => {
    newFilePathInput.value = "";
    presetCards.forEach(c => c.classList.remove("selected"));
    document.querySelector('[data-preset="blank"]').classList.add("selected");
    chosenPresetType = "blank";
    modalAddFileEl.classList.remove("hidden");
};

presetCards.forEach(card => {
    card.onclick = () => {
        presetCards.forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        chosenPresetType = card.getAttribute("data-preset");
    };
});

document.getElementById("add-file-cancel").onclick = () => modalAddFileEl.classList.add("hidden");
document.getElementById("add-file-confirm").onclick = () => {
    const filepath = newFilePathInput.value.trim();
    if (!filepath) return;

    const data = codeTemplates[chosenPresetType]();
    activeWorkspace[filepath] = data;
    activeFilePath = filepath;
    fileTabTitleEl.textContent = filepath;
    codeCanvasEl.value = data;

    modalAddFileEl.classList.add("hidden");
    updateWorkspaceDirectoryTree();
    syncLinesAndCursor();
};

// Scoped preference panel switcher inside the settings modal container
document.querySelectorAll("#modal-settings .setting-tab-btn").forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll("#modal-settings .setting-tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        
        const targetPane = btn.getAttribute("data-target");
        document.querySelectorAll("#modal-settings .bridge-pane-content").forEach(p => {
            p.style.display = p.id === targetPane ? "flex" : "none";
        });
    };
});

document.getElementById("action-settings").onclick = () => modalSettingsEl.classList.remove("hidden");
document.getElementById("settings-close").onclick = () => modalSettingsEl.classList.add("hidden");

// ==========================================
// WIZARD INITIALIZER SEQUENCE
// ==========================================
function updateWizardStageView() {
    document.querySelectorAll(".wizard-stage-view").forEach(p => p.classList.remove("active"));
    document.querySelector(`[data-step="${currentWizardStep}"]`).classList.add("active");
    const progressPercents = { 1: 33.3, 2: 66.6, 3: 100 };
    wizardProgressFill.style.width = `${progressPercents[currentWizardStep]}%`;
    wizardPrevBtn.style.visibility = currentWizardStep === 1 ? "hidden" : "visible";
    wizardNextBtn.textContent = currentWizardStep === 3 ? "Generate Workspace ✨" : "Continue →";
}

wizardNextBtn.onclick = () => {
    if (currentWizardStep < 3) {
        currentWizardStep++;
        updateWizardStageView();
    } else {
        finalizeProjectOnboardingCreation();
    }
};
wizardPrevBtn.onclick = () => {
    if (currentWizardStep > 1) {
        currentWizardStep--;
        updateWizardStageView();
    }
};

function finalizeProjectOnboardingCreation() {
    activeWorkspace = {};
    projectConfig.name = document.getElementById("setup-name").value || "My Pack";
    projectConfig.namespace = document.getElementById("setup-namespace").value || "epic";
    
    // Extract designated project version selection
    const versionSelectEl = document.getElementById("setup-target-version");
    projectConfig.targetVersion = versionSelectEl ? versionSelectEl.value : "1.21.0";
    
    projectConfig.experimental.betaApis = document.getElementById("setup-chk-beta").checked;
    projectConfig.experimental.components = document.getElementById("setup-chk-components").checked;

    // Convert string string target layout segments into integer triplets
    const versionSegments = projectConfig.targetVersion.split(".").map(num => parseInt(num, 10) || 0);

    if (document.getElementById("setup-chk-bp").checked) {
        const bpManifest = {
            format_version: bedrockDocRegistry.manifest_format,
            header: { 
                name: `${projectConfig.name} BP`, 
                description: "Blast Studio Pro Output", 
                uuid: crypto.randomUUID(), 
                version: [1,0,0], 
                min_engine_version: versionSegments 
            },
            modules: [{ type: "data", uuid: crypto.randomUUID(), version: [1,0,0] }]
        };
        if (projectConfig.experimental.betaApis) {
            bpManifest.dependencies = [{ module_name: "@minecraft/server", version: "1.11.0-beta" }];
            activeWorkspace["behavior_pack/scripts/main.js"] = codeTemplates.script();
        }
        activeWorkspace["behavior_pack/manifest.json"] = JSON.stringify(bpManifest, null, 2);
    }

    if (document.getElementById("setup-chk-rp").checked) {
        const rpManifest = {
            format_version: bedrockDocRegistry.manifest_format,
            header: { 
                name: `${projectConfig.name} RP`, 
                description: "Blast Studio Pro Output", 
                uuid: crypto.randomUUID(), 
                version: [1,0,0], 
                min_engine_version: versionSegments 
            },
            modules: [{ type: "resources", uuid: crypto.randomUUID(), version: [1,0,0] }]
        };
        activeWorkspace["resource_pack/manifest.json"] = JSON.stringify(rpManifest, null, 2);
    }

    activeFilePath = Object.keys(activeWorkspace)[0] || null;
    if (activeFilePath) {
        fileTabTitleEl.textContent = activeFilePath;
        codeCanvasEl.value = activeWorkspace[activeFilePath];
    }
    statusProjectNameEl.textContent = projectConfig.name;
    modalSetupEl.classList.add("hidden");
    updateWorkspaceDirectoryTree();
    syncLinesAndCursor();
}

document.getElementById("action-setup").onclick = () => {
    currentWizardStep = 1;
    updateWizardStageView();
    modalSetupEl.classList.remove("hidden");
};

document.getElementById("rail-toggle-wizard").onclick = () => {
    document.getElementById("rail-toggle-wizard").classList.toggle("active");
    wizardSidebarEl.classList.toggle("collapsed");
};

document.getElementById("wiz-block-sync").onclick = () => {
    const id = document.getElementById("wiz-block-id").value;
    const hard = document.getElementById("wiz-block-hardness").value;
    const light = document.getElementById("wiz-block-light").value;
    const tex = document.getElementById("wiz-block-texture").value;
    const assetPack = generateBlockAsset(id, { destroyTime: hard, lightLevel: light, textureName: tex });
    activeWorkspace[assetPack.bpPath] = assetPack.bpContent;
    activeWorkspace[assetPack.rpPath] = assetPack.rpContent;
    activeFilePath = assetPack.bpPath;
    fileTabTitleEl.textContent = assetPack.bpPath;
    codeCanvasEl.value = assetPack.bpContent;
    updateWorkspaceDirectoryTree();
    syncLinesAndCursor();
};

updateWizardStageView();
