import spacy
from typing import Optional, List
import language_tool_python
from transformers import pipeline
import textstat
import threading

try:
    nlp = spacy.load("en_core_web_sm")
except OSError:
    print("Downloading language model for the first time. This may take a few minutes...")
    from spacy.cli import download
    download("en_core_web_sm")
    nlp = spacy.load("en_core_web_sm")

# Initialize LanguageTool
try:
    tool = language_tool_python.LanguageTool('en-US')
except Exception as e:
    print(f"Error initializing LanguageTool: {e}")
    print("LanguageTool is required for grammar checking. Please ensure you have a working internet connection for the initial setup.")
    tool = None

# Initialize emotion analysis pipeline
try:
    emotion_classifier = pipeline(
        "text-classification",
        model="SamLowe/roberta-base-go_emotions",
        top_k=None # Return all emotions
    )
except Exception as e:
    print(f"Error initializing emotion classifier pipeline: {e}")
    emotion_classifier = None

tool_lock = threading.Lock()

def analyze_text(text: str, platform: Optional[str], field: Optional[str], tone_preference: Optional[str], enabled_analyzers: Optional[dict], user_dictionary: Optional[List[str]] = None):
    """
    Analyzes text for grammar, tone, and SEO.
    """
    doc = nlp(text)
    suggestions = []
    text_lower = text.lower()
    
    if enabled_analyzers is None:
        enabled_analyzers = {"grammar": True, "tone": True, "seo": True, "style": True}

    # --- Grammar Analysis ---
    if enabled_analyzers.get("grammar") and tool:
        print("Checking grammar...")
        matches = tool.check(text)
        change = '''original_ignored_words = None
        with tool_lock:
            if user_dictionary:
                original_ignored_words = tool.language.ignored_words.copy()
                tool.language.ignored_words.update(user_dictionary)

            matches = tool.check(text)

            if user_dictionary and original_ignored_words is not None:
                tool.language.ignored_words = original_ignored_words
        '''
        for match in matches:
            if text[match.offset:match.offset + match.errorLength] in user_dictionary:
                continue
            suggestions.append({
                "type": "grammar",
                "message": match.message,
                "replacements": match.replacements,
                "start": match.offset,
                "end": match.offset + match.errorLength,
                "category": match.category,
                "ruleId": match.ruleId
            })

    # --- Style & Readability Analysis ---
    if enabled_analyzers.get("style"):
        # 1. Readability Score
        if len(text.split()) > 20: # Only run on longer text
            try:
                grade = textstat.flesch_kincaid_grade(text)
                readability_msg = f"This text has a readability score equivalent to a {int(grade)}{'th' if int(grade) % 10 == 1 and int(grade) % 100 != 11 else 'nd' if int(grade) % 10 == 2 and int(grade) % 100 != 12 else 'rd' if int(grade) % 10 == 3 and int(grade) % 100 != 13 else 'th'} grade reading level."
                if grade > 12:
                    readability_msg += " Consider simplifying complex sentences for a broader audience."
                elif grade < 6:
                    readability_msg += " This is very easy to read. Great for general audiences!"
                else:
                    readability_msg += " This is easily understood by most readers."

                suggestions.append({
                    "type": "readability",
                    "message": readability_msg,
                    "score": grade
                })
            except Exception as e:
                print(f"Error during readability analysis: {e}")

        # 2. Passive Voice Check
        for sent in doc.sents:
            is_passive = any(tok.dep_ == "nsubjpass" for tok in sent)
            if is_passive:
                 suggestions.append({
                    "type": "style",
                    "message": "This sentence appears to be in the passive voice. Consider rewriting it in the active voice for more direct and engaging writing.",
                    "replacements": [],
                    "start": sent.start_char,
                    "end": sent.end_char
                })

    # --- Advanced Tone Analysis (Model-based) ---
    if enabled_analyzers.get("tone") and emotion_classifier and len(text.split()) > 3:
        try:
            model_results = emotion_classifier(text)
            # Filter emotions with a score > 0.25 and take the top 3
            top_emotions = sorted(
                [emo for emo in model_results[0] if emo['score'] > 0.25],
                key=lambda x: x['score'],
                reverse=True
            )[:3]

            if top_emotions:
                suggestions.append({
                    "type": "emotion_analysis",
                    "emotions": top_emotions
                })
        except Exception as e:
            print(f"Error during emotion analysis: {e}")

    # --- SEO Analysis ---
    if enabled_analyzers.get("seo"):
        print("Checking SEO...")
        if platform == "youtube" and field == "description":
            if "#" not in text:
                suggestions.append({
                    "type": "seo",
                    "message": "Consider adding relevant hashtags to your YouTube description to improve discoverability."
                })

    return {"suggestions": suggestions} 