import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

export function init() {
    const root = document.querySelector(".about_layout");
    const section = document.querySelector(".section_about");
    const svg = document.querySelector(".about_svg");
    const title = document.querySelector(".about_title");

    if (!root) return;

    const images = Array.isArray(window.aboutHeroImages)
        ? window.aboutHeroImages.slice()
        : [];

    if (!images.length) {
        console.warn("No aboutHeroImages found");
        return;
    }

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
        imgIndex: i % images.length,
        busy: false,
        geom: null, // { rowCell, colCell, w, h, area }
    }));

    /* ---------------------------------------------
       SIZE + POSITION HELPERS (safe, 0-based)
    --------------------------------------------- */

    // Only change COL span (w), keep ROW span (h) fixed
    function pickSize(lastGeom) {
        // Fixed row span: never changes once chosen
        const h = Math.min(Math.max(BASE_H, MIN_H), MAX_H);

        // Start from previous width if present, otherwise base
        let wBase = lastGeom ? lastGeom.w : BASE_W;
        wBase = Math.min(Math.max(wBase, MIN_W), MAX_W);

        // Wiggle width by ±1 within bounds
        const wCandidates = [];
        for (const dw of [-1, 1]) {
            const w = wBase + dw;
            if (w >= MIN_W && w <= MAX_W) wCandidates.push(w);
        }

        // If we somehow can't move (at extreme), stay at current width
        if (!wCandidates.length) {
            wCandidates.push(wBase);
        }

        const w = rand(wCandidates);
        return { w, h };
    }

    function pickGeom(blockIndex, lastGeom) {
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

        const opts = [];
        for (let r = rowMin; r <= rowMax; r++) {
            for (let c = colMin; c <= colMax; c++) {
                opts.push({ rowCell: r, colCell: c, w, h });
            }
        }

        let candidates = opts;

        if (lastGeom) {
            // ❗️Avoid same anchor position, regardless of size
            candidates = opts.filter(
                (g) =>
                    !(
                        g.rowCell === lastGeom.rowCell &&
                        g.colCell === lastGeom.colCell
                    )
            );

            // If the block is tiny and we *must* reuse the same anchor, fall back
            if (!candidates.length) {
                candidates = opts;
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

    function pickNewImageIndex(current) {
        if (images.length <= 1) return current || 0;
        let next = current;
        while (next === current) {
            next = randInt(0, images.length - 1);
        }
        return next;
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

    function swapSlot(slot, mode) {
        if (!slot || slot.busy) return Promise.resolve();

        slot.busy = true;

        const cfg =
            mode === "manual"
                ? { outY: 26, outS: 0.88, inY: -32, inS: 1.09 }
                : { outY: 12, outS: 0.95, inY: -18, inS: 1.03 };

        const spring = mode === "manual" ? T_MANUAL : T_AUTO;
        const OUT_DUR = mode === "manual" ? 0.45 : 0.4;
        const IN_DUR = mode === "manual" ? 0.65 : 0.55;

        const newImgIndex = pickNewImageIndex(slot.imgIndex);
        const geom = pickGeom(slot.blockIndex, slot.geom);

        const oldEl = slot.el;
        const newEl = document.createElement("img");

        newEl.className = "about_item";
        newEl.src = images[newImgIndex];
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
        await Promise.all(slots.map((s) => swapSlot(s, "manual")));

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

    root.innerHTML = "";
    const initialEls = [];

    slots.forEach((slot) => {
        const geom = pickGeom(slot.blockIndex, null);
        const el = document.createElement("img");

        el.className = "about_item";
        el.src = images[slot.imgIndex];
        el.style.opacity = "0";
        el.style.transform = "translateY(-28px) scale(1.08)";
        applyGeom(el, geom);

        slot.el = el;
        slot.geom = geom;

        root.appendChild(el);
        initialEls.push(el);
    });

    animate(
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

    /* ---------------------------------------------
       THEME + TITLE CLICKS
    --------------------------------------------- */

    const baseBg = section ? getComputedStyle(section).backgroundColor : "#fff";
    const pink =
        getComputedStyle(document.documentElement)
            .getPropertyValue("--_color---pink")
            .trim() || baseBg;
    const svgBase = svg ? getComputedStyle(svg).color : null;

    function applyTheme() {
        const active = title?.querySelector(".about_title-active");
        if (!active) return;

        const wrappers = title?.querySelectorAll(".title-l") || [];
        if (wrappers.length < 2) return;

        const isPeople = active.closest(".title-l") === wrappers[0];

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

    function setupTitle() {
        if (!title) return;

        const wrappers = title.querySelectorAll(".title-l");
        if (wrappers.length < 2) return;

        wrappers.forEach((w) => {
            w.addEventListener("click", () => {
                const active = title.querySelector(".about_title-active");
                if (!active) return;
                if (w.contains(active)) return;

                active.classList.remove("about_title-active");
                (w.firstElementChild || w).classList.add("about_title-active");

                globalSwapManual();
                applyTheme();
            });
        });

        applyTheme();
    }

    setupTitle();
}