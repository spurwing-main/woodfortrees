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
    // Card size as % of the block's smaller side.
    // Hooked to layout changes via computeBlockLayout.
    itemSizePercentOfMin: 85,
    // Random-walk drift per swap, as % of the available axis range.
    driftStrengthPercent: 80,
    // Max drift speed per swap, as % of the available axis range.
    driftMaxSpeedPercent: 95,
    // Minimum drift speed per swap, as % of the available axis range.
    driftMinMovePercent: 12,
    // Minimum drift speed per swap on the long axis, as % of that axis range.
    minMoveLongAxisPercent: 24,
    // Random kick per swap to avoid slow/flat paths.
    driftKickPercent: 18,
    // Minimum displacement per swap, as % of the available axis range.
    swapMinDistancePercent: 14,
    // Minimum per-axis displacement per swap, as % of that axis range.
    swapMinAxisPercent: 8,
    // Minimum displacement along the long axis, as % of that axis range.
    swapMinLongAxisPercent: 20,
    // Keep a small padding from edges, as % of the available axis range.
    edgePaddingPercent: 1,
    // Nudge away from edges, as % of the available axis range.
    edgeNudgePercent: 8
};

let allBlocks = [];

// ===== shared state =====

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
    const blocksToReset = allBlocks.length
        ? allBlocks
        : slots.map((s) => s.block).filter(Boolean);
    blocksToReset.forEach((block) => {
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

function randFrom(profile, min, max) {
    if (!profile) return rand(min, max);
    let seed = profile.seed >>> 0;
    if (!seed) {
        seed = (Math.random() * 0xffffffff) >>> 0;
        profile.seed = seed;
    }
    seed = (seed * 1664525 + 1013904223) >>> 0;
    profile.seed = seed;
    const t = seed / 0xffffffff;
    return min + t * (max - min);
}

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

    const makeDriftProfile = () => {
        const scale = () => rand(0.6, 1.6);
        const bias = () => rand(-0.8, 0.8);
        return {
            scaleX: scale(),
            scaleY: scale(),
            biasX: bias(),
            biasY: bias(),
            seed: (Math.random() * 0xffffffff) >>> 0
        };
    };

    const driftProfile =
        block?.__aboutHeroDriftProfile || makeDriftProfile();
    if (block) block.__aboutHeroDriftProfile = driftProfile;

    return {
        width,
        height,
        size,
        sizeWidthPercent,
        sizeHeightPercent,
        maxX: Math.max(0, width - size),
        maxY: Math.max(0, height - size),
        driftProfile
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

async function ensureImageReady(img, src) {
    if (!img || !src) return false;

    const t0 = now();

    const ready = await ensureSrcReady(src).catch((err) => {
        warn("ensureImageReady preload failed", { src, err });
        return false;
    });
    if (!ready) return false;

    if (img.src !== src) {
        img.src = src;
    }

    const isLoaded = () => img.complete && img.naturalWidth > 0;

    if (isLoaded()) {
        log("ensureImageReady done", { src, ms: dur(t0) });
        return true;
    }

    if (typeof img.decode === "function") {
        try {
            await img.decode();
            if (isLoaded()) {
                log("ensureImageReady done", { src, ms: dur(t0) });
                return true;
            }
        } catch (err) {
            warn("ensureImageReady decode failed", { src, err });
        }
    }

    const waitForLoad = () =>
        new Promise((resolve, reject) => {
            if (isLoaded()) {
                resolve(true);
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

    if (loadResult) {
        log("ensureImageReady done", { src, ms: dur(t0) });
    }
    return Boolean(loadResult);
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

function computeDriftPosition(
    layout,
    prevAnchor = null,
    driftProfile = null
) {
    const maxXPercent = 100 - (layout.sizeWidthPercent || 0);
    const maxYPercent = 100 - (layout.sizeHeightPercent || 0);
    const maxXRange = Math.max(0, maxXPercent);
    const maxYRange = Math.max(0, maxYPercent);
    const padPct = Math.max(0, LAYOUT.edgePaddingPercent || 0);
    const nudgePct = Math.max(0, LAYOUT.edgeNudgePercent || 0);
    const padX = Math.min(padPct, maxXRange * 0.5);
    const padY = Math.min(padPct, maxYRange * 0.5);
    const nudgeX = Math.min(nudgePct, maxXRange * 0.5);
    const nudgeY = Math.min(nudgePct, maxYRange * 0.5);
    const strength = Math.max(0, LAYOUT.driftStrengthPercent || 0);
    const maxSpeed = Math.max(0, LAYOUT.driftMaxSpeedPercent || 0);
    const kick = Math.max(0, LAYOUT.driftKickPercent || 0);
    const profile = driftProfile || {};
    const scaleX = Math.max(0.6, Math.min(1.6, profile.scaleX ?? 1));
    const scaleY = Math.max(0.6, Math.min(1.6, profile.scaleY ?? 1));
    const biasX = Math.max(-1, Math.min(1, profile.biasX ?? 0));
    const biasY = Math.max(-1, Math.min(1, profile.biasY ?? 0));
    const maxRange = Math.max(maxXRange, maxYRange) || 1;
    const damping = 0.8;
    const r = (min, max) => randFrom(driftProfile, min, max);

    let leftPercent;
    let topPercent;
    let vx;
    let vy;

    if (!prevAnchor) {
        leftPercent = maxXRange ? r(padX, maxXRange - padX) : 0;
        topPercent = maxYRange ? r(padY, maxYRange - padY) : 0;
        const maxSpeedX = maxSpeed * (maxXRange / maxRange) * scaleX;
        const maxSpeedY = maxSpeed * (maxYRange / maxRange) * scaleY;
        vx = maxSpeedX ? r(-maxSpeedX, maxSpeedX) * 0.3 : 0;
        vy = maxSpeedY ? r(-maxSpeedY, maxSpeedY) * 0.3 : 0;
    } else {
        leftPercent = prevAnchor.leftPercent ?? 0;
        topPercent = prevAnchor.topPercent ?? 0;
        vx = prevAnchor.vx ?? 0;
        vy = prevAnchor.vy ?? 0;
    }

    if (maxXRange) {
        const strengthX = strength * (maxXRange / maxRange) * scaleX;
        const maxSpeedX = maxSpeed * (maxXRange / maxRange) * scaleX;
        const noiseX = r(-strengthX, strengthX) + biasX * strengthX;
        const kickX = (kick / 100) * maxXRange * scaleX;
        vx = clamp((vx + noiseX) * damping, -maxSpeedX, maxSpeedX);
        if (kickX) {
            vx = clamp(vx + r(-kickX, kickX), -maxSpeedX, maxSpeedX);
        }
        const minSpeedX =
            (Math.max(0, LAYOUT.driftMinMovePercent || 0) / 100) * maxXRange;
        const longMinX =
            maxXRange >= maxYRange
                ? (Math.max(0, LAYOUT.minMoveLongAxisPercent || 0) / 100) * maxXRange
                : 0;
        const minVx = Math.max(minSpeedX, longMinX) * scaleX;
        if (minVx && Math.abs(vx) < minVx) {
            const dir = vx < 0 ? -1 : vx > 0 ? 1 : r(-1, 1) < 0 ? -1 : 1;
            vx = dir * minVx;
        }
        leftPercent += vx;
        const minX = padX;
        const maxX = maxXRange - padX;
        if (leftPercent < minX) {
            leftPercent = clamp(minX + nudgeX, minX, maxX);
            vx = Math.abs(vx) * 0.5;
        } else if (leftPercent > maxX) {
            leftPercent = clamp(maxX - nudgeX, minX, maxX);
            vx = -Math.abs(vx) * 0.5;
        }
        leftPercent = clamp(leftPercent, minX, maxX);
    } else {
        leftPercent = 0;
        vx = 0;
    }

    if (maxYRange) {
        const strengthY = strength * (maxYRange / maxRange) * scaleY;
        const maxSpeedY = maxSpeed * (maxYRange / maxRange) * scaleY;
        const noiseY = r(-strengthY, strengthY) + biasY * strengthY;
        const kickY = (kick / 100) * maxYRange * scaleY;
        vy = clamp((vy + noiseY) * damping, -maxSpeedY, maxSpeedY);
        if (kickY) {
            vy = clamp(vy + r(-kickY, kickY), -maxSpeedY, maxSpeedY);
        }
        const minSpeedY =
            (Math.max(0, LAYOUT.driftMinMovePercent || 0) / 100) * maxYRange;
        const longMinY =
            maxYRange >= maxXRange
                ? (Math.max(0, LAYOUT.minMoveLongAxisPercent || 0) / 100) * maxYRange
                : 0;
        const minVy = Math.max(minSpeedY, longMinY) * scaleY;
        if (minVy && Math.abs(vy) < minVy) {
            const dir = vy < 0 ? -1 : vy > 0 ? 1 : r(-1, 1) < 0 ? -1 : 1;
            vy = dir * minVy;
        }
        topPercent += vy;
        const minY = padY;
        const maxY = maxYRange - padY;
        if (topPercent < minY) {
            topPercent = clamp(minY + nudgeY, minY, maxY);
            vy = Math.abs(vy) * 0.5;
        } else if (topPercent > maxY) {
            topPercent = clamp(maxY - nudgeY, minY, maxY);
            vy = -Math.abs(vy) * 0.5;
        }
        topPercent = clamp(topPercent, minY, maxY);
    } else {
        topPercent = 0;
        vy = 0;
    }

    const swapMin = Math.max(0, LAYOUT.swapMinDistancePercent || 0);
    const swapMinAxis = Math.max(0, LAYOUT.swapMinAxisPercent || 0);
    const swapMinLong = Math.max(0, LAYOUT.swapMinLongAxisPercent || 0);
    if (prevAnchor && (swapMin || swapMinAxis || swapMinLong)) {
        const prevLeft = prevAnchor.leftPercent ?? leftPercent;
        const prevTop = prevAnchor.topPercent ?? topPercent;
        let dx = leftPercent - prevLeft;
        let dy = topPercent - prevTop;
        const dist = Math.hypot(dx, dy);
        const minDist = (swapMin / 100) * maxRange;
        if (minDist && dist < minDist) {
            let nx = dx;
            let ny = dy;
            if (dist < 0.001) {
                const angle = r(0, Math.PI * 2);
                nx = Math.cos(angle);
                ny = Math.sin(angle);
            } else {
                nx /= dist;
                ny /= dist;
            }
            const push = minDist - dist;
            if (maxXRange) {
                leftPercent = clamp(
                    leftPercent + nx * push,
                    padX,
                    maxXRange - padX
                );
            }
            if (maxYRange) {
                topPercent = clamp(
                    topPercent + ny * push,
                    padY,
                    maxYRange - padY
                );
            }
            dx = leftPercent - prevLeft;
            dy = topPercent - prevTop;
        }

        if (swapMinAxis) {
            if (maxXRange) {
                const minX = (swapMinAxis / 100) * maxXRange;
                if (Math.abs(dx) < minX) {
                    const dir =
                        dx < 0 ? -1 : dx > 0 ? 1 : r(-1, 1) < 0 ? -1 : 1;
                    leftPercent = clamp(
                        leftPercent + dir * (minX - Math.abs(dx)),
                        padX,
                        maxXRange - padX
                    );
                }
            }
            if (maxYRange) {
                const minY = (swapMinAxis / 100) * maxYRange;
                if (Math.abs(dy) < minY) {
                    const dir =
                        dy < 0 ? -1 : dy > 0 ? 1 : r(-1, 1) < 0 ? -1 : 1;
                    topPercent = clamp(
                        topPercent + dir * (minY - Math.abs(dy)),
                        padY,
                        maxYRange - padY
                    );
                }
            }
            dx = leftPercent - prevLeft;
            dy = topPercent - prevTop;
        }

        if (swapMinLong) {
            if (maxXRange >= maxYRange && maxXRange) {
                const minLong = (swapMinLong / 100) * maxXRange;
                if (Math.abs(dx) < minLong) {
                    const dir =
                        dx < 0 ? -1 : dx > 0 ? 1 : r(-1, 1) < 0 ? -1 : 1;
                    leftPercent = clamp(
                        leftPercent + dir * (minLong - Math.abs(dx)),
                        padX,
                        maxXRange - padX
                    );
                }
            } else if (maxYRange) {
                const minLong = (swapMinLong / 100) * maxYRange;
                if (Math.abs(dy) < minLong) {
                    const dir =
                        dy < 0 ? -1 : dy > 0 ? 1 : r(-1, 1) < 0 ? -1 : 1;
                    topPercent = clamp(
                        topPercent + dir * (minLong - Math.abs(dy)),
                        padY,
                        maxYRange - padY
                    );
                }
            }
        }
    }

    const left = layout.width ? (leftPercent / 100) * layout.width : 0;
    const top = layout.height ? (topPercent / 100) * layout.height : 0;
    const x = layout.maxX ? left / layout.maxX : 0.5;
    const y = layout.maxY ? top / layout.maxY : 0.5;
    return { x, y, top, left, topPercent, leftPercent, vx, vy };
}

// ===== DOM helpers =====

function makeItem(src, blockLayout, prevAnchor = null) {
    // New item every time we show an image → new position per swap
    const layout = blockLayout || computeBlockLayout();
    const resolvedAnchor = computeDriftPosition(
        layout,
        prevAnchor,
        blockLayout?.driftProfile || null
    );

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
    const candidates = pool.filter((src) => src !== slot.src && !used.has(src));
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
        await ensureSrcReady(nextSrc);
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
        blockLayout,
        prevAnchor
    );
    if (prevAnchor && anchor) {
        const round = (v) =>
            typeof v === "number" ? Math.round(v * 100) / 100 : null;
        const prevLeft = round(prevAnchor.leftPercent);
        const prevTop = round(prevAnchor.topPercent);
        const nextLeft = round(anchor.leftPercent);
        const nextTop = round(anchor.topPercent);
        const deltaLeft =
            prevLeft != null && nextLeft != null ? round(nextLeft - prevLeft) : null;
        const deltaTop =
            prevTop != null && nextTop != null ? round(nextTop - prevTop) : null;
        log(
            "swapSlotImage: pos",
            `slot=${slotIndexHint ?? "?"} ` +
            `prev=(${prevLeft},${prevTop}) next=(${nextLeft},${nextTop}) ` +
            `delta=(${deltaLeft},${deltaTop})`
        );
    }
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
        const preResults = await Promise.allSettled(preloadList.map(ensureSrcReady));
        const preOk = preResults.filter((r) => r.status === "fulfilled").length;
        log("changeTheme: preload done", { ms: dur(tPre), ok: preOk, total: preResults.length });

        const oldItems = [];
        const newItems = [];
        const readyPromises = [];

        // build new items but don't remove old yet
        const tBuild = now();
        slots.forEach((slot, i) => {
            const src = newSrcs[i % newSrcs.length];
            const prevAnchor = slot.anchor;
            const blockLayout = computeBlockLayout(slot.block);
            const { item, img, anchor } = makeItem(
                src,
                blockLayout,
                prevAnchor
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
        });
        log("changeTheme: built new items", { ms: dur(tBuild), count: slots.length });

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
    Promise.allSettled(initialSrcs.map(ensureSrcReady))
        .then(async () => {
            log("init: preload done", { ms: dur(tInitPre), count: initialSrcs.length });

            const tBuild = now();
            blocks.forEach((block, i) => {
                // Remove any stale items from previous mounts (internal nav scenario)
                Array.from(block.querySelectorAll(".about_block-item")).forEach(
                    (stale) => stale.remove()
                );

                const src = initialSrcs[i % initialSrcs.length];
                const { item, img, anchor: chosenAnchor } = makeItem(
                    src,
                    computeBlockLayout(block),
                    null
                );
                setDropPose(item);
                block.style.position = "relative";
                block.appendChild(item);
                slots.push({ block, item, img, src, anchor: chosenAnchor });
            });
            log("init: built slots", { ms: dur(tBuild), slots: slots.length });

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

        btn.addEventListener("click", onClick);
        cleanupFns.push(() => btn.removeEventListener("click", onClick));
    });

    log("init wired, theme =", theme);
}
