const fs = require("fs");
const path = require("path");
const express = require("express");
const { loadDashboardConfig, saveDashboardConfig } = require("./dashboardConfig");
const { listRecruitmentLogs } = require("./recruitmentStore");
const {
    ensureRecruitmentPanel,
    getBotUser,
    getGuildLookups,
    syncReactionRoles
} = require("./discordApi");
const {
    getOAuthConfig,
    getSession,
    registerDashboardAuthRoutes,
    requireDashboardAuth
} = require("./dashboardAuth");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const UPLOAD_DIR = process.env.DASHBOARD_UPLOAD_DIR
    ? path.resolve(process.env.DASHBOARD_UPLOAD_DIR)
    : path.join(__dirname, "..", "uploads");
const rawVideoUpload = express.raw({
    type: "*/*",
    limit: process.env.DASHBOARD_UPLOAD_LIMIT || "100mb"
});

function avatarUrl(user) {
    if (!user?.avatar) return "";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=80`;
}

function getBaseUrl(req) {
    if (process.env.DASHBOARD_PUBLIC_URL) return process.env.DASHBOARD_PUBLIC_URL.replace(/\/$/, "");
    if (process.env.DASHBOARD_BASE_URL) return process.env.DASHBOARD_BASE_URL.replace(/\/$/, "");

    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    return `${String(protocol).split(",")[0]}://${req.get("host")}`;
}

function sanitizeFilename(value) {
    return String(value || "video")
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "video";
}

function extensionForUpload(req) {
    const headerName = String(req.headers["x-file-name"] || "");
    const fromName = path.extname(headerName).toLowerCase();
    if (/^\.(mp4|mov|webm|m4v)$/i.test(fromName)) return fromName;

    const type = String(req.headers["content-type"] || "").toLowerCase();
    if (type.includes("quicktime")) return ".mov";
    if (type.includes("webm")) return ".webm";
    if (type.includes("mp4")) return ".mp4";
    return ".mp4";
}

async function saveTutorialUpload(req, tutorialId) {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
        throw new Error("No video data was uploaded.");
    }

    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    const baseName = sanitizeFilename(path.basename(String(req.headers["x-file-name"] || tutorialId), path.extname(String(req.headers["x-file-name"] || ""))));
    const fileName = `${tutorialId}-${Date.now()}-${baseName}${extensionForUpload(req)}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    if (!filePath.startsWith(UPLOAD_DIR)) {
        throw new Error("Invalid upload path.");
    }

    await fs.promises.writeFile(filePath, req.body);
    return `${getBaseUrl(req)}/uploads/${encodeURIComponent(fileName)}`;
}

function registerDashboardRoutes(app) {
    const requireAuth = requireDashboardAuth();

    registerDashboardAuthRoutes(app);

    app.use("/dashboard", express.static(PUBLIC_DIR, {
        index: false,
        maxAge: "1h"
    }));

    app.use("/uploads", express.static(UPLOAD_DIR, {
        maxAge: "7d",
        fallthrough: false
    }));

    app.get(["/dashboard", "/dashboard/"], (req, res) => {
        res.sendFile(path.join(PUBLIC_DIR, "index.html"));
    });

    app.get("/api/dashboard/me", async (req, res) => {
        const session = getSession(req);
        const oauth = getOAuthConfig(req);
        const bot = await getBotUser().catch(() => null);

        res.json({
            authenticated: Boolean(session),
            user: session ? {
                ...session.user,
                avatarUrl: avatarUrl(session.user)
            } : null,
            setup: {
                configured: oauth.configured,
                missing: oauth.missing
            },
            bot: {
                ready: Boolean(bot),
                user: bot ? {
                    id: bot.id,
                    tag: bot.discriminator && bot.discriminator !== "0"
                        ? `${bot.username}#${bot.discriminator}`
                        : bot.username
                } : null
            },
            recruitment: {
                recruiterRoleId: process.env.RECRUITER_ROLE_ID || process.env.RECRUITMENT_RECRUITER_ROLE_ID || ""
            }
        });
    });

    app.get("/api/dashboard/config", requireAuth, async (req, res) => {
        try {
            const [config, lookups, logs] = await Promise.all([
                loadDashboardConfig(),
                getGuildLookups(),
                listRecruitmentLogs(50)
            ]);

            res.json({ config, lookups, logs });
        } catch (error) {
            console.error("Dashboard config load failed:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.put("/api/dashboard/config", requireAuth, async (req, res) => {
        try {
            const saved = await saveDashboardConfig(req.body || {});
            const sync = await syncReactionRoles().catch(error => ({ error: error.message }));

            res.json({
                config: sync.config || saved,
                sync
            });
        } catch (error) {
            console.error("Dashboard config save failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.post("/api/dashboard/reaction-roles/sync", requireAuth, async (req, res) => {
        const sync = await syncReactionRoles().catch(error => ({ error: error.message }));
        if (sync.error) {
            res.status(500).json(sync);
            return;
        }

        res.json(sync);
    });

    app.post("/api/dashboard/recruitment/panel/sync", requireAuth, async (req, res) => {
        const sync = await ensureRecruitmentPanel().catch(error => ({ error: error.message }));
        if (sync.error) {
            res.status(500).json(sync);
            return;
        }

        const config = await loadDashboardConfig();
        res.json({ config, sync });
    });

    app.get("/api/dashboard/recruitment/logs", requireAuth, async (req, res) => {
        res.json({ logs: await listRecruitmentLogs(100) });
    });

    app.post("/api/dashboard/recruitment/tutorials/:id/upload", requireAuth, rawVideoUpload, async (req, res) => {
        try {
            const tutorialId = sanitizeFilename(req.params.id);
            const config = await loadDashboardConfig();
            const tutorial = config.recruitment.tutorials.find(item => item.id === tutorialId);
            if (!tutorial) throw new Error("Tutorial not found.");

            const videoUrl = await saveTutorialUpload(req, tutorialId);
            const nextTutorials = config.recruitment.tutorials.map(item =>
                item.id === tutorialId ? { ...item, videoUrl } : item
            );

            const saved = await saveDashboardConfig({
                ...config,
                recruitment: {
                    ...config.recruitment,
                    tutorials: nextTutorials
                }
            });

            res.json({
                config: saved,
                tutorial: saved.recruitment.tutorials.find(item => item.id === tutorialId)
            });
        } catch (error) {
            console.error("Tutorial upload failed:", error);
            res.status(400).json({ error: error.message });
        }
    });
}

module.exports = {
    registerDashboardRoutes
};
