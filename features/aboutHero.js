// Requires Motion CDN: import { animate } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";
import { animate } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

const spring = (stiffness, damping, mass = 1) => ({ type: "spring", stiffness, damping, mass });
const physics = {
    in: spring(900, 32, 1.1),
    out: spring(1200, 28, 0.9),
    drop: spring(1000, 30, 1),
};

const jiggleCfg = {
    duration: 3.2,
    amp: 1.4,
    rot: 0.6,
};

const swapInterval = 6000;

// Theme timing (bg + svg use same values)
const THEME_DURATION = 0.4;
const THEME_EASE = "easeOut";

export function init() {
    const root = document.querySelector(".about_layout");
    if (!root) return;

    const section = document.querySelector(".section_about");
    const svg = document.querySelector(".about_svg");
    const title = document.querySelector(".about_title");

    const items = Array.from(root.querySelectorAll(".about_item"));
    if (!items.length) return;

    const srcPool = Array.isArray(window.aboutHeroImages)
        ? window.aboutHeroImages.slice()
        : [];

    if (!srcPool.length) {
        console.warn("[about_hero] window.aboutHeroImages missing");
        return;
    }

    // Theme colors
    const baseBg = section ? getComputedStyle(section).backgroundColor : null;
    const pink =
        getComputedStyle(document.documentElement)
            .getPropertyValue("--_color---pink")
            .trim() || baseBg;
    const svgInitial = svg ? getComputedStyle(svg).color : null;

    // State
    const loaded = [];
    let swaps = new Array(items.length).fill(null);
    let slotBusy = new Array(items.length).fill(false);
    let pendingImmediate = new Array(items.length).fill(false);
    let initialDone = false;

    // UTIL ----------------------------------------------------

    const randItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const shuffle = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0;
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };

    const usedIds = () =>
        new Set(
            items
                .filter((el) => el.dataset.heroId != null)
                .map((el) => Number(el.dataset.heroId))
        );

    const pickNew = (currentIdStr) => {
        if (!loaded.length) return null;
        const currentId = currentIdStr != null ? Number(currentIdStr) : null;
        const used = usedIds();
        const free = loaded.filter((e) => !used.has(e.id));
        if (free.length) return randItem(free);
        const alts = loaded.filter((e) => e.id !== currentId);
        return alts.length ? randItem(alts) : null;
    };

    // JIGGLE --------------------------------------------------

    const startJiggle = (el, idx) => {
        stopJiggle(el);
        const { amp, rot, duration } = jiggleCfg;
        el._jiggle = animate(
            el,
            {
                scale: [1, 1 + amp / 100, 1],
                rotate: [0, rot, -rot * 0.5, 0],
                y: [0, -amp, 0],
            },
            {
                duration,
                ease: "easeInOut",
                repeat: Infinity,
                repeatType: "reverse",
                delay: idx * 0.18,
            }
        );
    };

    const stopJiggle = (el) => {
        if (el._jiggle && typeof el._jiggle.cancel === "function") el._jiggle.cancel();
        el._jiggle = null;
    };

    // SWAP LOCKING --------------------------------------------

    const markIdle = (i) => {
        slotBusy[i] = false;

        // If a global toggle happened while we were busy, honour that first
        if (pendingImmediate[i]) {
            pendingImmediate[i] = false;
            // This will re-check slotBusy and either run or defer again
            doSwap(i);
            return;
        }

        // Otherwise, if there is no pending timeout, resume auto swapping
        if (!swaps[i]) {
            scheduleSwap(i);
        }
    };

    const scheduleSwap = (i, delay = swapInterval) => {
        clearTimeout(swaps[i]);
        swaps[i] = setTimeout(() => {
            swaps[i] = null;
            if (!slotBusy[i]) {
                doSwap(i);
            }
        }, delay);
    };

    const doSwap = (i) => {
        const oldEl = items[i];
        if (!oldEl?.isConnected) {
            markIdle(i);
            return;
        }

        // Per-slot lock: no overlapping swaps for the same item
        if (slotBusy[i]) return;
        slotBusy[i] = true;

        clearTimeout(swaps[i]);
        swaps[i] = null;

        const nextEntry = pickNew(oldEl.dataset.heroId);
        if (!nextEntry) {
            markIdle(i);
            return;
        }

        stopJiggle(oldEl);

        const parent = oldEl.parentNode;
        if (!parent) {
            markIdle(i);
            return;
        }

        const newEl = oldEl.cloneNode(true);
        newEl.dataset.heroId = String(nextEntry.id);
        newEl.dataset.heroUrl = nextEntry.blobUrl;
        newEl.src = nextEntry.blobUrl;
        newEl.style.opacity = "0";
        newEl.style.transform = "translateY(-24px) scale(1.1)";
        parent.insertBefore(newEl, oldEl.nextSibling);

        const outPromise = animate(
            oldEl,
            {
                scale: [1, 0.85],
                opacity: [1, 0],
                y: [0, 12],
            },
            physics.out
        ).finished.then(() => oldEl.remove());

        const inPromise = animate(
            newEl,
            {
                y: [-24, 0],
                scale: [1.1, 1],
                opacity: [0, 1],
            },
            physics.in
        ).finished.then(() => {
            items[i] = newEl;
            const realIndex = i;
            startJiggle(newEl, realIndex);
        });

        Promise.all([outPromise, inPromise])
            .catch(() => {
                // swallow; just unlock
            })
            .finally(() => {
                markIdle(i);
            });
    };

    // INITIAL CASCADE ----------------------------------------

    const startInitial = () => {
        if (initialDone) return;
        initialDone = true;

        const activeItems = items.filter((el) => el.dataset.heroUrl);
        shuffle(activeItems);

        animate(
            activeItems,
            {
                y: [-24, 0],
                scale: [1.1, 1],
                rotate: [2, 0],
                opacity: [0, 1],
            },
            {
                ...physics.drop,
                delay: (i) => i * 0.12,
            }
        ).finished.then(() => {
            activeItems.forEach((el) => {
                const idx = items.indexOf(el);
                if (idx === -1) return;
                startJiggle(el, idx);
                scheduleSwap(idx);
            });
        });
    };

    const globalSwap = () => {
        if (!initialDone || !loaded.length) return;

        items.forEach((_, i) => {
            clearTimeout(swaps[i]);
            swaps[i] = null;

            if (slotBusy[i]) {
                // Mark that once the current swap is done, we should swap again
                pendingImmediate[i] = true;
            } else {
                doSwap(i);
            }
        });
    };

    // THEME --------------------------------------------------

    const applyTheme = () => {
        if (!section || !title || !pink || !baseBg) return;
        const active = title.querySelector(".about_title-active");
        if (!active) return;

        const wrappers = title.querySelectorAll(".title-l");
        if (wrappers.length < 2) return;
        const peopleWrapper = wrappers[0];
        const isPeople = active.closest(".title-l") === peopleWrapper;

        const currentSectionBg = getComputedStyle(section).backgroundColor;
        const currentSvgColor = svg ? getComputedStyle(svg).color : null;

        animate(
            section,
            { backgroundColor: [currentSectionBg, isPeople ? pink : baseBg] },
            { duration: THEME_DURATION, ease: THEME_EASE }
        );

        if (svg) {
            const targetColor = isPeople
                ? baseBg
                : svgInitial || currentSvgColor;

            animate(
                svg,
                { color: [currentSvgColor, targetColor] },
                { duration: THEME_DURATION, ease: THEME_EASE }
            );
        }
    };

    const setupTitle = () => {
        if (!title) return;

        const wrappers = title.querySelectorAll(".title-l");
        if (wrappers.length < 2) return;

        wrappers.forEach((wrapper) => {
            wrapper.addEventListener("click", () => {

                // find ANY element with .about_title-active
                const active = title.querySelector(".about_title-active");
                if (!active) return;

                // ignore clicks on already-active side
                if (wrapper.contains(active)) return;

                // remove from old
                active.classList.remove("about_title-active");

                // add to the first eligible child inside wrapper
                // could be h2, could be span, could be div — doesn't matter
                const clickable = wrapper.querySelector(".about_title-active")
                    || wrapper.firstElementChild
                    || wrapper;

                clickable.classList.add("about_title-active");

                globalSwap();
                applyTheme();
            });
        });

        applyTheme();
    };

    // IMAGE LOADING ------------------------------------------

    const assignEntry = (entry) => {
        const empty = items.find((el) => !el.dataset.heroUrl);
        if (!empty) return;
        empty.dataset.heroId = String(entry.id);
        empty.dataset.heroUrl = entry.blobUrl;
        empty.src = entry.blobUrl;

        if (items.every((el) => el.dataset.heroUrl) && !initialDone) {
            startInitial();
        }
    };

    const loadImages = () => {
        let done = 0;
        srcPool.forEach((src, id) => {
            fetch(src)
                .then((r) => {
                    if (!r.ok) throw new Error(r.status);
                    return r.blob();
                })
                .then((blob) => {
                    const blobUrl = URL.createObjectURL(blob);
                    const entry = { id, blobUrl };
                    loaded.push(entry);
                    assignEntry(entry);
                })
                .catch((e) => console.warn("[about_hero] image fetch failed", src, e))
                .finally(() => {
                    done++;
                    if (done === srcPool.length && !initialDone && loaded.length) {
                        // Start even if not all filled
                        startInitial();
                    }
                });
        });
    };

    // START --------------------------------------------------
    setupTitle();
    loadImages();
}