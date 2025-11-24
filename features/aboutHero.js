// Motion-first hero engine — NO JIGGLE, improved image selection
// Motion CDN required:
// <script type="module" src="https://cdn.jsdelivr.net/npm/motion@latest/+esm"></script>

import { animate, stagger } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

export function init() {
    const root = document.querySelector(".about_layout");
    if (!root) return;

    const section = document.querySelector(".section_about");
    const svg = document.querySelector(".about_svg");
    const title = document.querySelector(".about_title");

    const els = Array.from(root.querySelectorAll(".about_item"));
    if (!els.length) return;

    const imageList = Array.isArray(window.aboutHeroImages)
        ? window.aboutHeroImages.slice()
        : [];

    if (!imageList.length) {
        console.warn("No aboutHeroImages found");
        return;
    }

    /* ---------------------------------------------------------
       MOTION FEEL
    --------------------------------------------------------- */

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

    const AUTO_MIN = 600;    // reduced from 2200 (faster swapping)
    const AUTO_MAX = 1200;    // reduced from 3200 (faster swapping)

    /* ---------------------------------------------------------
       SLOT MODEL
    --------------------------------------------------------- */

    const slots = els.map((el) => ({
        el,
        id: null,
        busy: false,
        pending: false,
        depth: 0.4 + Math.random() * 0.8,
    }));

    const loaded = [];
    let autoTimer = null;
    let initDone = false;
    let lastAutoSlot = null;

    // Parallax state - shared globally
    let parallaxCx = 0;
    let parallaxCy = 0;

    const rand = (arr) => arr[(Math.random() * arr.length) | 0];
    const delayRand = () => AUTO_MIN + Math.random() * (AUTO_MAX - AUTO_MIN);

    const shuffle = (arr) => {
        const copy = arr.slice();
        for (let i = copy.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    };

    // Recent-use buffer to avoid hammering the same images
    const recentIds = [];
    const RECENT_LIMIT = 6;

    // Track IDs that are currently mid-swap so we don't reuse them in another swap at the same time
    const swappingIds = new Set();

    const markUsed = (id) => {
        if (id == null) return;
        recentIds.push(id);
        const maxLen = Math.min(RECENT_LIMIT, Math.max(3, loaded.length - 2));
        while (recentIds.length > maxLen) {
            recentIds.shift();
        }
    };

    const getVisibleIds = () => {
        const set = new Set();
        for (const s of slots) {
            if (s.id != null) set.add(s.id);
        }
        return set;
    };

    /* ---------------------------------------------------------
       IMAGE SELECTION — GLOBAL AWARENESS
       - Never return current image (avoidId)
       - Prefer images not in recentIds
       - Avoid images currently visible in any slot
       - Avoid images currently mid-swap (swappingIds)
    --------------------------------------------------------- */

    const pickNewImage = (avoidId) => {
        if (!loaded.length) return null;

        const visibleIds = getVisibleIds();
        const hardAvoid = new Set();

        // avoid current image for this slot
        if (avoidId != null) hardAvoid.add(avoidId);

        // avoid all visible images (so we don't stamp the same image twice at once)
        for (const id of visibleIds) hardAvoid.add(id);

        // avoid anything mid-swap
        for (const id of swappingIds) hardAvoid.add(id);

        // strict candidates: not in hardAvoid
        let strictCandidates = loaded.filter((e) => !hardAvoid.has(e.id));

        // prefer those not in recentIds
        const recentSet = new Set(recentIds);
        const fresh = strictCandidates.filter((e) => !recentSet.has(e.id));

        let pool = fresh.length ? fresh : strictCandidates;

        // fallback: if somehow everything is in hardAvoid, relax to "anything except avoidId"
        if (!pool.length) {
            pool = loaded.filter((e) => e.id !== avoidId);
        }

        if (!pool.length) return null;

        return rand(pool);
    };

    /* ---------------------------------------------------------
       SWAP SLOT
    --------------------------------------------------------- */

    const swapSlot = (slot, mode) => {
        if (slot.busy) return;
        if (!loaded.length) return;

        slot.busy = true;

        const cfg =
            mode === "manual"
                ? { outY: 26, outS: 0.88, inY: -32, inS: 1.09 }
                : { outY: 12, outS: 0.95, inY: -18, inS: 1.03 };

        const transition = mode === "manual" ? T_MANUAL : T_AUTO;

        const next = pickNewImage(slot.id);
        if (!next) {
            slot.busy = false;
            return;
        }

        // Reserve this ID while it's mid-swap so we don't pick it again in another slot simultaneously
        swappingIds.add(next.id);

        const oldEl = slot.el;
        const parent = oldEl.parentNode;
        if (!parent) {
            slot.busy = false;
            swappingIds.delete(next.id);
            return;
        }

        const newEl = oldEl.cloneNode(true);

        newEl.src = next.blobUrl;
        newEl.dataset.heroId = next.id;
        newEl.dataset.heroUrl = next.blobUrl;

        // Apply current parallax offset immediately to prevent glitch
        const parallaxOffsetX = parallaxCx * slot.depth;
        const parallaxOffsetY = parallaxCy * slot.depth;
        newEl.style.translate = `${parallaxOffsetX}px ${parallaxOffsetY}px`;

        newEl.style.opacity = "0";
        newEl.style.transform = `translateY(${cfg.inY}px) scale(${cfg.inS})`;

        parent.insertBefore(newEl, oldEl.nextSibling);

        const pOut = animate(
            oldEl,
            {
                opacity: 0,
                y: cfg.outY,
                scale: cfg.outS,
            },
            transition
        ).finished.then(() => oldEl.remove());

        const pIn = animate(
            newEl,
            {
                opacity: 1,
                y: [cfg.inY, 0],
                scale: [cfg.inS, 1],
            },
            transition
        ).finished.then(() => {
            slot.el = newEl;
            slot.id = next.id;
            markUsed(next.id);
        });

        Promise.all([pOut, pIn])
            .catch(() => {
                // swallow, just unlock
            })
            .finally(() => {
                slot.busy = false;
                swappingIds.delete(next.id);

                if (slot.pending) {
                    slot.pending = false;
                    swapSlot(slot, "manual");
                }
            });
    };

    /* ---------------------------------------------------------
       INITIAL DROP
    --------------------------------------------------------- */

    const startInitial = () => {
        if (initDone) return;
        initDone = true;

        const shuffledEls = shuffle(slots.map((s) => s.el));

        animate(
            shuffledEls,
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
            startAutoLoop();
        });
    };

    /* ---------------------------------------------------------
       AUTO LOOP
    --------------------------------------------------------- */

    const autoTick = () => {
        autoTimer = null;

        if (!initDone || !loaded.length) {
            startAutoLoop();
            return;
        }

        const free = slots.filter((s) => !s.busy && s.id !== null);
        
        // Exclude the last auto-swapped slot to prevent immediate repeats
        const candidates = free.filter((s) => s !== lastAutoSlot);
        const pool = candidates.length ? candidates : free;
        
        if (pool.length) {
            const selected = rand(pool);
            lastAutoSlot = selected;
            swapSlot(selected, "auto");
        }

        startAutoLoop();
    };

    const startAutoLoop = () => {
        if (autoTimer) return;
        autoTimer = setTimeout(autoTick, delayRand());
    };

    /* ---------------------------------------------------------
       GLOBAL MANUAL SWAP
    --------------------------------------------------------- */

    const globalSwap = () => {
        if (autoTimer) {
            clearTimeout(autoTimer);
            autoTimer = null;
        }

        lastAutoSlot = null;

        for (const s of slots) {
            if (s.busy) {
                s.pending = true;
            } else if (s.id != null) {
                swapSlot(s, "manual");
            }
        }

        startAutoLoop();
    };

    /* ---------------------------------------------------------
       THEME
    --------------------------------------------------------- */

    const baseBg = section ? getComputedStyle(section).backgroundColor : "#fff";
    const pink =
        getComputedStyle(document.documentElement)
            .getPropertyValue("--_color---pink")
            .trim() || baseBg;

    const svgBase = svg ? getComputedStyle(svg).color : null;

    const applyTheme = () => {
        const active = title?.querySelector(".about_title-active");
        if (!active) return;

        const wrappers = title.querySelectorAll(".title-l");
        if (wrappers.length < 2) return;

        const isPeople = active.closest(".title-l") === wrappers[0];

        animate(
            section,
            { backgroundColor: isPeople ? pink : baseBg },
            THEME_T
        );

        if (svg) {
            animate(
                svg,
                { color: isPeople ? baseBg : svgBase },
                THEME_T
            );
        }
    };

    const setupTitle = () => {
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

                globalSwap();
                applyTheme();
            });
        });

        applyTheme();
    };

    /* ---------------------------------------------------------
       PARALLAX
    --------------------------------------------------------- */

    const setupParallax = () => {
        if (!window.matchMedia("(pointer:fine)").matches) return;
        if (!section) return;

        let tx = 0,
            ty = 0;
        const lerp = 0.04;
        const maxShift = 8;
        let raf = null;

        const tick = () => {
            raf = null;
            parallaxCx += (tx - parallaxCx) * lerp;
            parallaxCy += (ty - parallaxCy) * lerp;

            for (const slot of slots) {
                if (slot.el && slot.el.style) {
                    slot.el.style.translate = `${parallaxCx * slot.depth}px ${parallaxCy * slot.depth}px`;
                }
            }

            if (Math.abs(tx - parallaxCx) > 0.1 || Math.abs(ty - parallaxCy) > 0.1) {
                raf = requestAnimationFrame(tick);
            }
        };

        const queue = () => {
            if (!raf) raf = requestAnimationFrame(tick);
        };

        section.addEventListener("mousemove", (e) => {
            const r = section.getBoundingClientRect();
            const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
            const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);

            tx = -Math.max(-1, Math.min(1, nx)) * maxShift;
            ty = -Math.max(-1, Math.min(1, ny)) * maxShift;

            queue();
        });

        section.addEventListener("mouseleave", () => {
            tx = ty = 0;
            queue();
        });
    };

    /* ---------------------------------------------------------
       IMAGE LOADING → triggers cascade
    --------------------------------------------------------- */

    const tryStartInit = () => {
        if (initDone) return;
        const allFilled = slots.every((s) => s.id !== null);
        if (allFilled || loaded.length) {
            startInitial();
        }
    };

    imageList.forEach((src, id) => {
        fetch(src)
            .then((r) => r.blob())
            .then((blob) => {
                const url = URL.createObjectURL(blob);
                loaded.push({ id, blobUrl: url });

                const slot = slots.find((s) => s.id === null);
                if (slot) {
                    slot.id = id;
                    slot.el.src = url;
                    slot.el.dataset.heroId = id;
                    slot.el.dataset.heroUrl = url;
                    markUsed(id);
                }

                tryStartInit();
            })
            .catch(() => {
                tryStartInit();
            });
    });

    /* ---------------------------------------------------------
       START
    --------------------------------------------------------- */

    setupTitle();
    setupParallax();
}