import spacy
from typing import Optional, List
import language_tool_python
from transformers import pipeline
import threading
import os
import re
from openai import OpenAI
from models import Inspiration
from dotenv import load_dotenv
import json
import base64
import math
load_dotenv()

def convert_offsets_to_utf16(text: str, start: int, end: int):
    """
    Converts character-based start/end offsets to UTF-16 code unit offsets,
    which is what JavaScript's string manipulation functions use.
    """
    prefix = text[:start]
    match = text[start:end]
    
    # The length of the string encoded in UTF-16 little-endian, divided by 2,
    # gives the number of 16-bit code units.
    start_utf16 = len(prefix.encode('utf-16-le')) // 2
    end_utf16 = start_utf16 + len(match.encode('utf-16-le')) // 2
    
    return start_utf16, end_utf16

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

# OpenAI Client
try:
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
except Exception as e:
    print(f"Error initializing OpenAI client: {e}")
    client = None

tool_lock = threading.Lock()

def calculate_ari(text):
    """
    Calculate the Automated Readability Index (ARI) grade level for given text, 
    returning the ceiling as an integer.
    
    Parameters:
    text (str): The input text to analyze
    
    Returns:
    int: The ARI grade level (ceiling of the calculated score)
    """
    
    # Remove extra whitespace and newlines
    text = ' '.join(text.split())
    
    # Count characters (excluding spaces and punctuation)
    characters = len(re.sub(r'[^a-zA-Z0-9]', '', text))
    
    # Count words (split by whitespace)
    words = len(text.split())
    
    # Count sentences (split by .!?)
    raw_sentences = re.split(r'[.!?]+', text.strip())
    sentences = len(raw_sentences) - 1
    if len(raw_sentences[-1]) > 0:
        sentences += 1
    
    # Avoid division by zero
    if words == 0 or sentences == 0:
        return 0
        
    # ARI formula: 4.71 * (characters/words) + 0.5 * (words/sentences) - 21.43
    ari_score = 4.71 * (characters / words) + 0.5 * (words / sentences) - 21.43
    
    # Return ceiling of the score as integer
    return math.ceil(max(0, ari_score))

def analyze_text(text: str, platform: Optional[str], field: Optional[str], enabled_analyzers: Optional[dict], user_dictionary: Optional[List[str]] = None):
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
            
            start_utf16, end_utf16 = convert_offsets_to_utf16(text, match.offset, match.offset + match.errorLength)

            suggestions.append({
                "type": "grammar",
                "message": match.message,
                "replacements": match.replacements,
                "start": start_utf16,
                "end": end_utf16,
                "category": match.category,
                "ruleId": match.ruleId
            })

    # --- Style & Readability Analysis ---
    if enabled_analyzers.get("style"):
        # 1. Readability Score
        if len(text.split()) > 5: # Only run on longer text
            try:
                # Remove hashtags for more accurate readability scoring
                text_for_readability = re.sub(r'#\w+', '', text)
                grade = calculate_ari(text_for_readability)
                if grade < 1:
                    grade = 1
                readability_msg = f"This text has a readability score equivalent to a {int(grade)}{'st' if int(grade) % 10 == 1 and int(grade) % 100 != 11 else 'nd' if int(grade) % 10 == 2 and int(grade) % 100 != 12 else 'rd' if int(grade) % 10 == 3 and int(grade) % 100 != 13 else 'th'} grade reading level."
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
                 start_utf16, end_utf16 = convert_offsets_to_utf16(text, sent.start_char, sent.end_char)
                 suggestions.append({
                    "type": "style",
                    "message": "This sentence appears to be in the passive voice. Consider rewriting it in the active voice for more direct and engaging writing.",
                    "replacements": [],
                    "start": start_utf16,
                    "end": end_utf16
                })

    # --- Advanced Tone Analysis (Model-based) ---
    if enabled_analyzers.get("tone") and emotion_classifier and len(text.split()) > 3:
        print("Checking tone...")
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

    return {"suggestions": suggestions}

def _clean_ai_suggestion(suggestion: str) -> str:
    """Removes leading numbering/bullets and surrounding quotes from a string."""
    # Remove leading numbers, bullets, or hyphens (e.g., "1. ", "- ", "* ")
    cleaned = re.sub(r'^\s*[\d\.\-\*]+\s*', '', suggestion).strip()
    # Remove surrounding quotes, being careful not to remove internal quotes.
    if len(cleaned) > 1 and (
        (cleaned.startswith('"') and cleaned.endswith('"')) or
        (cleaned.startswith("'") and cleaned.endswith("'"))
    ):
        cleaned = cleaned[1:-1]
    return cleaned

async def adjust_tone_with_ai(text: str, adjective: str, inspirations: Optional[List[Inspiration]] = None):
    if not client:
        raise ConnectionError("OpenAI client is not initialized.")

    system_prompt = f"You are an expert writing assistant. A user wants to rewrite their text to make it more '{adjective}'. Your task is to provide 3-4 high-quality, distinct suggestions that match this new tone while preserving the original message's core meaning. Do not explain the suggestions, just provide the rewritten text. Each suggestion should be on a new line."

    if inspirations:
        inspiration_text = "\n\nHere are some examples of the kind of tone the user likes:\n"
        for insp in inspirations:
            inspiration_text += f"- \"{insp.post_text}\"\n"
        system_prompt += inspiration_text

    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Here is the text to rewrite:\n\n\"{text}\""}
            ],
            temperature=0.7,
            max_tokens=500,
            n=1,
        )
        content = response.choices[0].message.content
        # Split suggestions by newline and filter out any empty strings
        suggestions = [s.strip() for s in content.split('\n') if s.strip()]
        return [_clean_ai_suggestion(s) for s in suggestions if s]
    except Exception as e:
        print(f"Error calling OpenAI API: {e}")
        return []

async def analyze_post_with_ai(post_text: str, platform: str, hashtags: List[str], mentions: List[str]):
    if not client:
        raise ConnectionError("OpenAI client is not initialized.")

    system_prompt = f"""
    You are an expert social media analyst. Your task is to analyze a post provided by the user and give them actionable feedback.
    The user is posting on {platform}.

    Analyze the following aspects of the post:
    1.  **Clarity and Tone:** Is the message clear? What is the emotional tone?
    2.  **Engagement Potential:** Does the post encourage interaction (e.g., questions, CTAs)?
    3.  **Hashtag/Mention Strategy:** Are the hashtags and mentions used effectively for the platform?

    Based on your analysis, provide a structured response in JSON format. The JSON object should have three keys:
    -   `summary`: A one-sentence summary of the post's overall effectiveness.
    -   `key_factors`: A list of 2-3 strings, with each string being a key factor (positive or negative) that contributes to the post's potential performance.
    -   `recommendations`: A list of 2-3 strings, with each string being a concrete recommendation for improvement.

    Do not include any text outside of the JSON object.
    """

    user_message = f"""
    Here is the post to analyze:
    **Platform:** {platform}
    **Text:** "{post_text}"
    **Hashtags:** {', '.join(hashtags) if hashtags else 'None'}
    **Mentions:** {', '.join(mentions) if mentions else 'None'}
    """

    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.5,
        )
        analysis_data = response.choices[0].message.content
        # The response should be a JSON string, so we parse it.
        return json.loads(analysis_data)
    except Exception as e:
        print(f"Error calling OpenAI API for post analysis: {e}")
        return {
            "summary": "Could not analyze the post due to an error.",
            "key_factors": [],
            "recommendations": []
        }

async def improve_post_with_ai(post_text: str):
    if not client:
        raise ConnectionError("OpenAI client is not initialized.")

    system_prompt = """
    You are a viral marketing and copywriting expert. Your task is to analyze a user's post and provide concrete, actionable suggestions for improvement in three distinct categories.

    The user's goal is to maximize engagement, clarity, and impact.

    Provide a structured response in JSON format. The JSON object must have three keys:
    - `engagement_suggestions`: A list of 2-3 strings with suggestions to make the post more interactive (e.g., adding questions, stronger CTAs).
    - `clarity_suggestions`: A list of 2-3 strings with suggestions to make the text clearer and more impactful (e.g., rewriting sentences for conciseness).
    - `structure_suggestions`: A list of 2-3 strings with suggestions for structural improvements (e.g., reordering sentences, improving flow).

    Do not include any text outside of the JSON object.
    """

    user_message = f"Here is the post to improve:\n\n---\n{post_text}\n---"

    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.6,
        )
        improvement_data = response.choices[0].message.content
        return json.loads(improvement_data)
    except Exception as e:
        print(f"Error calling OpenAI API for post improvement: {e}")
        return {
            "engagement_suggestions": [],
            "clarity_suggestions": [],
            "structure_suggestions": ["Could not get suggestions due to an error."]
        }

async def generate_image_caption(image_bytes: bytes, platform: str, keywords: Optional[str] = None):
    if not client:
        raise ConnectionError("OpenAI client is not initialized.")

    base64_image = base64.b64encode(image_bytes).decode('utf-8')

    system_prompt = f"""
    You are an expert social media copywriter. Your task is to generate 3 distinct and compelling captions for an image, tailored for {platform}.

    - Analyze the image provided by the user.
    - If the user provides keywords, use them to guide the tone and content of the captions.
    - For Instagram, include relevant and popular hashtags.
    - For X (formerly Twitter), keep the captions concise and impactful.
    - The output should be a JSON object with a single key "captions", which is a list of strings. Do not include any other text or explanations.
    """

    user_prompt = "Generate captions for this image."
    if keywords:
        user_prompt += f"\nUse these keywords as inspiration: '{keywords}'"

    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            temperature=0.7,
            max_tokens=400
        )
        caption_data = json.loads(response.choices[0].message.content)
        captions = caption_data.get("captions", [])
        return [_clean_ai_suggestion(c) for c in captions if c]
    except Exception as e:
        print(f"Error calling OpenAI API for image captioning: {e}")
        return [] 