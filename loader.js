function getKit() {
    const w = window
    if (!w.sitekit) {
        w.sitekit = {}
    }
    if (!w.sitekit.features) {
        w.sitekit.features = {}
    }
    if (!w.sitekit.utils) {
        w.sitekit.utils = {}
    }
    return w.sitekit
}

function waitForDomReady() {
    const state = document.readyState
    if (state === 'interactive' || state === 'complete') {
        return Promise.resolve()
    }
    return new Promise((resolve) => {
        document.addEventListener(
            'DOMContentLoaded',
            () => {
                resolve()
            },
            { once: true }
        )
    })
}

// list of features to load
// name → dynamic import
const featureList = [
    { name: 'tooltip', load: () => import('./features/footerTooltip.js') },
    { name: 'aboutHero', load: () => import('./features/aboutHero.js') },
    { name: 'aboutTeam', load: () => import('./features/aboutTeam.js') },
    { name: 'expertTabs', load: () => import('./features/expertTabs.js') },
    { name: 'testimonialSlider', load: () => import('./features/testimonialSlider.js') },
    { name: 'howSlider', load: () => import('./features/howSlider.js') },
    { name: 'contactForm', load: () => import('./features/contactForm.js') },
    { name: 'homeHoz', load: () => import('./features/homeHoz.js') },
    { name: 'navLogoTheme', load: () => import('./features/navLogoTheme.js') },
    { name: 'pastaLlax', load: () => import('./features/pastaLlax.js') },
    // e.g. { name: 'navColorTheme', load: () => import('./features/navColorTheme.js') },
]

// list of utils to load
const utilList = [
    { name: 'breakpoints', load: () => import('./utils/breakpoints.js') },
]

let bootStarted = false

async function boot() {
    const kit = getKit()

    if (bootStarted) return
    bootStarted = true

    await waitForDomReady()

    // Utils
    for (const util of utilList) {
        try {
            const mod = await util.load()
            const utilExports = { ...mod }

            if (typeof mod.init === 'function') {
                const maybeStop = mod.init()
                if (typeof maybeStop === 'function') {
                    utilExports.stop = maybeStop
                }
            }

            kit.utils[util.name] = utilExports

            // mount util api if present: sitekit[util.name]
            if (mod.api && typeof mod.api === 'object') {
                kit[util.name] = mod.api
            }
        } catch (error) {
            console.warn('sitekit util failed', util.name, error?.message || error)
        }
    }

    // Features
    for (const feature of featureList) {
        try {
            const mod = await feature.load()

            // store all exports on window.sitekit.features[name]
            kit.features[feature.name] = mod

            // auto-init if available
            if (typeof mod.init === 'function') {
                mod.init()
            }

            // if module exposes an api object, mount to sitekit[feature.name]
            if (mod.api && typeof mod.api === 'object') {
                kit[feature.name] = mod.api
            }
        } catch (error) {
            console.warn('sitekit feature failed', feature.name, error?.message || error)
        }
    }
}

// start booting right away
boot()

// expose boot on window for manual re-run if needed
getKit().boot = boot

export { boot }