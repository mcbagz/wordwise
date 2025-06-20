from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

# Token Schemas
class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    email: Optional[str] = None


# User Schemas
class UserBase(BaseModel):
    email: EmailStr

class UserCreate(UserBase):
    password: str

class User(UserBase):
    id: int
    is_active: bool
    inspirations: List["Inspiration"] = []

    class Config:
        from_attributes = True

class WordCreate(BaseModel):
    word: str

class UserWord(BaseModel):
    id: int
    word: str
    user_id: int

    class Config:
        from_attributes = True

class AnalysisRequest(BaseModel):
    text: str
    platform: Optional[str] = None
    field: Optional[str] = None
    enabled_analyzers: Optional[dict] = None

# Inspiration Schemas
class InspirationBase(BaseModel):
    post_text: Optional[str] = None
    image_url: Optional[str] = None
    platform: str
    tags: Optional[str] = None

class InspirationCreate(InspirationBase):
    pass

class Inspiration(InspirationBase):
    id: int
    user_id: int
    timestamp: datetime

    class Config:
        from_attributes = True

# Tone Adjust Schemas
class ToneAdjustRequest(BaseModel):
    text: str
    adjective: str
    inspiration_ids: Optional[List[int]] = None

class ToneAdjustResponse(BaseModel):
    suggestions: List[str]

# Post Analysis Schemas
class PostAnalysisRequest(BaseModel):
    post_text: str
    platform: str
    hashtags: Optional[List[str]] = []
    mentions: Optional[List[str]] = []

class PostAnalysisResponse(BaseModel):
    summary: str
    key_factors: List[str]
    recommendations: List[str]

# Improve Post Schemas
class ImprovePostRequest(BaseModel):
    post_text: str

class ImprovePostResponse(BaseModel):
    engagement_suggestions: List[str]
    clarity_suggestions: List[str]
    structure_suggestions: List[str]

# Image Caption Schemas
class CaptionResponse(BaseModel):
    captions: List[str] 