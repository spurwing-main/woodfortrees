import { animate, stagger, hover } from "https://cdn.jsdelivr.net/npm/motion@latest/+esm";

let mounted = false;
let cleanupFns = [];
let transitionNonce = 0;

const QUERY_KEY = "expert";
const HOVER_DELAY = 2000; // 2s hover dwell before auto-switch

function addCleanup(fn) {
    cleanupFns.push(fn);
}

function cleanupAll() {
    cleanupFns.splice(0).forEach((fn) => {
        try {
            fn();
        } catch (err) {
            console.warn("expertTabs cleanup", err);
        }
    });
    mounted = false;
}

export function init() {
    const root = document.querySelector(".section_expert");
    if (!root) return;

    if (mounted) cleanupAll();
    mounted = true;

    const tabList = root.querySelector(".expert_text-list");
    const tabs = Array.from(root.querySelectorAll(".expert_text-item"));
    const panels = Array.from(root.querySelectorAll(".expert_content-item"));
    const contentList = root.querySelector(".expert_content-list");

    if (!tabs.length || !panels.length) {
        mounted = false;
        return;
    }

    const total = Math.min(tabs.length, panels.length);
    let activeIndex = parseInitialIndex(total);

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let REDUCE_MOTION = prefersReduced.matches;
    const onReduceChange = (e) => {
        REDUCE_MOTION = e.matches;
    };
    prefersReduced.addEventListener("change", onReduceChange);
    addCleanup(() => prefersReduced.removeEventListener("change", onReduceChange));

    const activeAnimations = new Map();

    if (tabList) {
        tabList.setAttribute("role", "tablist");
        tabList.setAttribute("aria-orientation", "vertical");
        tabList.setAttribute("aria-label", "Expertise tabs");
    }

    setupContentShell(contentList);
    setupTabs(tabs, total, activeIndex);
    setupPanels(panels, tabs, total, activeIndex);
    setContainerHeight(contentList, panels[activeIndex]);
    const onResize = () => setContainerHeight(contentList, panels[activeIndex]);
    window.addEventListener("resize", onResize, { passive: true });
    addCleanup(() => window.removeEventListener("resize", onResize));

    showPanel({
        nextIndex: activeIndex,
        prevIndex: null,
        panels,
        activeAnimations,
        contentList,
        REDUCE_MOTION,
        initial: true,
    });
    writeStateToUrl(activeIndex);

    function activate(nextIndex, { focusTab = false } = {}) {
        if (nextIndex === activeIndex || nextIndex < 0 || nextIndex >= total) return;

        const prevIndex = activeIndex;
        activeIndex = nextIndex;

        tabs.slice(0, total).forEach((tab, i) => {
            const selected = i === activeIndex;
            tab.setAttribute("aria-selected", selected ? "true" : "false");
            tab.setAttribute("tabindex", selected ? "0" : "-1");
            tab.classList.toggle("is-active", selected);
        });

        if (focusTab) {
            tabs[activeIndex]?.focus({ preventScroll: true });
        }

        writeStateToUrl(activeIndex);

        showPanel({
            nextIndex,
            prevIndex,
            panels,
            activeAnimations,
            contentList,
            REDUCE_MOTION,
            initial: false,
        });
    }

    function focusAndActivate(nextIndex) {
        const normalized = ((nextIndex % total) + total) % total;
        tabs.slice(0, total).forEach((tab, i) => {
            tab.setAttribute("tabindex", i === normalized ? "0" : "-1");
        });
        tabs[normalized]?.focus({ preventScroll: true });
        activate(normalized, { focusTab: true });
    }

    function setupTabs(t, count, current) {
        t.slice(0, count).forEach((tab, i) => {
            const tabId = tab.id || `expert-tab-${i + 1}`;
            tab.id = tabId;
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-selected", i === current ? "true" : "false");
            tab.setAttribute("tabindex", i === current ? "0" : "-1");
            tab.setAttribute("aria-controls", panelId(i));
            tab.dataset.index = String(i);
            tab.style.cursor = tab.style.cursor || "pointer";
            tab.style.touchAction = tab.style.touchAction || "manipulation";
            tab.style.WebkitTapHighlightColor =
                tab.style.WebkitTapHighlightColor || "rgba(0,0,0,0.08)";

            const onClick = (e) => {
                e.preventDefault();
                activate(i, { focusTab: true, reason: "click" });
            };

            // Use Motion's hover() for cleaner hover detection
            // Filters out fake touch-emulated hover events automatically
            let hoverTimer = null;
            const cancelHover = hover(tab, () => {
                hoverTimer = setTimeout(
                    () => activate(i, { reason: "hover" }),
                    HOVER_DELAY
                );
                // Return cleanup called on hover end
                return () => clearTimeout(hoverTimer);
            });

            const onKeyDown = (e) => {
                switch (e.key) {
                    case "ArrowRight":
                    case "ArrowDown":
                        e.preventDefault();
                        focusAndActivate(i + 1);
                        break;
                    case "ArrowLeft":
                    case "ArrowUp":
                        e.preventDefault();
                        focusAndActivate(i - 1);
                        break;
                    case "Home":
                        e.preventDefault();
                        focusAndActivate(0);
                        break;
                    case "End":
                        e.preventDefault();
                        focusAndActivate(count - 1);
                        break;
                    case "Enter":
                    case " ":
                        e.preventDefault();
                        activate(i, { focusTab: true });
                        break;
                    default:
                        break;
                }
            };

            const onFocus = () => {
                if (tab.matches(":focus-visible")) {
                    applyFocusRing(tab);
                }
            };
            const onBlur = () => clearFocusRing(tab);

            tab.addEventListener("click", onClick);
            tab.addEventListener("keydown", onKeyDown);
            tab.addEventListener("focus", onFocus);
            tab.addEventListener("blur", onBlur);

            addCleanup(() => {
                tab.removeEventListener("click", onClick);
                tab.removeEventListener("keydown", onKeyDown);
                tab.removeEventListener("focus", onFocus);
                tab.removeEventListener("blur", onBlur);
                cancelHover(); // Clean up hover gesture
                clearTimeout(hoverTimer);
            });
        });
    }

    function setupPanels(p, t, count, current) {
        p.slice(0, count).forEach((panel, i) => {
            const id = panelId(i);
            panel.id = panel.id || id;
            panel.setAttribute("role", "tabpanel");
            const labelledBy = t[i]?.id || `expert-tab-${i + 1}`;
            panel.setAttribute("aria-labelledby", labelledBy);

            const isActive = i === current;
            panel.setAttribute("aria-hidden", isActive ? "false" : "true");
            panel.style.pointerEvents = isActive ? "auto" : "none";
            panel.style.opacity = isActive ? "1" : "0";
            panel.style.visibility = isActive ? "visible" : "hidden";
            panel.style.background = panel.style.background || "#fff";
            panel.style.transformOrigin = panel.style.transformOrigin || "top center";
            panel.style.willChange = "opacity, transform, filter";
        });
    }
}

function parseInitialIndex(total) {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get(QUERY_KEY);
    if (fromUrl == null) return 0;
    const num = Number(fromUrl);
    if (!Number.isFinite(num)) return 0;
    const clamped = Math.max(0, Math.min(total - 1, Math.trunc(num)));
    return clamped;
}

function writeStateToUrl(index) {
    const url = new URL(window.location.href);
    url.searchParams.set(QUERY_KEY, String(index));
    history.replaceState({}, "", url);
}

function setContainerHeight(listEl, panel) {
    if (!listEl || !panel) return;
    const nextHeight = panel.scrollHeight;
    if (nextHeight) {
        listEl.style.minHeight = `${nextHeight}px`;
    }
}

function showPanel({
    prevIndex,
    nextIndex,
    panels,
    activeAnimations,
    contentList,
    REDUCE_MOTION,
    initial = false,
}) {
    const nonce = ++transitionNonce;
    const prevPanel = prevIndex == null ? null : panels[prevIndex];
    const nextPanel = panels[nextIndex];
    if (!nextPanel) return;

    stopAnimation(activeAnimations, prevPanel);
    stopAnimation(activeAnimations, nextPanel);

    setContainerHeight(contentList, nextPanel);

    nextPanel.style.visibility = "visible";
    nextPanel.style.pointerEvents = "auto";
    nextPanel.setAttribute("aria-hidden", "false");

    if (REDUCE_MOTION) {
        if (prevPanel && prevPanel !== nextPanel) {
            prevPanel.style.pointerEvents = "none";
            prevPanel.style.visibility = "hidden";
            prevPanel.style.opacity = "0";
            prevPanel.setAttribute("aria-hidden", "true");
        }
        nextPanel.style.opacity = "1";
        Array.from(nextPanel.children).forEach((child) => {
            child.style.filter = "";
            child.style.transform = "";
            child.style.opacity = "";
        });
        return;
    }

    const startIn = () => {
        if (nonce !== transitionNonce) return;
        const kids = Array.from(nextPanel.children);
        kids.forEach((child) => {
            child.style.willChange = "opacity, transform, filter";
        });

        nextPanel.style.opacity = "1";
        nextPanel.style.visibility = "visible";

        const inCtrl = animate(
            kids,
            {
                opacity: [0, 1],
                filter: ["blur(14px)", "blur(0px)"],
                transform: ["translateY(10px)", "translateY(0px)"],
            },
            {
                type: "spring",
                visualDuration: initial ? 0.4 : 0.35,
                bounce: 0.15,
                delay: stagger(0.06),
            }
        );

        activeAnimations.set(nextPanel, inCtrl);

        inCtrl.finished.finally(() => {
            if (activeAnimations.get(nextPanel) !== inCtrl) return;
            activeAnimations.delete(nextPanel);
            kids.forEach((child) => {
                child.style.willChange = "";
                child.style.filter = "";
                child.style.transform = "";
                child.style.opacity = "";
            });
        });
    };

    if (prevPanel && prevPanel !== nextPanel) {
        const prevKids = Array.from(prevPanel.children);
        prevKids.forEach((child) => {
            child.style.willChange = "opacity, transform, filter";
        });

        const outCtrl = animate(
            prevKids,
            {
                opacity: [1, 0],
                filter: ["blur(0px)", "blur(12px)"],
                transform: ["translateY(0px)", "translateY(-6px)"],
            },
            {
                type: "spring",
                visualDuration: 0.2,
                bounce: 0,
                delay: stagger(0.04),
            }
        );
        activeAnimations.set(prevPanel, outCtrl);
        outCtrl.finished.finally(() => {
            if (activeAnimations.get(prevPanel) !== outCtrl) return;
            prevPanel.style.pointerEvents = "none";
            prevPanel.style.visibility = "hidden";
            prevPanel.style.opacity = "0";
            prevPanel.setAttribute("aria-hidden", "true");
            activeAnimations.delete(prevPanel);
            prevKids.forEach((child) => {
                child.style.willChange = "";
                child.style.filter = "";
                child.style.transform = "";
                child.style.opacity = "";
            });
            if (nonce === transitionNonce) {
                startIn();
            }
        });
        return;
    }

    startIn();
}

function stopAnimation(activeAnimations, el) {
    if (!el) return;
    const ctrl = activeAnimations.get(el);
    if (ctrl?.cancel) ctrl.cancel();
    activeAnimations.delete(el);
}

function panelId(i) {
    return `expert-panel-${i + 1}`;
}

function setupContentShell(contentList) {
    if (!contentList) return;
    const cs = getComputedStyle(contentList);
    if (cs.position === "static") {
        contentList.style.position = "relative";
    }
    contentList.style.isolation = contentList.style.isolation || "isolate";
}

function applyFocusRing(el) {
    el.style.outline = "2px solid currentColor";
    el.style.outlineOffset = "6px";
    el.style.borderRadius = el.style.borderRadius || "12px";
}

function clearFocusRing(el) {
    el.style.outline = "";
    el.style.outlineOffset = "";
}

export function destroy() {
    cleanupAll();
}
