import { createLogger } from "./utils/debug.js";

const { log } = createLogger("loader");

function getKit() {
    const w = window;
    if (!w.sitekit) w.sitekit = {};
    if (!w.sitekit.features) w.sitekit.features = {};
    if (!w.sitekit.utils) w.sitekit.utils = {};
    return w.sitekit;
}

function waitForDomReady() {
    const state = document.readyState;
    if (state === "interactive" || state === "complete") {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        document.addEventListener(
            "DOMContentLoaded",
            () => {
                resolve();
            },
            { once: true }
        );
    });
}

// One way to import + load utils.
// Kept simple: load after DOM ready.
const utilList = [
    { name: "pageWrapGate", load: () => import("./utils/pageWrapGate.js") },
    { name: "breakpoints", load: () => import("./utils/breakpoints.js") },
];

function has(selector) {
    try {
        return Boolean(document.querySelector(selector));
    } catch {
        return false;
    }
}

function pathIncludes(segment) {
    try {
        return String(window.location?.pathname || "").includes(segment);
    } catch {
        return false;
    }
}

async function loadUtils() {
    const kit = getKit();

    log("utils: loading", utilList.map((u) => u.name));

    for (const util of utilList) {
        try {
            const mod = await util.load();
            const utilExports = { ...mod };

            if (typeof mod.init === "function") {
                const maybeStop = mod.init();
                if (typeof maybeStop === "function") {
                    utilExports.stop = maybeStop;
                }
            }

            kit.utils[util.name] = utilExports;

            // mount util api if present: sitekit[util.name]
            if (mod.api && typeof mod.api === "object") {
                kit[util.name] = mod.api;
            }

            log("utils: loaded", util.name);
        } catch (error) {
            console.warn("sitekit util failed", util.name, error?.message || error);
        }
    }
}

// name → dynamic import
const featureList = [
    {
        name: "homeLoading",
        load: () => import("./features/homeLoading.js"),
        when: () => has(".section_loading"),
    },
    {
        name: "pastaLlax",
        load: () => import("./features/pastaLlax.js"),
        when: () => has(".hero_pastallax"),
    },
    {
        name: "tooltip",
        load: () => import("./features/footerTooltip.js"),
        when: () => has("[data-copy]"),
    },
    {
        name: "aboutHero",
        load: () => import("./features/aboutHero.js"),
        when: () => has(".section_about") && has(".about_layout") && has(".about_title"),
    },
    {
        name: "whatWeDoHero",
        load: () => import("./features/whatWeDoHero.js"),
        when: () =>
            has(".section_hero .hero_pastallax") &&
            Array.isArray(window.whatWeDoHeroImages) &&
            window.whatWeDoHeroImages.length > 0,
    },
    {
        name: "aboutTeam",
        load: () => import("./features/aboutTeam.js"),
        when: () => has(".section_team"),
    },
    {
        name: "expertTabs",
        load: () => import("./features/expertTabs.js"),
        when: () => has(".section_expert"),
    },
    {
        name: "testimonialSlider",
        load: () => import("./features/testimonialSlider.js"),
        when: () => has(".section_test") && typeof window.EmblaCarousel === "function",
    },
    {
        name: "howSlider",
        load: () => import("./features/howSlider.js"),
        when: () => has(".how_list-wrap.embla") && typeof window.EmblaCarousel === "function",
    },
    {
        name: "contactForm",
        load: () => import("./features/contactForm.js"),
        when: () =>
            pathIncludes("/contact") ||
            has("#email-form") ||
            has(".section_success .title-m"),
    },
    {
        name: "navLogoTheme",
        load: () => import("./features/navLogoTheme.js"),
        when: () => has(".c-nav"),
    },
];

let bootStarted = false;

async function boot() {
    const kit = getKit();

    if (bootStarted) return;
    bootStarted = true;

    log("boot: start");

    await waitForDomReady();

    log("boot: dom ready");

    // Utils
    await loadUtils();

    log("boot: utils loaded");

    // Features
    for (const feature of featureList) {
        try {
            log("feature: loading", feature.name);

            if (typeof feature.when === "function") {
                const shouldLoad = feature.when();
                if (!shouldLoad) {
                    log("feature: skip", { name: feature.name, reason: "not applicable" });
                    continue;
                }
            }

            const mod = await feature.load();

            // store all exports on window.sitekit.features[name]
            kit.features[feature.name] = mod;

            // auto-init if available
            if (typeof mod.init === "function") {
                // If boot() is called multiple times, prevent double-binding
                if (typeof mod.destroy === "function") {
                    try {
                        mod.destroy();
                    } catch (error) {
                        console.warn(
                            "sitekit feature destroy failed",
                            feature.name,
                            error?.message || error
                        );
                    }
                }
                mod.init();
                log("feature: init", feature.name);
            }

            // if module exposes an api object, mount to sitekit[feature.name]
            if (mod.api && typeof mod.api === "object") {
                kit[feature.name] = mod.api;
            }
        } catch (error) {
            console.warn("sitekit feature failed", feature.name, error?.message || error);
        }
    }

    log("boot: done");
}

// expose boot on window for manual re-run if needed
getKit().boot = boot;

boot();

export { boot };