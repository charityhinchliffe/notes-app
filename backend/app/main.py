from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware

from app.database import (
    IncorrectPassword,
    MissingNote,
    MissingTags,
    attach_tags,
    change_password,
    create_note,
    create_tag,
    delete_note,
    delete_tag,
    detach_tag,
    get_note,
    init_db,
    is_locked,
    list_notes,
    list_tags,
    lock_notes,
    update_note,
    unlock_with_password,
)
from app.schemas import (
    AttachTags,
    NoteCreate,
    NoteOut,
    NoteUpdate,
    LockStatus,
    PasswordChange,
    PasswordChangeResult,
    PasswordCheck,
    PasswordCheckResult,
    TagCreate,
    TagOut,
)


def require_unlocked() -> None:
    if is_locked():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Notes are locked",
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Notes API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def note_or_404(note_id: str) -> dict:
    note = get_note(note_id)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return note


@app.get("/settings/lock", response_model=LockStatus)
def read_lock():
    return {"locked": is_locked()}


@app.post("/settings/lock", response_model=LockStatus)
def engage_lock():
    lock_notes()
    return {"locked": True}


@app.post("/settings/password/verify", response_model=PasswordCheckResult)
def check_password(payload: PasswordCheck):
    return {"valid": unlock_with_password(payload.password)}


@app.put("/settings/password", response_model=PasswordChangeResult)
def replace_password(payload: PasswordChange):
    try:
        change_password(payload.current_password, payload.new_password)
    except IncorrectPassword as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect",
        ) from error
    return {"updated": True}


@app.get("/tags", response_model=list[TagOut])
def read_tags():
    require_unlocked()
    return list_tags()


@app.post("/tags", response_model=TagOut)
def add_tag(payload: TagCreate, response: Response):
    require_unlocked()
    tag = create_tag(payload.name)
    response.status_code = (
        status.HTTP_201_CREATED if tag.pop("created") else status.HTTP_200_OK
    )
    return tag


@app.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_tag(tag_id: str):
    require_unlocked()
    if not delete_tag(tag_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")


@app.get("/notes", response_model=list[NoteOut])
def read_notes():
    require_unlocked()
    return list_notes()


@app.post("/notes", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def add_note(payload: NoteCreate):
    require_unlocked()
    try:
        return create_note(payload.title, payload.content, payload.tag_ids)
    except MissingTags as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown tags: {error}",
        ) from error


@app.get("/notes/{note_id}", response_model=NoteOut)
def read_note(note_id: str):
    require_unlocked()
    return note_or_404(note_id)


@app.patch("/notes/{note_id}", response_model=NoteOut)
def edit_note(note_id: str, payload: NoteUpdate):
    require_unlocked()
    note = update_note(note_id, payload.title, payload.content)
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    return note


@app.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_note(note_id: str):
    require_unlocked()
    if not delete_note(note_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")


@app.post("/notes/{note_id}/tags", response_model=NoteOut)
def add_note_tags(note_id: str, payload: AttachTags):
    require_unlocked()
    try:
        return attach_tags(note_id, payload.tag_ids)
    except MissingNote as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Note not found"
        ) from error
    except MissingTags as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown tags: {error}",
        ) from error


@app.delete("/notes/{note_id}/tags/{tag_id}", response_model=NoteOut)
def remove_note_tag(note_id: str, tag_id: str):
    require_unlocked()
    try:
        return detach_tag(note_id, tag_id)
    except MissingNote as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Note not found"
        ) from error
    except MissingTags as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found"
        ) from error
