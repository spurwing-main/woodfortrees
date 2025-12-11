// navColorTheme.js
// Usage notes:
//
// 1) Configure background colors that should force WHITE nav text.
//    Define **before** this script runs:
//
//    window.navWhiteBgColors = ["#ffffff", "#fdf2e9", "#f5f5f5"]
//    // or
//    window.sitekit = { navWhiteBgColors: ["#fff", "#fdf2e9"] }
//
// 2) Per-section override:
//    <section class="section_xxx" data-nav-theme="white">...</section>
//    <section class="section_xxx" data-nav-theme="black">...</section>
//
//    - "white" or "black" here beat the color matching.
//    - If no attribute + no color match => nav is black (implicit).

import { scroll, animate } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

let sections = [];

// Public inspector: which sections exist and what theme we computed.
export function getNavSectionThemes() {
    return sections.map((section, index) => ({
        index,
        theme: section.theme,
        bgColor: section.bgColor,
        element: section.el
    }));
}

function getConfiguredWhiteColors() {
    const w = window;

    // Preferred: sitekit.navWhiteBgColors
    const fromSitekit =
        w.sitekit && Array.isArray(w.sitekit.navWhiteBgColors)
            ? w.sitekit.navWhiteBgColors
            : null;

    // Fallback: plain global
    const fromGlobal =
        Array.isArray(w.navWhiteBgColors) ? w.navWhiteBgColors : null;

    if (fromSitekit && fromSitekit.length) return fromSitekit;
    if (fromGlobal && fromGlobal.length) return fromGlobal;

    // Hardcoded minimal default list
    return ["#ffffff", "#fff"];
}

// Parse CSS color into { r, g, b, a }
function parseCssColorToRgba(str) {
    if (!str) return null;
    let s = str.trim().toLowerCase();

    // rgb / rgba
    const rgbMatch = s.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/
    );
    if (rgbMatch) {
        const r = parseInt(rgbMatch[1], 10);
        const g = parseInt(rgbMatch[2], 10);
        const b = parseInt(rgbMatch[3], 10);
        const a =
            rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;

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

    // hex
    if (s[0] === "#") s = s.slice(1);

    if (s.length === 3 || s.length === 4) {
        // #rgb or #rgba -> expand
        const r = s[0] + s[0];
        const g = s[1] + s[1];
        const b = s[2] + s[2];
        let a = "ff";
        if (s.length === 4) a = s[3] + s[3];

        const rVal = parseInt(r, 16);
        const gVal = parseInt(g, 16);
        const bVal = parseInt(b, 16);
        const aVal = parseInt(a, 16) / 255;

        if (
            Number.isNaN(rVal) ||
            Number.isNaN(gVal) ||
            Number.isNaN(bVal) ||
            Number.isNaN(aVal)
        ) {
            return null;
        }

        return { r: rVal, g: gVal, b: bVal, a: aVal };
    }

    if (s.length === 6 || s.length === 8) {
        const r = parseInt(s.slice(0, 2), 16);
        const g = parseInt(s.slice(2, 4), 16);
        const b = parseInt(s.slice(4, 6), 16);
        let a = 1;

        if (s.length === 8) {
            const aByte = parseInt(s.slice(6, 8), 16);
            a = aByte / 255;
        }

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

    return null;
}

// Normalise to a simple key so hex/rgb/rgba all compare the same
function rgbaToKey(rgba) {
    const { r, g, b, a } = rgba;
    const aStr = a === 1 ? "1" : a.toFixed(3);
    return `${r},${g},${b},${aStr}`;
}

function normalizeColorToKey(str) {
    const rgba = parseCssColorToRgba(str);
    if (!rgba) return null;
    return rgbaToKey(rgba);
}

// Build Set of "bg color => should use WHITE nav text"
function buildWhiteBgSet() {
    const colors = getConfiguredWhiteColors();
    const set = new Set();

    for (let i = 0; i < colors.length; i++) {
        const key = normalizeColorToKey(colors[i]);
        if (key) set.add(key);
    }

    return set;
}

export function init() {
    const nav = document.querySelector(".c-nav");
    if (!nav) return;

    const sectionNodes = Array.from(
        document.querySelectorAll("[class^='section_']")
    );
    if (!sectionNodes.length) return;

    const whiteBgSet = buildWhiteBgSet();

    // Build simple section meta
    sections = sectionNodes.map((el) => {
        // 1) Explicit attribute wins
        const attr = (el.getAttribute("data-nav-theme") || "").toLowerCase();
        let themeFromAttr = null;
        if (attr === "white" || attr === "black") {
            themeFromAttr = attr;
        }

        // 2) Background color
        const bgColor = getComputedStyle(el).backgroundColor || "";
        const bgKey = normalizeColorToKey(bgColor);
        const themeFromBg =
            bgKey && whiteBgSet.has(bgKey) ? "white" : "black";

        const theme = themeFromAttr || themeFromBg;

        return {
            el,
            theme, // "white" | "black"
            bgColor
        };
    });

    if (!sections.length) return;

    let currentTheme = null;

    function applyNavTheme(theme) {
        if (!theme) theme = "black";
        if (theme === currentTheme) return;
        currentTheme = theme;

        const targetColor =
            theme === "white" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)";

        animate(
            nav,
            { color: targetColor },
            {
                duration: 0.25,
                ease: "easeOut"
            }
        );
    }

    function updateThemeFromScroll() {
        if (!sections.length) return;

        const navRect = nav.getBoundingClientRect();
        const lineY = navRect.bottom; // y where nav "sits" over content

        let activeIndex = -1;
        let closestIndex = -1;
        let closestDistance = Infinity;

        for (let i = 0; i < sections.length; i++) {
            const rect = sections[i].el.getBoundingClientRect();

            // If the nav line is inside this section, it's the active one.
            if (rect.top <= lineY && rect.bottom >= lineY) {
                activeIndex = i;
                break;
            }

            // Fallback: track section whose center is closest to nav line
            const center = rect.top + rect.height / 2;
            const dist = Math.abs(center - lineY);
            if (dist < closestDistance) {
                closestDistance = dist;
                closestIndex = i;
            }
        }

        if (activeIndex === -1) activeIndex = closestIndex;
        if (activeIndex < 0) return;

        applyNavTheme(sections[activeIndex].theme);
    }

    // Initial run
    updateThemeFromScroll();

    // Scroll-linked updates (vertical scroll only)
    scroll(() => {
        updateThemeFromScroll();
    }, {
        axis: "y"
    });
}

// Tiny API surface for loader: sitekit.navColorTheme.list()
export const api = {
    list: getNavSectionThemes
};