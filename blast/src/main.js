import { compileProject, generateBlockAsset, wormCompile } from '../../flash/index.js';

// Global In-Memory Workspace State
let activeWorkspace = {};
let currentProjectConfig = { name: "My Custom Addon", namespace: "custom" };
let selectedFile = null;

const fileListEl = document.getElementById("file-list");
const codeEditorEl = document.getElementById("code-editor");
const visualEditorEl = document.getElementById("visual-editor");
const compileBtnEl = document.getElementById("run-flash");
const displayTitleEl = document.getElementById("project-title-display");

// Wizard UI Dom Elements 
const wizardModalEl = document.getElementById("wizard-modal");
const openWizardBtnEl = document.getElementById("open-wizard");
const cancelWizBtnEl = document.getElementById("btn-wiz-cancel");
const createWizBtnEl = document.getElementById("btn-wiz-create");
const wizNameInp = document.getElementById("wiz-name");
const wizSpaceInp = document.getElementById("wiz-space");
const wizBpChk = document.getElementById("wiz-bp");
const wizRpChk = document.getElementById("wiz-rp");
const wizTreePreviewEl = document.getElementById("wiz-tree-view");

// Local Component Form Settings Model
const blockConfig = {
    identifier: "custom:ruby_ore",
    destroyTime: 3.0,
    lightLevel: 10,
    textureName: "ruby_ore",
    soundType: "stone"
};

// Wizard Dynamic Realtime Preview Map Generator
function updateWizardPreview() {
    const space = wizSpaceInp.value || "custom";
    let previewHTML = `<div style="color: #6b7280; font-weight: bold; margin-bottom: 4px;">📂 root/</div>`;
    
    if (wizBpChk.checked) {
        previewHTML += `
            <div style="padding-left: 12px; color: #38bdf8;">📂 behavior_pack/</div>
            <div style="padding-left: 24px; color: #7cc8fa;">📄 manifest.json</div>
            <div style="padding-left: 24px; color: #7cc8fa;">📂 blocks/</div>
        `;
    }
    if (wizRpChk.checked) {
        previewHTML += `
            <div style="padding-left: 12px; color: #a855f7;">📂 resource_pack/</div>
            <div style="padding-left: 24px; color: #c084fc;">📄 manifest.json</div>
            <div style="padding-left: 24px; color: #c084fc;">📂 blocks/</div>
        `;
    }
    wizTreePreviewEl.innerHTML = previewHTML;
}

// Bind live changes inside wizard input fields
[wizNameInp, wizSpaceInp, wizBpChk, wizRpChk].forEach(el => {
    el.oninput = () => updateWizardPreview();
});

// Modal Toggles
openWizardBtnEl.onclick = () => {
    wizardModalEl.classList.remove("hidden");
    updateWizardPreview();
};
cancelWizBtnEl.onclick = () => wizardModalEl.classList.add("hidden");

// Execute Generation on Confirmation Click
createWizBtnEl.onclick = () => {
    activeWorkspace = {}; // Clear previous session values safely
    currentProjectConfig.name = wizNameInp.value || "Unnamed Pack";
    currentProjectConfig.namespace = wizSpaceInp.value || "custom";
    blockConfig.identifier = `${currentProjectConfig.namespace}:ruby_ore`;

    // Scaffold empty structures via flash capabilities rule mapping
    const baseFiles = {};
    if (wizBpChk.checked) baseFiles["behavior_pack/blocks/.keep"] = "";
    if (wizRpChk.checked) baseFiles["resource_pack/blocks/.keep"] = "";

    const structure = compileProject(baseFiles, {
        projectName: currentProjectConfig.name
    });

    activeWorkspace = structure.files;
    
    // Auto focus first available configuration element map
    const paths = Object.keys(activeWorkspace);
    selectedFile = paths.length > 0 ? paths[0] : null;

    displayTitleEl.textContent = currentProjectConfig.name.toUpperCase();
    wizardModalEl.classList.add("hidden");
    
    renderVisualForm();
    updateWorkspaceUI();
};

function renderVisualForm() {
    visualEditorEl.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px; color:#e1e1e6;">
            <h3>Block Blueprint Wizard</h3>
            <label>Identifier: <input type="text" id="cfg-id" value="${blockConfig.identifier}" style="width:100%; background:#121214; color:#fff; border:1px solid #29292e; padding:6px; border-radius:4px;"></label>
            <label>Mining Time (Seconds): <input type="number" id="cfg-time" step="0.1" value="${blockConfig.destroyTime}" style="width:100%; background:#121214; color:#fff; border:1px solid #29292e; padding:6px; border-radius:4px;"></label>
            <label>Light Emission (0-15): <input type="range" id="cfg-light" min="0" max="15" value="${blockConfig.lightLevel}" style="width:100%;"></label>
            <label>Texture ID Key: <input type="text" id="cfg-texture" value="${blockConfig.textureName}" style="width:100%; background:#121214; color:#fff; border:1px solid #29292e; padding:6px; border-radius:4px;"></label>
            <button id="btn-generate-assets" style="background:#f43f5e; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:bold; margin-top:10px;">Update Block Assets</button>
            
            <hr style="border:0; border-top:1px solid #29292e; margin:15px 0;">
            
            <h3>worm Distribution Compiler</h3>
            <p style="font-size:12px; color:#7c7c8a;">Packages your assets securely into a fully ready-to-import Minecraft Bedrock Add-on archive format.</p>
            <button id="btn-worm-export" style="background:#a855f7; color:white; border:none; padding:10px; border-radius:4px; cursor:pointer; font-weight:bold; margin-top:5px;">Export .mcaddon Archive</button>
        </div>
    `;

    document.getElementById("btn-generate-assets").onclick = () => {
        blockConfig.identifier = document.getElementById("cfg-id").value;
        blockConfig.destroyTime = document.getElementById("cfg-time").value;
        blockConfig.lightLevel = document.getElementById("cfg-light").value;
        blockConfig.textureName = document.getElementById("cfg-texture").value;

        // Clean out layout placeholders (.keep tracking files)
        delete activeWorkspace["behavior_pack/blocks/.keep"];
        delete activeWorkspace["resource_pack/blocks/.keep"];

        const assets = generateBlockAsset(blockConfig.identifier, blockConfig);
        activeWorkspace[assets.bpPath] = assets.bpContent;
        activeWorkspace[assets.rpPath] = assets.rpContent;

        selectedFile = assets.bpPath;
        updateWorkspaceUI();
    };

    document.getElementById("btn-worm-export").onclick = async () => {
        if (Object.keys(activeWorkspace).length === 0) {
            alert("Workspace tree is empty!");
            return;
        }

        const flashOutput = compileProject(activeWorkspace, {
            projectName: currentProjectConfig.name
        });

        try {
            const addonBlob = await wormCompile(flashOutput.files);
            const downloadAnchor = document.createElement("a");
            downloadAnchor.href = URL.createObjectURL(addonBlob);
            downloadAnchor.download = `${currentProjectConfig.name.toLowerCase().replace(/\s+/g, '_')}.mcaddon`;
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            document.body.removeChild(downloadAnchor);
            URL.revokeObjectURL(downloadAnchor.href);
        } catch(err) {
            alert("Worm packing failed: " + err.message);
        }
    };
}

function updateWorkspaceUI() {
    fileListEl.innerHTML = "";
    const files = Object.keys(activeWorkspace);

    if (files.length === 0) {
        fileListEl.innerHTML = `<div style="color:#7c7c8a; font-size:13px;">No assets active.</div>`;
        codeEditorEl.value = "";
        return;
    }

    files.forEach(filePath => {
        if (filePath.endsWith(".keep")) return; // Hide placeholder entries cleanly
        
        const item = document.createElement("div");
        item.textContent = filePath.replace("behavior_pack/", "BP/").replace("resource_pack/", "RP/");
        item.style.padding = "8px 6px";
        item.style.cursor = "pointer";
        item.style.borderRadius = "4px";
        item.style.fontSize = "13px";
        item.style.backgroundColor = filePath === selectedFile ? "#29292e" : "transparent";
        item.style.borderLeft = filePath.startsWith("behavior_pack") ? "3px solid #38bdf8" : "3px solid #a855f7";
        
        item.onclick = () => {
            selectedFile = filePath;
            updateWorkspaceUI();
        };
        fileListEl.appendChild(item);
    });

    codeEditorEl.value = activeWorkspace[selectedFile] || "";
}

codeEditorEl.oninput = (e) => {
    if (selectedFile) activeWorkspace[selectedFile] = e.target.value;
};

compileBtnEl.onclick = () => {
    const result = compileProject(activeWorkspace, { projectName: currentProjectConfig.name });
    console.log("🚀 Build Finished:", result.files);
    alert("Project verified through flash engine successfully.");
};

// Open the custom creation wizard automatically at launch
updateWizardPreview();
