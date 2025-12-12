// homeLoading.js
// Expects: window.homeLoadingImages = [{ src }, ...]

import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@12.23.26/+esm";

const DEBUG = false;
const log = (...a) => DEBUG && console.log("[homeLoading]", ...a);
const warn = (...a) => console.warn("[homeLoading]", ...a);

// Always reveal the page content as soon as this feature loads.
try {
    document.querySelector(".page-wrap")?.style &&
        (document.querySelector(".page-wrap").style.opacity = "1");
} catch {
    // ignore
}

const CONFIG = {
    gate: {
        // show at most once per 24h
        seenKey: "sitekit_homeLoadingSeen",
        seenTsKey: "sitekit_homeLoadingSeenTs",
        cooldownMs: 1000 * 60 * 60 * 24,

        // if `sitekit_mode` is `dev`, always show
        modeKey: "sitekit_mode",
        devMode: "dev"
    },

    stack: {
        count: 6,
        offsetPx: 8,
        jitterPx: 1.5,
        rotateMin: -9,
        rotateMax: 9,

        // request: last one straight
        lastCardStraight: true
    },

    retry: {
        maxAttempts: 6,
        delayMs: 250
    },

    timing: {
        // delay before anything starts (incl. preload requests)
        startDelayMs: 250,

        // pause after intro settles
        holdBeforeOutroMs: 900
    },

    sectionIntro: {
        duration: 0.25,
        easing: [0.22, 1, 0.36, 1]
    },

    intro: {
        // aboutHero-ish drop pose (slower)
        dropInY: -22,
        dropInScale: 1.08,
        dropRotDelta: 4.5,

        // each card ends slightly larger
        scaleStep: -0.018,

        staggerStep: 0.38,
        duration: 1.65,
        spring: { type: "spring", stiffness: 420, damping: 46, mass: 1 }
    },

    outro: {
        // Cards: quick and staggered
        cardDuration: 0.28,
        cardStaggerStep: 0.055,
        cardScaleTo: 0.7,

        // Calm, high-quality ease-out
        easeOut: [0.22, 1, 0.36, 1],

        // Section: fade out all at once (fast)
        sectionDuration: 0.22,
        sectionDelayAfterCardsMs: 0
    }
};

let stackRoot = null;
let created = [];
let retryTimer = null;
let runToken = 0;
let attempts = 0;

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

function isDevMode() {
    const fromWindow = String(window.sitekit_mode || "").toLowerCase();
    const fromStorage = String(safeStorageGet(CONFIG.gate.modeKey) || "").toLowerCase();
    return fromWindow === CONFIG.gate.devMode || fromStorage === CONFIG.gate.devMode;
}

function hasSeenRecently() {
    const seen = safeStorageGet(CONFIG.gate.seenKey);
    if (seen !== "true") return false;

    const tsRaw = safeStorageGet(CONFIG.gate.seenTsKey);
    const ts = Number.parseInt(tsRaw || "", 10);
    if (!Number.isFinite(ts)) return true;

    return Date.now() - ts < CONFIG.gate.cooldownMs;
}

function markSeenNow() {
    safeStorageSet(CONFIG.gate.seenKey, "true");
    safeStorageSet(CONFIG.gate.seenTsKey, String(Date.now()));
}

const lerp = (a, b, t) => a + (b - a) * t;

function dedupe(arr) {
    return Array.from(new Set((arr || []).filter(Boolean)));
}

function shuffle(arr) {
    const a = (arr || []).slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
    return a;
}

function pickSrcs(pool, count) {
    const unique = dedupe(pool);
    if (!unique.length) return [];

    if (unique.length >= count) {
        return shuffle(unique).slice(0, count);
    }

    const base = shuffle(unique);
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push(base[i % base.length]);
    }
    return out;
}

const rand = (min, max) => min + Math.random() * (max - min);

const sleep = (ms) =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

function waitForImage(src, timeoutMs = 10000) {
    if (!src) return Promise.reject(new Error("empty src"));

    return new Promise((resolve, reject) => {
        const img = new Image();
        let done = false;

        const finish = (ok) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            if (ok) resolve();
            else reject(new Error("Image failed: " + src));
        };

        const t = setTimeout(() => finish(false), timeoutMs);
        img.decoding = "async";
        img.loading = "eager";
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = src;

        // If decode is supported it can settle earlier than onload in some cases.
        if (typeof img.decode === "function") {
            img.decode().then(
                () => finish(true),
                () => {
                    // fall back to onload/onerror
                }
            );
        }
    });
}

function clearRetry() {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}

export function destroy() {
    clearRetry();
    attempts = 0;
    runToken += 1;

    created.splice(0).forEach((el) => {
        try {
            el.remove();
        } catch {
            // ignore
        }
    });

    if (stackRoot) {
        try {
            stackRoot.remove();
        } catch {
            // ignore
        }
        stackRoot = null;
    }
}

function getPoolSrcs() {
    const raw = Array.isArray(window.homeLoadingImages)
        ? window.homeLoadingImages
        : [];

    return dedupe(raw.map((it) => it?.src).filter(Boolean));
}

async function runOutro(section, items, token) {
    if (token !== runToken) return;

    const cardCount = items.length;
    const delays = stagger(CONFIG.outro.cardStaggerStep);
    const imgControls = items.map((it, i) =>
        animate(
            it.el,
            {
                opacity: [1, 0],
                scale: [it.pose.endScale, CONFIG.outro.cardScaleTo],
                rotate: [it.pose.rot, 0]
            },
            {
                duration: CONFIG.outro.cardDuration,
                delay: delays(i),
                easing: CONFIG.outro.easeOut
            }
        )
    );

    // Fade the whole section (logos included) so it FINISHES with the last card.
    // It starts later (computed), but ends at the same time as the staggered cards.
    const lastCardDelay = Math.max(0, (cardCount - 1) * CONFIG.outro.cardStaggerStep);
    const lastCardEnd = lastCardDelay + CONFIG.outro.cardDuration;
    const sectionDelay = Math.max(0, lastCardEnd - CONFIG.outro.sectionDuration);

    const sectionControl = animate(
        section,
        { opacity: [1, 0] },
        {
            duration: CONFIG.outro.sectionDuration,
            delay: sectionDelay,
            easing: CONFIG.outro.easeOut
        }
    );

    await Promise.allSettled([
        ...imgControls.map((c) => c.finished),
        sectionControl.finished
    ]);

    if (token !== runToken) return;
    section.style.display = "none";
}

async function ensureStack(section, layout, token) {
    const pool = getPoolSrcs();
    if (!pool.length) {
        if (attempts < CONFIG.retry.maxAttempts) {
            attempts += 1;
            clearRetry();
            retryTimer = setTimeout(() => {
                retryTimer = null;
                init();
            }, CONFIG.retry.delayMs);
        } else {
            warn("init: no window.homeLoadingImages");
        }
        return;
    }

    // Delay before doing anything visible or starting any requests
    await sleep(CONFIG.timing.startDelayMs);
    if (token !== runToken) return;

    attempts = 0;
    clearRetry();

    const chosen = pickSrcs(pool, CONFIG.stack.count);
    if (!chosen.length) return;

    // Wait for all 6 images to load before we swap/mount and animate.
    // Use allSettled to avoid hanging forever if a single URL fails.
    const loadResults = await Promise.allSettled(chosen.map((src) => waitForImage(src)));
    if (token !== runToken) return;

    const loadedSrcs = chosen.filter((_, i) => loadResults[i]?.status === "fulfilled");
    if (loadedSrcs.length !== chosen.length) {
        warn("Some loading images failed to preload", { loaded: loadedSrcs.length, expected: chosen.length });
    }
    if (!loadedSrcs.length) return;

    // Mark as seen only when we’re actually going to show.
    if (!isDevMode()) markSeenNow();

    // Replace the single placeholder image, if it exists.
    const placeholder = layout.querySelector("img.loading_image");
    const baseClass = placeholder?.className || "loading_image";
    if (placeholder) placeholder.remove();

    // layout must be positioning context for absolute stack root
    if (!layout.style.position) layout.style.position = "relative";

    // Build a single root so we can keep the stack behind other children (e.g. logos)
    stackRoot = document.createElement("div");
    stackRoot.dataset.homeLoadingStackRoot = "true";
    stackRoot.style.position = "absolute";
    stackRoot.style.inset = "0";
    stackRoot.style.pointerEvents = "none";
    stackRoot.style.zIndex = "0";

    // Insert stack as first child so later elements (logos) sit on top.
    layout.insertBefore(stackRoot, layout.firstChild);

    // build stack (only 6 <img> get created)
    created = [];
    const items = [];

    loadedSrcs.slice(0, CONFIG.stack.count).forEach((src) => {
        const item = document.createElement("div");
        item.dataset.homeLoadingStack = "true";
        item.style.position = "absolute";
        item.style.inset = "0";
        item.style.display = "flex";
        item.style.alignItems = "center";
        item.style.justifyContent = "center";
        item.style.willChange = "transform, opacity";
        item.style.pointerEvents = "none";

        const img = document.createElement("img");
        img.className = baseClass;
        img.alt = "";
        img.decoding = "async";
        img.loading = "eager";
        img.src = src;

        item.appendChild(img);
        stackRoot.appendChild(item);
        created.push(item);
        items.push(item);
    });

    const count = items.length;
    const startDx = rand(-CONFIG.stack.offsetPx, CONFIG.stack.offsetPx);
    const startDy = rand(-CONFIG.stack.offsetPx, CONFIG.stack.offsetPx);
    const cards = items.map((el, i) => {
        const isLast = i === count - 1;
        const rot = CONFIG.stack.lastCardStraight && isLast
            ? 0
            : rand(CONFIG.stack.rotateMin, CONFIG.stack.rotateMax);

        // Drift each card slightly toward the center; final card ends centered.
        const t = count <= 1 ? 1 : i / (count - 1);
        const jitter = CONFIG.stack.jitterPx;
        const dx = CONFIG.stack.lastCardStraight && isLast
            ? 0
            : lerp(startDx, 0, t) + rand(-jitter, jitter);
        const dy = CONFIG.stack.lastCardStraight && isLast
            ? 0
            : lerp(startDy, 0, t) + rand(-jitter, jitter);
        const startRot = rot + rand(-CONFIG.intro.dropRotDelta, CONFIG.intro.dropRotDelta);

        const endScale = 1 + i * CONFIG.intro.scaleStep;
        const startScale = endScale * CONFIG.intro.dropInScale;

        return {
            el,
            pose: { rot, dx, dy, startRot, endScale, startScale }
        };
    });

    // animate in (slow, staggered, rotate/scale down)
    const delays = stagger(CONFIG.intro.staggerStep);
    const controls = cards.map((it, i) => {
        const { dx, dy, startRot, startScale, endScale, rot } = it.pose;

        // start pose
        it.el.style.opacity = "0";
        it.el.style.transform = `translate3d(${dx}px, ${dy + CONFIG.intro.dropInY}px, 0) scale(${startScale}) rotate(${startRot}deg)`;

        return animate(
            it.el,
            {
                opacity: [0, 1],
                x: [dx, dx],
                y: [dy + CONFIG.intro.dropInY, dy],
                scale: [startScale, endScale],
                rotate: [startRot, rot]
            },
            {
                ...CONFIG.intro.spring,
                duration: CONFIG.intro.duration,
                delay: delays(i)
            }
        );
    });

    // Wait for all IN animations to finish, then hold, then outro
    await Promise.allSettled(controls.map((c) => c.finished));
    if (token !== runToken) return;

    await sleep(CONFIG.timing.holdBeforeOutroMs);
    if (token !== runToken) return;

    await runOutro(section, cards, token);

    log("mounted stack", created.length);
}

export function init() {
    // Clean up previous mount if called twice
    destroy();

    const token = runToken;

    const section = document.querySelector(".section_loading");
    if (!section) return;

    // Gate: show at most once per 24h unless dev mode.
    if (!isDevMode() && hasSeenRecently()) {
        section.style.display = "none";
        return;
    }

    // Make sure the loader is visible, but animate it in.
    section.style.display = "";
    section.style.visibility = "visible";
    section.style.opacity = "0";

    const introToken = token;
    animate(
        section,
        { opacity: [0, 1] },
        { duration: CONFIG.sectionIntro.duration, easing: CONFIG.sectionIntro.easing }
    ).finished.finally(() => {
        // If init/destroy raced, don’t force any final state.
        if (introToken !== runToken) return;
        section.style.opacity = "1";
    });

    const layout = section.querySelector(".loading_layout") || document.querySelector(".loading_layout");
    if (!layout) return;

    // If we already mounted somehow, remove any remnants first
    Array.from(layout.querySelectorAll("[data-home-loading-stack='true']")).forEach((el) => el.remove());
    layout.querySelector("[data-home-loading-stack-root='true']")?.remove();

    void ensureStack(section, layout, token);
}
