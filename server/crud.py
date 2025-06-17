from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

import models, schemas, auth

async def get_user(db: AsyncSession, user_id: int):
    result = await db.execute(select(models.User).filter(models.User.id == user_id))
    return result.scalars().first()

async def get_user_by_email(db: AsyncSession, email: str):
    result = await db.execute(select(models.User).filter(models.User.email == email))
    return result.scalars().first()

async def create_user(db: AsyncSession, user: schemas.UserCreate):
    hashed_password = auth.get_password_hash(user.password)
    db_user = models.User(email=user.email, hashed_password=hashed_password)
    db.add(db_user)
    await db.commit()
    await db.refresh(db_user)
    return db_user

async def get_user_dictionary(db: AsyncSession, user_id: int):
    result = await db.execute(
        select(models.UserWord).filter(models.UserWord.user_id == user_id)
    )
    return result.scalars().all()

async def add_word_to_dictionary(db: AsyncSession, user_id: int, word: str):
    db_word = models.UserWord(word=word, user_id=user_id)
    db.add(db_word)
    await db.commit()
    await db.refresh(db_word)
    return db_word

async def get_word_in_dictionary(db: AsyncSession, user_id: int, word: str):
    result = await db.execute(
        select(models.UserWord).filter(models.UserWord.user_id == user_id, models.UserWord.word == word)
    )
    return result.scalars().first() 