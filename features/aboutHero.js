// Motion-first hero
// requires motion cdn:
// <script type="module" src="https://cdn.jsdelivr.net/npm/motion@latest/+esm"></script>

import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

const cache = (window.aboutHeroImageCache =
    window.aboutHeroImageCache || new Map());

let mounted = false;
let cleanups = [];

// basic lifecycle

function addCleanup(fn) {
    cleanups.push(fn);
}

function cleanupAll() {
    cleanups.forEach((fn) => {
        try {
            fn();
        } catch (err) {
            console.warn("aboutHero cleanup", err);
        }
    });
    cleanups = [];
    mounted = false;
}

// tiny utils

const dedupe = (list) => Array.from(new Set(list.filter(Boolean)));

function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

const rand = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const normKey = (v) => (v || "").toLowerCase();

// public entry

export function init() {
    const root = document.querySelector(".about_layout");
    const section = document.querySelector(".section_about");
    const svg = document.querySelector(".about_svg");
    const title = document.querySelector(".about_title");

    if (!root) return;
    if (mounted) cleanupAll();
    mounted = true;

    // images → pools

    const raw = Array.isArray(window.aboutHeroImages)
        ? window.aboutHeroImages.slice()
        : [];

    if (!raw.length) {
        console.warn("[aboutHero] no aboutHeroImages");
        return;
    }

    const pools = {
        people: dedupe(
            raw.filter((it) => it?.people && it?.src).map((it) => it.src)
        ),
        places: dedupe(
            raw.filter((it) => it?.place && it?.src).map((it) => it.src)
        ),
    };

    if (!pools.people.length && !pools.places.length) {
        console.warn("[aboutHero] no usable image pools");
        return;
    }

    const store = {};
    Object.entries(pools).forEach(([key, pool]) => {
        if (!pool.length) return;
        store[key] = {
            key,
            pool: shuffle(pool),
            loaded: new Set(), // src that successfully preloaded
            failed: new Set(),
            firstPromise: null,
        };
    });

    const storeKeys = Object.keys(store);
    if (!storeKeys.length) return;

    // which state is active?

    const titleButtons = Array.from(
        title?.querySelectorAll("[data-about-hero]") || []
    );
    const initialBtn = titleButtons.find((btn) =>
        btn.classList.contains("about_title-active")
    );

    let activeKey = normKey(initialBtn?.dataset.aboutHero);
    if (!activeKey || !store[activeKey]) {
        activeKey = store.people ? "people" : storeKeys[0];
    }

    function syncTitleActive(key) {
        if (!title) return;
        titleButtons.forEach((btn) => {
            const match = normKey(btn.dataset.aboutHero) === key;
            btn.classList.toggle("about_title-active", match);
        });
    }

    syncTitleActive(activeKey);

    // motion config

    const prefersReduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );
    let reduceMotion = prefersReduced.matches;

    const onReduceChange = (e) => {
        reduceMotion = e.matches;
    };
    prefersReduced.addEventListener("change", onReduceChange);
    addCleanup(() =>
        prefersReduced.removeEventListener("change", onReduceChange)
    );

    const springManual = { type: "spring", stiffness: 900, damping: 40 };
    const springAuto = { type: "spring", stiffness: 540, damping: 52 };
    const themeTiming = { duration: 0.35, ease: "easeOut" };

    const autoMin = 1200;
    const autoMax = 2600;
    const autoDelay = () =>
        autoMin + Math.random() * (autoMax - autoMin);

    function applyFinal(target, keyframes) {
        const apply = (el) => {
            const transforms = [];
            for (const [prop, value] of Object.entries(keyframes)) {
                const finalVal = Array.isArray(value)
                    ? value[value.length - 1]
                    : value;

                if (prop === "y") {
                    transforms.push(`translateY(${finalVal}px)`);
                } else if (prop === "scale") {
                    transforms.push(`scale(${finalVal})`);
                } else if (prop === "rotate") {
                    transforms.push(`rotate(${finalVal}deg)`);
                } else {
                    el.style[prop] =
                        typeof finalVal === "number"
                            ? String(finalVal)
                            : finalVal;
                }
            }
            if (transforms.length) {
                el.style.transform = transforms.join(" ");
            }
        };

        if (Array.isArray(target)) target.forEach(apply);
        else apply(target);
    }

    function runAnim(target, keyframes, options) {
        if (reduceMotion) {
            applyFinal(target, keyframes);
            return Promise.resolve();
        }
        return animate(target, keyframes, options).finished.catch(() => { });
    }

    // grid config

    const gridRows = 30;
    const gridCols = 30;

    const blockW = 10;
    const blockH = 15;

    const blocks = [
        { r0: 0, c0: 0 },
        { r0: 0, c0: 10 },
        { r0: 0, c0: 20 },
        { r0: 15, c0: 0 },
        { r0: 15, c0: 10 },
        { r0: 15, c0: 20 },
    ];

    const slotCount = blocks.length;

    const baseW = 6;
    const baseH = 10;
    const minW = 4;
    const maxW = Math.min(8, blockW);
    const minH = 8;
    const maxH = Math.min(12, blockH);

    const slots = Array.from({ length: slotCount }, (_, i) => ({
        index: i,
        blockIndex: i,
        el: null,
        imgIndex: 0,
        geom: null,
    }));

    let images = []; // current src list for active pool
    let autoTimer = null;
    let initDone = false;

    addCleanup(() => {
        if (autoTimer) {
            clearTimeout(autoTimer);
            autoTimer = null;
        }
        root.innerHTML = "";
        images = [];
        initDone = false;
    });

    // image preload with shared cache

    function preload(src) {
        if (!src) return Promise.reject(new Error("empty src"));

        let rec = cache.get(src);
        if (rec) {
            if (rec.status === "loaded") {
                return rec.promise || Promise.resolve(src);
            }
            if (rec.status === "error") {
                return rec.promise || Promise.reject(new Error("fail"));
            }
            return rec.promise;
        }

        rec = { status: "pending", promise: null };
        rec.promise = new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = "async";
            img.onload = () => {
                rec.status = "loaded";
                resolve(src);
            };
            img.onerror = () => {
                rec.status = "error";
                reject(new Error(`Image failed: ${src}`));
            };
            img.src = src;
        });

        cache.set(src, rec);
        rec.promise.catch(() => { });
        return rec.promise;
    }

    function ensureFirstBatch(state) {
        if (!state) return Promise.resolve();
        if (state.firstPromise) return state.firstPromise;

        const need = Math.min(slotCount, state.pool.length);

        state.firstPromise = new Promise((resolve) => {
            let success = state.loaded.size;
            let idx = 0;
            let inflight = 0;
            const limit = 4;

            const maybeDone = () => {
                if (success >= need || (idx >= state.pool.length && inflight === 0)) {
                    resolve();
                    return true;
                }
                return false;
            };

            const pump = () => {
                if (maybeDone()) return;

                while (inflight < limit && idx < state.pool.length) {
                    const src = state.pool[idx++];

                    if (state.loaded.has(src) || state.failed.has(src)) continue;

                    inflight += 1;
                    preload(src)
                        .then(() => {
                            state.loaded.add(src);
                            success = state.loaded.size;
                        })
                        .catch(() => {
                            state.failed.add(src);
                        })
                        .finally(() => {
                            inflight -= 1;
                            pump();
                        });
                }

                if (idx >= state.pool.length && inflight === 0) {
                    maybeDone();
                }
            };

            pump();
        });

        return state.firstPromise;
    }

    function buildImageList(state) {
        if (!state) return [];

        const loaded = Array.from(state.loaded);
        const usable = state.pool.filter((src) => !state.failed.has(src));

        if (loaded.length >= slotCount) {
            return loaded.slice(0, slotCount);
        }

        if (loaded.length) {
            const out = loaded.slice();
            let i = 0;
            while (out.length < slotCount && usable.length) {
                out.push(usable[i % usable.length]);
                i++;
            }
            return out;
        }

        return usable.slice(0, slotCount);
    }

    // geometry

    function pickSize(lastGeom) {
        const baseHeight = lastGeom ? lastGeom.h : baseH;
        const baseWidth = lastGeom ? lastGeom.w : baseW;

        const hBase = clamp(baseHeight, minH, maxH);
        const wBase = clamp(baseWidth, minW, maxW);

        const wOpts = [];
        for (const dw of [-1, 1]) {
            const w = wBase + dw;
            if (w >= minW && w <= maxW) wOpts.push(w);
        }
        if (!wOpts.length) wOpts.push(wBase);

        const hOpts = [];
        for (const dh of [-1, 1]) {
            const h = hBase + dh;
            if (h >= minH && h <= maxH) hOpts.push(h);
        }
        if (!hOpts.length) hOpts.push(hBase);

        return { w: rand(wOpts), h: rand(hOpts) };
    }

    function pickGeom(blockIndex, lastGeom, opts = {}) {
        const block = blocks[blockIndex];
        const { w, h } = pickSize(lastGeom);

        let rowMin = block.r0;
        let rowMax = block.r0 + blockH - h;
        let colMin = block.c0;
        let colMax = block.c0 + blockW - w;

        rowMin = clamp(rowMin, 0, gridRows - h);
        rowMax = clamp(rowMax, 0, gridRows - h);
        colMin = clamp(colMin, 0, gridCols - w);
        colMax = clamp(colMax, 0, gridCols - w);

        const options = [];
        for (let r = rowMin; r <= rowMax; r++) {
            for (let c = colMin; c <= colMax; c++) {
                options.push({ rowCell: r, colCell: c, w, h });
            }
        }

        let candidates = options;

        if (lastGeom) {
            candidates = candidates.filter(
                (g) =>
                    !(
                        g.rowCell === lastGeom.rowCell &&
                        g.colCell === lastGeom.colCell &&
                        g.w === lastGeom.w &&
                        g.h === lastGeom.h
                    )
            );
            if (!candidates.length) {
                candidates = options.filter(
                    (g) => g.w !== lastGeom.w || g.h !== lastGeom.h
                );
            }
            if (!candidates.length) {
                candidates = options.filter(
                    (g) =>
                        g.rowCell !== lastGeom.rowCell ||
                        g.colCell !== lastGeom.colCell
                );
            }
            if (!candidates.length) {
                candidates = options;
            }
        }

        if (opts.avoidRows && opts.avoidRows.size) {
            const filtered = candidates.filter(
                (g) => !opts.avoidRows.has(g.rowCell)
            );
            if (filtered.length) candidates = filtered;
        }

        const g = rand(candidates);

        const rowStart = g.rowCell + 1;
        const rowEnd = g.rowCell + g.h + 1;
        const colStart = g.colCell + 1;
        const colEnd = g.colCell + g.w + 1;

        return {
            ...g,
            area: `${rowStart} / ${colStart} / ${rowEnd} / ${colEnd}`,
        };
    }

    function applyGeom(el, geom) {
        el.style.gridArea = geom.area;
    }

    // image picking

    function pickNewIndex(slot, reserved) {
        if (!images.length) return 0;

        const currentIdx = slot?.imgIndex ?? 0;
        const currentSrc = slot?.el?.src || images[currentIdx] || null;

        const visible = new Set(
            slots
                .map((s) => s.el?.src)
                .filter(Boolean)
        );

        if (reserved?.images) {
            reserved.images.forEach((src) => visible.add(src));
        }

        const candidates = images
            .map((src, i) => ({ src, i }))
            .filter(({ src }) => src !== currentSrc && !visible.has(src));

        if (candidates.length) return rand(candidates).i;

        const nonCurrent = images.findIndex((src) => src !== currentSrc);
        if (nonCurrent !== -1) return nonCurrent;

        return currentIdx || 0;
    }

    function currentRows(excludeIndex) {
        const rows = new Set();
        slots.forEach((s, i) => {
            if (i === excludeIndex) return;
            if (s.geom) rows.add(s.geom.rowCell);
        });
        return rows;
    }

    // swapping

    function swapSlot(slot, mode, reserved) {
        if (!slot) return Promise.resolve();

        const cfg =
            mode === "manual"
                ? { outY: 26, outS: 0.88, inY: -32, inS: 1.09 }
                : { outY: 12, outS: 0.95, inY: -18, inS: 1.03 };

        const spring = mode === "manual" ? springManual : springAuto;
        const outDuration = mode === "manual" ? 0.42 : 0.36;
        const inDuration = mode === "manual" ? 0.6 : 0.5;

        const newIndex = pickNewIndex(slot, reserved);
        const nextSrc = images[newIndex];
        if (!nextSrc) return Promise.resolve();

        const geom = pickGeom(slot.blockIndex, slot.geom, {
            avoidRows: reserved?.rows,
        });

        if (reserved?.images) reserved.images.add(nextSrc);
        if (reserved?.rows) reserved.rows.add(geom.rowCell);

        const oldEl = slot.el;
        const newEl = document.createElement("img");

        newEl.className = "about_item";
        newEl.src = nextSrc;
        newEl.style.opacity = "0";
        newEl.style.transform = `translateY(${cfg.inY}px) scale(${cfg.inS})`;
        applyGeom(newEl, geom);

        if (oldEl) oldEl.after(newEl);
        else root.appendChild(newEl);

        const outP = oldEl
            ? runAnim(
                oldEl,
                {
                    opacity: [1, 0],
                    y: [0, cfg.outY],
                    scale: [1, cfg.outS],
                    rotate: [0, 2],
                },
                { ...spring, duration: outDuration }
            ).then(() => oldEl.remove())
            : Promise.resolve();

        return outP
            .then(() =>
                runAnim(
                    newEl,
                    {
                        opacity: [0, 1],
                        y: [cfg.inY, 4, 0],
                        scale: [cfg.inS, 0.97, 1],
                        rotate: [-2, 0],
                    },
                    { ...spring, duration: inDuration }
                )
            )
            .then(() => {
                slot.el = newEl;
                slot.imgIndex = newIndex;
                slot.geom = geom;
            });
    }

    function swapAuto(blockIndex) {
        const slot = slots[blockIndex];
        const reserved = {
            images: new Set(),
            rows: currentRows(blockIndex),
        };
        return swapSlot(slot, "auto", reserved);
    }

    async function swapGlobalManual() {
        if (autoTimer) {
            clearTimeout(autoTimer);
            autoTimer = null;
        }

        const reserved = { images: new Set(), rows: new Set() };
        await Promise.all(slots.map((s) => swapSlot(s, "manual", reserved)));

        startAutoLoop();
    }

    // auto loop

    let seq = [];
    let seqPos = 0;
    let lastIdx = null;

    function makeSeq() {
        const base = shuffle([...Array(slotCount).keys()]);
        if (lastIdx != null && base[0] === lastIdx && base.length > 1) {
            const swapPos = 1 + ((Math.random() * (base.length - 1)) | 0);
            [base[0], base[swapPos]] = [base[swapPos], base[0]];
        }
        seq = base;
        seqPos = 0;
    }

    function nextSlotIndex() {
        if (!seq.length || seqPos >= seq.length) {
            makeSeq();
        }
        const idx = seq[seqPos++];
        lastIdx = idx;
        return idx;
    }

    async function autoTick() {
        autoTimer = null;
        if (!initDone) return;

        const idx = nextSlotIndex();
        await swapAuto(idx);

        autoTimer = setTimeout(autoTick, autoDelay());
    }

    function startAutoLoop() {
        if (autoTimer || !initDone) return;
        autoTimer = setTimeout(autoTick, autoDelay());
    }

    // initial drop

    function initialDrop() {
        if (!images.length) return Promise.resolve();

        root.innerHTML = "";
        const els = [];
        const usedRows = new Set();

        slots.forEach((slot, i) => {
            const geom = pickGeom(slot.blockIndex, null, { avoidRows: usedRows });
            usedRows.add(geom.rowCell);

            const el = document.createElement("img");
            const src = images[i % images.length];

            el.className = "about_item";
            el.src = src;
            el.style.opacity = "0";
            el.style.transform = "translateY(-28px) scale(1.08)";
            applyGeom(el, geom);

            slot.el = el;
            slot.geom = geom;
            slot.imgIndex = i % images.length;

            root.appendChild(el);
            els.push(el);
        });

        return runAnim(
            els,
            {
                opacity: [0, 1],
                y: [-28, 0],
                scale: [1.08, 1],
                rotate: [2, 0],
            },
            {
                ...springAuto,
                delay: reduceMotion ? 0 : stagger(0.08, { from: "center" }),
            }
        ).then(() => {
            initDone = true;
            makeSeq();
            startAutoLoop();
        });
    }

    // theme + titles

    const baseBg = section
        ? getComputedStyle(section).backgroundColor
        : "#fff";

    const pink =
        getComputedStyle(document.documentElement)
            .getPropertyValue("--_color---pink")
            .trim() || baseBg;

    const svgBase = svg ? getComputedStyle(svg).color : null;

    function applyTheme(key) {
        const isPeople = key === "people";

        if (section) {
            runAnim(
                section,
                {
                    backgroundColor: isPeople ? pink : baseBg,
                },
                themeTiming
            );
        }

        if (svg && svgBase) {
            runAnim(
                svg,
                {
                    color: isPeople ? baseBg : svgBase,
                },
                themeTiming
            );
        }
    }

    function otherKey(key) {
        if (key === "people" && store.places) return "places";
        if (key === "places" && store.people) return "people";
        return Object.keys(store).find((k) => k !== key);
    }

    let changeChain = Promise.resolve();

    function handleStateChange(next) {
        const key = normKey(next);
        const state = store[key];
        if (!state) return;
        if (key === activeKey && initDone) return;

        changeChain = changeChain
            .then(async () => {
                activeKey = key;
                syncTitleActive(key);
                applyTheme(key);

                await ensureFirstBatch(state);
                images = buildImageList(state);

                if (!images.length) return;

                if (initDone) {
                    await swapGlobalManual();
                } else {
                    await initialDrop();
                }

                // quietly prime the other pool
                const alt = otherKey(key);
                if (alt && store[alt]) {
                    ensureFirstBatch(store[alt]);
                }
            })
            .catch((err) => console.warn("[aboutHero] state change", err));
    }

    function setupTitles() {
        if (!titleButtons.length) return;
        titleButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                handleStateChange(btn.dataset.aboutHero);
            });
            addCleanup(() =>
                btn.removeEventListener("click", () => {
                    handleStateChange(btn.dataset.aboutHero);
                })
            );
        });
    }

    // bootstrap

    async function bootstrap() {
        const state = store[activeKey];
        if (!state) return;

        applyTheme(activeKey);

        await ensureFirstBatch(state);
        images = buildImageList(state);

        if (!images.length) return;

        await initialDrop();
        setupTitles();

        const alt = otherKey(activeKey);
        if (alt && store[alt]) {
            ensureFirstBatch(store[alt]);
        }
    }

    bootstrap().catch((err) => console.warn("[aboutHero] init", err));
}
