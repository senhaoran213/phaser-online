export type RuntimeConfig = {
  wsUrl?: string;
};

declare global {
  interface Window {
    __PIXEL_LEARN_TOWN_CONFIG__?: RuntimeConfig;
  }
}

export async function loadRuntimeConfig() {
  try {
    const response = await fetch("./config.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    window.__PIXEL_LEARN_TOWN_CONFIG__ = (await response.json()) as RuntimeConfig;
  } catch (err) {
    console.warn("runtime config load failed, using defaults", err);
  }
}

export function getRuntimeConfig() {
  return window.__PIXEL_LEARN_TOWN_CONFIG__ ?? {};
}
