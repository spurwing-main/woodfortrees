import tippy from 'https://cdn.jsdelivr.net/npm/tippy.js@6/+esm';

// Load required CSS
function loadCSS(href) {
    if (!document.querySelector(`link[href="${href}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }
}

loadCSS('https://unpkg.com/tippy.js@6/dist/tippy.css');
loadCSS('https://unpkg.com/tippy.js@6/animations/scale.css');

export function init() {

    console.log('Tooltip feature loaded');

    document.querySelectorAll('[data-copy]').forEach((el) => {
        const tip = tippy(el, {
            content: 'Copy',
            placement: 'top',
            arrow: true,
            animation: 'scale',
            trigger: 'mouseenter focus',
            hideOnClick: false,
            onHidden(i) { i.setContent('Copy'); }
        });

        const show = (msg) => {
            tip.setContent(msg);
            tip.show();
            clearTimeout(el._ct);
            el._ct = setTimeout(() => { tip.hide(); tip.setContent('Copy'); }, 1000);
        };

        el.addEventListener('click', async (e) => {
            e.preventDefault();
            const text = (el.value ?? el.textContent ?? '').trim();
            if (!text) return show('Nothing to copy');
            try {
                await navigator.clipboard.writeText(text);
                show('Copied');
            } catch {
                show('Copy failed');
            }
        });
    });
}