const { readState, writeState } = require("./stateStore");

const TICKETS_SCOPE = "recruitmentTickets";
const LOGS_SCOPE = "recruitmentLogs";
const MAX_LOGS = 500;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function emptyTickets() {
    return { tickets: {} };
}

function emptyLogs() {
    return { logs: [] };
}

function normalizeTickets(raw) {
    if (raw && typeof raw === "object" && raw.tickets && typeof raw.tickets === "object") {
        return { tickets: raw.tickets };
    }

    return emptyTickets();
}

function normalizeLogs(raw) {
    if (raw && typeof raw === "object" && Array.isArray(raw.logs)) {
        return { logs: raw.logs };
    }

    return emptyLogs();
}

async function getTicket(threadId) {
    const state = normalizeTickets(await readState(TICKETS_SCOPE, emptyTickets()));
    return state.tickets[threadId] ? clone(state.tickets[threadId]) : null;
}

async function saveTicket(ticket) {
    if (!ticket?.threadId) throw new Error("Ticket is missing threadId.");

    const state = normalizeTickets(await readState(TICKETS_SCOPE, emptyTickets()));
    state.tickets[ticket.threadId] = {
        ...state.tickets[ticket.threadId],
        ...ticket,
        updatedAt: new Date().toISOString()
    };

    await writeState(TICKETS_SCOPE, state);
    return clone(state.tickets[ticket.threadId]);
}

async function updateTicket(threadId, patch) {
    const current = await getTicket(threadId);
    if (!current) return null;
    return saveTicket({ ...current, ...patch, threadId });
}

async function listRecruitmentLogs(limit = 50) {
    const state = normalizeLogs(await readState(LOGS_SCOPE, emptyLogs()));
    return state.logs
        .slice()
        .sort((a, b) => String(b.closedAt || b.createdAt).localeCompare(String(a.closedAt || a.createdAt)))
        .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

async function appendRecruitmentLog(log) {
    const state = normalizeLogs(await readState(LOGS_SCOPE, emptyLogs()));
    const entry = {
        id: log.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ...log,
        createdAt: log.createdAt || new Date().toISOString()
    };

    state.logs.unshift(entry);
    state.logs = state.logs.slice(0, MAX_LOGS);

    await writeState(LOGS_SCOPE, state);
    return clone(entry);
}

module.exports = {
    getTicket,
    saveTicket,
    updateTicket,
    listRecruitmentLogs,
    appendRecruitmentLog
};
