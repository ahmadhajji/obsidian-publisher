/**
 * Obsidian Publisher - Full-Text Search
 */

// Search state
let searchIndex = null;
let searchTimeout = null;

// DOM Elements
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

// Initialize search
async function initSearch() {
    try {
        const response = await fetch('/api/search');
        if (!response.ok) throw new Error('Failed to load search index');
        searchIndex = await response.json();
        console.log(`Search index loaded: ${searchIndex.length} notes`);
    } catch (error) {
        console.error('Failed to load search index:', error);
    }
}

// Perform search
function performSearch(query) {
    if (!searchIndex || !query.trim()) {
        hideSearchResults();
        return;
    }

    const normalizedQuery = query.toLowerCase().trim();
    const terms = normalizedQuery.split(/\s+/).filter(t => t.length > 1);

    if (terms.length === 0) {
        hideSearchResults();
        return;
    }

    // Score each note
    const results = searchIndex
        .map(note => {
            let score = 0;
            let matchedContent = '';

            const titleLower = note.title.toLowerCase();
            const contentLower = note.content;

            terms.forEach(term => {
                // Title matches are worth more
                if (titleLower.includes(term)) {
                    score += 10;
                    // Exact title match bonus
                    if (titleLower === term) {
                        score += 5;
                    }
                }

                // Content matches
                const contentMatches = (contentLower.match(new RegExp(escapeRegex(term), 'gi')) || []).length;
                score += contentMatches * 2;

                // Find snippet
                if (!matchedContent && contentLower.includes(term)) {
                    const index = contentLower.indexOf(term);
                    const start = Math.max(0, index - 40);
                    const end = Math.min(contentLower.length, index + term.length + 80);
                    matchedContent = '...' + contentLower.slice(start, end) + '...';
                }
            });

            return {
                ...note,
                score,
                matchedContent
            };
        })
        .filter(note => note.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10); // Top 10 results

    displayResults(results, terms);
}

// Display search results
function displayResults(results, terms) {
    if (results.length === 0) {
        searchResults.innerHTML = `
      <div class="search-no-results">
        No notes found
      </div>
    `;
    } else {
        searchResults.innerHTML = results
            .map(result => `
        <div class="search-result-item" data-note-id="${result.id}">
          <div class="search-result-title">${highlightTerms(result.title, terms)}</div>
          <div class="search-result-path">${result.path}</div>
          ${result.matchedContent ? `
            <div class="search-result-snippet">
              ${highlightTerms(result.matchedContent, terms)}
            </div>
          ` : ''}
        </div>
      `)
            .join('');

        // Add click handlers
        searchResults.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const noteId = item.dataset.noteId;
                const { state } = window.obsidianPublisher;
                const note = state.notes.find(n => n.id === noteId);
                if (note) {
                    // Use tabs manager to open the note
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
                }
            });
        });
    }

    showSearchResults();
}

// Highlight search terms in text
function highlightTerms(text, terms) {
    let result = escapeHtml(text);
    terms.forEach(term => {
        const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
        result = result.replace(regex, '<mark>$1</mark>');
    });
    return result;
}

// Show search results
function showSearchResults() {
    searchResults.classList.add('active');
}

// Hide search results
function hideSearchResults() {
    searchResults.classList.remove('active');
}

// Escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Event listeners
searchInput.addEventListener('input', (e) => {
    const query = e.target.value;

    // Debounce search
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        performSearch(query);
    }, 150);
});

searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) {
        performSearch(searchInput.value);
    }
});

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    if (!searchResults.contains(e.target) && e.target !== searchInput) {
        hideSearchResults();
    }
});

// Keyboard navigation
searchInput.addEventListener('keydown', (e) => {
    const items = searchResults.querySelectorAll('.search-result-item');
    const activeItem = searchResults.querySelector('.search-result-item:hover, .search-result-item.focused');

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
        if (focused) {
            focused.click();
        }
    } else if (e.key === 'Escape') {
        hideSearchResults();
        searchInput.blur();
    }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initSearch);
