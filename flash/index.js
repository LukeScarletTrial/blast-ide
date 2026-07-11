import JSZip from 'jszip';

export function compileProject(projectFiles, config = {}) {
    const outputFiles = {};
    const errors = [];

    const defaultManifest = {
        format_version: 2,
        header: {
            name: config.projectName || "Blast Generated Pack",
            description: config.description || "Created with Blast IDE",
            uuid: crypto.randomUUID(),
            version: [1, 0, 0],
            min_engine_version: [1, 21, 0]
        },
        modules: []
    };

    let hasBehaviorPack = false;
    let hasResourcePack = false;

    // Process our virtual files
    for (const [filePath, fileContent] of Object.entries(projectFiles)) {
        try {
            if (filePath.startsWith("behavior_pack/")) {
                hasBehaviorPack = true;
                outputFiles[filePath] = processFile(filePath, fileContent);
            } else if (filePath.startsWith("resource_pack/")) {
                hasResourcePack = true;
                outputFiles[filePath] = processFile(filePath, fileContent);
            } else {
                outputFiles[filePath] = fileContent;
            }
        } catch (err) {
            errors.push({ file: filePath, message: err.message });
        }
    }

    // Auto-generate linked BP/RP manifests if they don't exist
    if (hasBehaviorPack && !projectFiles["behavior_pack/manifest.json"]) {
        const bpManifest = { ...defaultManifest };
        bpManifest.modules.push({ type: "data", uuid: crypto.randomUUID(), version: [1, 0, 0] });
        outputFiles["behavior_pack/manifest.json"] = JSON.stringify(bpManifest, null, 2);
    }

    if (hasResourcePack && !projectFiles["resource_pack/manifest.json"]) {
        const rpManifest = { ...defaultManifest };
        rpManifest.modules.push({ type: "resources", uuid: crypto.randomUUID(), version: [1, 0, 0] });
        outputFiles["resource_pack/manifest.json"] = JSON.stringify(rpManifest, null, 2);
    }

    return { success: errors.length === 0, files: outputFiles, errors };
}

// Custom High-Level Generator: Takes simple UI configs and creates an Add-on asset pair
export function generateBlockAsset(identifier, properties) {
    const namespace = identifier.includes(":") ? identifier.split(":")[0] : "blast";
    const name = identifier.includes(":") ? identifier.split(":")[1] : identifier;
    const cleanId = `${namespace}:${name}`;

    const behaviorBlock = {
        format_version: "1.21.0",
        "minecraft:block": {
            description: { identifier: cleanId },
            components: {
                "minecraft:destructible_by_mining": { seconds_to_destroy: parseFloat(properties.destroyTime || 1.5) },
                "minecraft:light_emission": parseInt(properties.lightLevel || 0),
                "minecraft:flammable": { burn_odds: 0, flame_odds: 0 }
            }
        }
    };

    const resourceBlock = {
        format_version: "1.21.0",
        "minecraft:client_block_definition": {
            textures: properties.textureName || "stone",
            sound: properties.soundType || "stone"
        }
    };

    return {
        bpPath: `behavior_pack/blocks/${name}.json`,
        bpContent: JSON.stringify(behaviorBlock, null, 2),
        rpPath: `resource_pack/blocks/${name}.json`,
        rpContent: JSON.stringify(resourceBlock, null, 2)
    };
}

// worm compiler: Compresses compiled virtual files into a true browser-downloadable .mcaddon archive
export async function wormCompile(compiledFiles) {
    const archive = new JSZip();
    
    for (const [filePath, fileContent] of Object.entries(compiledFiles)) {
        // Adds files directly into the virtual zip structure
        archive.file(filePath, fileContent);
    }

    // Generates a binary zip blob targeted at modern browsers
    const outputBlob = await archive.generateAsync({ type: "blob" });
    return outputBlob;
}

function processFile(path, content) {
    if (typeof content === "string" && content.trim().startsWith("{")) {
        return JSON.stringify(JSON.parse(content), null, 2);
    }
    return content;
}
