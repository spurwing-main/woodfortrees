// aboutHero.js
// Expects: window.aboutHeroImages = [{ src, people?: boolean, place?: boolean }, ...]

import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@12.23.26/+esm";

const DEBUG = false;
const log = (...a) => DEBUG && console.log("[aboutHero]", ...a);
const warn = (...a) => console.warn("[aboutHero]", ...a);

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
    autoDelayMin: 800,
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

// remember the last couple of auto-swapped slots
let lastAutoSlotHistory = []; // [mostRecent, previous]

// cached DOM for queued theme changes
let sectionEl = null;
let titleEl = null;

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

function preload(src) {
    if (!src) return Promise.reject(new Error("empty src"));
    let p = imageCache.get(src);
    if (p) return p;

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
    img.loading = "eager";
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
    autoTimer = window.setTimeout(runAutoSwap, delay);
}

async function runAutoSwap() {
    autoTimer = null;

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

    isBusy = true;

    try {
        // load-aware single swap
        await preload(nextSrc);
        await swapSlotImage(slot, nextSrc);
    } catch (err) {
        warn("auto swap error", err);
    } finally {
        isBusy = false;

        // If a theme switch was queued during this auto swap, run it now
        if (queuedTheme && queuedTheme !== theme && sectionEl && titleEl) {
            const nextKey = queuedTheme;
            queuedTheme = null;
            changeTheme(nextKey);
        } else {
            // carry on as normal, plus a little "next next" preload
            const poolAny = pools[theme] || [];
            const extra =
                poolAny[(Math.random() * poolAny.length) | 0] || null;
            if (extra) {
                preload(extra).catch(() => { });
            }
            scheduleAuto();
        }
    }
}

async function swapSlotImage(slot, nextSrc) {
    const oldItem = slot.item;

    const { item: newItem, img: newImg } = makeItem(nextSrc);
    setDropPose(newItem);
    slot.block.appendChild(newItem);

    // OUT and IN are scheduled together, IN is offset by CONFIG.offsets.singleIn
    const outAnim = animateOutSingle(oldItem, 0);
    const inAnim = animateInSingle(newItem, CONFIG.offsets.singleIn);

    await Promise.all([outAnim.finished, inAnim.finished]).catch(
        () => { }
    );

    oldItem.remove();
    slot.item = newItem;
    slot.img = newImg;
    slot.src = nextSrc;
}

// ===== theme change (global list animation) =====

async function changeTheme(key) {
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

    const count = slots.length;
    const newSrcs = pickSrcs(pool, count);
    if (!newSrcs.length) {
        isBusy = false;
        scheduleAuto();
        return;
    }

    const preloadList = dedupe(newSrcs);
    log("changeTheme:", key, "slots:", count);

    try {
        // preload everything this theme needs for the slots
        await Promise.allSettled(preloadList.map(preload));

        const oldItems = [];
        const newItems = [];

        // build new items but don't remove old yet
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

        applyThemeClasses(key);
        syncTitleActive(key);

        // Global OUT + IN triggered at the same time:
        // - OUT: scale+fade with stagger
        // - IN: drop-in with stagger, offset by CONFIG.offsets.globalIn
        const outPromise = animateListOut(oldItems, 0);
        const inPromise = animateListIn(
            newItems,
            CONFIG.offsets.globalIn
        );

        await Promise.all([outPromise, inPromise]);

        oldItems.forEach((el) => el.remove());
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
    log("init start");

    const section = document.querySelector(".section_about");
    const layout = document.querySelector(".about_layout");
    const title = document.querySelector(".about_title");
    const blocks = layout
        ? Array.from(layout.querySelectorAll(".about_block"))
        : [];

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

    // reset any previous run
    if (autoTimer) {
        clearTimeout(autoTimer);
        autoTimer = null;
    }
    slots.forEach((s) => s.item?.remove());
    slots = [];
    isBusy = false;
    queuedTheme = null;
    lastAutoSlotHistory = [];

    pools = buildPools();
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
    Promise.allSettled(initialSrcs.map(preload))
        .then(async () => {
            blocks.forEach((block, i) => {
                const src = initialSrcs[i % initialSrcs.length];
                const { item, img } = makeItem(src);
                setDropPose(item);
                block.style.position = "relative";
                block.appendChild(item);
                slots.push({ block, item, img, src });
            });

            applyThemeClasses(theme);
            syncTitleActive(theme);

            const items = slots.map((s) => s.item);
            await animateListIn(items);
        })
        .catch((err) => warn("init error", err))
        .finally(() => {
            isBusy = false;

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
        btn.addEventListener("click", () => {
            const key = (btn.dataset.aboutHero || "")
                .toLowerCase()
                .trim();
            if (!key) return;

            // Ignore if this theme is already selected
            if (key === theme) return;

            // changeTheme handles isBusy/queueing itself
            changeTheme(key);
        });
    });

    log("init wired, theme =", theme);
}
