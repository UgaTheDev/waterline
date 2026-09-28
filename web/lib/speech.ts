"use client";
import { useSyncExternalStore } from "react";

// Browser speech engines only. One utterance at a time: a new one cancels the last, never overlaps it.
let current: SpeechSynthesisUtterance | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

// es-US when Spanish is selected, for both synthesis and recognition.
export const speechLang = (lang: "en" | "es") => (lang === "es" ? "es-US" : "en-US");

export function speak(text: string, lang: "en" | "es" = "en") {
  if (!canSpeak() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speechLang(lang);
  u.onend = u.onerror = () => {
    if (current !== u) return; // the cancel() above ends the previous utterance; ignore it
    current = null;
    emit();
  };
  current = u;
  speechSynthesis.speak(u);
  emit();
}

export function stopSpeaking() {
  current = null;
  if (canSpeak()) speechSynthesis.cancel();
  emit();
}

export const useSpeaking = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current !== null,
    () => false,
  );

// Minimal Web Speech recognition typing: not in every TS DOM lib, and Safari/Chrome only ship the webkit prefix.
type Alt = { transcript: string };
export type RecognitionEvent = { resultIndex: number; results: ArrayLike<ArrayLike<Alt> & { isFinal: boolean }> };
export type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
type Ctor = new () => Recognition;

export function recognitionCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noop = () => () => {};
export const useCanListen = () => useSyncExternalStore(noop, () => recognitionCtor() !== null, () => false);
export const useCanSpeak = () => useSyncExternalStore(noop, canSpeak, () => false);
