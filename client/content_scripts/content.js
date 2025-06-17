console.log("WordWise content script loaded.");

const managedInputs = new WeakSet();
const inputIgnoredSuggestions = new WeakMap(); // Store ignored suggestions per input
const inputHighlightOverlay = new WeakMap(); // Store highlight overlay per input
const managedIndicators = new Set(); // Keep track of all created indicators

function createHighlightOverlay(input) {
    const overlay = document.createElement('div');
    overlay.className = 'wordwise-highlight-overlay';
    overlay.style.position = 'absolute';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483645';
    document.body.appendChild(overlay);
    inputHighlightOverlay.set(input, overlay);
    return overlay;
}

function updateHighlightOverlay(input) {
    const overlay = inputHighlightOverlay.get(input);
    if (!overlay) return;
    
    const rect = input.getBoundingClientRect();
    overlay.style.top = `${rect.top + window.scrollY}px`;
    overlay.style.left = `${rect.left + window.scrollX}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
}

function clearHighlight() {
    const highlights = document.querySelectorAll('.wordwise-text-highlight');
    highlights.forEach(h => h.remove());
}

function highlightText(input, start, end) {
    clearHighlight();
    const overlay = inputHighlightOverlay.get(input);
    if (!overlay) return;

    if (input.isContentEditable) {
        // Use Range API for contenteditable elements
        try {
            const range = document.createRange();
            const textNodes = [];
            const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while(node = walker.nextNode()) {
                textNodes.push(node);
            }

            let charCount = 0;
            let startNode, startOffset, endNode, endOffset;

            for (const textNode of textNodes) {
                const textLength = textNode.textContent.length;
                if (startNode === undefined && charCount + textLength >= start) {
                    startNode = textNode;
                    startOffset = start - charCount;
                }
                if (endNode === undefined && charCount + textLength >= end) {
                    endNode = textNode;
                    endOffset = end - charCount;
                }
                charCount += textLength;
                if (startNode && endNode) break;
            }

            if (!startNode || !endNode) return;

            range.setStart(startNode, startOffset);
            range.setEnd(endNode, endOffset);

            const rects = range.getClientRects();
            const overlayRect = overlay.getBoundingClientRect();

            for (const rect of rects) {
                const highlight = document.createElement('div');
                highlight.className = 'wordwise-text-highlight';
                highlight.style.position = 'absolute';
                highlight.style.backgroundColor = 'rgba(220, 53, 69, 0.1)';
                highlight.style.top = `${rect.top - overlayRect.top}px`;
                highlight.style.left = `${rect.left - overlayRect.left}px`;
                highlight.style.width = `${rect.width}px`;
                highlight.style.height = `${rect.height}px`;
                overlay.appendChild(highlight);
            }
        } catch (e) {
            console.error("WordWise: Error highlighting contenteditable", e);
        }
        return;
    }
    
    // For textarea, use a mirror element
    const mirror = document.createElement('div');
    const style = window.getComputedStyle(input);
    const properties = [
        'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 
        'textAlign', 'textTransform', 'wordSpacing', 'textIndent', 'whiteSpace', 
        'wordWrap', 'wordBreak', 'boxSizing', 'paddingTop', 'paddingRight', 
        'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 
        'borderBottomWidth', 'borderLeftWidth'
    ];
    properties.forEach(prop => {
        mirror.style[prop] = style[prop];
    });

    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.left = '-9999px';
    mirror.style.top = '-9999px';
    mirror.style.width = `${input.clientWidth}px`;
    mirror.style.height = 'auto';

    const text = input.value || input.innerText;
    
    const beforeSpan = document.createElement('span');
    beforeSpan.textContent = text.substring(0, start);
    
    const highlightSpan = document.createElement('span');
    highlightSpan.textContent = text.substring(start, end);

    mirror.appendChild(beforeSpan);
    mirror.appendChild(highlightSpan);
    document.body.appendChild(mirror);
    
    const rects = highlightSpan.getClientRects();
    const mirrorRect = mirror.getBoundingClientRect();
    
    for (const rect of rects) {
        const highlight = document.createElement('div');
        highlight.className = 'wordwise-text-highlight';
        highlight.style.position = 'absolute';
        highlight.style.backgroundColor = 'rgba(220, 53, 69, 0.1)';
        
        const top = rect.top - mirrorRect.top - input.scrollTop;
        const left = rect.left - mirrorRect.left - input.scrollLeft;

        // Only add highlight if it's within the visible area of the input
        if (top >= 0 && top < input.clientHeight && left >=0 && left < input.clientWidth) {
             highlight.style.top = `${top}px`;
             highlight.style.left = `${left}px`;
             highlight.style.width = `${rect.width}px`;
             highlight.style.height = `${rect.height}px`;
             overlay.appendChild(highlight);
        }
    }
    
    document.body.removeChild(mirror);
}

function updateIgnoredSuggestionsPositions(input, changeStart, changeEnd, lengthDiff) {
    const ignoredSet = inputIgnoredSuggestions.get(input);
    if (!ignoredSet) return;

    const updatedIgnored = new Set();
    const text = input.value || input.innerText;

    ignoredSet.forEach(suggestionId => {
        const [message, start, end, content] = suggestionId.split('|');
        let newStart = parseInt(start);
        let newEnd = parseInt(end);
        
        // If change was before this suggestion
        if (changeEnd <= newStart) {
            newStart += lengthDiff;
            newEnd += lengthDiff;
        }
        // If change overlapped with this suggestion
        else if (changeStart < newEnd) {
            // Remove suggestion if its content changed
            const newContent = text.substring(newStart, newEnd + lengthDiff);
            if (newContent !== content) return;
            
            // Adjust end position if change was within suggestion
            if (changeStart > newStart) {
                newEnd += lengthDiff;
            }
        }
        
        // Only keep suggestion if positions are still valid
        if (newStart >= 0 && newEnd <= text.length) {
            updatedIgnored.add(`${message}|${newStart}|${newEnd}|${text.substring(newStart, newEnd)}`);
        }
    });

    inputIgnoredSuggestions.set(input, updatedIgnored);
}

function findAndManageTextInputs() {
    // Cleanup stale indicators for inputs that are no longer visible or gone from the DOM
    managedIndicators.forEach(indicator => {
        const input = findInputForIndicator(indicator);
        if (!input || !document.body.contains(input) || !isElementVisible(input)) {
            indicator.remove();
            const boxId = `wordwise-suggestion-box-${indicator.dataset.id}`;
            const box = document.getElementById(boxId);
            if (box) box.remove();
            managedIndicators.delete(indicator);
        }
    });

    const textInputs = document.querySelectorAll('textarea, [contenteditable="true"]');
    
    textInputs.forEach(input => {
        if (managedInputs.has(input) || !isElementVisible(input)) {
            return;
        }

        managedInputs.add(input);
        inputIgnoredSuggestions.set(input, new Set());
        createHighlightOverlay(input);
        
        const indicator = createIndicator();
        managedIndicators.add(indicator);
        positionIndicator(indicator, input);
        input.wordwiseIndicator = indicator;

        // Track input changes for position updates
        let lastText = input.value || input.innerText;
        const handleTextChange = () => {
            const newText = input.value || input.innerText;
            if (newText === lastText) return;
            
            // Find the change
            let i = 0;
            while (i < Math.min(lastText.length, newText.length) && lastText[i] === newText[i]) i++;
            
            const changeStart = i;
            const oldEnd = lastText.length;
            const newEnd = newText.length;
            const lengthDiff = newEnd - oldEnd;
            
            updateIgnoredSuggestionsPositions(input, changeStart, changeStart + Math.abs(lengthDiff), lengthDiff);
            updateHighlightOverlay(input);
            lastText = newText;
        };

        input.addEventListener('input', handleTextChange);
        input.addEventListener('scroll', () => updateHighlightOverlay(input));
        window.addEventListener('resize', () => updateHighlightOverlay(input));
        window.addEventListener('scroll', () => updateHighlightOverlay(input));

        const debouncedAnalysis = debounce(() => {
            const text = input.value || input.innerText;
            if (text.trim().length < 5) {
                setIndicatorState(indicator, 'idle');
                indicator.wordwiseResponse = null;
                const oldBox = document.getElementById(`wordwise-suggestion-box-${indicator.dataset.id}`);
                if(oldBox) oldBox.remove();
                return;
            }

            setIndicatorState(indicator, 'loading');

            chrome.runtime.sendMessage({
                type: 'analyzeText',
                payload: { text, platform: window.location.hostname, field: getFieldIdentifier(input) }
            }, (response) => {
                if (chrome.runtime.lastError || !response || !response.suggestions) {
                    setIndicatorState(indicator, 'error');
                    indicator.wordwiseResponse = null;
                    return;
                }
                
                // Filter out ignored suggestions before counting
                const ignoredSet = inputIgnoredSuggestions.get(input);
                const filteredSuggestions = response.suggestions.filter(s => {
                    if (s.type === 'emotion_analysis' || s.type === 'readability') return true;
                    const suggestionId = `${s.message}|${s.start}|${s.end}|${text.substring(s.start, s.end)}`;
                    return !ignoredSet.has(suggestionId);
                });
                
                const suggestionCount = filteredSuggestions.filter(s => 
                    s.type !== 'emotion_analysis' && s.type !== 'readability'
                ).length;
                
                indicator.wordwiseResponse = { ...response, suggestions: filteredSuggestions };
                setIndicatorState(indicator, 'suggestions', suggestionCount);

                // Check if suggestion box should be open
                const oldBox = document.getElementById(`wordwise-suggestion-box-${indicator.dataset.id}`);
                if (oldBox && oldBox.dataset.isOpen === 'true') {
                    displaySuggestions(input, filteredSuggestions, indicator);
                }
            });
        }, 700);

        // Store reference to debounced analysis function
        input._wordwiseAnalysis = debouncedAnalysis;

        input.addEventListener('input', debouncedAnalysis);
        input.addEventListener('wordwise-reanalyze', debouncedAnalysis);
    });
}

function createIndicator() {
    const indicatorId = `indicator-${Date.now()}-${Math.random()}`;
    const indicator = document.createElement('div');
    indicator.className = 'wordwise-indicator';
    indicator.dataset.id = indicatorId;
    setIndicatorState(indicator, 'idle');
    document.body.appendChild(indicator);

    indicator.addEventListener('click', (e) => {
        e.stopPropagation();

        // If in error state, it's likely a login issue. Try to open popup.
        if (indicator.classList.contains('error')) {
            // This message is handled by background.js to open the popup
            chrome.runtime.sendMessage({ type: 'openPopup' });
            return;
        }

        const boxId = `wordwise-suggestion-box-${indicator.dataset.id}`;
        const oldBox = document.getElementById(boxId);
        if (oldBox) {
            oldBox.remove();
            return;
        }
        if (indicator.wordwiseResponse) {
            const associatedInput = findInputForIndicator(indicator);
            if (associatedInput) {
                displaySuggestions(associatedInput, indicator.wordwiseResponse.suggestions, indicator);
            }
        }
    });

    return indicator;
}

function setIndicatorState(indicator, state, count = 0) {
    indicator.innerHTML = ''; // Clear previous content
    indicator.className = 'wordwise-indicator';
    switch (state) {
        case 'idle':
            indicator.classList.add('idle');
            // Uses CSS to create a blue dot.
            break;
        case 'loading':
            indicator.classList.add('loading');
            break;
        case 'suggestions':
            if (count > 0) {
                indicator.classList.add('has-suggestions');
                indicator.textContent = count;
            } else {
                 setIndicatorState(indicator, 'no-suggestions');
            }
            break;
        case 'no-suggestions':
            indicator.classList.add('no-suggestions');
             // Uses CSS to create a blue dot.
            break;
        case 'error':
            indicator.classList.add('error');
            indicator.textContent = '!';
            break;
    }
}

function displaySuggestions(inputElement, suggestions, indicator) {
    const oldbox = document.getElementById(`wordwise-suggestion-box-${indicator.dataset.id}`);
    if(oldbox) oldbox.remove();
    const ignoredSuggestions = inputIgnoredSuggestions.get(inputElement);
    const container = document.createElement('div');
    container.id = `wordwise-suggestion-box-${indicator.dataset.id}`;
    container.dataset.isOpen = 'true'; // Mark the box as open
    
    const renderContent = (currentSuggestions) => {
        let html = `<div class="wordwise-suggestion-box">
                        <button class="wordwise-close-btn" title="Close">×</button>`;
        
        const emotionAnalysis = currentSuggestions.find(s => s.type === 'emotion_analysis');
        if (emotionAnalysis && emotionAnalysis.emotions.length > 0) {
            html += `<h3>Tone Analysis</h3><div class="wordwise-emotions-list">`;
            html += emotionAnalysis.emotions.map(e => e.label).join(', ');
            html += `</div>`;
        }

        const readabilityAnalysis = currentSuggestions.find(s => s.type === 'readability');
        if (readabilityAnalysis) {
            html += `<h3>Readability</h3><div class="wordwise-readability-score">${readabilityAnalysis.message}</div>`;
        }

        const otherSuggestions = currentSuggestions.filter(s => s.type !== 'emotion_analysis' && s.type !== 'readability');
        if (otherSuggestions.length > 0) {
            if((emotionAnalysis && emotionAnalysis.emotions.length > 0) || readabilityAnalysis) html += '<hr>';
            html += `<h3>Suggestions</h3><ul>`;
            otherSuggestions.forEach(s => {
                const suggestionId = `${s.message}|${s.start}|${s.end}|${(inputElement.value || inputElement.innerText).substring(s.start, s.end)}`;
                if (ignoredSuggestions.has(suggestionId)) return;

                const originalText = (inputElement.value || inputElement.innerText).substring(s.start, s.end);
                html += `<li data-suggestion-type="${s.type}" data-suggestion-id="${suggestionId}" 
                            data-start="${s.start}" data-end="${s.end}">
                        <button class="wordwise-ignore-btn" title="Ignore suggestion">×</button>
                        <div class="wordwise-suggestion-message"><b>${s.type.toUpperCase()}:</b> ${s.message}</div>`;
                if (s.replacements && s.replacements.length > 0) {
                    html += `<div class="wordwise-replacements">`;
                    s.replacements.slice(0, 3).forEach(r => {
                        html += `<button class="wordwise-replacement-btn" 
                            data-start="${s.start}" 
                            data-end="${s.end}"
                            data-original-text="${originalText}" 
                            data-replacement="${r}">${r}</button>`;
                    });
                    html += `</div>`;
                }
                // Add to dictionary button for spelling errors
                if (s.category === 'TYPOS' || s.ruleId === 'MORFOLOGIK_RULE_EN_US') {
                    const misspelledWord = (inputElement.value || inputElement.innerText).substring(s.start, s.end);
                    html += `<div class="wordwise-dictionary-actions">
                                <button class="wordwise-add-dict-btn" data-word="${misspelledWord}">Add "<span>${misspelledWord}</span>" to dictionary</button>
                             </div>`;
                }
                html += `</li>`;
            });
            html += `</ul>`;
        }
        
        html += '</div>';
        container.innerHTML = html;
        if (!document.body.contains(container)) {
            document.body.appendChild(container);
        }
        
        const suggestionBox = container.querySelector('.wordwise-suggestion-box');
        positionSuggestionBox(suggestionBox, inputElement);
        attachSuggestionListeners(container, inputElement, indicator, otherSuggestions, ignoredSuggestions, renderContent);
    };
    
    renderContent(suggestions);
}

function attachSuggestionListeners(container, inputElement, indicator, suggestions, ignoredSuggestions, renderCallback) {
    container.querySelector('.wordwise-close-btn').addEventListener('click', () => {
        container.remove();
        clearHighlight();
    });

    // Add hover listeners for highlighting
    container.querySelectorAll('li').forEach(li => {
        const start = parseInt(li.dataset.start);
        const end = parseInt(li.dataset.end);
        
        li.addEventListener('mouseenter', () => highlightText(inputElement, start, end));
        li.addEventListener('mouseleave', clearHighlight);
    });

    container.querySelectorAll('.wordwise-replacement-btn').forEach(button => {
        const start = parseInt(button.dataset.start);
        const end = parseInt(button.dataset.end);
        
        button.addEventListener('mouseenter', () => highlightText(inputElement, start, end));
        button.addEventListener('mouseleave', clearHighlight);
        
        button.addEventListener('click', (event) => {
            const { replacement } = event.target.dataset;
            const text = inputElement.value || inputElement.innerText;
            const newText = text.substring(0, start) + replacement + text.substring(end);
            
            if (inputElement.value !== undefined) {
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                nativeSetter.call(inputElement, newText);
            } else {
                inputElement.innerText = newText;
            }
            
            // Trigger immediate reanalysis
            const debouncedAnalysis = inputElement._wordwiseAnalysis;
            if (debouncedAnalysis) {
                clearTimeout(debouncedAnalysis.timeout); // Clear any pending analysis
                debouncedAnalysis(); // Run analysis immediately
            }
            
            clearHighlight();
            inputElement.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' || e.key === 'Delete') {
                    e.stopImmediatePropagation(); // Stop other listeners from running
                }
            }, { capture: true });
        });
    });

    container.querySelectorAll('.wordwise-add-dict-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const word = event.currentTarget.dataset.word;
            button.textContent = 'Adding...';
            button.disabled = true;

            chrome.runtime.sendMessage({ type: 'addWordToDictionary', payload: { word } }, (response) => {
                if (chrome.runtime.lastError || !response || !response.success) {
                    console.error('Failed to add word to dictionary:', chrome.runtime.lastError || response.error);
                    button.textContent = `Failed to add.`;
                    // Optionally revert button text after a delay
                    setTimeout(() => {
                        event.currentTarget.querySelector('span').textContent = word;
                        button.disabled = false;
                    }, 2000);
                } else {
                    console.log('Word added to dictionary, re-analyzing...');
                    // Trigger re-analysis
                    inputElement.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                    // Close the suggestion box
                    container.remove();
                }
            });
        });
    });

    container.querySelectorAll('.wordwise-ignore-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const suggestionId = event.target.closest('li').dataset.suggestionId;
            const inputIgnoredSet = inputIgnoredSuggestions.get(inputElement);
            inputIgnoredSet.add(suggestionId);
            
            // Filter suggestions and update display
            const currentSuggestions = suggestions.filter(s => {
                const id = `${s.message}|${s.start}|${s.end}`;
                return !inputIgnoredSet.has(id);
            });
            
            setIndicatorState(
                indicator, 
                'suggestions', 
                currentSuggestions.filter(s => s.type !== 'emotion_analysis' && s.type !== 'readability').length
            );
            renderCallback(currentSuggestions);
        });
    });
}

function applyReplacement(element, original, replacement) {
    const currentText = element.value !== undefined ? element.value : element.innerText;
    
    // Replace only the first instance to avoid unintended changes
    const newText = currentText.replace(original, replacement);

    if (element.value !== undefined) {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
        nativeSetter.call(element, newText);
        // Dispatch input event to trigger re-analysis and other listeners
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    } else {
        element.innerText = newText;
        // For contenteditable, dispatch a custom event and also an input event
        element.dispatchEvent(new CustomEvent('wordwise-reanalyze', { bubbles: true }));
        element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    }
    element.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
            e.stopImmediatePropagation(); // Stop other listeners from running
        }
    }, { capture: true });
}

function positionSuggestionBox(box, input) {
    const inputRect = input.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const spaceBelow = window.innerHeight - inputRect.bottom;
    
    if (spaceBelow < boxRect.height && inputRect.top > boxRect.height) {
        // Not enough space below, place above
        box.style.top = `${inputRect.top + window.scrollY - boxRect.height - 5}px`;
    } else {
        // Place below
        box.style.top = `${inputRect.bottom + window.scrollY + 5}px`;
    }
    box.style.left = `${inputRect.left + window.scrollX}px`;
}

function positionIndicator(indicator, input) {
    const rect = input.getBoundingClientRect();
    indicator.style.top = `${rect.top + window.scrollY + 5}px`;
    indicator.style.left = `${rect.right + window.scrollX - 25}px`;
}

function findInputForIndicator(indicator) {
    for (const input of document.querySelectorAll('textarea, [contenteditable="true"]')) {
        if (input.wordwiseIndicator === indicator) return input;
    }
    return null;
}

function isElementVisible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length > 0);
}

function getFieldIdentifier(input) {
    return input.getAttribute('aria-label') || input.id || input.name || 'unknown';
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

injectCss();
setInterval(findAndManageTextInputs, 1500);
findAndManageTextInputs();

function injectCss() {
    const styleId = 'wordwise-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
        .wordwise-indicator {
            position: absolute;
            z-index: 2147483646;
            width: 22px;
            height: 22px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            font-family: sans-serif;
            color: white;
            background-color: #f0f2f5;
            border: 1px solid #ccc;
            transition: all 0.2s ease-in-out;
        }
        .wordwise-indicator.idle, .wordwise-indicator.no-suggestions {
            background-color: #0d6efd;
            border-color: #0a58ca;
        }
        .wordwise-indicator.idle:hover, .wordwise-indicator.no-suggestions:hover {
            background-color: #0b5ed7;
        }

        .wordwise-indicator img { width: 14px; height: 14px; opacity: 0.6; }
        .wordwise-indicator.loading {
            background-color: #0d6efd;
            border-color: #0a58ca;
            border-radius: 4px;
            animation: wordwise-spin 1s linear infinite;
        }
        .wordwise-indicator.has-suggestions { background-color: #dc3545; border-color: #b02a37; }
        .wordwise-indicator.error { background-color: #ffc107; color: #333; }

        .wordwise-suggestion-box {
            position: absolute;
            z-index: 2147483647;
            background-color: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.15);
            padding: 16px;
            width: 320px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .wordwise-close-btn {
            position: absolute; top: 8px; right: 8px;
            width: 24px; height: 24px;
            border: none; background: none;
            font-size: 20px; color: #aaa;
            cursor: pointer;
        }
        .wordwise-close-btn:hover { color: #333; }
        .wordwise-suggestion-box h3 { font-size: 16px; margin: 0 0 12px; }
        .wordwise-suggestion-box ul { list-style: none; padding: 0; margin: 0; }
        .wordwise-suggestion-box li { margin-bottom: 12px; padding-left: 15px; position: relative; }
        .wordwise-suggestion-box li::before {
             content: '';
             position: absolute;
             left: 0; top: 6px;
             width: 6px; height: 6px;
             border-radius: 50%;
        }
        .wordwise-suggestion-box li[data-suggestion-type="grammar"]::before { background-color: #dc3545; }
        .wordwise-suggestion-box li[data-suggestion-type="seo"]::before { background-color: #20c997; }
        .wordwise-suggestion-box li[data-suggestion-type="style"]::before { background-color: #0d6efd; }

        .wordwise-suggestion-box hr { border: 0; border-top: 1px solid #eee; margin: 12px 0; }
        .wordwise-suggestion-message b { font-weight: 600; text-transform: capitalize; }
        
        .wordwise-replacements { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
        .wordwise-replacement-btn { background-color: #e7f3ff; color: #007bff; border: 1px solid #b3d7ff; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 13px; }
        .wordwise-replacement-btn:hover { background-color: #d0e7ff; border-color: #a0caff; }
        
        .wordwise-dictionary-actions { margin-top: 8px; }
        .wordwise-add-dict-btn {
            background: none;
            border: none;
            color: #007bff;
            cursor: pointer;
            font-size: 12px;
            padding: 0;
        }
        .wordwise-add-dict-btn:hover { text-decoration: underline; }
        .wordwise-add-dict-btn span { font-weight: bold; }

        .wordwise-emotions { display: flex; flex-direction: column; gap: 4px; }
        .emotion-item { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .emotion-label { width: 90px; text-transform: capitalize; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .emotion-bar-container { flex-grow: 1; background-color: #f0f2f5; border-radius: 4px; height: 10px; }
        .emotion-bar { background-color: #007bff; height: 100%; border-radius: 4px; transition: width 0.3s ease-in-out; }

        @keyframes wordwise-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .wordwise-ignore-btn {
            position: absolute;
            right: -5px; top: -5px;
            width: 18px; height: 18px;
            border-radius: 50%;
            border: 1px solid #ccc;
            background-color: #f0f2f5;
            color: #888;
            font-size: 14px;
            line-height: 16px;
            text-align: center;
            cursor: pointer;
            opacity: 0.5;
        }
        .wordwise-suggestion-box li:hover .wordwise-ignore-btn { opacity: 1; }
        .wordwise-ignore-btn:hover { background-color: #e2e6ea; color: #333; }

        .wordwise-emotions-list { font-size: 14px; color: #333; text-transform: capitalize; }
        .wordwise-readability-score { font-size: 14px; color: #333; }

        .wordwise-highlight-overlay {
            pointer-events: none;
            overflow: hidden;
        }
        
        .wordwise-text-highlight {
            position: absolute;
            background-color: rgba(220, 53, 69, 0.1);
            pointer-events: none;
            transition: all 0.2s ease-in-out;
        }
    `;
    document.head.appendChild(style);
}