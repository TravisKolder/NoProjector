"use client";

// Each phone gets a random id + secret, kept only on that device.
// The secret is what lets this device (and no other) accept a handoff.

type Device = { clientId: string; secret: string };

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing: fall back to memory for this page load.
  }
}

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

let memoryDevice: Device | null = null;

function randomHex(bytes: number) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getDevice(): Device {
  const raw = safeGet("np_device");
  if (raw) {
    try {
      return JSON.parse(raw) as Device;
    } catch {}
  }
  if (memoryDevice) return memoryDevice;
  const device = { clientId: crypto.randomUUID(), secret: randomHex(24) };
  memoryDevice = device;
  safeSet("np_device", JSON.stringify(device));
  return device;
}

export const getName = () => safeGet("np_name") ?? "";
export const setName = (name: string) => safeSet("np_name", name.trim());

export const getPresenterToken = (code: string) => safeGet(`np_token_${code.toUpperCase()}`);
export const setPresenterToken = (code: string, token: string) => safeSet(`np_token_${code.toUpperCase()}`, token);
export const clearPresenterToken = (code: string) => safeRemove(`np_token_${code.toUpperCase()}`);

export const getPref = (key: string) => safeGet(`np_pref_${key}`);
export const setPref = (key: string, value: string) => safeSet(`np_pref_${key}`, value);
