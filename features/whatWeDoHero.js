// whatWeDoHero.js
// Expects: window.whatWeDoHeroImages = [{ src, orange, purple, red, green }, ...]
// Rotates site color theme on each load, persists last theme (sitekit_*),
// applies theme classes + swaps hero parallax images.
//
// Opacity gate model:
// - Pages that need gating set `.page-wrap` to opacity 0 server-side.
// - This feature reveals the page only after it has swapped theme + images.

import { createLogger } from "../utils/debug.js";

const { log } = createLogger("whatWeDoHero");

// Edit order here.
const COLOR_THEMES = [
    { key: "purple", className: "is-purple" },
    { key: "red", className: "is-red" },
    { key: "orange", className: "is-orange" },
    { key: "green", className: "is-green" }
];

const STORAGE_KEY = "sitekit_whatWeDoHeroThemeKey";

const REVEAL = {
    // Don’t leave the page hidden forever if images are slow.
    maxWaitMs: 1200,
};

const nextPaint = () =>
    new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

function preloadSrc(src, timeoutMs) {
    if (!src) return Promise.resolve({ src, status: "skipped" });

    return new Promise((resolve) => {
        const img = new Image();
        let done = false;

        const finish = (status) => {
            if (done) return;
            done = true;
            clearTimeout(timeoutId);
            img.onload = null;
            img.onerror = null;
            resolve({ src, status });
        };

        const timeoutId = setTimeout(() => finish("timeout"), timeoutMs);
        img.decoding = "async";
        img.loading = "eager";
        img.onload = () => {
            // decode is a better signal than onload for “ready to paint”
            try {
                if (typeof img.decode === "function") {
                    img.decode().then(() => finish("loaded")).catch(() => finish("loaded"));
                    return;
                }
            } catch {
                // ignore
            }
            finish("loaded");
        };
        img.onerror = () => finish("error");
        img.src = src;
    });
}

function safeStorageGet(key) {
    try {
        return window.localStorage?.getItem(key) ?? null;
    } catch {
        return null;
    }
}

function safeStorageSet(key, value) {
    try {
        window.localStorage?.setItem(key, String(value));
    } catch {
        // ignore
    }
}

function getCookie(name) {
    try {
        const parts = String(document.cookie || "").split(";");
        for (const part of parts) {
            const [rawK, ...rawV] = part.trim().split("=");
            if (!rawK) continue;
            if (rawK === name) return decodeURIComponent(rawV.join("=") || "");
        }
    } catch {
        // ignore
    }
    return null;
}

function setCookie(name, value, maxAgeSeconds = 60 * 60 * 24 * 365) {
    try {
        const v = encodeURIComponent(String(value));
        document.cookie = `${name}=${v}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
    } catch {
        // ignore
    }
}

function normalizeKey(key) {
    const k = String(key || "").toLowerCase().trim();
    if (!k) return null;
    return COLOR_THEMES.some((t) => t.key === k) ? k : null;
}

function readLastThemeKey() {
    return (
        normalizeKey(safeStorageGet(STORAGE_KEY)) ||
        normalizeKey(getCookie(STORAGE_KEY))
    );
}

function computeNextTheme(lastKey) {
    const idx = COLOR_THEMES.findIndex((t) => t.key === lastKey);
    const nextIdx = idx >= 0 ? (idx + 1) % COLOR_THEMES.length : 0;
    return COLOR_THEMES[nextIdx];
}

function persistThemeKey(key) {
    safeStorageSet(STORAGE_KEY, key);
    setCookie(STORAGE_KEY, key);
}

function stripThemeClasses(el) {
    if (!el?.classList) return;

    // Theme classes on the hero are always `is-*`.
    // Remove any existing `is-` classes to avoid stacking (e.g. is-yellow + is-purple).
    for (const cls of Array.from(el.classList)) {
        if (cls.startsWith("is-")) {
            el.classList.remove(cls);
        }
    }
}

function applyThemeClasses(themeObj, section) {
    stripThemeClasses(section);
    section.classList.add(themeObj.className);
    log("applyThemeClasses", { theme: themeObj.key, className: themeObj.className });
}

function applyThemeGlobal(themeObj) {
    try {
        document.documentElement.dataset.sitekitColorTheme = themeObj.key;
        log("applyThemeGlobal", { theme: themeObj.key });
    } catch {
        // ignore
    }
}

function revealGate() {
    log("revealGate()");
    window.sitekit.pageWrapGate.reveal();
}

function pickThemeHeroSrcs(themeKey, pool) {
    const items = Array.isArray(pool) ? pool : [];
    const matches = items.filter((it) => {
        if (!it || !it.src) return false;
        const v = it[themeKey];
        return v === true || String(v).toLowerCase() === "true";
    });

    const byKind = { back: null, mid: null, front: null };
    for (const it of matches) {
        const src = String(it.src);
        const low = src.toLowerCase();
        if (!byKind.back && (low.includes("back") || low.includes("background"))) byKind.back = src;
        else if (!byKind.mid && low.includes("mid")) byKind.mid = src;
        else if (!byKind.front && (low.includes("front") || low.includes("foreground"))) byKind.front = src;
    }

    const fallbacks = matches.map((m) => m.src).filter(Boolean);
    return {
        back: byKind.back || fallbacks[0] || null,
        mid: byKind.mid || fallbacks[1] || fallbacks[0] || null,
        front: byKind.front || fallbacks[2] || fallbacks[1] || fallbacks[0] || null
    };
}

function applyHeroImagesFromSrcs(srcs, section) {
    if (!srcs || (!srcs.back && !srcs.mid && !srcs.front)) return;

    log("applyHeroImages: desired", srcs);

    const root = section.querySelector(".hero_pastallax");
    const back = root.querySelector("img.hero_img.is-background");
    const mid = root.querySelector("img.hero_img.is-mid");
    const front = root.querySelector("img.hero_img.is-foreground");

    const changed = [];

    const getAttrSrc = (img) => {
        try {
            return img?.getAttribute?.("src") || "";
        } catch {
            return "";
        }
    };

    if (back && srcs.back && getAttrSrc(back) !== srcs.back) {
        log("swap back", { from: getAttrSrc(back), to: srcs.back });
        back.loading = "eager";
        back.decoding = "async";
        back.src = srcs.back;
        changed.push(back);
    }
    if (mid && srcs.mid && getAttrSrc(mid) !== srcs.mid) {
        log("swap mid", { from: getAttrSrc(mid), to: srcs.mid });
        mid.loading = "eager";
        mid.decoding = "async";
        mid.src = srcs.mid;
        changed.push(mid);
    }
    if (front && srcs.front && getAttrSrc(front) !== srcs.front) {
        log("swap front", { from: getAttrSrc(front), to: srcs.front });
        front.loading = "eager";
        front.decoding = "async";
        front.src = srcs.front;
        changed.push(front);
    }

    return changed;
}

function revealPageIfAllowed() {
    // If homeLoading exists on this page, it controls page-wrap reveal.
    const hasHomeLoader = Boolean(document.querySelector(".section_loading"));
    if (hasHomeLoader) {
        log("revealPageIfAllowed: blocked by .section_loading");
        return;
    }

    revealGate();
}

function ensureKitBucket() {
    window.sitekit = window.sitekit || {};
    window.sitekit.whatWeDoHero = window.sitekit.whatWeDoHero || {};
    return window.sitekit.whatWeDoHero;
}

export function init() {
    // Only run when the page actually has the hero + image pool.
    const hasPool = Array.isArray(window.whatWeDoHeroImages) && window.whatWeDoHeroImages.length;
    const sections = Array.from(document.querySelectorAll(".section_hero"));
    const targets = sections.filter((s) => s.querySelector(".hero_pastallax"));
    log("init()", { hasPool, poolLen: Array.isArray(window.whatWeDoHeroImages) ? window.whatWeDoHeroImages.length : 0, targets: targets.length });
    if (!hasPool || !targets.length) return;

    const bucket = ensureKitBucket();
    const lastKey = readLastThemeKey();
    const nextTheme = computeNextTheme(lastKey);
    persistThemeKey(nextTheme.key);

    bucket.theme = nextTheme;
    bucket.list = COLOR_THEMES.slice();

    log("theme", { last: lastKey, next: nextTheme.key });

    applyThemeGlobal(nextTheme);

    // Preload desired theme images before applying swaps.
    // This prevents the “reveal then jarring src switch” when the old image is still displayed.
    const pool = window.whatWeDoHeroImages;
    const desired = pickThemeHeroSrcs(nextTheme.key, pool);
    log("preload: desired", desired);

    const preloadList = [desired.back, desired.mid, desired.front].filter(Boolean);
    log("preload: start", { count: preloadList.length, maxWaitMs: REVEAL.maxWaitMs });

    Promise.allSettled(preloadList.map((src) => preloadSrc(src, REVEAL.maxWaitMs)))
        .then((results) => {
            log(
                "preload: done",
                results.map((r) => (r.status === "fulfilled" ? r.value : { status: "rejected" }))
            );

            // Apply theme classes and swaps while still hidden.
            targets.forEach((section) => {
                applyThemeClasses(nextTheme, section);
                applyHeroImagesFromSrcs(desired, section);
            });
        })
        .then(() => nextPaint())
        .finally(() => {
            log("revealing (post-preload+swap)");
            revealPageIfAllowed();
        });
}

export const api = {
    getTheme: () => window.sitekit?.whatWeDoHero?.theme || null,
    getThemes: () => COLOR_THEMES.slice()
};
