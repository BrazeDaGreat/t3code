export const NATIVE_SIDEBAR_ARGUMENT = "--t3-native-sidebar";

/** Native backdrops keep the window resizable without using a layered transparent window. */
export function getNativeSidebarOptions(platform: NodeJS.Platform, osRelease: string) {
  if (platform === "darwin") {
    return { vibrancy: "sidebar", visualEffectState: "followWindow" } as const;
  }

  if (platform === "win32") {
    const [major, , build] = osRelease.split(".").map(Number);
    // Electron's system backdrop requires Windows 11 22H2 (build 22621).
    if (
      major !== undefined &&
      (major > 10 || (major === 10 && build !== undefined && build >= 22621))
    ) {
      return { backgroundMaterial: "acrylic" } as const;
    }
  }

  return null;
}
