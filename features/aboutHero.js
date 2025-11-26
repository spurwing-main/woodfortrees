import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

export function init() {
    const root = document.querySelector(".about_layout");
    const section = document.querySelector(".section_about");
    const svg = document.querySelector(".about_svg");
    const title = document.querySelector(".about_title");

    if (!root) return;

    const rawImages = Array.isArray(window.aboutHeroImages)
        ? window.aboutHeroImages.slice()
        : [];

    if (!rawImages.length) {
        console.warn("No aboutHeroImages found");
        return;
    }

    const pools = {
        people: dedupe(
            rawImages
                .filter((item) => item?.people && item?.src)
                .map((item) => item.src)
        ),
        places: dedupe(
            rawImages
                .filter((item) => item?.place && item?.src)
                .map((item) => item.src)
        ),
    };

    if (!pools.people.length && !pools.places.length) {
        console.warn("No usable aboutHeroImages pools");
        return;
    }

    const stateStore = {};
    Object.entries(pools).forEach(([key, pool]) => {
        if (!pool.length) return;
        stateStore[key] = {
            key,
            pool: shuffle(pool),
            loaded: new Set(),
            failed: new Set(),
            firstPromise: null,
            allPromise: null,
        };
    });

    const titleButtons = Array.from(
        title?.querySelectorAll("[data-about-hero]") || []
    );

    const initialFromDom = titleButtons.find((btn) =>
        btn.classList.contains("about_title-active")
    );

    let activeStateKey = normalizeKey(initialFromDom?.dataset.aboutHero);
    if (!activeStateKey || !stateStore[activeStateKey]) {
        activeStateKey = stateStore.people
            ? "people"
            : Object.keys(stateStore)[0];
    }

    syncTitleActive(activeStateKey);

    let images = [];
    let changeChain = Promise.resolve();
    let dropPromise = null;

    // ⚠️ You really want this:
    // .about_layout {
    //   display: grid;
    //   grid-template-columns: repeat(30, 1fr);
    //   grid-template-rows: repeat(30, 1fr);
    // }

    /* ---------------------------------------------
       MOTION FEEL (your springs + forced durations)
    --------------------------------------------- */

    const T_MANUAL = {
        type: "spring",
        stiffness: 900,
        damping: 40,
        mass: 1,
    };

    const T_AUTO = {
        type: "spring",
        stiffness: 540,
        damping: 52,
        mass: 1.2,
    };

    const THEME_T = {
        duration: 0.35,
        ease: "easeOut",
    };

    const AUTO_MIN = 1000;
    const AUTO_MAX = 3000;
    const delayRand = () =>
        AUTO_MIN + Math.random() * (AUTO_MAX - AUTO_MIN);
    const randInt = (min, max) =>
        Math.floor(Math.random() * (max - min + 1)) + min;
    const rand = (arr) => arr[(Math.random() * arr.length) | 0];

    /* ---------------------------------------------
       GRID MODEL (cells, 0-based)
    --------------------------------------------- */

    const GRID_ROWS = 30;
    const GRID_COLS = 30;

    const BLOCK_W = 10; // cells
    const BLOCK_H = 15; // cells

    // r0, c0 are 0-based cell indices
    const BLOCKS = [
        { r0: 0, c0: 0 },  // top-left
        { r0: 0, c0: 10 },  // top-middle
        { r0: 0, c0: 20 },  // top-right
        { r0: 15, c0: 0 },  // bottom-left
        { r0: 15, c0: 10 },  // bottom-middle
        { r0: 15, c0: 20 },  // bottom-right
    ];

    const SLOT_COUNT = BLOCKS.length;

    // Size breathing band
    const BASE_W = 6;
    const BASE_H = 10;
    const MIN_W = 4;
    const MAX_W = Math.min(8, BLOCK_W);  // <=10
    const MIN_H = 8;
    const MAX_H = Math.min(12, BLOCK_H); // <=15

    const slots = Array.from({ length: SLOT_COUNT }, (_, i) => ({
        index: i,
        blockIndex: i,
        el: null,
        imgIndex: 0,
        busy: false,
        geom: null, // { rowCell, colCell, w, h, area }
    }));

    /* ---------------------------------------------
       DATA + STATE HELPERS
    --------------------------------------------- */

    function dedupe(list) {
        return Array.from(new Set(list.filter(Boolean)));
    }

    function normalizeKey(value) {
        return (value || "").toLowerCase();
    }

    function getOtherKey(key) {
        if (key === "people" && stateStore.places) return "places";
        if (key === "places" && stateStore.people) return "people";
        return Object.keys(stateStore).find((k) => k !== key);
    }

    function deriveDisplayList(state) {
        if (!state) return [];

        const loadedList = Array.from(state.loaded);
        const pool = state.pool || [];

        if (loadedList.length >= SLOT_COUNT) return loadedList.slice();
        if (loadedList.length) {
            const padded = loadedList.slice();
            let i = 0;
            while (padded.length < SLOT_COUNT && pool.length) {
                padded.push(pool[i % pool.length]);
                i += 1;
            }
            return padded;
        }

        return pool.slice(0, SLOT_COUNT);
    }

    function updateImagesFromState(state) {
        images = deriveDisplayList(state);
        if (!images.length) return;

        slots.forEach((slot) => {
            slot.imgIndex = slot.imgIndex % images.length;
        });
    }

    function syncTitleActive(key) {
        if (!title) return;

        const buttons = title.querySelectorAll("[data-about-hero]");
        buttons.forEach((btn) => {
            const isMatch = normalizeKey(btn.dataset.aboutHero) === key;
            btn.classList.toggle("about_title-active", isMatch);
        });
    }

    /* ---------------------------------------------
       IMAGE LOADER + CACHE
    --------------------------------------------- */

    const imageCache = new Map();

    function preloadImage(src) {
        if (!src) return Promise.reject(new Error("empty src"));

        const cached = imageCache.get(src);
        if (cached) {
            if (cached.status === "loaded") return cached.promise || Promise.resolve(src);
            if (cached.status === "error") return cached.promise || Promise.reject(new Error("fail"));
            return cached.promise;
        }

        const record = { status: "pending", promise: null };

        record.promise = new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = "async";
            img.loading = "eager";

            img.onload = () => {
                record.status = "loaded";
                resolve(src);
            };

            img.onerror = () => {
                record.status = "error";
                reject(new Error(`Image failed: ${src}`));
            };

            img.src = src;
        });

        imageCache.set(src, record);
        record.promise.catch(() => { });
        return record.promise;
    }

    function loadUpTo(state, targetCount, limit = 4) {
        if (!state || !state.pool.length) return Promise.resolve([]);

        const desired = Math.min(targetCount, state.pool.length);
        const results = Array.from(state.loaded);
        if (results.length >= desired) return Promise.resolve(results.slice(0, desired));

        const queue = state.pool.filter(
            (src) => !state.loaded.has(src) && !state.failed.has(src)
        );

        let index = 0;
        let inflight = 0;

        return new Promise((resolve) => {
            const maybeResolve = () => {
                if (
                    results.length >= desired ||
                    (index >= queue.length && inflight === 0)
                ) {
                    resolve(results.slice(0, Math.min(desired, results.length)));
                    return true;
                }
                return false;
            };

            const pump = () => {
                if (maybeResolve()) return;

                while (inflight < limit && index < queue.length) {
                    const src = queue[index++];

                    const cached = imageCache.get(src);
                    if (cached?.status === "loaded") {
                        state.loaded.add(src);
                        results.push(src);
                        continue;
                    }
                    if (cached?.status === "error") {
                        state.failed.add(src);
                        continue;
                    }

                    inflight += 1;
                    preloadImage(src)
                        .then(() => {
                            state.loaded.add(src);
                            results.push(src);
                        })
                        .catch(() => {
                            state.failed.add(src);
                        })
                        .finally(() => {
                            inflight -= 1;
                            pump();
                        });
                }

                if (index >= queue.length && inflight === 0) {
                    maybeResolve();
                }
            };

            pump();
        });
    }

    function ensureFirstBatch(state) {
        if (!state) return Promise.resolve([]);
        if (state.firstPromise) return state.firstPromise;

        const target = Math.min(SLOT_COUNT, state.pool.length);
        state.firstPromise = loadUpTo(state, target, 4).then((list) => {
            if (!list.length) return deriveDisplayList(state);
            return list;
        });

        return state.firstPromise;
    }

    function ensureAll(state) {
        if (!state) return Promise.resolve([]);
        if (state.allPromise) return state.allPromise;

        state.allPromise = ensureFirstBatch(state)
            .then(() => loadUpTo(state, state.pool.length, 3))
            .then(() => Array.from(state.loaded));

        return state.allPromise;
    }

    /* ---------------------------------------------
       SIZE + POSITION HELPERS (safe, 0-based)
    --------------------------------------------- */

    // Only change COL span (w), keep ROW span (h) fixed
    function pickSize(lastGeom) {
        let hBase = lastGeom ? lastGeom.h : BASE_H;
        hBase = Math.min(Math.max(hBase, MIN_H), MAX_H);

        // Start from previous width if present, otherwise base
        let wBase = lastGeom ? lastGeom.w : BASE_W;
        wBase = Math.min(Math.max(wBase, MIN_W), MAX_W);

        // Wiggle width/height by ±1 within bounds to keep placements lively
        const wCandidates = [];
        for (const dw of [-1, 1]) {
            const w = wBase + dw;
            if (w >= MIN_W && w <= MAX_W) wCandidates.push(w);
        }

        // If we somehow can't move (at extreme), stay at current width
        if (!wCandidates.length) {
            wCandidates.push(wBase);
        }

        const hCandidates = [];
        for (const dh of [-1, 1]) {
            const h = hBase + dh;
            if (h >= MIN_H && h <= MAX_H) hCandidates.push(h);
        }
        if (!hCandidates.length) hCandidates.push(hBase);

        const w = rand(wCandidates);
        const h = rand(hCandidates);
        return { w, h };
    }

    function pickGeom(blockIndex, lastGeom, opts = {}) {
        const block = BLOCKS[blockIndex];
        const { w, h } = pickSize(lastGeom);

        // block in cells: [r0 .. r0+BLOCK_H-1], [c0 .. c0+BLOCK_W-1]
        let rowMin = block.r0;
        let rowMax = block.r0 + BLOCK_H - h; // inclusive
        let colMin = block.c0;
        let colMax = block.c0 + BLOCK_W - w; // inclusive

        // clamp to grid bounds (defensive)
        rowMin = Math.max(0, rowMin);
        colMin = Math.max(0, colMin);
        rowMax = Math.min(GRID_ROWS - h, rowMax);
        colMax = Math.min(GRID_COLS - w, colMax);

        if (rowMax < rowMin) rowMax = rowMin;
        if (colMax < colMin) colMax = colMin;

        const optsList = [];
        for (let r = rowMin; r <= rowMax; r++) {
            for (let c = colMin; c <= colMax; c++) {
                optsList.push({ rowCell: r, colCell: c, w, h });
            }
        }

        let candidates = optsList;

        if (lastGeom) {
            // ❗️Avoid same anchor AND same size (identical grid-area)
            candidates = optsList.filter(
                (g) =>
                    !(
                        g.rowCell === lastGeom.rowCell &&
                        g.colCell === lastGeom.colCell &&
                        g.w === lastGeom.w &&
                        g.h === lastGeom.h
                    )
            );

            // If that wiped out options, allow different size anywhere in block
            if (!candidates.length) {
                candidates = optsList.filter(
                    (g) => g.w !== lastGeom.w || g.h !== lastGeom.h
                );
            }

            // If still empty (very rare), allow different anchor only
            if (!candidates.length) {
                candidates = optsList.filter(
                    (g) =>
                        g.rowCell !== lastGeom.rowCell ||
                        g.colCell !== lastGeom.colCell
                );
            }

            // Final fallback: everything (should basically never happen)
            if (!candidates.length) {
                candidates = optsList;
            }
        }

        if (opts.avoidRows && opts.avoidRows.size) {
            const filtered = candidates.filter(
                (g) => !opts.avoidRows.has(g.rowCell)
            );
            if (filtered.length) {
                candidates = filtered;
            }
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

    /* ---------------------------------------------
       IMAGE PICKING
    --------------------------------------------- */

    function pickNewImageIndex(slot, reserved) {
        if (!images.length) return 0;

        const currentIdx = slot?.imgIndex ?? 0;
        const currentSrc = slot?.el?.src || images[currentIdx] || null;

        const visible = new Set(
            slots
                .map((s) => s.el?.src)
                .filter(Boolean)
        );

        if (reserved?.images && reserved.images.size) {
            reserved.images.forEach((src) => visible.add(src));
        }

        const candidates = images
            .map((src, i) => ({ src, i }))
            .filter(({ src }) => src !== currentSrc && !visible.has(src));

        if (candidates.length) {
            return rand(candidates).i;
        }

        // Fallback: avoid currentSrc if possible
        const nonCurrent = images.findIndex((src) => src !== currentSrc);
        if (nonCurrent !== -1) return nonCurrent;

        return currentIdx || 0;
    }

    /* ---------------------------------------------
       PER-CYCLE SEQUENCE OVER BLOCKS
    --------------------------------------------- */

    function shuffle(arr) {
        const copy = arr.slice();
        for (let i = copy.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    let sequence = [];
    let seqPos = 0;
    let lastSeqLastBlock = null;
    let autoTimer = null;
    let initDone = false;

    function makeSequence(disallowFirst) {
        const base = shuffle([...Array(SLOT_COUNT).keys()]);
        if (
            disallowFirst != null &&
            base[0] === disallowFirst &&
            base.length > 1
        ) {
            const swapIndex = randInt(1, base.length - 1);
            [base[0], base[swapIndex]] = [base[swapIndex], base[0]];
        }
        return base;
    }

    function startNewSequence() {
        sequence = makeSequence(lastSeqLastBlock);
        seqPos = 0;
    }

    function nextBlockIndex() {
        if (seqPos >= sequence.length) {
            lastSeqLastBlock = sequence[sequence.length - 1];
            startNewSequence();
        }
        const idx = sequence[seqPos++];
        lastSeqLastBlock = idx;
        return idx;
    }

    /* ---------------------------------------------
       SWAP LOGIC — springy with clear motion
    --------------------------------------------- */

    function swapSlot(slot, mode, reserved) {
        if (!slot || slot.busy) return Promise.resolve();

        slot.busy = true;

        const cfg =
            mode === "manual"
                ? { outY: 26, outS: 0.88, inY: -32, inS: 1.09 }
                : { outY: 12, outS: 0.95, inY: -18, inS: 1.03 };

        const spring = mode === "manual" ? T_MANUAL : T_AUTO;
        const OUT_DUR = mode === "manual" ? 0.45 : 0.4;
        const IN_DUR = mode === "manual" ? 0.65 : 0.55;

        const newImgIndex = pickNewImageIndex(slot, reserved);
        const nextSrc = images[newImgIndex];
        if (!nextSrc) {
            slot.busy = false;
            return Promise.resolve();
        }
        const geom = pickGeom(slot.blockIndex, slot.geom, { avoidRows: reserved?.rows });

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
            ? animate(
                oldEl,
                {
                    opacity: [1, 0],
                    y: [0, cfg.outY],
                    scale: [1, cfg.outS],
                    rotate: [0, 2],
                },
                { ...spring, duration: OUT_DUR }
            ).finished.then(() => oldEl.remove())
            : Promise.resolve();

        return outP
            .then(() =>
                animate(
                    newEl,
                    {
                        opacity: [0, 1],
                        y: [cfg.inY, 4, 0],
                        scale: [cfg.inS, 0.97, 1],
                        rotate: [-2, 0],
                    },
                    { ...spring, duration: IN_DUR }
                ).finished
            )
            .catch(() => { })
            .then(() => {
                slot.el = newEl;
                slot.imgIndex = newImgIndex;
                slot.geom = geom;
                slot.busy = false;
            });
    }

    function swapBlockAuto(blockIndex) {
        const slot = slots[blockIndex];
        return swapSlot(slot, "auto");
    }

    /* ---------------------------------------------
       GLOBAL SWAP — nukes auto, then restarts
    --------------------------------------------- */

    async function globalSwapManual() {
        // stop future ticks
        if (autoTimer) {
            clearTimeout(autoTimer);
            autoTimer = null;
        }

        // wait for any current swaps to finish
        while (slots.some((s) => s.busy)) {
            await new Promise((r) => setTimeout(r, 16));
        }

        // run manual swap on all slots
        const reserved = { images: new Set(), rows: new Set() };
        await Promise.all(slots.map((s) => swapSlot(s, "manual", reserved)));

        // restart auto
        startNewSequence();
        startAutoLoop();
    }

    /* ---------------------------------------------
       AUTO LOOP
    --------------------------------------------- */

    async function autoTick() {
        autoTimer = null;
        if (!initDone) return;

        const blockIndex = nextBlockIndex();
        await swapBlockAuto(blockIndex);

        autoTimer = setTimeout(autoTick, delayRand());
    }

    function startAutoLoop() {
        if (autoTimer) return;
        autoTimer = setTimeout(autoTick, delayRand());
    }

    /* ---------------------------------------------
       INITIAL BUILD + DROP-IN
    --------------------------------------------- */

    function runInitialDrop() {
        if (!images.length) return Promise.resolve();

        root.innerHTML = "";
        const initialEls = [];

        const firstBatch = images.length
            ? shuffle(images).slice(0, Math.min(SLOT_COUNT, images.length))
            : [];

        const reservedRows = new Set();

        slots.forEach((slot, i) => {
            const geomUnique = pickGeom(slot.blockIndex, null, { avoidRows: reservedRows });
            const el = document.createElement("img");

            const idx = firstBatch.length
                ? i % firstBatch.length
                : i % Math.max(images.length, 1);
            const src = firstBatch[idx] || images[idx] || images[0];

            el.className = "about_item";
            el.src = src;
            el.style.opacity = "0";
            el.style.transform = "translateY(-28px) scale(1.08)";
            applyGeom(el, geomUnique);

            slot.el = el;
            slot.geom = geomUnique;
            slot.imgIndex = idx;

            reservedRows.add(geomUnique.rowCell);

            root.appendChild(el);
            initialEls.push(el);
        });

        dropPromise = animate(
            initialEls,
            {
                opacity: [0, 1],
                y: [-28, 0],
                scale: [1.08, 1],
                rotate: [2, 0],
            },
            {
                ...T_AUTO,
                delay: stagger(0.12),
            }
        ).finished.then(() => {
            initDone = true;
            startNewSequence();
            startAutoLoop();
        });

        return dropPromise;
    }

    /* ---------------------------------------------
       THEME + STATE SWITCHING
    --------------------------------------------- */

    const baseBg = section ? getComputedStyle(section).backgroundColor : "#fff";
    const pink =
        getComputedStyle(document.documentElement)
            .getPropertyValue("--_color---pink")
            .trim() || baseBg;
    const svgBase = svg ? getComputedStyle(svg).color : null;

    function applyTheme(stateKey = activeStateKey) {
        const isPeople = stateKey === "people";

        if (section) {
            animate(
                section,
                { backgroundColor: isPeople ? pink : baseBg },
                THEME_T
            );
        }

        if (svg && svgBase) {
            animate(
                svg,
                { color: isPeople ? baseBg : svgBase },
                THEME_T
            );
        }
    }

    function handleStateChange(nextKey) {
        const key = normalizeKey(nextKey);
        const targetState = stateStore[key];
        if (!targetState) return;
        if (key === activeStateKey && initDone) return;

        changeChain = changeChain
            .then(async () => {
                activeStateKey = key;
                syncTitleActive(key);
                applyTheme(key);

                await ensureFirstBatch(targetState);
                updateImagesFromState(targetState);

                if (initDone) {
                    await globalSwapManual();
                } else if (dropPromise) {
                    await dropPromise;
                    await globalSwapManual();
                } else if (images.length) {
                    await runInitialDrop();
                }

                ensureAll(targetState).then(() => {
                    if (activeStateKey === key) {
                        updateImagesFromState(targetState);
                    }
                });

                const otherKey = getOtherKey(key);
                if (otherKey && stateStore[otherKey]) {
                    ensureFirstBatch(stateStore[otherKey]);
                    ensureAll(stateStore[otherKey]);
                }
            })
            .catch((err) => console.warn("aboutHero state change", err));
    }

    function setupTitle() {
        if (!title) return;

        const buttons = title.querySelectorAll("[data-about-hero]");
        if (!buttons.length) return;

        buttons.forEach((btn) => {
            btn.addEventListener("click", () => {
                handleStateChange(btn.dataset.aboutHero);
            });
        });

        applyTheme(activeStateKey);
    }

    async function bootstrap() {
        const firstState = stateStore[activeStateKey];
        if (!firstState) return;

        applyTheme(activeStateKey);

        await ensureFirstBatch(firstState);
        updateImagesFromState(firstState);

        if (!images.length) return;

        await runInitialDrop();

        setupTitle();

        ensureAll(firstState).then(() => {
            if (activeStateKey === firstState.key) {
                updateImagesFromState(firstState);
            }

            const otherKey = getOtherKey(firstState.key);
            if (otherKey && stateStore[otherKey]) {
                ensureFirstBatch(stateStore[otherKey]);
                ensureAll(stateStore[otherKey]);
            }
        });
    }

    bootstrap().catch((err) => console.warn("aboutHero init", err));
}
