function getKit() {
    const w = window

    if (!w.sitekit) {
        w.sitekit = {}
    }

    if (!w.sitekit.features) {
        w.sitekit.features = {}
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
]

let bootStarted = false

async function boot() {
    const kit = getKit()

    if (bootStarted) return
    bootStarted = true

    await waitForDomReady()

    for (const feature of featureList) {
        try {
            const mod = await feature.load()

            // store all exports on window.sitekit.features[name]
            kit.features[feature.name] = mod

            // auto-init if available
            if (typeof mod.init === 'function') {
                mod.init()
            }
        } catch (error) {
            console.warn('sitekit: feature failed', feature.name, error)
        }
    }
}

// start booting right away
boot()

// expose boot on window for manual re-run if needed
getKit().boot = boot

export { boot }