from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import timedelta

from nlp.analysis import analyze_text
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
        request.tone_preference,
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