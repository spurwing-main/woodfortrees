// navColorTheme.js
// Usage:
//
// Per-section theme:
//   <section class="section_xxx" data-nav-theme="white">...</section>
//   <section class="section_xxx" data-nav-theme="black">...</section>
//
// - "white" / "black" are explicit.
// - No attribute => "black" (implicit default).
//
// The script looks at where the nav overlaps the page and picks the
// theme from the section under it.

import { scroll, animate, resize } from "https://cdn.jsdelivr.net/npm/motion@12.23.26/+esm";

let sections = [];
let cleanupFns = [];

let bounds = []; // [{ start, end, theme }]
let navLineOffset = 0; // px from viewport top to navRect.bottom

export function destroy() {
    cleanupFns.splice(0).forEach((fn) => {
        try {
            fn();
        } catch (err) {
            console.warn("navLogoTheme destroy", err);
        }
    });
    cleanupFns = [];
    sections = [];
}

export function init() {
    destroy();

    const nav = document.querySelector(".c-nav");
    if (!nav) return;

    const sectionNodes = Array.from(
        document.querySelectorAll("[class^='section_']")
    );
    if (!sectionNodes.length) return;

    // Build simple section meta based purely on data-nav-theme
    sections = sectionNodes.map((el) => {
        const attr = (el.getAttribute("data-nav-theme") || "").toLowerCase();
        let theme = "black"; // implicit default

        if (attr === "white" || attr === "black") {
            theme = attr;
        }

        return { el, theme };
    });

    if (!sections.length) return;

    let currentTheme = null;
    let currentAnim = null;

    function applyNavTheme(theme) {
        if (!theme) theme = "black";
        if (theme === currentTheme) return;
        currentTheme = theme;

        const targetColor =
            theme === "white" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)";

        currentAnim?.stop?.();
        currentAnim = animate(
            nav,
            { color: targetColor },
            {
                duration: 0.25,
                ease: "easeOut"
            }
        );
    }

    function measure() {
        if (!sections.length) return;

        // This is the viewport Y where the nav overlaps content.
        // If nav is fixed, this stays stable except on resize.
        navLineOffset = nav.getBoundingClientRect().bottom;

        const y = window.scrollY || window.pageYOffset || 0;
        bounds = sections
            .map(({ el, theme }) => {
                const rect = el.getBoundingClientRect();
                return {
                    start: y + rect.top,
                    end: y + rect.bottom,
                    theme
                };
            })
            .sort((a, b) => a.start - b.start);
    }

    function themeForLineYAbs(lineYAbs) {
        if (!bounds.length) return "black";

        if (lineYAbs <= bounds[0].start) return bounds[0].theme;
        const last = bounds[bounds.length - 1];
        if (lineYAbs >= last.end) return last.theme;

        // Find last bound whose start <= lineYAbs
        let lo = 0;
        let hi = bounds.length - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (bounds[mid].start <= lineYAbs) lo = mid + 1;
            else hi = mid - 1;
        }
        const idx = Math.max(0, lo - 1);
        const cur = bounds[idx];

        if (lineYAbs <= cur.end) return cur.theme;

        // In gaps between sections, pick the closer of current vs next.
        const next = bounds[idx + 1];
        if (!next) return cur.theme;
        const distToCur = Math.abs(lineYAbs - cur.end);
        const distToNext = Math.abs(next.start - lineYAbs);
        return distToCur <= distToNext ? cur.theme : next.theme;
    }

    function updateFromScrollY(scrollY) {
        const lineYAbs = scrollY + navLineOffset;
        applyNavTheme(themeForLineYAbs(lineYAbs));
    }

    measure();
    updateFromScrollY(window.scrollY || window.pageYOffset || 0);

    const cancelResize = resize(() => {
        measure();
        updateFromScrollY(window.scrollY || window.pageYOffset || 0);
    });
    if (typeof cancelResize === "function") cleanupFns.push(cancelResize);

    // Scroll-linked updates (vertical scroll only)
    const cancelScroll = scroll((_, info) => {
        updateFromScrollY(info.y.current);
    }, {
        axis: "y"
    });

    cleanupFns.push(cancelScroll);
}
