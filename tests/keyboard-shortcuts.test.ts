import test from "node:test";
import assert from "node:assert/strict";
import {
  SHORTCUT_DEFINITIONS,
  SHORTCUT_CATEGORIES,
  normalizeKeyCombo,
  eventToKeyCombo,
  isEditableElement,
} from "../lib/shortcuts/shortcut-definitions";

test("shortcut definitions are correctly configured and unique", () => {
  const ids = new Set<string>();
  const categories = new Set(SHORTCUT_CATEGORIES.map((c) => c.id));

  for (const shortcut of SHORTCUT_DEFINITIONS) {
    assert.ok(shortcut.id, "Shortcut must have an id");
    assert.ok(!ids.has(shortcut.id), `Duplicate shortcut id: ${shortcut.id}`);
    ids.add(shortcut.id);

    assert.ok(shortcut.label, `Shortcut ${shortcut.id} must have a label`);
    assert.ok(shortcut.description, `Shortcut ${shortcut.id} must have a description`);
    assert.ok(categories.has(shortcut.category), `Shortcut ${shortcut.id} has invalid category ${shortcut.category}`);
    assert.ok(shortcut.keys.length > 0, `Shortcut ${shortcut.id} must have at least one key combo`);
    assert.ok(shortcut.displayKey, `Shortcut ${shortcut.id} must have a displayKey`);
  }

  // Key shortcuts must exist
  assert.ok(ids.has("global.commandPalette"), "Must contain global.commandPalette");
  assert.ok(ids.has("global.cheatsheet"), "Must contain global.cheatsheet");
  assert.ok(ids.has("global.toggleSidebar"), "Must contain global.toggleSidebar");
  assert.ok(ids.has("nav.flow"), "Must contain nav.flow");
  assert.ok(ids.has("nav.supervision"), "Must contain nav.supervision");
  assert.ok(ids.has("nav.cortex"), "Must contain nav.cortex");
  assert.ok(ids.has("nav.video"), "Must contain nav.video");
  assert.ok(ids.has("nav.settings"), "Must contain nav.settings");
  assert.ok(ids.has("chat.newChat"), "Must contain chat.newChat");
  assert.ok(ids.has("chat.focusPrompt"), "Must contain chat.focusPrompt");
  assert.ok(ids.has("video.playPause"), "Must contain video.playPause");
});

test("normalizeKeyCombo standardizes various modifier representations", () => {
  assert.equal(normalizeKeyCombo("Ctrl+K"), "ctrl+k");
  assert.equal(normalizeKeyCombo("CONTROL+k"), "ctrl+k");
  assert.equal(normalizeKeyCombo("meta+K"), "meta+k");
  assert.equal(normalizeKeyCombo("cmd+k"), "meta+k");
  assert.equal(normalizeKeyCombo("Alt+1"), "alt+1");
  assert.equal(normalizeKeyCombo("opt+1"), "alt+1");
  assert.equal(normalizeKeyCombo("Shift+Ctrl+K"), "ctrl+shift+k");
  assert.equal(normalizeKeyCombo("Escape"), "escape");
  assert.equal(normalizeKeyCombo("space"), "space");
  assert.equal(normalizeKeyCombo("?"), "?");
});

test("eventToKeyCombo parses synthetic KeyboardEvents accurately", () => {
  const ctrlKEvent = {
    key: "k",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  } as unknown as KeyboardEvent;
  assert.equal(eventToKeyCombo(ctrlKEvent), "ctrl+k");

  const cmdKEvent = {
    key: "k",
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
  } as unknown as KeyboardEvent;
  assert.equal(eventToKeyCombo(cmdKEvent), "meta+k");

  const alt1Event = {
    key: "1",
    ctrlKey: false,
    metaKey: false,
    altKey: true,
    shiftKey: false,
  } as unknown as KeyboardEvent;
  assert.equal(eventToKeyCombo(alt1Event), "alt+1");

  const questionEvent = {
    key: "?",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: true,
  } as unknown as KeyboardEvent;
  assert.equal(eventToKeyCombo(questionEvent), "?");

  const spaceEvent = {
    key: " ",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  } as unknown as KeyboardEvent;
  assert.equal(eventToKeyCombo(spaceEvent), "space");
});

test("isEditableElement detects text input elements vs non-input elements", () => {
  // Mock element structure
  const inputEl = {
    tagName: "INPUT",
    type: "text",
    isContentEditable: false,
    getAttribute: () => null,
  };
  Object.setPrototypeOf(inputEl, HTMLElement.prototype);
  assert.equal(isEditableElement(inputEl as unknown as EventTarget), true);

  const textareaEl = {
    tagName: "TEXTAREA",
    isContentEditable: false,
    getAttribute: () => null,
  };
  Object.setPrototypeOf(textareaEl, HTMLElement.prototype);
  assert.equal(isEditableElement(textareaEl as unknown as EventTarget), true);

  const checkboxEl = {
    tagName: "INPUT",
    type: "checkbox",
    isContentEditable: false,
    getAttribute: () => null,
  };
  Object.setPrototypeOf(checkboxEl, HTMLElement.prototype);
  assert.equal(isEditableElement(checkboxEl as unknown as EventTarget), false);

  const buttonEl = {
    tagName: "BUTTON",
    isContentEditable: false,
    getAttribute: () => null,
  };
  Object.setPrototypeOf(buttonEl, HTMLElement.prototype);
  assert.equal(isEditableElement(buttonEl as unknown as EventTarget), false);

  const contentEditableDiv = {
    tagName: "DIV",
    isContentEditable: true,
    getAttribute: () => "true",
  };
  Object.setPrototypeOf(contentEditableDiv, HTMLElement.prototype);
  assert.equal(isEditableElement(contentEditableDiv as unknown as EventTarget), true);
});
