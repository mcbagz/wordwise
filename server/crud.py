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

# Inspiration CRUD
async def create_inspiration(db: AsyncSession, inspiration: schemas.InspirationCreate, user_id: int):
    db_inspiration = models.Inspiration(**inspiration.model_dump(), user_id=user_id)
    db.add(db_inspiration)
    await db.commit()
    await db.refresh(db_inspiration)
    return db_inspiration

async def get_inspirations(db: AsyncSession, user_id: int, skip: int = 0, limit: int = 100):
    result = await db.execute(
        select(models.Inspiration)
        .filter(models.Inspiration.user_id == user_id)
        .offset(skip)
        .order_by(models.Inspiration.id.desc())
        .limit(limit)
    )
    return result.scalars().all()

async def get_inspiration(db: AsyncSession, inspiration_id: int, user_id: int):
    result = await db.execute(
        select(models.Inspiration).filter(models.Inspiration.id == inspiration_id, models.Inspiration.user_id == user_id)
    )
    return result.scalars().first()

async def delete_inspiration(db: AsyncSession, inspiration_id: int, user_id: int):
    db_inspiration = await get_inspiration(db, inspiration_id=inspiration_id, user_id=user_id)
    if db_inspiration:
        await db.delete(db_inspiration)
        await db.commit()
        return db_inspiration
    return None

async def update_inspiration_tags(db: AsyncSession, inspiration_id: int, tags: str, user_id: int):
    db_inspiration = await get_inspiration(db, inspiration_id=inspiration_id, user_id=user_id)
    if db_inspiration:
        db_inspiration.tags = tags
        await db.commit()
        await db.refresh(db_inspiration)
        return db_inspiration
    return None

async def get_inspirations_by_ids(db: AsyncSession, inspiration_ids: list[int], user_id: int):
    if not inspiration_ids:
        return []
    result = await db.execute(
        select(models.Inspiration)
        .filter(models.Inspiration.id.in_(inspiration_ids), models.Inspiration.user_id == user_id)
    )
    return result.scalars().all() 