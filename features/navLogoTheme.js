// navColorTheme.js
import {
    scroll,
    motionValue,
    resize,
    animate
} from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

export function init() {
    const nav = document.querySelector(".c-nav");
    if (!nav) {
        console.warn("[navColorTheme] .c-nav not found");
        return;
    }

    // --- COLOR BANK ---------------------------------------------------------
    // Hex colors that should force the nav foreground to white.
    const WHITE_TRIGGER_HEX = [
        "#191919", // dark grey
        "#000000", // black
        "#0094d6", // blue
        "#ff9ebd"  // rgb(255, 158, 189)
    ];

    function hexToRGB(hex) {
        if (!hex) return null;
        let h = hex.trim().toLowerCase();
        if (h[0] === "#") h = h.slice(1);

        if (h.length === 3) {
            // #rgb -> #rrggbb
            const r = h[0] + h[0];
            const g = h[1] + h[1];
            const b = h[2] + h[2];
            h = r + g + b;
        }

        if (h.length !== 6) return null;

        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);

        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
        return { r, g, b };
    }

    // Parse rgb()/rgba() (or hex as fallback) into { r, g, b, a }
    function parseCssColorToRGBA(str) {
        if (!str) return null;
        const s = str.trim().toLowerCase();

        // rgb() / rgba()
        const match = s.match(
            /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/
        );
        if (match) {
            const r = parseInt(match[1], 10);
            const g = parseInt(match[2], 10);
            const b = parseInt(match[3], 10);
            const a =
                match[4] !== undefined ? parseFloat(match[4]) : 1;

            if (
                Number.isNaN(r) ||
                Number.isNaN(g) ||
                Number.isNaN(b) ||
                Number.isNaN(a)
            ) {
                return null;
            }

            return { r, g, b, a };
        }

        // Fallback if browser gives hex
        if (s.startsWith("#")) {
            const rgb = hexToRGB(s);
            if (!rgb) return null;
            return { ...rgb, a: 1 };
        }

        return null;
    }

    function rgbEqual(a, b) {
        return a && b && a.r === b.r && a.g === b.g && a.b === b.b;
    }

    // Precompute RGB bank once
    const WHITE_TRIGGER_RGB = [];
    for (let i = 0; i < WHITE_TRIGGER_HEX.length; i++) {
        const rgb = hexToRGB(WHITE_TRIGGER_HEX[i]);
        if (rgb) WHITE_TRIGGER_RGB.push(rgb);
    }

    console.log("[navColorTheme] White trigger colors (RGB):", WHITE_TRIGGER_RGB);

    // Walk up the DOM until we find a non-transparent background
    function getEffectiveBackgroundRGB(el) {
        let current = el;

        while (current && current !== document.documentElement) {
            const bgStr = getComputedStyle(current).backgroundColor;
            const rgba = parseCssColorToRGBA(bgStr);

            // If we got a real color and it's not fully transparent, use it
            if (rgba && rgba.a > 0) {
                return { r: rgba.r, g: rgba.g, b: rgba.b };
            }

            current = current.parentElement;
        }

        // If everything is transparent, we treat as "no explicit bg"
        return null;
    }

    // All sections whose class starts with "section_"
    const sectionNodes = Array.from(
        document.querySelectorAll("[class^='section_']")
    );
    if (!sectionNodes.length) {
        console.warn("[navColorTheme] No [class^='section_'] sections found");
        return;
    }

    // Helper: does this section want a white nav foreground?
    function sectionTriggersWhite(el) {
        if (el.classList.contains("nav_toggle_white")) {
            console.log(
                "[navColorTheme] sectionTriggersWhite via class",
                el.className
            );
            return true;
        }

        const effectiveRGB = getEffectiveBackgroundRGB(el);
        console.log(
            "[navColorTheme] Effective background for",
            el.className,
            effectiveRGB
        );

        if (!effectiveRGB) return false;

        for (let i = 0; i < WHITE_TRIGGER_RGB.length; i++) {
            if (rgbEqual(effectiveRGB, WHITE_TRIGGER_RGB[i])) {
                console.log(
                    "[navColorTheme] Matched white trigger color",
                    WHITE_TRIGGER_RGB[i],
                    "for",
                    el.className
                );
                return true;
            }
        }

        return false;
    }

    // Prebuild section metadata, layout fields are filled later
    const sections = [];
    for (let i = 0; i < sectionNodes.length; i++) {
        const el = sectionNodes[i];
        const triggerWhite = sectionTriggersWhite(el);
        sections.push({
            el,
            triggerWhite,
            top: 0,
            bottom: 0,
            activateY: 0
        });

        console.log("[navColorTheme] Section", i, {
            classes: el.className,
            triggerWhite
        });
    }

    // Track nav height (from CSS var)
    let navHeight = 0;
    function updateNavHeight() {
        const rootStyles = getComputedStyle(document.documentElement);
        const raw = rootStyles.getPropertyValue("--nav--height") || "0";
        const parsed = parseFloat(raw);
        navHeight = Number.isFinite(parsed) ? parsed : 0;
        console.log("[navColorTheme] navHeight", navHeight, "from", raw.trim());
    }
    updateNavHeight();

    // Read initial nav text color (this is our "default" nav foreground)
    const computedNavStyles = getComputedStyle(nav);
    const defaultColorString = computedNavStyles.color || "rgb(0, 0, 0)";
    const defaultColorRGBA =
        parseCssColorToRGBA(defaultColorString) || {
            r: 0,
            g: 0,
            b: 0,
            a: 1
        };
    const whiteRGB = { r: 255, g: 255, b: 255 };

    console.log("[navColorTheme] Initial nav color", {
        defaultColor: defaultColorString,
        defaultColorRGBA,
        whiteRGB
    });

    // Motion values
    const activeSectionIndex = motionValue(-1); // -1 = none

    // Theme value 0 = default nav color, 1 = white nav color
    const navTheme = motionValue(0);

    // Animate helper: tween navTheme to 0 or 1 with 0.25s easeOut
    let lastThemeTarget = navTheme.get();
    function setThemeTarget(target) {
        if (target === lastThemeTarget) return;
        lastThemeTarget = target;

        navTheme.stop();
        animate(navTheme, target, {
            duration: 0.25,
            ease: "easeOut"
        });
    }

    // Log when active section changes
    activeSectionIndex.on("change", (index) => {
        if (index < 0) {
            console.log("[navColorTheme] Active section: none");
        } else {
            const data = sections[index];
            console.log("[navColorTheme] Active section:", index, {
                classes: data.el.className,
                triggerWhite: data.triggerWhite
            });
        }
    });

    // Apply theme changes to DOM on navTheme change — mix colors
    let lastAppliedColor = "";
    navTheme.on("change", (value) => {
        // Clamp and mix defaultColorRGBA → whiteRGB
        const t = value < 0 ? 0 : value > 1 ? 1 : value;

        const r = Math.round(
            defaultColorRGBA.r + (whiteRGB.r - defaultColorRGBA.r) * t
        );
        const g = Math.round(
            defaultColorRGBA.g + (whiteRGB.g - defaultColorRGBA.g) * t
        );
        const b = Math.round(
            defaultColorRGBA.b + (whiteRGB.b - defaultColorRGBA.b) * t
        );

        const color = `rgb(${r}, ${g}, ${b})`;
        if (color === lastAppliedColor) return;
        lastAppliedColor = color;

        nav.style.color = color;

        console.log("[navColorTheme] Nav color ->", color, {
            themeValue: value
        });
    });

    // Compute absolute positions for each section
    function computeLayout() {
        const scrollY = window.scrollY || window.pageYOffset || 0;

        for (let i = 0; i < sections.length; i++) {
            const data = sections[i];
            const rect = data.el.getBoundingClientRect();

            const top = scrollY + rect.top;
            const bottom = scrollY + rect.bottom;

            data.top = top;
            data.bottom = bottom;
            // Start affecting the nav when section top hits navHeight below viewport top
            data.activateY = top - navHeight;
        }

        console.log(
            "[navColorTheme] Layout computed",
            sections.map((s, i) => ({
                i,
                top: Math.round(s.top),
                bottom: Math.round(s.bottom),
                activateY: Math.round(s.activateY),
                triggerWhite: s.triggerWhite
            }))
        );
    }

    function findActiveIndex(scrollY) {
        let activeIndex = -1;

        // Active while nav line (scrollY) is between activateY and bottom
        for (let i = 0; i < sections.length; i++) {
            const data = sections[i];
            if (scrollY >= data.activateY && scrollY < data.bottom) {
                activeIndex = i; // later sections win
            }
        }

        return activeIndex;
    }

    function updateForScroll(scrollY) {
        const index = findActiveIndex(scrollY);
        activeSectionIndex.set(index);

        let shouldBeWhite = false;
        if (index >= 0) {
            shouldBeWhite = sections[index].triggerWhite;
        }

        setThemeTarget(shouldBeWhite ? 1 : 0);
    }

    // Initial layout
    computeLayout();

    // Initial state based on current scroll and section under nav
    const initialScrollY = window.scrollY || window.pageYOffset || 0;
    console.log("[navColorTheme] Initial scrollY", initialScrollY);
    console.log("[navColorTheme] Initial nav inline color", {
        inlineColor: nav.style.color || "(none)"
    });

    updateForScroll(initialScrollY);

    // Recompute on resize (including responsive nav height)
    resize(() => {
        console.log("[navColorTheme] Resize detected");
        updateNavHeight();
        computeLayout();
        updateForScroll(window.scrollY || window.pageYOffset || 0);
    });

    // Scroll listener via Motion
    scroll((_, info) => {
        const y = info.y.current;
        updateForScroll(y);
    }, {
        axis: "y"
    });
}