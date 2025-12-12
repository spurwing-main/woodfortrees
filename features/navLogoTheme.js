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

import { scroll, animate } from "https://cdn.jsdelivr.net/npm/motion@12.23.26/+esm";

let sections = [];

export function init() {
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
