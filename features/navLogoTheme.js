// navColorTheme.js
import {
    scroll,
    motionValue,
    resize,
    animate
} from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

let sections = [];

/**
 * Simple API: returns the sections and their computed theme
 * theme: "black" | "white"  -> nav text color
 * color: { r, g, b, a } | null -> effective background behind section
 */
export function getNavSectionThemes() {
    return sections.map((section, index) => ({
        index,
        theme: section.theme,
        color: section.color,
        element: section.el
    }));
}

export function init() {
    const nav = document.querySelector(".c-nav");
    if (!nav) return;

    const sectionNodes = Array.from(
        document.querySelectorAll("[class^='section_']")
    );
    if (!sectionNodes.length) return;

    // 0 = black, 1 = white
    const navTheme = motionValue(0);

    function setTheme(target) {
        navTheme.stop();
        animate(navTheme, target, {
            duration: 0.25,
            ease: "easeOut"
        });
    }

    let lastColor = "";
    navTheme.on("change", (value) => {
        const t = value < 0 ? 0 : value > 1 ? 1 : value;
        const channel = Math.round(255 * t);
        const color = `rgb(${channel}, ${channel}, ${channel})`;

        if (color === lastColor) return;
        lastColor = color;
        nav.style.color = color;
    });

    function hexToRgb(hex) {
        if (!hex) return null;
        let h = hex.trim().toLowerCase();
        if (h[0] === "#") h = h.slice(1);

        if (h.length === 3) {
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
        return { r, g, b, a: 1 };
    }

    function parseCssColorToRgba(str) {
        if (!str) return null;
        const s = str.trim().toLowerCase();

        const rgbMatch = s.match(
            /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/
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

        if (s.startsWith("#")) {
            return hexToRgb(s);
        }

        return null;
    }

    // Walk up until we find a non-transparent background
    function getEffectiveBackgroundRgba(el) {
        let current = el;

        while (current && current !== document.documentElement) {
            const bgStr = getComputedStyle(current).backgroundColor;
            const rgba = parseCssColorToRgba(bgStr);

            if (rgba && rgba.a > 0) return rgba;
            current = current.parentElement;
        }

        return null;
    }

    function isDarkColor(rgba) {
        const { r, g, b } = rgba;
        const luminance =
            (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return luminance < 0.4;
    }

    // Build section list with theme "black" or "white" for nav text
    sections = sectionNodes.map((el) => {
        const rgba = getEffectiveBackgroundRgba(el);

        // Default: transparent / unknown -> black nav text
        let theme = "black";

        if (rgba && isDarkColor(rgba)) {
            theme = "white";
        }

        return {
            el,
            theme,
            color: rgba,
            top: 0,
            bottom: 0,
            activateY: 0
        };
    });

    let navHeight = 0;
    function updateNavHeight() {
        const rootStyles = getComputedStyle(
            document.documentElement
        );
        const raw = rootStyles.getPropertyValue("--nav--height") || "0";
        const parsed = parseFloat(raw);
        navHeight = Number.isFinite(parsed) ? parsed : 0;
    }

    function computeLayout() {
        const scrollY =
            window.scrollY || window.pageYOffset || 0;

        for (let i = 0; i < sections.length; i++) {
            const data = sections[i];
            const rect = data.el.getBoundingClientRect();

            const top = scrollY + rect.top;
            const bottom = scrollY + rect.bottom;

            data.top = top;
            data.bottom = bottom;
            data.activateY = top - navHeight;
        }
    }

    function findActiveIndex(scrollY) {
        let activeIndex = -1;

        for (let i = 0; i < sections.length; i++) {
            const data = sections[i];
            if (scrollY >= data.activateY && scrollY < data.bottom) {
                activeIndex = i;
            }
        }

        return activeIndex;
    }

    function updateForScroll(scrollY) {
        const index = findActiveIndex(scrollY);
        const theme =
            index >= 0 ? sections[index].theme : "black";
        setTheme(theme === "white" ? 1 : 0);
    }

    updateNavHeight();
    computeLayout();
    updateForScroll(
        window.scrollY || window.pageYOffset || 0
    );

    resize(() => {
        updateNavHeight();
        computeLayout();
        updateForScroll(
            window.scrollY || window.pageYOffset || 0
        );
    });

    scroll(
        (_, info) => {
            updateForScroll(info.y.current);
        },
        { axis: "y" }
    );
}

// navColorTheme.js
// ... (everything we had before: getNavSectionThemes, init, etc.)

export const api = {
    list: getNavSectionThemes,
}