# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Identity & Privilege Isolation**: No user can register or update themselves with `role: "admin"`, nor create an `/admins/{uid}` document unless they are already a verified admin or the bootstrapped owner (`danielbiranu.23@gmail.com` with `email_verified == true`).
2. **Ownership & Query Isolation**: Every subcollection under `/users/{uid}` (`progress`, `highlights`, `chats`, `messages`) must carry `userId == request.auth.uid == uid` and be unreadable/unwritable by other non-admin users, enforced both at `get`/`write` and `list` (`resource.data.userId == request.auth.uid`).
3. **Curriculum & Settings Governance**: `/appSettings/{settingId}` and `/studyDocuments/{docId}` are immutable to standard students (`role: "user"`). Students may read active lessons (`resource.data.active == true`) only when signed in with verified email.
4. **Master Gate Relational Integrity**: Messages under `/users/{uid}/chats/{threadId}/messages/{messageId}` require the parent `/users/{uid}/chats/{threadId}` document to exist (`exists(...)`) and belong to `request.auth.uid`.
5. **Immutable Audit Fields & Bounded Payloads**: `createdAt`, `uid`, and `userId` cannot change on update, and every string field has strict `.size()` bounds.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return `PERMISSION_DENIED`)
1. **Self-Admin Registration**: `create /users/attacker` with `{ uid: "attacker", role: "admin", ... }` -> Denied (`data.role == 'user'` required unless `isAdmin()`).
2. **Role Escalation Update**: `update /users/attacker` with `affectedKeys` containing `['role']` -> Denied (`affectedKeys().hasOnly(['displayName', 'username', 'updatedAt'])`).
3. **Ghost Shadow Field Injection**: `create /users/attacker/highlights/JHN:3:16` with extra field `{ ..., isOfficial: true }` -> Denied (`keys().hasOnly(...)`).
4. **Email Spoofing (Unverified Email)**: Request with `token.email == "danielbiranu.23@gmail.com"` and `token.email_verified == false` -> Denied (`isVerified()` requires `email_verified == true`).
5. **Cross-User PII Read**: Non-admin signed-in user calling `get /users/other_uid` -> Denied (`isOwner(uid) || isAdmin()`).
6. **Cross-User Highlight List Scraping**: Non-admin querying `/users/other_uid/highlights` -> Denied (`allow list: if isOwner(uid) && resource.data.userId == request.auth.uid`).
7. **ID Poisoning Attack**: `create /users/u1/chats/<2KB_junk_id>` -> Denied (`isValidId(threadId)` requires `<= 128` chars matching `^[a-zA-Z0-9_\-]+$`).
8. **Value Poisoning (Oversized String)**: `create /users/u1/highlights/JHN:1:1` with `omText` > 4000 chars or invalid `color: "purple"` -> Denied.
9. **Student Modifying Curriculum**: Non-admin calling `update /studyDocuments/doc1` -> Denied (`allow write: if isAdmin()`).
10. **Student Modifying Global Settings**: Non-admin calling `update /appSettings/global` -> Denied (`allow write: if isAdmin()`).
11. **Orphaned Message Creation**: `create /users/u1/chats/nonexistent/messages/m1` -> Denied (`exists(/databases/.../chats/$(threadId))`).
12. **Immutable `createdAt` Tampering**: `update /users/u1/chats/c1` changing `createdAt` -> Denied (`incoming().createdAt == existing().createdAt`).
