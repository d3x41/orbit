import { Emulator, Simulator, AppleDevice } from 'eas-shared';
import { parseRuntimeUrl } from 'snack-content';

type launchExpoGoURLAsyncOptions = {
  platform: 'android' | 'ios';
  deviceId: string;
  sdkVersion?: string;
};

export async function launchExpoGoURLAsync(
  url: string,
  { platform, deviceId, sdkVersion }: launchExpoGoURLAsyncOptions
) {
  const version = sdkVersion ?? (await getSDKVersionForSnackUrl(url));

  if (platform === 'android') {
    await launchExpoGoURLOnAndroidAsync(url, deviceId, version);
  } else {
    await launchExpoGoURLOnIOSAsync(url, deviceId, version);
  }
}

async function launchExpoGoURLOnAndroidAsync(url: string, deviceId: string, version?: string) {
  const device = await Emulator.getRunningDeviceAsync(deviceId);

  await Emulator.ensureExpoClientInstalledAsync(device.pid, version);
  await Emulator.openURLAsync({ url: url, pid: device.pid });
}

async function launchExpoGoURLOnIOSAsync(url: string, deviceId: string, version?: string) {
  if (await Simulator.isSimulatorAsync(deviceId)) {
    await Simulator.ensureExpoClientInstalledAsync(deviceId, version);
    await Simulator.openURLAsync({
      url: url,
      udid: deviceId,
    });
    return;
  }

  await AppleDevice.ensureExpoClientInstalledAsync(deviceId);
  await AppleDevice.openExpoGoURLAsync(deviceId, url);
}

/** Get SDK version from an EAS Update, or classic updates Snack URL */
function getSDKVersionForSnackUrl(snackURL: string) {
  const snack = parseRuntimeUrl(snackURL);
  if (snack?.sdkVersion) {
    return snack.sdkVersion;
  }

  return getSDKVersionForLegacySnackUrl(snackURL);
}

/** Get SDK version from a classic updates Snack url */
async function getSDKVersionForLegacySnackUrl(snackURL: string): Promise<string | undefined> {
  // Attempts to extract sdk version from url. Match "sdk.", followed by one or more digits and dots, before a hyphen
  // e.g. exp://exp.host/@snack/sdk.48.0.0-ChmcDz6VUr
  const versionRegex = /sdk\.([\d.]+)(?=-)/;
  const match = snackURL.match(versionRegex);
  if (match?.[1]) {
    return match[1];
  }

  // For snacks saved to accounts the ID can be `@snack/<hashId>` or `@<username>/<hashId>`.
  const snackIdentifierRegex = /(@[^\/]+\/[^\/+]+)/;
  const snackIdentifier = snackURL.match(snackIdentifierRegex)?.[0];
  if (!snackIdentifier) {
    return;
  }

  const snackId = snackIdentifier.startsWith('@snack/')
    ? snackIdentifier.substring('@snack/'.length)
    : snackIdentifier;

  // Get the SDK version for a specific snack from the Snack API.
  try {
    const response = await fetch(`https://exp.host/--/api/v2/snack/${snackId}`, {
      method: 'GET',
      headers: {
        'Snack-Api-Version': '3.0.0',
      },
    });
    const { sdkVersion }: { sdkVersion: string } = await response.json();

    return sdkVersion;
  } catch (err) {
    console.error(`Failed fetch snack with identifier: ${snackId}`, err);
    throw err;
  }
}
