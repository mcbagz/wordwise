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
    overlay.style.zIndex = '9998';
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
            if (text.trim().length === 0) {
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

        input.addEventListener('wordwise-reanalyze', debouncedAnalysis);

        // Explicitly handle backspace and delete to ensure re-analysis
        input.addEventListener('keydown', (e) => {
            setTimeout(debouncedAnalysis, 300);
        });
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
        let analysisContent = '';
        const emotionAnalysis = currentSuggestions.find(s => s.type === 'emotion_analysis');
        if (emotionAnalysis && emotionAnalysis.emotions.length > 0) {
            analysisContent += `<h3>Tone Analysis</h3><div class="wordwise-emotions-list">`;
            analysisContent += emotionAnalysis.emotions.map(e => e.label).join(', ');
            analysisContent += `</div>`;
        }

        const readabilityAnalysis = currentSuggestions.find(s => s.type === 'readability');
        if (readabilityAnalysis) {
            analysisContent += `<h3>Readability</h3><div class="wordwise-readability-score">${readabilityAnalysis.message}</div>`;
        }

        const otherSuggestions = currentSuggestions.filter(s => s.type !== 'emotion_analysis' && s.type !== 'readability');
        if (otherSuggestions.length > 0) {
            if((emotionAnalysis && emotionAnalysis.emotions.length > 0) || readabilityAnalysis) analysisContent += '<hr>';
            analysisContent += `<h3>Suggestions</h3><ul>`;
            otherSuggestions.forEach(s => {
                const suggestionId = `${s.message}|${s.start}|${s.end}|${(inputElement.value || inputElement.innerText).substring(s.start, s.end)}`;
                if (ignoredSuggestions.has(suggestionId)) return;

                const originalText = (inputElement.value || inputElement.innerText).substring(s.start, s.end);
                analysisContent += `<li data-suggestion-type="${s.type}" data-suggestion-id="${suggestionId}" 
                            data-start="${s.start}" data-end="${s.end}">
                        <button class="wordwise-ignore-btn" title="Ignore suggestion">×</button>
                        <div class="wordwise-suggestion-message"><b>${s.type.toUpperCase()}:</b> ${s.message}</div>`;
                if (s.replacements && s.replacements.length > 0) {
                    analysisContent += `<div class="wordwise-replacements">`;
                    s.replacements.slice(0, 3).forEach(r => {
                        analysisContent += `<button class="wordwise-replacement-btn" 
                            data-start="${s.start}" 
                            data-end="${s.end}"
                            data-original-text="${originalText}" 
                            data-replacement="${r}">${r}</button>`;
                    });
                    analysisContent += `</div>`;
                }
                // Add to dictionary button for spelling errors
                if (s.category === 'TYPOS' || s.ruleId === 'MORFOLOGIK_RULE_EN_US') {
                    const misspelledWord = (inputElement.value || inputElement.innerText).substring(s.start, s.end);
                    analysisContent += `<div class="wordwise-dictionary-actions">
                                <button class="wordwise-add-dict-btn" data-word="${misspelledWord}">Add "<span>${misspelledWord}</span>" to dictionary</button>
                             </div>`;
                }
                analysisContent += `</li>`;
            });
            analysisContent += `</ul>`;
        }

        // Improvement section is now part of the Analyze tab
        analysisContent += `<div class="wordwise-improvement-section">
                                 <button id="wordwise-improve-btn">Get Improvement Tips ✨</button>
                                 <div id="wordwise-improve-suggestions-container"></div>
                             </div>`;

        const rewriteContent = `<div class="wordwise-tone-adjust-section">
                                    <h3>Make this more...</h3>
                                    <div class="wordwise-tone-adjust-controls">
                                        <select id="wordwise-adjective-preset">
                                            <option value="">--Select Tone--</option>
                                            <option value="Witty">Witty</option>
                                            <option value="Heartfelt">Heartfelt</option>
                                            <option value="Professional">Professional</option>
                                            <option value="Casual">Casual</option>
                                        </select>
                                        <input type="text" id="wordwise-adjective-custom" placeholder="...or type a custom one">
                                    </div>
                                    <button id="wordwise-generate-tone-btn">Generate Alternatives ✨</button>
                                    <div id="wordwise-inspirations-container" style="display:none;"></div>
                                    <div id="wordwise-tone-suggestions-container"></div>
                                 </div>`;

        let html = `<div class="wordwise-suggestion-box">
                        <button class="wordwise-close-btn" title="Close">×</button>
                        <div class="inner-tabs">
                            <button class="inner-tab-link active" data-tab="analyze">Analyze</button>
                            <button class="inner-tab-link" data-tab="rewrite">Rewrite</button>
                        </div>
                        <div id="analyze" class="inner-tab-content active">
                            ${analysisContent}
                        </div>
                        <div id="rewrite" class="inner-tab-content">
                            ${rewriteContent}
                        </div>
                    </div>`;

        container.innerHTML = html;
        if (!document.body.contains(container)) {
            document.body.appendChild(container);
        }
        
        const suggestionBox = container.querySelector('.wordwise-suggestion-box');
        positionSuggestionBox(suggestionBox, inputElement);
        attachSuggestionListeners(container, inputElement, indicator, otherSuggestions, ignoredSuggestions, renderContent);
        attachToneAdjustListeners(container, inputElement);

        // Add tab switching logic
        container.querySelectorAll('.inner-tab-link').forEach(button => {
            button.addEventListener('click', (e) => {
                const tabId = e.currentTarget.dataset.tab;

                // If switching to the analyze tab from another tab, trigger a re-analysis.
                if (tabId === 'analyze' && !e.currentTarget.classList.contains('active')) {
                     inputElement.dispatchEvent(new Event('wordwise-reanalyze', { bubbles: true }));
                }

                container.querySelectorAll('.inner-tab-link').forEach(link => link.classList.remove('active'));
                container.querySelectorAll('.inner-tab-content').forEach(content => content.classList.remove('active'));
                e.currentTarget.classList.add('active');
                container.querySelector(`#${tabId}`).classList.add('active');
            });
        });
    };
    
    renderContent(suggestions);
}

function attachToneAdjustListeners(container, inputElement) {
    // --- Tone Adjust Listeners ---
    const presetAdjective = container.querySelector('#wordwise-adjective-preset');
    const customAdjective = container.querySelector('#wordwise-adjective-custom');
    const generateBtn = container.querySelector('#wordwise-generate-tone-btn');
    const inspirationsContainer = container.querySelector('#wordwise-inspirations-container');
    const suggestionsContainer = container.querySelector('#wordwise-tone-suggestions-container');

    // --- Improve Post Listeners (MOVED) ---

    // Load inspirations when a preset is chosen or custom input is focused
    const loadInspirations = (container) => {
        if (container.dataset.loaded === 'true') return;
        container.innerHTML = '<em>Loading inspirations...</em>';
        container.style.display = 'block';

        chrome.runtime.sendMessage({ type: 'getInspirations' }, response => {
            if (response && response.success && response.inspirations.length > 0) {
                container.innerHTML = `
                    <div class="wordwise-inspirations-header">
                        <h5>Use inspirations as context:</h5>
                        <a href="#" class="wordwise-inspirations-toggle">[Show]</a>
                    </div>
                    <div class="wordwise-inspirations-list"></div>
                `;

                const listContainer = container.querySelector('.wordwise-inspirations-list');
                listContainer.style.display = 'none';
                const toggleLink = container.querySelector('.wordwise-inspirations-toggle');

                response.inspirations.forEach(insp => {
                    const inspEl = document.createElement('label');
                    inspEl.className = 'wordwise-inspiration-label';

                    const fullText = insp.post_text || '';
                    const isLong = fullText.length > 50;
                    const shortText = isLong ? fullText.substring(0, 50) + '...' : fullText;

                    inspEl.innerHTML = `
                        <input type="checkbox" class="wordwise-inspiration-checkbox" value="${insp.id}">
                        <span class="wordwise-inspiration-text">
                            <span class="wordwise-inspiration-platform">${insp.platform}:</span>
                            <span class="wordwise-inspiration-content" data-full-text="${fullText}" data-short-text="${shortText}">${shortText}</span>
                            ${isLong ? `<a href="#" class="wordwise-inspiration-expand">(more)</a>` : ''}
                        </span>
                    `;
                    listContainer.appendChild(inspEl);

                    if (isLong) {
                        const expandLink = inspEl.querySelector('.wordwise-inspiration-expand');
                        expandLink.addEventListener('click', e => {
                            e.preventDefault();
                            e.stopPropagation();
                            const contentSpan = inspEl.querySelector('.wordwise-inspiration-content');
                            if (expandLink.textContent === '(more)') {
                                contentSpan.textContent = contentSpan.dataset.fullText;
                                expandLink.textContent = '(less)';
                            } else {
                                contentSpan.textContent = contentSpan.dataset.shortText;
                                expandLink.textContent = '(more)';
                            }
                        });
                    }
                });

                toggleLink.addEventListener('click', e => {
                    e.preventDefault();
                    if (listContainer.style.display === 'none') {
                        listContainer.style.display = 'block';
                        toggleLink.textContent = '[Hide]';
                    } else {
                        listContainer.style.display = 'none';
                        toggleLink.textContent = '[Show]';
                    }
                });

                container.dataset.loaded = 'true';
            } else {
                container.style.display = 'none';
            }
        });
    };

    presetAdjective.addEventListener('change', () => loadInspirations(inspirationsContainer));
    customAdjective.addEventListener('focus', () => loadInspirations(inspirationsContainer), { once: true });

    generateBtn.addEventListener('click', () => {
        const adjective = customAdjective.value.trim() || presetAdjective.value;
        if (!adjective) {
            alert('Please select or enter an adjective.');
            return;
        }

        const selectedInspirationIds = Array.from(inspirationsContainer.querySelectorAll('.wordwise-inspiration-checkbox:checked'))
            .map(cb => parseInt(cb.value));

        suggestionsContainer.innerHTML = '<em>Generating AI suggestions...</em>';
        
        chrome.runtime.sendMessage({
            type: 'adjustTone',
            payload: {
                text: inputElement.value || inputElement.innerText,
                adjective: adjective,
                inspiration_ids: selectedInspirationIds
            }
        }, response => {
            if (response && response.success && response.suggestions.length > 0) {
                suggestionsContainer.innerHTML = '<h5>Suggestions:</h5>';
                response.suggestions.forEach(suggestion => {
                    const btn = document.createElement('button');
                    btn.className = 'wordwise-replacement-btn';
                    btn.textContent = suggestion;
                    btn.onclick = () => {
                        const fullText = inputElement.value || inputElement.innerText;
                        performFullTextReplacement(suggestion);
                    };
                    suggestionsContainer.appendChild(btn);
                });
            } else {
                suggestionsContainer.innerHTML = '<em>Could not generate suggestions.</em>';
            }
        });
    });
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
            applyReplacement(inputElement, replacement, start, end, false);
            clearHighlight();
            // Trigger re-analysis to get fresh suggestions for the new text.
            inputElement.dispatchEvent(new Event('wordwise-reanalyze', { bubbles: true }));

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
                    // The suggestion box will re-render, so we can remove the old one.
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

    // --- Improve Post Listener ---
    const improveBtn = container.querySelector('#wordwise-improve-btn');
    if (improveBtn) {
        const improveSuggestionsContainer = container.querySelector('#wordwise-improve-suggestions-container');

        const handleImprovementGeneration = () => {
            improveSuggestionsContainer.innerHTML = '<em>Analyzing for improvements...</em>';

            chrome.runtime.sendMessage({
                type: 'improvePost',
                payload: {
                    post_text: inputElement.value || inputElement.innerText,
                }
            }, response => {
                if (response && response.success && response.improvements) {
                    improveSuggestionsContainer.innerHTML = '';
                    const { engagement_suggestions, clarity_suggestions, structure_suggestions } = response.improvements;
                    
                    const renderCategory = (title, categorySuggestions) => {
                        if (categorySuggestions && categorySuggestions.length > 0) {
                            let categoryHtml = `<h5>${title}</h5>`;
                            improveSuggestionsContainer.innerHTML += categoryHtml;

                            categorySuggestions.forEach(suggestion => {
                                 const btn = document.createElement('button');
                                 btn.className = 'wordwise-replacement-btn';
                                 btn.textContent = suggestion;
                                 btn.onclick = () => {
                                     // This is a full rewrite suggestion, so we use the robust replacement function.
                                     performFullTextReplacement(suggestion);
                                 };
                                improveSuggestionsContainer.appendChild(btn);
                            });
                        }
                    };
                    
                    renderCategory('Engagement', engagement_suggestions);
                    renderCategory('Clarity', clarity_suggestions);
                    renderCategory('Structure', structure_suggestions);

                } else {
                    improveSuggestionsContainer.innerHTML = '<em>Could not get improvement suggestions.</em>';
                }
            });
        };
        
        improveBtn.addEventListener('click', handleImprovementGeneration);
    }
}

function applyReplacement(element, replacement, start, end, isFullRewrite) {
    element.focus();

    if (element.isContentEditable) {
        // For full rewrites, we delegate to a more robust, specialized function.
        if (isFullRewrite) {
            performFullTextReplacement(replacement);
            return;
        }

        // For partial replacements, we use the original TreeWalker logic to find the precise spot.
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
            // Find the correct text nodes to create a range to select
            let charCount = 0;
            let startNode, startOffset, endNode, endOffset;
            
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                const textLength = node.textContent.length;
                if (startNode === undefined && charCount + textLength >= start) {
                    startNode = node;
                    startOffset = start - charCount;
                }
                if (endNode === undefined && charCount + textLength >= end) {
                    endNode = node;
                    endOffset = end - charCount;
                }
                charCount += textLength;
                if (startNode && endNode) break;
            }

            if (startNode && endNode) {
                const selectRange = document.createRange();
                selectRange.setStart(startNode, startOffset);
                selectRange.setEnd(endNode, endOffset);
                sel.removeAllRanges();
                sel.addRange(selectRange);
                document.execCommand('insertText', false, replacement);
            }
        }
    } else { // For textarea
        element.setSelectionRange(start, end);
        // `insertText` will correctly replace the selected text.
        document.execCommand('insertText', false, replacement);
    }
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

const trackedImages = new WeakSet();

function findAndAttachCaptionButtons() {
    const images = document.querySelectorAll('img[src^="blob:"]');
    images.forEach(image => {
        if (trackedImages.has(image) || !isElementVisible(image)) {
            return;
        }

        // Add context check for X.com
        const isTwitterAttachment = image.closest('div[data-testid="attachments"]');
        if (window.location.hostname.includes('x.com') && !isTwitterAttachment) {
            return; // Skip if it's not a recognized attachment on Twitter
        }
        
        trackedImages.add(image);
        createFloatingButton(image);
    });
}

function createFloatingButton(image) {
    const button = document.createElement('button');
    button.textContent = 'Generate Caption ✨';
    button.className = 'wordwise-floating-caption-btn';
    document.body.appendChild(button);

    const positionButton = () => {
        if (!document.body.contains(image)) {
            button.remove();
            return;
        }
        const imageRect = image.getBoundingClientRect();
        button.style.position = 'absolute';
        
        const isInstagram = window.location.hostname.includes('instagram.com');
        if (isInstagram) {
            // Position at the bottom for Instagram
            button.style.top = `${imageRect.bottom + window.scrollY - button.offsetHeight - 8}px`;
        } else {
            // Position at the top for other sites (e.g., X)
            button.style.top = `${imageRect.top + window.scrollY + 8}px`;
        }
        
        button.style.left = `${imageRect.left + window.scrollX + (imageRect.width / 2) - (button.offsetWidth / 2)}px`;
    };

    // Position after a brief moment to ensure styles are applied
    setTimeout(positionButton, 100);
    
    const observer = new MutationObserver(positionButton);
    observer.observe(document.body, { attributes: true, childList: true, subtree: true });

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        openCaptionModal(image);
    });
}

function openCaptionModal(image) {
    // Remove existing modal if any
    const oldModal = document.getElementById('wordwise-caption-modal');
    if (oldModal) oldModal.remove();

    const modalHTML = `
        <div id="wordwise-caption-modal" class="wordwise-modal-overlay">
            <div class="wordwise-modal-content">
                <button class="wordwise-modal-close">×</button>
                <h2>Generate Image Caption</h2>
                <p>Enter optional keywords to guide the AI.</p>
                <input type="text" id="wordwise-modal-keywords" placeholder="e.g., witty, professional, about nature">
                <button id="wordwise-modal-generate-btn">Generate</button>
                <div id="wordwise-modal-results"></div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('wordwise-caption-modal');
    const closeBtn = modal.querySelector('.wordwise-modal-close');
    const generateBtn = modal.querySelector('#wordwise-modal-generate-btn');
    const keywordsInput = modal.querySelector('#wordwise-modal-keywords');
    const resultsContainer = modal.querySelector('#wordwise-modal-results');

    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) { // Close if clicking on the overlay
            modal.remove();
        }
    });

    generateBtn.addEventListener('click', () => {
        resultsContainer.innerHTML = '<em>Generating captions...</em>';
        
        chrome.runtime.sendMessage({
            type: 'generateCaption',
            payload: {
                imageUrl: image.src, // Pass the blob URL directly
                platform: window.location.hostname.includes('x.com') ? 'X' : 'Instagram',
                keywords: keywordsInput.value
            }
        }, (response) => {
            if (response.success && response.captions && response.captions.length > 0) {
                resultsContainer.innerHTML = '';
                response.captions.forEach(caption => {
                    const capBtn = document.createElement('button');
                    capBtn.className = 'wordwise-caption-suggestion-btn';
                    capBtn.textContent = caption;
                    capBtn.onclick = () => {
                        // Use the new, robust replacement function
                        performFullTextReplacement(caption);
                        modal.remove();
                    };
                    resultsContainer.appendChild(capBtn);
                });
            } else {
                resultsContainer.innerHTML = `<em>Error: ${response.error || 'Could not generate captions.'}</em>`;
            }
        });
    });
}

/**
 * Performs a robust full-text replacement in the active composer on X or Instagram.
 * This is the unified function for all full-rewrite actions (captions, tone, improvements).
 * @param {string} newText The text to insert.
 */
function performFullTextReplacement(newText) {
    let composer = document.querySelector('div[data-testid="tweetTextarea_0"]');
    if (!composer) {
        composer = document.querySelector('div[aria-label="Write a caption..."]');
    }

    if (composer && composer.isContentEditable) {
        composer.focus();

        // 1. Select all the text in the editor using the execCommand.
        document.execCommand('selectAll', false, null);

        // 2. Introduce a small delay. This is critical to ensure the browser
        // has time to register the 'selectAll' command before we paste.
        setTimeout(() => {
            // 3. Create and dispatch a 'paste' event to replace the selected content.
            const pasteEvent = new ClipboardEvent('paste', {
                clipboardData: new DataTransfer(),
                bubbles: true,
                cancelable: true
            });
            pasteEvent.clipboardData.setData('text/plain', newText);
            composer.dispatchEvent(pasteEvent);

            // 4. Dispatch a final 'input' event to ensure the framework's state updates.
            setTimeout(() => {
                composer.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }, 50);

        }, 10); // A 10ms delay is usually sufficient.

    } else {
        console.error("WordWise: Could not find the composer element for X or Instagram.");
        alert("Could not insert the text. Please try pasting it manually.");
    }
}

function applyCaptionToActiveInput(caption) {
    // All caption logic is now handled by the unified replacement function.
    performFullTextReplacement(caption);
}

injectCss();
setInterval(findAndManageTextInputs, 1500);
setInterval(findAndAttachCaptionButtons, 2000);
findAndManageTextInputs();
findAndAttachCaptionButtons();

function injectCss() {
    const styleId = 'wordwise-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.innerHTML = `
        .wordwise-indicator {
            position: absolute;
            z-index: 9999;
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
            z-index: 10000;
            background-color: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.15);
            padding: 16px;
            width: 400px;
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

        .wordwise-suggestion-box .inner-tabs {
            display: flex;
            border-bottom: 1px solid #eee;
            margin-bottom: 12px;
        }
        .wordwise-suggestion-box .inner-tab-link {
            padding: 8px 12px;
            cursor: pointer;
            border: none;
            background: none;
            font-size: 14px;
            font-weight: 500;
            color: #555;
            border-bottom: 2px solid transparent;
        }
        .wordwise-suggestion-box .inner-tab-link.active,
        .wordwise-suggestion-box .inner-tab-link:hover {
            color: #0d6efd;
            border-bottom-color: #0d6efd;
        }
        .wordwise-suggestion-box .inner-tab-content {
            display: none;
        }
        .wordwise-suggestion-box .inner-tab-content.active {
            display: block;
        }

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

        /* Styles for Tone Adjust Feature */
        .wordwise-tone-adjust-section {
            margin-top: 16px;
            border-top: 1px solid #eee;
            padding-top: 16px;
        }
        .wordwise-tone-adjust-section h3 {
            font-size: 16px;
            margin: 0 0 12px;
        }
        .wordwise-tone-adjust-controls {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-bottom: 12px;
        }
        .wordwise-tone-adjust-controls select {
            padding: 6px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 13px;
            flex: 1 1 35%;
        }
         .wordwise-tone-adjust-controls input {
            padding: 6px;
            border: 1px solid #ccc;
            border-radius: 4px;
            font-size: 13px;
            flex: 1 1 65%;
        }
        .wordwise-tone-adjust-section button#wordwise-generate-tone-btn {
            width: 100%;
            padding: 10px;
            border: 1px dashed #0d6efd;
            background-color: #f8f9fa;
            color: #0d6efd;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 12px;
            text-align: center;
        }
        .wordwise-tone-adjust-section button#wordwise-generate-tone-btn:hover {
            background-color: #eef5ff;
            border-color: #0b5ed7;
        }
        
        .wordwise-inspirations-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 10px;
        }
        .wordwise-inspirations-header h5 {
            margin: 0;
            font-size: 13px;
            font-weight: 600;
        }
        .wordwise-inspirations-toggle {
            font-size: 12px;
            color: #0d6efd;
            text-decoration: none;
            cursor: pointer;
        }
        .wordwise-inspirations-toggle:hover {
            text-decoration: underline;
        }
        .wordwise-inspirations-list {
            max-height: 120px; /* Approx 4 items */
            overflow-y: auto;
            border: 1px solid #eee;
            padding: 8px;
            margin-top: 5px;
            border-radius: 4px;
        }
        .wordwise-inspiration-label {
            display: block;
            margin-bottom: 5px;
            font-size: 12px;
            line-height: 1.4;
        }
        .wordwise-inspiration-label .wordwise-inspiration-text {
            vertical-align: middle;
        }
        .wordwise-inspiration-label .wordwise-inspiration-platform {
            font-weight: 600;
        }
        .wordwise-inspiration-expand {
            font-size: 11px;
            color: #0d6efd;
            text-decoration: none;
            cursor: pointer;
            margin-left: 4px;
        }
        .wordwise-inspiration-expand:hover {
             text-decoration: underline;
        }

        .wordwise-tone-adjust-section #wordwise-tone-suggestions-container .wordwise-replacement-btn {
            display: block;
            width: 100%;
            margin-bottom: 8px;
            text-align: left;
        }

        .wordwise-improvement-section {
            margin-top: 16px;
        }
        .wordwise-improvement-section h5 {
            font-size: 13px;
            font-weight: 600;
            margin: 0 0 8px;
        }
        .wordwise-improvement-section button#wordwise-improve-btn {
            width: 100%;
            padding: 10px;
            border: 1px dashed #0d6efd;
            background-color: #f8f9fa;
            color: #0d6efd;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 10px;
            text-align: center;
        }
        .wordwise-improvement-section button#wordwise-improve-btn:hover {
            background-color: #eef5ff;
            border-color: #0b5ed7;
        }
        .wordwise-improvement-section #wordwise-improve-suggestions-container .wordwise-replacement-btn {
             display: block;
             width: 100%;
             margin-bottom: 8px;
             text-align: left;
        }

        /* New Floating Caption Button Styles */
        .wordwise-floating-caption-btn {
            position: absolute;
            z-index: 9997;
            background-color: rgba(29, 161, 242, 0.9);
            color: white;
            border: none;
            border-radius: 99px;
            padding: 8px 16px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            transition: background-color 0.2s;
        }
        .wordwise-floating-caption-btn:hover {
            background-color: rgba(29, 161, 242, 1);
        }

        /* New Caption Modal Styles */
        .wordwise-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 10001;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .wordwise-modal-content {
            background-color: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.25);
            width: 400px;
            max-width: 90%;
            position: relative;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .wordwise-modal-close {
            position: absolute;
            top: 10px; right: 10px;
            font-size: 24px;
            border: none;
            background: none;
            cursor: pointer;
            color: #aaa;
        }
        .wordwise-modal-close:hover { color: #333; }
        .wordwise-modal-content h2 { margin: 0 0 8px; font-size: 18px; }
        .wordwise-modal-content p { margin: 0 0 16px; font-size: 14px; color: #555; }
        .wordwise-modal-content input {
            width: 100%;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 6px;
            margin-bottom: 12px;
            box-sizing: border-box;
        }
        .wordwise-modal-content #wordwise-modal-generate-btn {
            width: 100%;
            padding: 10px;
            border: none;
            border-radius: 6px;
            background-color: #0d6efd;
            color: white;
            font-size: 15px;
            font-weight: bold;
            cursor: pointer;
        }
        #wordwise-modal-results {
            margin-top: 16px;
            max-height: 200px;
            overflow-y: auto;
        }
        .wordwise-caption-suggestion-btn {
            display: block;
            width: 100%;
            background-color: #f0f2f5;
            border: 1px solid #ddd;
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 8px;
            text-align: left;
            cursor: pointer;
        }
        .wordwise-caption-suggestion-btn:hover {
            background-color: #e9ecef;
            border-color: #ccc;
        }
    `;
    document.head.appendChild(style);
}

// --- Inspiration Feature Listener ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getPostData") {
        const postData = extractPostData(window.location.hostname);
        if (postData) {
            sendResponse({ data: postData });
        } else {
            sendResponse({ data: null });
        }
        return true; // Indicates that the response is sent asynchronously
    } else if (request.action === "getDetailedPostData") {
        const postData = extractDetailedPostData(window.location.hostname);
        if (postData) {
            sendResponse({ data: postData });
        } else {
            sendResponse({ data: null });
        }
        return true;
    }
});

function extractPostData(hostname) {
    if (hostname.includes('x.com')) {
        return extractTwitterPost();
    } else if (hostname.includes('instagram.com')) {
        return extractInstagramPost();
    }
    return null;
}

function extractTwitterPost() {
    // This assumes we're on a detail page or the main feed.
    // We'll try to find the main article element. This might need refinement.
    const article = document.querySelector('article[data-testid="tweet"]');
    if (!article) return null;

    const postTextElement = article.querySelector('div[data-testid="tweetText"]');
    const postText = postTextElement ? postTextElement.innerText : null;

    const imageElement = article.querySelector('div[data-testid="tweetPhoto"] img');
    const imageUrl = imageElement ? imageElement.src : null;
    
    if (!postText && !imageUrl) return null;

    return {
        post_text: postText,
        image_url: imageUrl,
        platform: 'X'
    };
}

function extractDetailedPostData(hostname) {
    if (hostname.includes('x.com')) {
        return extractDetailedTwitterPost();
    } else if (hostname.includes('instagram.com')) {
        // Placeholder for detailed Instagram extraction
        return extractInstagramPost();
    }
    return null;
}

function extractDetailedTwitterPost() {
    const baseData = extractTwitterPost();
    if (!baseData) return null;

    const article = document.querySelector('article[data-testid="tweet"]');
    if (!article) return null;

    const hashtags = Array.from(article.querySelectorAll('a[href*="/hashtag/"]'))
        .map(a => a.innerText);
    
    const mentions = Array.from(article.querySelectorAll('a[href^="/"]'))
        .filter(a => a.innerText.startsWith('@'))
        .map(a => a.innerText);

    return { ...baseData, hashtags, mentions };
}

function extractInstagramPost() {
    // Placeholder for Instagram extraction logic
    // This needs careful selection of elements.
    const article = document.querySelector('article');
    if(!article) return null;

    const postTextElement = article.querySelector('h1');
    const postText = postTextElement ? postTextElement.innerText : null;
    
    const imageElement = article.querySelector('div._aagv img');
    const imageUrl = imageElement ? imageElement.src : null;

    if (!postText && !imageUrl) return null;

    return {
        post_text: postText,
        image_url: imageUrl,
        platform: 'Instagram'
    };
}