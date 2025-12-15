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
    autoDelayMax: 2000
};

// ===== shared state =====

let imageCache; // Map<string, Promise<void>>

let pools = { people: [], places: [] }; // string[]
// `theme` = currently *selected* theme (including in-flight transitions)
let theme = "people";
let slots = []; // [{ block, item, img, src }]

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
    slots = [];

    // reset state
    isBusy = false;
    queuedTheme = null;
    lastAutoSlotHistory = [];
    sectionEl = null;
    titleEl = null;
}

// ===== utilities =====

const rand = (min, max) => min + Math.random() * (max - min);
const randPercent = () => (Math.random() * 10).toFixed(2) + "%";

const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));

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

// ===== DOM helpers =====

function makeItem(src) {
    // New item every time we show an image → new random x/y per swap
    const item = document.createElement("div");
    item.className = "about_block-item";
    item.style.position = "absolute";
    item.style.width = "90%";
    item.style.height = "90%";
    item.style.top = randPercent();
    item.style.left = randPercent();
    item.style.willChange = "transform, opacity";

    const frame = document.createElement("div");
    frame.className = "about_block-inner";
    frame.style.width = "100%";
    frame.style.height = "100%";

    const img = document.createElement("img");
    img.className = "about_block-img";
    img.alt = "";
    img.decoding = "async";
    img.src = src;

    frame.appendChild(img);
    item.appendChild(frame);

    return { item, img };
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
        await swapSlotImage(slot, nextSrc);
        log("auto: swap done", { ms: dur(tSwap), slotIndex });
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

async function swapSlotImage(slot, nextSrc) {
    const t0 = now();
    const oldItem = slot.item;

    const { item: newItem, img: newImg } = makeItem(nextSrc);
    setDropPose(newItem);
    slot.block.appendChild(newItem);

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

    oldItem.remove();
    slot.item = newItem;
    slot.img = newImg;
    slot.src = nextSrc;
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

        // build new items but don't remove old yet
        const tBuild = now();
        slots.forEach((slot, i) => {
            const src = newSrcs[i % newSrcs.length];
            const { item, img } = makeItem(src);
            setDropPose(item);
            slot.block.appendChild(item);

            oldItems.push(slot.item);
            newItems.push(item);

            slot.item = item;
            slot.img = img;
            slot.src = src;
        });
        log("changeTheme: built new items", { ms: dur(tBuild), count: slots.length });

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

    sectionEl = section;
    titleEl = title;

    const tPools = now();
    pools = buildPools();
    log("init: pools built", { ms: dur(tPools), people: pools.people.length, places: pools.places.length });
    if (!pools.people.length && !pools.places.length) {
        warn("init: no pools");
        return;
    }

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
                const src = initialSrcs[i % initialSrcs.length];
                const { item, img } = makeItem(src);
                setDropPose(item);
                block.style.position = "relative";
                block.appendChild(item);
                slots.push({ block, item, img, src });
            });
            log("init: built slots", { ms: dur(tBuild), slots: slots.length });

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

        btn.addEventListener("click", onClick);
        cleanupFns.push(() => btn.removeEventListener("click", onClick));
    });

    log("init wired, theme =", theme);
}
