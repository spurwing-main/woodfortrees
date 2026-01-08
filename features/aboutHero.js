// aboutHero.js
// Expects: window.aboutHeroImages = [{ src, people?: boolean, place?: boolean }, ...]

import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@12.23.26/+esm";

import { createLogger } from "../utils/debug.js";

const { log, warn } = createLogger("aboutHero");

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const dur = (t0) => Math.round(now() - t0);

const CONFIG = {
    maxPoolSize: 32,

    // pose for "drop in"
    dropInY: -28,
    dropInScale: 1.08,
    dropRot: 3,

    springs: {
        in: { type: "spring", stiffness: 900, damping: 40, mass: 1 }
    },

    durations: {
        // single-card swap (auto)
        singleIn: 0.6,
        singleOut: 0.2,

        // global list (initial load + theme switch)
        globalIn: 0.45,
        globalOut: 0.2
    },

    // Offsets between OUT and IN (in seconds)
    // These are *relative*, but both animations are scheduled together.
    offsets: {
        singleIn: 0.08, // new card starts 0.08s after old card starts fading/scaling out
        globalIn: 0.1   // cluster IN starts 0.1s after OUT starts
    },

    staggerStep: 0.06,
    autoDelayMin: 500,
    autoDelayMax: 2000,

    warmConcurrency: 4
};

const LAYOUT = {
    // Card size as % of the block's smaller side (recommended 40–80).
    // Larger values reduce travel area; smaller values give more movement.
    itemSizePercentOfMin: 85,
    // Jitter per swap/theme change as % of movement range (recommended 0–15).
    // Higher = more variation away from the base anchor.
    anchorJitterPercent: 15,
    // Anchor grid positions (normalized 0–1). With [0, 1] we only use corners.
    anchorSteps: [0, 1]
};

const ANCHORS = buildAnchors();

function buildAnchors() {
    const anchors = [];
    LAYOUT.anchorSteps.forEach((y) => {
        LAYOUT.anchorSteps.forEach((x) => {
            anchors.push({ x, y });
        });
    });

    return anchors.map((anchor, idx) => ({ ...anchor, idx }));
}

let allBlocks = [];

// ===== shared state =====

let imageCache; // Map<string, Promise<void>>
let poolWarmers = new Map(); // Map<string, Promise<void>>
let readyCache; // Map<string, Promise<boolean>>

let pools = { people: [], places: [] }; // string[]
// `theme` = currently *selected* theme (including in-flight transitions)
let theme = "people";
let slots = []; // [{ block, item, img, src, anchor }]

let autoTimer = null;
let isBusy = false;      // any swap / theme transition in-flight
let queuedTheme = null;  // at most one queued theme, last click wins

let cleanupFns = [];

// remember the last couple of auto-swapped slots
let lastAutoSlotHistory = []; // [mostRecent, previous]

// cached DOM for queued theme changes
let sectionEl = null;
let titleEl = null;

export function destroy() {
    // cancel timers
    if (autoTimer) {
        clearTimeout(autoTimer);
        autoTimer = null;
    }

    // remove event listeners
    cleanupFns.splice(0).forEach((fn) => {
        try {
            fn();
        } catch (err) {
            warn("destroy cleanup error", err);
        }
    });

    // clear DOM we created
    slots.forEach((s) => s.item?.remove());

    // also reset any styles we applied to blocks
    slots.forEach((s) => {
        if (s.block) {
            s.block.style.position = "";
            s.block.style.display = "";
            s.block.style.padding = "";
            s.block.style.boxSizing = "";
        }
    });
    allBlocks.forEach((block) => {
        if (block && block.style) {
            block.style.position = "";
            block.style.display = "";
            block.style.padding = "";
            block.style.boxSizing = "";
        }
    });
    slots = [];
    allBlocks = [];

    // reset state
    isBusy = false;
    queuedTheme = null;
    lastAutoSlotHistory = [];
    sectionEl = null;
    titleEl = null;
}

// ===== utilities =====

const rand = (min, max) => min + Math.random() * (max - min);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));

const anchorSide = (v) => (v >= 0.5 ? 1 : 0);

function computeBlockLayout(block) {
    const rect = block?.getBoundingClientRect
        ? block.getBoundingClientRect()
        : { width: 0, height: 0 };

    const width = rect.width || 0;
    const height = rect.height || 0;
    const base = Math.max(Math.min(width, height), 0);
    const size = (base * LAYOUT.itemSizePercentOfMin) / 100;
    const sizeWidthPercent = width ? (size / width) * 100 : 0;
    const sizeHeightPercent = height ? (size / height) * 100 : 0;

    return {
        width,
        height,
        size,
        sizeWidthPercent,
        sizeHeightPercent,
        maxX: Math.max(0, width - size),
        maxY: Math.max(0, height - size)
    };
}

const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
    }
    return a;
};

const nextPaint = () =>
    new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

function ensureSrcReady(src) {
    if (!src) return Promise.resolve(false);

    let p = readyCache.get(src);
    if (p) return p;

    p = new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = "async";
        img.loading = "eager";
        img.onload = async () => {
            if (typeof img.decode === "function") {
                try {
                    await img.decode();
                } catch (err) {
                    warn("ensureSrcReady decode failed", { src, err });
                }
            }
            resolve(true);
        };
        img.onerror = () => reject(new Error("Image failed: " + src));
        img.src = src;
    });

    readyCache.set(src, p);
    p.catch(() => {
        try {
            readyCache.delete(src);
        } catch { }
    });

    return p;
}

function warmPool(key) {
    const pool = pools[key];
    if (!pool || !pool.length) return;

    const existing = poolWarmers.get(key);
    if (existing) return existing;

    const srcs = dedupe(pool);
    const { warmConcurrency } = CONFIG;

    const job = (async () => {
        for (let i = 0; i < srcs.length; i += warmConcurrency) {
            const batch = srcs.slice(i, i + warmConcurrency);
            await Promise.allSettled(batch.map(ensureSrcReady));
        }
        log("warmPool done", { key, count: srcs.length });
    })()
        .catch((err) => warn("warmPool error", { key, err }))
        .finally(() => {
            poolWarmers.delete(key);
        });

    poolWarmers.set(key, job);
    return job;
}

async function ensureImageReady(img, src) {
    if (!img || !src) return false;

    const t0 = now();

    const ready = await ensureSrcReady(src).catch((err) => {
        warn("ensureImageReady preload failed", { src, err });
        return false;
    });

    const waitForLoad = () =>
        new Promise((resolve, reject) => {
            if (img.complete) {
                if (img.naturalWidth > 0) {
                    resolve(true);
                } else {
                    reject(new Error("Image failed: " + src));
                }
                return;
            }

            const onLoad = () => {
                img.removeEventListener("error", onError);
                resolve(true);
            };
            const onError = () => {
                img.removeEventListener("load", onLoad);
                reject(new Error("Image failed: " + src));
            };

            img.addEventListener("load", onLoad, { once: true });
            img.addEventListener("error", onError, { once: true });
        });

    const loadResult = await waitForLoad().catch((err) => {
        warn("ensureImageReady load failed", { src, err });
        return false;
    });

    if (ready && loadResult) {
        log("ensureImageReady done", { src, ms: dur(t0) });
    }
    return Boolean(ready && loadResult);
}

function preload(src) {
    if (!src) return Promise.reject(new Error("empty src"));
    let p = imageCache.get(src);
    if (p) {
        log("preload cache hit", src);
        return p;
    }

    log("preload start", src);
    p = new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = "async";
        img.loading = "eager";
        img.onload = () => {
            log("preload loaded", src);
            resolve();
        };
        img.onerror = () => {
            warn("preload failed", src);
            reject(new Error("Image failed: " + src));
        };
        img.src = src;
    });
    imageCache.set(src, p);
    p.catch(() => {
        try {
            imageCache.delete(src);
        } catch { }
    });
    return p;
}

function buildPools() {
    const raw = Array.isArray(window.aboutHeroImages)
        ? window.aboutHeroImages
        : [];

    const people = shuffle(
        dedupe(
            raw.filter((it) => it?.people && it.src).map((it) => it.src)
        )
    ).slice(0, CONFIG.maxPoolSize);

    const places = shuffle(
        dedupe(
            raw.filter((it) => it?.place && it.src).map((it) => it.src)
        )
    ).slice(0, CONFIG.maxPoolSize);

    log("pools:", { people: people.length, places: places.length });
    return { people, places };
}

function pickSrcs(pool, count) {
    const unique = dedupe(pool);
    if (!unique.length) return [];
    if (unique.length >= count) return shuffle(unique).slice(0, count);

    const base = shuffle(unique);
    const out = [];
    for (let i = 0; i < count; i++) {
        out.push(base[i % base.length]);
    }
    return out;
}

function jitterAnchor(anchor) {
    if (!anchor) return { idx: null, x: 0, y: 0 };

    const jitterScale = (LAYOUT.anchorJitterPercent || 0) / 100;
    if (!jitterScale) return { ...anchor };

    const jitteredX = clamp(anchor.x + rand(-jitterScale, jitterScale), 0, 1);
    const jitteredY = clamp(anchor.y + rand(-jitterScale, jitterScale), 0, 1);

    return { ...anchor, x: jitteredX, y: jitteredY };
}

function resolveAnchorPosition(anchor, blockLayout) {
    const layout = blockLayout || computeBlockLayout();
    const jittered = jitterAnchor(anchor);
    const left = jittered.x * layout.maxX;
    const top = jittered.y * layout.maxY;
    const topPercent = layout.height ? (top / layout.height) * 100 : 0;
    const leftPercent = layout.width ? (left / layout.width) * 100 : 0;

    return { ...jittered, top, left, topPercent, leftPercent };
}

function pickAnchor(prevAnchor = null) {
    if (!ANCHORS.length) {
        return { x: 0, y: 0, idx: 0 };
    }

    const randomAnchor = () => {
        const idx = (Math.random() * ANCHORS.length) | 0;
        const base = ANCHORS[idx] || { x: 0, y: 0, idx };
        const anchor = jitterAnchor(base);
        return { ...anchor, idx: base.idx ?? idx };
    };

    if (!prevAnchor || typeof prevAnchor !== "object") {
        return randomAnchor();
    }

    const prevX = anchorSide(prevAnchor.x ?? 0);
    const prevY = anchorSide(prevAnchor.y ?? 0);
    const targetX = prevX === 0 ? 1 : 0;
    const targetY = prevY === 0 ? 1 : 0;

    const target =
        ANCHORS.find((a) => a.x === targetX && a.y === targetY) || null;
    if (!target) {
        return randomAnchor();
    }

    const anchor = jitterAnchor(target);
    return { ...anchor, idx: target.idx };
}

function describeAnchor(anchor, layout) {
    if (anchor && typeof anchor === "object") {
        const { idx, topPercent, leftPercent, x = 0, y = 0 } = anchor;
        if (typeof topPercent === "number" && typeof leftPercent === "number") {
            return { idx: typeof idx === "number" ? idx : null, top: topPercent, left: leftPercent };
        }
        const l = layout || computeBlockLayout();
        return {
            idx: typeof idx === "number" ? idx : null,
            top: l.height ? (y * l.maxY * 100) / l.height : 0,
            left: l.width ? (x * l.maxX * 100) / l.width : 0
        };
    }
    const target = typeof anchor === "number" ? ANCHORS[anchor] : null;
    return {
        idx: typeof anchor === "number" ? anchor : null,
        top: target ? target.y * 100 : 0,
        left: target ? target.x * 100 : 0
    };
}

function formatAnchor(anchor, layout) {
    const a = describeAnchor(anchor, layout);
    const round = (v) => Math.round(v * 10) / 10;
    return `#${a.idx ?? "?"} (top:${round(a.top)}%, left:${round(a.left)}%)`;
}

function setObjectPosition(img, anchor) {
    if (!img || !anchor) return;
    const x = clamp((anchor.x ?? 0.5) * 100, 0, 100);
    const y = clamp((anchor.y ?? 0.5) * 100, 0, 100);
    img.style.objectPosition = `${x}% ${y}%`;
}

// ===== DOM helpers =====

function makeItem(src, anchor, blockLayout) {
    // New item every time we show an image → new random x/y per swap
    const layout = blockLayout || computeBlockLayout();
    const baseAnchor = anchor || pickAnchor();
    const resolvedAnchor = resolveAnchorPosition(baseAnchor, layout);

    const item = document.createElement("div");
    item.className = "about_block-item";
    item.style.position = "absolute";
    item.style.width = `${layout.sizeWidthPercent || 0}%`;
    item.style.height = `${layout.sizeHeightPercent || 0}%`;
    item.style.top = `${resolvedAnchor.topPercent || 0}%`;
    item.style.left = `${resolvedAnchor.leftPercent || 0}%`;
    item.style.willChange = "transform, opacity";

    const frame = document.createElement("div");
    frame.className = "about_block-inner";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.display = "grid";
    frame.style.placeItems = "center";
    frame.style.overflow = "hidden";

    const img = document.createElement("img");
    img.className = "about_block-img";
    img.alt = "";
    img.decoding = "async";
    img.src = src;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.display = "block";
    setObjectPosition(img, resolvedAnchor);

    frame.appendChild(img);
    item.appendChild(frame);

    return { item, img, anchor: resolvedAnchor };
}

function applyThemeClasses(key) {
    if (!sectionEl) return;
    const isPeople = key === "people";
    sectionEl.classList.toggle("is-people", isPeople);
    sectionEl.classList.toggle("is-places", !isPeople);
}

function syncTitleActive(key) {
    if (!titleEl) return;
    const btns = Array.from(
        titleEl.querySelectorAll("[data-about-hero]")
    );
    btns.forEach((btn) => {
        const match =
            (btn.dataset.aboutHero || "").toLowerCase() === key;
        btn.classList.toggle("about_title-active", match);
    });
}

// ===== Motion pose helpers =====

function setDropPose(el) {
    const { dropInY, dropInScale, dropRot } = CONFIG;
    el.style.opacity = "0";
    el.style.transform = `translate3d(0, ${dropInY}px, 0) scale(${dropInScale}) rotate(${dropRot}deg)`;
}

// single-card (auto swap): in = full drop pose
function animateInSingle(el, delay = 0) {
    const { dropInY, dropInScale, dropRot, springs, durations } =
        CONFIG;
    return animate(
        el,
        {
            opacity: [0, 1],
            y: [dropInY, 0],
            scale: [dropInScale, 1],
            rotate: [dropRot, 0]
        },
        {
            ...springs.in,
            duration: durations.singleIn,
            delay
        }
    );
}

// single-card (auto swap): out = quick scale down + fade, no x/y/rotate
function animateOutSingle(el, delay = 0) {
    const { springs, durations } = CONFIG;
    return animate(
        el,
        {
            opacity: [1, 0],
            scale: [1, 0.9]
        },
        {
            ...springs.in,
            duration: durations.singleOut,
            delay
        }
    );
}

// list animations (initial load + theme switch)

// in: OG “drop” pose, staggered, slightly faster than single-card
function animateListIn(elements, baseDelay = 0) {
    if (!elements.length) return Promise.resolve();
    const { dropInY, dropInScale, dropRot, springs, durations } =
        CONFIG;

    const list = shuffle(elements);
    const anim = animate(
        list,
        {
            opacity: [0, 1],
            y: [dropInY, 0],
            scale: [dropInScale, 1],
            rotate: [dropRot, 0]
        },
        {
            ...springs.in,
            duration: durations.globalIn,
            delay: stagger(CONFIG.staggerStep, {
                startDelay: baseDelay
            })
        }
    );

    return anim.finished.catch(() => { });
}

// out: quick scale + fade for all, staggered, no x/y/rotate
function animateListOut(elements, baseDelay = 0) {
    if (!elements.length) return Promise.resolve();
    const { springs, durations } = CONFIG;

    const anim = animate(
        elements,
        {
            opacity: [1, 0],
            scale: [1, 0.9]
        },
        {
            ...springs.in,
            duration: durations.globalOut,
            delay: stagger(CONFIG.staggerStep, {
                startDelay: baseDelay
            })
        }
    );

    return anim.finished.catch(() => { });
}

// ===== auto swap (single card) =====

function scheduleAuto() {
    if (!slots.length) return;
    const delay = rand(CONFIG.autoDelayMin, CONFIG.autoDelayMax);
    log("auto: schedule", { delayMs: Math.round(delay), theme, slots: slots.length });
    autoTimer = window.setTimeout(runAutoSwap, delay);
}

async function runAutoSwap() {
    autoTimer = null;

    const t0 = now();

    if (!slots.length || isBusy) {
        scheduleAuto();
        return;
    }

    const pool = pools[theme] || [];
    if (!pool.length) {
        scheduleAuto();
        return;
    }

    const totalSlots = slots.length;

    // pick a slot index that hasn't been used in the last 2 auto swaps, if possible
    let slotIndex = 0;

    if (totalSlots === 1) {
        slotIndex = 0;
    } else {
        const candidates = [];
        for (let i = 0; i < totalSlots; i++) {
            let isForbidden = false;
            for (let j = 0; j < lastAutoSlotHistory.length; j++) {
                if (lastAutoSlotHistory[j] === i) {
                    isForbidden = true;
                    break;
                }
            }
            if (!isForbidden) {
                candidates.push(i);
            }
        }

        // if we couldn't avoid the last two (e.g. only 2 slots), fall back to all
        if (!candidates.length) {
            for (let i = 0; i < totalSlots; i++) {
                candidates.push(i);
            }
        }

        const chosenIdx = (Math.random() * candidates.length) | 0;
        slotIndex = candidates[chosenIdx];
    }

    const slot = slots[slotIndex];
    if (!slot) {
        scheduleAuto();
        return;
    }

    // update history: most recent at index 0
    lastAutoSlotHistory.unshift(slotIndex);
    if (lastAutoSlotHistory.length > 2) {
        lastAutoSlotHistory.length = 2;
    }

    const used = new Set(slots.map((s) => s.src));
    let candidates = pool.filter((src) => src !== slot.src && !used.has(src));
    if (!candidates.length) {
        candidates = pool.filter((src) => src !== slot.src);
    }
    if (!candidates.length) {
        scheduleAuto();
        return;
    }

    const nextSrc =
        candidates[(Math.random() * candidates.length) | 0];

    log("auto: swap start", {
        slotIndex,
        from: slot.src,
        to: nextSrc,
        theme,
        poolSize: pool.length,
        candidates: candidates.length
    });

    isBusy = true;

    try {
        // load-aware single swap
        const tPre = now();
        await preload(nextSrc);
        log("auto: preload done", { ms: dur(tPre), src: nextSrc });

        const tSwap = now();
        const swapped = await swapSlotImage(slot, nextSrc, slotIndex);
        log("auto: swap done", { ms: dur(tSwap), slotIndex, swapped });
    } catch (err) {
        warn("auto swap error", err);
    } finally {
        isBusy = false;

        log("auto: cycle done", { ms: dur(t0) });

        // If a theme switch was queued during this auto swap, run it now
        if (queuedTheme && queuedTheme !== theme && sectionEl && titleEl) {
            const nextKey = queuedTheme;
            queuedTheme = null;
            changeTheme(nextKey);
        } else {
            // carry on as normal
            scheduleAuto();
        }
    }
}

async function swapSlotImage(slot, nextSrc, slotIndexHint) {
    const t0 = now();
    const oldItem = slot.item;

    const prevAnchor = slot.anchor;
    const blockLayout = computeBlockLayout(slot.block);
    const { item: newItem, img: newImg, anchor } = makeItem(
        nextSrc,
        pickAnchor(prevAnchor),
        blockLayout
    );
    setDropPose(newItem);
    slot.block.appendChild(newItem);

    const ready = await ensureImageReady(newImg, nextSrc);
    if (!ready) {
        newItem.remove();
        log("swapSlotImage: new image not ready", { src: nextSrc });
        return false;
    }

    // KISS: schedule OUT + IN as a single sequence.
    // IN starts at CONFIG.offsets.singleIn seconds.
    const { dropInY, dropInScale, dropRot, springs, durations } = CONFIG;

    const seq = animate([
        [
            oldItem,
            { opacity: [1, 0], scale: [1, 0.9] },
            { ...springs.in, duration: durations.singleOut, at: 0 }
        ],
        [
            newItem,
            {
                opacity: [0, 1],
                y: [dropInY, 0],
                scale: [dropInScale, 1],
                rotate: [dropRot, 0]
            },
            {
                ...springs.in,
                duration: durations.singleIn,
                at: CONFIG.offsets.singleIn
            }
        ]
    ]);

    await seq.finished.catch(() => { });

    log("swapSlotImage: animations done", { ms: dur(t0) });
    const slotIndex =
        typeof slotIndexHint === "number" ? slotIndexHint : slots.indexOf(slot);
    log(
        "swapSlotImage: anchor",
        `slot ${slotIndex}: ${formatAnchor(prevAnchor, blockLayout)} -> ${formatAnchor(anchor, blockLayout)}`,
        {
            slotIndex,
            from: describeAnchor(prevAnchor, blockLayout),
            to: describeAnchor(anchor, blockLayout)
        }
    );

    oldItem.remove();
    slot.item = newItem;
    slot.img = newImg;
    slot.src = nextSrc;
    slot.anchor = anchor;
    return true;
}

// ===== theme change (global list animation) =====

async function changeTheme(key) {
    const t0 = now();
    const pool = pools[key];
    if (!pool || !pool.length) {
        warn("changeTheme: empty pool", key);
        return;
    }
    if (!sectionEl || !titleEl) return;

    warmPool(key);

    // If an animation is in-flight, just remember the latest requested theme.
    if (isBusy) {
        if (queuedTheme !== key) {
            queuedTheme = key;
            log("changeTheme queued:", key);
        }
        return;
    }

    // We're idle here. If we're already on this theme, nothing to do.
    if (key === theme) return;

    if (autoTimer) {
        clearTimeout(autoTimer);
        autoTimer = null;
    }

    isBusy = true;
    queuedTheme = null;

    // Mark this as the selected theme immediately.
    // UI state + future click logic now track this as "current".
    theme = key;

    // Switch classes first so the UI responds instantly.
    // Then allow the browser to paint before doing heavier work/animations.
    applyThemeClasses(key);
    syncTitleActive(key);

    const tPaint = now();
    await nextPaint();
    log("changeTheme: after paint", { ms: dur(tPaint), key });

    const count = slots.length;
    const newSrcs = pickSrcs(pool, count);
    if (!newSrcs.length) {
        isBusy = false;
        scheduleAuto();
        return;
    }

    const preloadList = dedupe(newSrcs);
    log("changeTheme: start", { key, slots: count, poolSize: pool.length, preloadCount: preloadList.length });

    try {
        // preload everything this theme needs for the slots
        const tPre = now();
        const preResults = await Promise.allSettled(preloadList.map(preload));
        const preOk = preResults.filter((r) => r.status === "fulfilled").length;
        log("changeTheme: preload done", { ms: dur(tPre), ok: preOk, total: preResults.length });

        const oldItems = [];
        const newItems = [];
        const readyPromises = [];
        const anchorTransitions = [];

        // build new items but don't remove old yet
        const tBuild = now();
        slots.forEach((slot, i) => {
            const src = newSrcs[i % newSrcs.length];
            const prevAnchor = slot.anchor;
            const blockLayout = computeBlockLayout(slot.block);
            const { item, img, anchor } = makeItem(
                src,
                pickAnchor(prevAnchor),
                blockLayout
            );
            setDropPose(item);
            slot.block.appendChild(item);

            oldItems.push(slot.item);
            newItems.push(item);
            readyPromises.push(ensureImageReady(img, src));

            slot.item = item;
            slot.img = img;
            slot.src = src;
            slot.anchor = anchor;
            anchorTransitions.push({
                slotIndex: i,
                from: describeAnchor(prevAnchor, blockLayout),
                to: describeAnchor(anchor, blockLayout),
                src,
                text: `slot ${i}: ${formatAnchor(prevAnchor, blockLayout)} -> ${formatAnchor(anchor, blockLayout)}`
            });
        });
        log("changeTheme: built new items", { ms: dur(tBuild), count: slots.length });
        log("changeTheme: anchors", {
            transitions: anchorTransitions,
            text: anchorTransitions.map((t) => t.text)
        });

        const readyResults = await Promise.allSettled(readyPromises);
        const readyOk = readyResults.filter((r) => r.status === "fulfilled" && r.value).length;
        if (readyOk !== readyResults.length) {
            warn("changeTheme: some images not ready", { ok: readyOk, total: readyResults.length });
        } else {
            log("changeTheme: images ready", { count: readyOk });
        }

        // Global OUT + IN triggered at the same time:
        // - OUT: scale+fade with stagger
        // - IN: drop-in with stagger, offset by CONFIG.offsets.globalIn
        const outPromise = animateListOut(oldItems, 0);
        const inPromise = animateListIn(
            newItems,
            CONFIG.offsets.globalIn
        );

        const tAnim = now();
        await Promise.all([outPromise, inPromise]);
        log("changeTheme: animations done", { ms: dur(tAnim) });

        oldItems.forEach((el) => el.remove());

        log("changeTheme: done", { key, ms: dur(t0) });
    } catch (err) {
        warn("changeTheme error", err);
    } finally {
        isBusy = false;

        // drain queue if something else got requested while this theme change was running
        if (queuedTheme && queuedTheme !== theme) {
            const nextKey = queuedTheme;
            queuedTheme = null;
            changeTheme(nextKey);
        } else {
            scheduleAuto();
        }

        const otherKey = key === "people" ? "places" : "people";
        warmPool(otherKey);
    }
}

// ===== public init =====

export function init() {
    const t0 = now();
    log("init start");

    // Clean up previous mount if called twice
    destroy();

    const section = document.querySelector(".section_about");
    const layout = document.querySelector(".about_layout");
    const title = document.querySelector(".about_title");
    const blocks = layout
        ? Array.from(layout.querySelectorAll(".about_block"))
        : [];

    allBlocks = blocks;

    log("init: dom", {
        hasSection: Boolean(section),
        hasLayout: Boolean(layout),
        hasTitle: Boolean(title),
        blocks: blocks.length
    });

    if (!section || !layout || !title || !blocks.length) {
        warn("init: missing DOM");
        return;
    }

    if (!imageCache) {
        window.aboutHeroImageCache =
            window.aboutHeroImageCache || new Map();
        imageCache = window.aboutHeroImageCache;
    }
    if (!readyCache) {
        window.aboutHeroReadyCache =
            window.aboutHeroReadyCache || new Map();
        readyCache = window.aboutHeroReadyCache;
    }

    sectionEl = section;
    titleEl = title;

    const tPools = now();
    pools = buildPools();
    log("init: pools built", { ms: dur(tPools), people: pools.people.length, places: pools.places.length });
    if (!pools.people.length && !pools.places.length) {
        warn("init: no pools");
        return;
    }

    warmPool("people");
    warmPool("places");

    // initial theme from DOM or fallbacks
    const buttons = Array.from(
        title.querySelectorAll("[data-about-hero]")
    );
    const domKey = (
        buttons.find((b) =>
            b.classList.contains("about_title-active")
        )?.dataset.aboutHero || ""
    )
        .toLowerCase()
        .trim();

    log("init: theme pick", { domKey: domKey || null, buttons: buttons.length });

    if (domKey && pools[domKey]?.length) {
        theme = domKey;
    } else if (pools.people.length) {
        theme = "people";
    } else {
        theme = "places";
    }

    const initialPool = pools[theme];
    const initialSrcs = pickSrcs(initialPool, blocks.length);
    if (!initialSrcs.length) {
        warn("init: no initial srcs");
        return;
    }

    isBusy = true;

    // preload everything we’re about to show
    const tInitPre = now();
    Promise.allSettled(initialSrcs.map(preload))
        .then(async () => {
            log("init: preload done", { ms: dur(tInitPre), count: initialSrcs.length });

            const tBuild = now();
            blocks.forEach((block, i) => {
                // Remove any stale items from previous mounts (internal nav scenario)
                Array.from(block.querySelectorAll(".about_block-item")).forEach(
                    (stale) => stale.remove()
                );

                const src = initialSrcs[i % initialSrcs.length];
                const anchor = pickAnchor();
                const { item, img, anchor: chosenAnchor } = makeItem(
                    src,
                    anchor,
                    computeBlockLayout(block)
                );
                setDropPose(item);
                block.style.position = "relative";
                block.appendChild(item);
                slots.push({ block, item, img, src, anchor: chosenAnchor });
            });
            log("init: built slots", { ms: dur(tBuild), slots: slots.length });
            log("init: anchors", {
                slots: slots.map((s, i) => ({
                    slotIndex: i,
                    anchor: describeAnchor(s.anchor, computeBlockLayout(s.block)),
                    src: s.src,
                    text: `slot ${i}: ${formatAnchor(s.anchor, computeBlockLayout(s.block))}`
                }))
            });
            log(
                "init: anchors text",
                slots.map((s, i) => `slot ${i}: ${formatAnchor(s.anchor, computeBlockLayout(s.block))}`)
            );

            const readyResults = await Promise.allSettled(
                slots.map((s) => ensureImageReady(s.img, s.src))
            );
            const readyOk = readyResults.filter((r) => r.status === "fulfilled" && r.value).length;
            if (readyOk !== readyResults.length) {
                warn("init: some images not ready", { ok: readyOk, total: readyResults.length });
            } else {
                log("init: images ready", { count: readyOk });
            }

            applyThemeClasses(theme);
            syncTitleActive(theme);

            const items = slots.map((s) => s.item);
            const tAnim = now();
            await animateListIn(items);
            log("init: animate in done", { ms: dur(tAnim), count: items.length });
        })
        .catch((err) => warn("init error", err))
        .finally(() => {
            isBusy = false;

            log("init: complete", { ms: dur(t0), theme, slots: slots.length });

            // If user clicked a theme during the initial animation, respect it.
            if (queuedTheme && queuedTheme !== theme) {
                const nextKey = queuedTheme;
                queuedTheme = null;
                changeTheme(nextKey);
            } else {
                scheduleAuto();
            }
        });

    // theme buttons: always go through queueing logic
    buttons.forEach((btn) => {
        const onClick = () => {
            const key = (btn.dataset.aboutHero || "")
                .toLowerCase()
                .trim();
            if (!key) return;

            // Ignore if this theme is already selected
            if (key === theme) return;

            // changeTheme handles isBusy/queueing itself
            changeTheme(key);
        };

        const onEnter = () => {
            const key = (btn.dataset.aboutHero || "")
                .toLowerCase()
                .trim();
            if (key) {
                warmPool(key);
            }
        };

        btn.addEventListener("click", onClick);
        btn.addEventListener("pointerenter", onEnter);
        cleanupFns.push(() => btn.removeEventListener("click", onClick));
        cleanupFns.push(() => btn.removeEventListener("pointerenter", onEnter));
    });

    log("init wired, theme =", theme);
}
