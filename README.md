# 📝 Notes

A small notes app for writing, tagging, and locking notes. The interface is a Next.js app, and notes are stored by a FastAPI service in a local SQLite database.

## ✨ Features

- 🗒️ Create, edit, and delete notes, with edits saved automatically
- 🏷️ Organize notes with tags, including an untagged filter
- 🔀 Sort by recent, oldest, title, or tag
- 🔒 Lock the app with a password, and lock it again after a minute of inactivity
- 🔑 Change the lock password from the app

## 🧰 Stack

| Layer | Tools |
| --- | --- |
| 🖥️ Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| ⚙️ Backend | Python, FastAPI, Uvicorn |
| 💾 Data | SQLite (`backend/notes.db`) |

The frontend calls `/api`, and Next.js rewrites those requests to the API at `http://127.0.0.1:8000`.

## 📁 Project structure

```text
notes-app/
├── frontend/          # Next.js app
│   └── src/
│       ├── app/       # App route
│       ├── components/
│       └── lib/       # API client and note state
└── backend/
    ├── app/           # FastAPI routes, schemas, and database
    └── requirements.txt
```

## 🚀 Getting started

You need **Node.js 20+** and **Python 3.11+**. Run the API first, then the frontend. Use two terminals.

### 🐍 Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API listens on [http://127.0.0.1:8000](http://127.0.0.1:8000). Interactive docs are at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

On Windows, activate the virtual environment with `.venv\Scripts\activate`.

### 🌐 Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

| Script | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Build for production |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |

## 🔐 Lock

The database is created on first launch with the password `password123`. Notes stay hidden until that password is entered. After one minute without pointer, keyboard, or scroll activity, the app locks itself.

Change the password from the lock settings in the app. The new password is stored in `backend/notes.db`.

## 🔌 API

All note and tag routes require the app to be unlocked. A locked app responds with `401`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/notes` | List notes |
| `POST` | `/notes` | Create a note |
| `GET` | `/notes/{id}` | Read one note |
| `PATCH` | `/notes/{id}` | Update a title or body |
| `DELETE` | `/notes/{id}` | Delete a note |
| `POST` | `/notes/{id}/tags` | Attach tags |
| `DELETE` | `/notes/{id}/tags/{tag_id}` | Remove a tag from a note |
| `GET` | `/tags` | List tags |
| `POST` | `/tags` | Create a tag |
| `DELETE` | `/tags/{id}` | Delete a tag |
| `GET` | `/settings/lock` | Read lock status |
| `POST` | `/settings/lock` | Lock the notes |
| `POST` | `/settings/password/verify` | Unlock with a password |
| `PUT` | `/settings/password` | Change the password |

A note needs a title or body. Titles are limited to 300 characters and bodies to 50,000. Tag names are limited to 24 characters.
