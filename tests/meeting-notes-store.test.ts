import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MeetingNotesStore } from "../lib/meeting-notes/meeting-notes-store.ts";
import { summarizeMeeting } from "../lib/meeting-notes/meeting-digest.ts";

async function removeTestRoot(root: string): Promise<void> {
  assert.equal(path.dirname(root), os.tmpdir());
  assert.ok(path.basename(root).startsWith("kaoz-meeting-notes-"));
  await rm(root, { recursive: true, force: true });
}

test("meeting segments survive reload, stay ordered and ignore duplicate chunk IDs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-meeting-notes-"));
  try {
    const store = new MeetingNotesStore(root);
    const created = await store.create("Planejamento");
    const lateId = randomUUID();
    const earlyId = randomUUID();
    await store.addSegment(created.id, { chunkId: lateId, startMs: 8000, endMs: 12000, text: "Vamos fazer a página nova." });
    await store.addSegment(created.id, { chunkId: earlyId, startMs: 0, endMs: 4000, text: "Decidimos começar na segunda." });
    await store.addSegment(created.id, { chunkId: lateId, startMs: 8000, endMs: 12000, text: "Texto duplicado" });

    const reopened = await new MeetingNotesStore(root).get(created.id);
    assert.ok(reopened);
    assert.deepEqual(reopened.segments.map((item) => item.chunkId), [earlyId, lateId]);
    assert.equal(reopened.segments.length, 2);
    assert.equal(reopened.segments[1].text, "Vamos fazer a página nova.");
    const digest = summarizeMeeting(reopened);
    assert.deepEqual(digest.decisions.map((item) => item.segmentId), [reopened.segments[0].id]);
    assert.deepEqual(digest.actions.map((item) => item.segmentId), [reopened.segments[1].id]);
    assert.equal("owner" in digest.actions[0], false);
    assert.equal("deadline" in digest.actions[0], false);
  } finally {
    await removeTestRoot(root);
  }
});

test("failed audio remains recoverable until its transcription is stored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-meeting-notes-"));
  try {
    const store = new MeetingNotesStore(root);
    const created = await store.create();
    const chunkId = randomUUID();
    await store.saveAudio(created.id, {
      chunkId, startMs: 0, endMs: 2000, mimeType: "audio/webm", data: new Uint8Array([1, 2, 3]),
    });
    await store.saveAudio(created.id, {
      chunkId, startMs: 0, endMs: 2000, mimeType: "audio/webm", data: new Uint8Array([9]),
    });
    await store.markAudioError(created.id, chunkId, "Modelo indisponível");
    const recovered = await new MeetingNotesStore(root).pendingAudio(created.id, chunkId);
    assert.ok(recovered);
    assert.equal(recovered.audio.size, 3);
    assert.equal((await store.get(created.id))?.pendingChunks[0].error, "Modelo indisponível");

    await store.addSegment(created.id, { chunkId, startMs: 0, endMs: 2000, text: "A reunião começou." });
    await store.removeAudio(created.id, chunkId);
    assert.equal((await store.get(created.id))?.pendingChunks.length, 0);
    assert.equal(await store.pendingAudio(created.id, chunkId), null);
  } finally {
    await removeTestRoot(root);
  }
});

test("notes and transcript edits persist, while a finished meeting cannot restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kaoz-meeting-notes-"));
  try {
    const store = new MeetingNotesStore(root);
    const created = await store.create("Rascunho");
    const chunkId = randomUUID();
    const recorded = await store.addSegment(created.id, { chunkId, startMs: 500, endMs: 1200, text: "Texto errado" });
    assert.ok(recorded);
    const segmentId = recorded.segments[0].id;
    await store.update(created.id, { title: "Revisão", notes: "Anotação editada", segment: { id: segmentId, text: "Texto corrigido", tag: "decision" } });
    await store.update(created.id, { status: "stopped" });
    const reopened = await new MeetingNotesStore(root).get(created.id);
    assert.equal(reopened?.title, "Revisão");
    assert.equal(reopened?.notes, "Anotação editada");
    assert.equal(reopened?.segments[0].text, "Texto corrigido");
    assert.equal(summarizeMeeting(reopened!).decisions[0].segmentId, segmentId);
    await assert.rejects(store.update(created.id, { status: "recording" }), /encerrada/i);
    await assert.rejects(store.addSegment(created.id, { chunkId: randomUUID(), startMs: 2000, endMs: 3000, text: "Depois" }), /encerrada/i);
  } finally {
    await removeTestRoot(root);
  }
});
