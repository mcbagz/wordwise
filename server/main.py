from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta

from nlp.analysis import analyze_text, adjust_tone_with_ai, analyze_post_with_ai, improve_post_with_ai, generate_image_caption
import auth
import crud
import models
import schemas
from database import engine, init_db

app = FastAPI()
# This will create the tables
@app.on_event("startup")
async def on_startup():
    await init_db()


# CORS middleware to allow requests from the Chrome extension
origins = [
    "*",  # Allows all origins
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/signup", response_model=schemas.User)
async def create_user(user: schemas.UserCreate, db: AsyncSession = Depends(auth.get_db)):
    db_user = await crud.get_user_by_email(db, email=user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    return await crud.create_user(db=db, user=user)

@app.post("/token", response_model=schemas.Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(auth.get_db)):
    user = await auth.authenticate_user(db, email=form_data.username, password=form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth.create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/users/me/", response_model=schemas.User)
async def read_users_me(current_user: models.User = Depends(auth.get_current_active_user)):
    return current_user

class AnalysisRequest(BaseModel):
    text: str
    platform: Optional[str] = None
    field: Optional[str] = None
    tone_preference: Optional[str] = 'professional'
    enabled_analyzers: Optional[dict] = None

@app.get("/")
def read_root():
    return {"message": "WordWise AI Server is running."}

@app.post("/analyze/")
async def analyze(request: AnalysisRequest, current_user: models.User = Depends(auth.get_current_active_user), db: AsyncSession = Depends(auth.get_db)):
    user_dictionary = await crud.get_user_dictionary(db, user_id=current_user.id)
    dictionary_words = [item.word for item in user_dictionary]
    
    return analyze_text(
        request.text,
        request.platform,
        request.field,
        request.enabled_analyzers,
        dictionary_words
    )

@app.post("/dictionary/add", status_code=status.HTTP_201_CREATED)
async def add_to_dictionary(word_data: schemas.WordCreate, current_user: models.User = Depends(auth.get_current_active_user), db: AsyncSession = Depends(auth.get_db)):
    word = word_data.word.strip()
    if not word or len(word.split()) > 1:
        raise HTTPException(status_code=400, detail="Invalid word provided.")

    existing_word = await crud.get_word_in_dictionary(db, user_id=current_user.id, word=word)
    if existing_word:
        return {"message": "Word already exists in dictionary."}

    await crud.add_word_to_dictionary(db, user_id=current_user.id, word=word)
    return {"message": f"'{word}' added to your dictionary."}

# Inspiration Endpoints
@app.post("/inspiration", response_model=schemas.Inspiration, status_code=status.HTTP_201_CREATED)
async def create_inspiration(
    inspiration: schemas.InspirationCreate,
    current_user: models.User = Depends(auth.get_current_active_user),
    db: AsyncSession = Depends(auth.get_db)
):
    return await crud.create_inspiration(db=db, inspiration=inspiration, user_id=current_user.id)

@app.get("/inspiration", response_model=List[schemas.Inspiration])
async def get_inspirations(
    skip: int = 0,
    limit: int = 100,
    current_user: models.User = Depends(auth.get_current_active_user),
    db: AsyncSession = Depends(auth.get_db)
):
    return await crud.get_inspirations(db=db, user_id=current_user.id, skip=skip, limit=limit)

@app.delete("/inspiration/{inspiration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_inspiration(
    inspiration_id: int,
    current_user: models.User = Depends(auth.get_current_active_user),
    db: AsyncSession = Depends(auth.get_db)
):
    db_inspiration = await crud.delete_inspiration(db=db, inspiration_id=inspiration_id, user_id=current_user.id)
    if db_inspiration is None:
        raise HTTPException(status_code=404, detail="Inspiration not found")
    return

class TagsUpdate(BaseModel):
    tags: str

@app.patch("/inspiration/{inspiration_id}/tags", response_model=schemas.Inspiration)
async def update_inspiration_tags(
    inspiration_id: int,
    tags_update: TagsUpdate,
    current_user: models.User = Depends(auth.get_current_active_user),
    db: AsyncSession = Depends(auth.get_db)
):
    updated_inspiration = await crud.update_inspiration_tags(
        db=db,
        inspiration_id=inspiration_id,
        tags=tags_update.tags,
        user_id=current_user.id
    )
    if updated_inspiration is None:
        raise HTTPException(status_code=404, detail="Inspiration not found")
    return updated_inspiration

@app.post("/tone-adjust", response_model=schemas.ToneAdjustResponse)
async def adjust_tone(
    request: schemas.ToneAdjustRequest,
    current_user: models.User = Depends(auth.get_current_active_user),
    db: AsyncSession = Depends(auth.get_db)
):
    inspirations = []
    if request.inspiration_ids:
        inspirations = await crud.get_inspirations_by_ids(
            db, inspiration_ids=request.inspiration_ids, user_id=current_user.id
        )

    try:
        suggestions = await adjust_tone_with_ai(
            text=request.text,
            adjective=request.adjective,
            inspirations=inspirations
        )
        return {"suggestions": suggestions}
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"Unhandled error in adjust_tone: {e}")
        raise HTTPException(status_code=500, detail="Failed to get AI suggestions.")

@app.post("/analyze-post", response_model=schemas.PostAnalysisResponse)
async def analyze_post(
    request: schemas.PostAnalysisRequest,
    current_user: models.User = Depends(auth.get_current_active_user)
):
    try:
        analysis_result = await analyze_post_with_ai(
            post_text=request.post_text,
            platform=request.platform,
            hashtags=request.hashtags,
            mentions=request.mentions
        )
        return analysis_result
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"Unhandled error in analyze_post: {e}")
        raise HTTPException(status_code=500, detail="Failed to analyze post.")

@app.post("/improve-post", response_model=schemas.ImprovePostResponse)
async def improve_post(
    request: schemas.ImprovePostRequest,
    current_user: models.User = Depends(auth.get_current_active_user),
    db: AsyncSession = Depends(auth.get_db)
):
    try:
        improvement_result = await improve_post_with_ai(
            post_text=request.post_text
        )
        return improvement_result
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"Unhandled error in improve_post: {e}")
        raise HTTPException(status_code=500, detail="Failed to get improvement suggestions.")

@app.post("/caption/generate", response_model=schemas.CaptionResponse)
async def get_image_captions(
    image: UploadFile = File(...),
    platform: str = Form(...),
    keywords: Optional[str] = Form(None),
    current_user: models.User = Depends(auth.get_current_active_user)
):
    if not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Uploaded file is not an image.")

    try:
        image_bytes = await image.read()
        captions = await generate_image_caption(
            image_bytes=image_bytes,
            platform=platform,
            keywords=keywords
        )
        return {"captions": captions}
    except ConnectionError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        print(f"Unhandled error in get_image_captions: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate image captions.")