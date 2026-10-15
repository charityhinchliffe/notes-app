export type ApiTag = {
  id: string;
  name: string;
  created_at: string;
};

export type ApiNote = {
  id: string;
  title: string;
  content: string;
  tags: ApiTag[];
  created_at: string;
  updated_at: string;
};

const API_BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        detail = body.detail
          .map((item) => {
            if (item && typeof item === "object" && "msg" in item) {
              return String(item.msg);
            }
            return String(item);
          })
          .join(" ");
      }
    } catch {
      detail = response.statusText;
    }
    throw new Error(detail || "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function listNotes() {
  return request<ApiNote[]>("/notes");
}

export function createNote(input: {
  title: string;
  content: string;
  tag_ids: string[];
}) {
  return request<ApiNote>("/notes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateNote(
  id: string,
  input: { title?: string; content?: string },
) {
  return request<ApiNote>(`/notes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteNote(id: string) {
  return request<void>(`/notes/${id}`, { method: "DELETE" });
}

export function listTags() {
  return request<ApiTag[]>("/tags");
}

export function createTag(name: string) {
  return request<ApiTag>("/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteTag(id: string) {
  return request<void>(`/tags/${id}`, { method: "DELETE" });
}

export function attachTags(noteId: string, tagIds: string[]) {
  return request<ApiNote>(`/notes/${noteId}/tags`, {
    method: "POST",
    body: JSON.stringify({ tag_ids: tagIds }),
  });
}

export function detachTag(noteId: string, tagId: string) {
  return request<ApiNote>(`/notes/${noteId}/tags/${tagId}`, {
    method: "DELETE",
  });
}

export function getLockStatus() {
  return request<{ locked: boolean }>("/settings/lock");
}

export function lockApp() {
  return request<{ locked: boolean }>("/settings/lock", { method: "POST" });
}

export function verifyPassword(password: string) {
  return request<{ valid: boolean }>("/settings/password/verify", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ updated: boolean }>("/settings/password", {
    method: "PUT",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}
