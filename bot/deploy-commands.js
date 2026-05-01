const { REST, Routes } = require("discord.js");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const clientId = process.env.DISCORD_CLIENT_ID || "1340222971847114762";
const token = process.env.DISCORD_TOKEN;

if (!token) {
    console.error("❌ DISCORD_TOKEN is not set in environment variables!");
    process.exit(1);
}

// Recursive function to get all .js files in slash commands folder & subfolders
function getAllSlashCommandFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);

    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat && stat.isDirectory()) {
            results = results.concat(getAllSlashCommandFiles(filePath));
        } else if (file.endsWith(".js")) {
            results.push(filePath);
        }
    }

    return results;
}

const slashCommandsPath = path.join(__dirname, "commands", "slash");
const slashCommandFiles = getAllSlashCommandFiles(slashCommandsPath);

const commands = [];

for (const filePath of slashCommandFiles) {
    const command = require(filePath);
    if (command.data && typeof command.data.toJSON === "function") {
        commands.push(command.data.toJSON());
    } else {
        console.warn(`⚠️ Slash command at ${filePath} is missing a valid 'data' property.`);
    }
}

const rest = new REST({ version: "10" }).setToken(token);

(async () => {
    try {
        console.log("📡 Registering slash commands...");
        await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log("✅ Slash commands registered successfully!");
    } catch (error) {
        console.error("❌ Error registering slash commands:", error);
    }
})();
