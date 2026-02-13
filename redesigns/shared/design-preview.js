(function () {
    const root = document.documentElement;
    const concept = root.dataset.designConcept || '';

    if (!concept) {
        return;
    }

    const basePath = `/__design/${concept}`;
    const escapedBase = basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const noteRoute = new RegExp(`^${escapedBase}/notes/(.+)$`);

    window.__DESIGN_PREVIEW__ = {
        concept,
        basePath
    };

    const initialMatch = window.location.pathname.match(noteRoute);
    if (initialMatch && !window.location.hash) {
        try {
            window.location.hash = decodeURIComponent(initialMatch[1]);
        } catch {
            window.location.hash = initialMatch[1];
        }
    }

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);

    function rewritePath(pathOrUrl) {
        if (typeof pathOrUrl !== 'string') {
            return pathOrUrl;
        }

        if (pathOrUrl.startsWith('/notes/')) {
            return `${basePath}${pathOrUrl}`;
        }

        return pathOrUrl;
    }

    window.history.pushState = function pushState(state, title, pathOrUrl) {
        return originalPushState(state, title, rewritePath(pathOrUrl));
    };

    window.history.replaceState = function replaceState(state, title, pathOrUrl) {
        return originalReplaceState(state, title, rewritePath(pathOrUrl));
    };
})();
