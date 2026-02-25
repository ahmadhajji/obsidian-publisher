/**
 * Obsidian Publisher - Search V2 (server-scored)
 */

let searchTimeout = null;
let activeController = null;

const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

function getActiveVault() {
    return window.obsidianPublisher?.state?.currentVault || null;
}

function getSearchEndpoint(query) {
    const vault = getActiveVault();
    if (vault?.id) {
        return `/api/vaults/${encodeURIComponent(vault.id)}/search?q=${encodeURIComponent(query)}`;
    }
    return `/api/search?q=${encodeURIComponent(query)}`;
}

function parseQueryTerms(query) {
    const terms = [];
    for (const token of query.toLowerCase().trim().split(/\s+/)) {
        if (!token) continue;
        if (/^[a-z]+:.+/.test(token)) continue;
        terms.push(token);
    }
    return terms;
}

async function performSearch(query) {
    if (!query.trim()) {
        hideSearchResults();
        return;
    }

    if (activeController) {
        activeController.abort();
        activeController = null;
    }

    const controller = new AbortController();
    activeController = controller;

    try {
        const response = await fetch(getSearchEndpoint(query), {
            credentials: 'include',
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error('Failed to search notes');
        }

        const results = await response.json();
        if (activeController !== controller) {
            return;
        }

        displayResults(Array.isArray(results) ? results : [], parseQueryTerms(query));
    } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Search failed:', error);
        displayResults([], []);
    } finally {
        if (activeController === controller) {
            activeController = null;
        }
    }
}

function displayResults(results, terms) {
    if (results.length === 0) {
        searchResults.innerHTML = '<div class="search-no-results">No notes found</div>';
    } else {
        searchResults.innerHTML = results
            .map((result) => {
                const snippet = buildSnippet(result.content, terms);
                return `
                    <div class="search-result-item" data-note-id="${escapeHtml(result.id)}">
                      <div class="search-result-title">${highlightTerms(result.title, terms)}</div>
                      <div class="search-result-path">${escapeHtml(result.path || '')}</div>
                      ${snippet ? `<div class="search-result-snippet">${highlightTerms(snippet, terms)}</div>` : ''}
                    </div>
                `;
            })
            .join('');

        searchResults.querySelectorAll('.search-result-item').forEach((item) => {
            item.addEventListener('click', () => {
                const noteId = item.dataset.noteId;
                const { state } = window.obsidianPublisher;
                const note = state.notes.find((n) => n.id === noteId || n.legacyId === noteId);
                if (!note) return;

                if (window.tabsManager) {
                    if (window._openInNewTab) {
                        window.tabsManager.openTab(note, true);
                        window._openInNewTab = false;
                    } else if (window.tabsManager.getActiveTab()) {
                        window.tabsManager.navigateInTab(note);
                    } else {
                        window.tabsManager.openTab(note);
                    }
                } else if (window.obsidianPublisher.displayNote) {
                    window.obsidianPublisher.displayNote(note);
                }

                hideSearchResults();
                searchInput.value = '';
            });
        });
    }

    showSearchResults();
}

function buildSnippet(content, terms) {
    const text = String(content || '');
    if (!text) return '';

    for (const term of terms) {
        const index = text.toLowerCase().indexOf(term.toLowerCase());
        if (index >= 0) {
            const start = Math.max(0, index - 40);
            const end = Math.min(text.length, index + term.length + 80);
            return `...${escapeHtml(text.slice(start, end))}...`;
        }
    }

    return escapeHtml(text.slice(0, 120));
}

function highlightTerms(text, terms) {
    let result = escapeHtml(text || '');
    terms.forEach((term) => {
        if (!term) return;
        const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
        result = result.replace(regex, '<mark>$1</mark>');
    });
    return result;
}

function showSearchResults() {
    searchResults.classList.add('active');
}

function hideSearchResults() {
    searchResults.classList.remove('active');
}

function escapeRegex(string) {
    return String(string || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        performSearch(query);
    }, 180);
});

searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) {
        performSearch(searchInput.value);
    }
});

document.addEventListener('click', (e) => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
        hideSearchResults();
    }
});

searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('.search-result-item');
    const activeItem = searchResults.querySelector('.search-result-item.focused');

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!activeItem && items.length > 0) {
            items[0].classList.add('focused');
        } else if (activeItem) {
            const index = Array.from(items).indexOf(activeItem);
            activeItem.classList.remove('focused');
            if (index < items.length - 1) {
                items[index + 1].classList.add('focused');
            }
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (activeItem) {
            const index = Array.from(items).indexOf(activeItem);
            activeItem.classList.remove('focused');
            if (index > 0) {
                items[index - 1].classList.add('focused');
            }
        }
    } else if (e.key === 'Enter') {
        const focused = searchResults.querySelector('.search-result-item.focused');
        if (focused) focused.click();
    } else if (e.key === 'Escape') {
        hideSearchResults();
        searchInput.blur();
    }
});
