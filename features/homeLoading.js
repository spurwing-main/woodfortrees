// homeLoading.js
// Expects: window.homeLoadingImages = [{ src }, ...]

import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@12.23.26/+esm";

const DEBUG = false;
const log = (...a) => DEBUG && console.log("[homeLoading]", ...a);
const warn = (...a) => console.warn("[homeLoading]", ...a);

const CONFIG = {
    stackCount: 6,
    maxAttempts: 6,
    retryDelayMs: 250,

    holdBeforeOutroMs: 900,

    // visual feel
    rotateMin: -9,
    rotateMax: 9,
    offsetPx: 8,

    // aboutHero-ish drop pose (slower)
    dropInY: -22,
    dropInScale: 1.08,
    dropRotDelta: 4.5,
    staggerStep: 0.28,
    inScaleStep: 0.018,
    springs: {
        in: { type: "spring", stiffness: 420, damping: 46, mass: 1 }
    },
    durations: {
        in: 1.65
    },

    outro: {
        // Cards: quick and staggered
        imagesDuration: 0.28,
        imagesStaggerStep: 0.055,
        imagesScaleTo: 0.9,

        // Calm, high-quality ease-out
        easeOut: [0.22, 1, 0.36, 1],

        // Section: fade out all at once (fast)
        sectionDuration: 0.22,
        sectionDelayAfterImagesMs: 0
    }
};

let stackRoot = null;
let created = [];
let retryTimer = null;
let runToken = 0;
let attempts = 0;

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

    const delays = stagger(CONFIG.outro.imagesStaggerStep);
    const imgControls = items.map((el, i) =>
        // Use stored values so we animate *from* the exact pose we created.
        animate(
            el,
            {
                opacity: [1, 0],
                scale: [
                    Number.parseFloat(el.dataset.homeLoadingEndScale || "1"),
                    CONFIG.outro.imagesScaleTo
                ],
                rotate: [
                    Number.parseFloat(el.dataset.homeLoadingRot || "0"),
                    0
                ]
            },
            {
                duration: CONFIG.outro.imagesDuration,
                delay: delays(i)
                ,
                easing: CONFIG.outro.easeOut
            }
        )
    );

    await Promise.allSettled(imgControls.map((c) => c.finished));
    if (token !== runToken) return;

    await sleep(CONFIG.outro.sectionDelayAfterImagesMs);
    if (token !== runToken) return;

    const sectionControl = animate(
        section,
        { opacity: [1, 0] },
        { duration: CONFIG.outro.sectionDuration, easing: CONFIG.outro.easeOut }
    );

    await Promise.allSettled([sectionControl.finished]);

    if (token !== runToken) return;
    section.style.display = "none";
}

async function ensureStack(section, layout, token) {
    const pool = getPoolSrcs();
    if (!pool.length) {
        if (attempts < CONFIG.maxAttempts) {
            attempts += 1;
            clearRetry();
            retryTimer = setTimeout(() => {
                retryTimer = null;
                init();
            }, CONFIG.retryDelayMs);
        } else {
            warn("init: no window.homeLoadingImages");
        }
        return;
    }

    attempts = 0;
    clearRetry();

    const chosen = pickSrcs(pool, CONFIG.stackCount);
    if (!chosen.length) return;

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

    chosen.forEach((src, i) => {
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
        items.push({ item, i });
    });

    // animate in (slow, staggered, rotate/scale down)
    const delays = stagger(CONFIG.staggerStep);
    const controls = items.map(({ item }, i) => {
        const rot = rand(CONFIG.rotateMin, CONFIG.rotateMax);
        const dx = rand(-CONFIG.offsetPx, CONFIG.offsetPx);
        const dy = rand(-CONFIG.offsetPx, CONFIG.offsetPx);
        const startRot = rot + rand(-CONFIG.dropRotDelta, CONFIG.dropRotDelta);

        const endScale = 1 + i * CONFIG.inScaleStep;
        const startScale = endScale * CONFIG.dropInScale;

        // store target pose for smooth outro later
        item.dataset.homeLoadingRot = String(rot);
        item.dataset.homeLoadingEndScale = String(endScale);

        // start pose
        item.style.opacity = "0";
        item.style.transform = `translate3d(${dx}px, ${dy + CONFIG.dropInY}px, 0) scale(${startScale}) rotate(${startRot}deg)`;

        return animate(
            item,
            {
                opacity: [0, 1],
                x: [dx, dx],
                y: [dy + CONFIG.dropInY, dy],
                scale: [startScale, endScale],
                rotate: [startRot, rot]
            },
            {
                ...CONFIG.springs.in,
                duration: CONFIG.durations.in,
                delay: delays(i)
            }
        );
    });

    // Wait for all IN animations to finish, then hold, then outro
    await Promise.allSettled(controls.map((c) => c.finished));
    if (token !== runToken) return;

    await sleep(CONFIG.holdBeforeOutroMs);
    if (token !== runToken) return;

    await runOutro(section, items.map((it) => it.item), token);

    log("mounted stack", created.length);
}

export function init() {
    // Clean up previous mount if called twice
    destroy();

    const token = runToken;

    const section = document.querySelector(".section_loading");
    if (!section) return;

    const layout = section.querySelector(".loading_layout") || document.querySelector(".loading_layout");
    if (!layout) return;

    // If we already mounted somehow, remove any remnants first
    Array.from(layout.querySelectorAll("[data-home-loading-stack='true']")).forEach((el) => el.remove());
    layout.querySelector("[data-home-loading-stack-root='true']")?.remove();

    void ensureStack(section, layout, token);
}
