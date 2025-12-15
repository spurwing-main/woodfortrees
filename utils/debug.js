const MODE_KEY = "sitekit_mode";
const DEBUG_KEY = "sitekit_debug";

function readParam(name) {
    try {
        return new URLSearchParams(window.location.search).get(name);
    } catch {
        return null;
    }
}

function safeStorageGet(key) {
    try {
        return window.localStorage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

export function getMode() {
    const fromParam = String(readParam(MODE_KEY) || "").toLowerCase();
    if (fromParam) return fromParam;

    const fromWindow = String(window.sitekit_mode || "").toLowerCase();
    if (fromWindow) return fromWindow;

    const fromStorage = String(safeStorageGet(MODE_KEY) || "").toLowerCase();
    if (fromStorage) return fromStorage;

    return "";
}

export function isDevMode() {
    const mode = getMode();

    return mode === "dev";
}

export function isDebugEnabled() {
    if (isDevMode()) return true;

    const urlFlag = String(readParam(DEBUG_KEY) || "").toLowerCase();
    if (urlFlag === "1" || urlFlag === "true") return true;

    const fromStorage = String(safeStorageGet(DEBUG_KEY) || "").toLowerCase();
    return fromStorage === "true";
}

export function nowMs() {
    try {
        return Math.round(performance.now());
    } catch {
        return Date.now();
    }
}

export function createLogger(scope) {
    const DEBUG = isDebugEnabled();
    const prefix = `[sitekit/${scope}`;

    return {
        DEBUG,
        log: (...args) => DEBUG && console.log(`${prefix} +${nowMs()}ms]`, ...args),
        warn: (...args) => DEBUG && console.warn(`${prefix} +${nowMs()}ms]`, ...args),
        trace: (...args) => DEBUG && console.trace(`${prefix} +${nowMs()}ms]`, ...args),
    };
}
