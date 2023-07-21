import spawnAsync, { SpawnResult } from "@expo/spawn-async";
import * as osascript from "@expo/osascript";
import assert from "assert";
import chalk from "chalk";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import semver from "semver";

import * as Versions from "../../versions";
import Log from "../../log";
import { promptAsync } from "../../prompts";
import {
  AndroidDevice,
  adbAsync,
  getFirstRunningEmulatorAsync,
  isEmulatorBootedAsync,
  waitForEmulatorToBeBootedAsync,
} from "./adb";
import { getAndroidSdkRootAsync } from "./sdk";
import { downloadApkAsync } from "../../downloadApkAsync";

const BEGINNING_OF_ADB_ERROR_MESSAGE = "error: ";
const INSTALL_WARNING_TIMEOUT = 60 * 1000;
const EXPO_GO_BUNDLE_IDENTIFIER = "host.exp.exponent";
export const EMULATOR_MAX_WAIT_TIMEOUT_MS = 60 * 1000 * 3;
export { AndroidDevice, getRunningDevicesAsync } from "./adb";
export { getAptParametersAsync } from "./aapt";

export async function getEmulatorExecutableAsync(): Promise<string> {
  const sdkRoot = await getAndroidSdkRootAsync();
  if (sdkRoot) {
    return path.join(sdkRoot, "emulator", "emulator");
  }

  return "emulator";
}

async function emulatorAsync(...options: string[]): Promise<SpawnResult> {
  const emulatorExecutable = await getEmulatorExecutableAsync();
  try {
    return await spawnAsync(emulatorExecutable, options);
  } catch (error: any) {
    if (error.stderr) {
      Log.error(error.stderr);
    }
    throw error;
  }
}

export async function getAvailableAndroidEmulatorsAsync(): Promise<
  AndroidDevice[]
> {
  try {
    const { stdout } = await emulatorAsync("-list-avds");

    return stdout
      .split(os.EOL)
      .filter(Boolean)
      .map((name) => ({
        name,
        osType: "android",
        deviceType: "emulator",
      }));
  } catch {
    return [];
  }
}

/** Start an Android device and wait until it is booted. */
export async function bootEmulatorAsync(
  emulator: AndroidDevice,
  {
    timeout = EMULATOR_MAX_WAIT_TIMEOUT_MS,
    interval = 1000,
    noAudio = false,
  }: {
    /** Time in milliseconds to wait before asserting a timeout error. */
    timeout?: number;
    interval?: number;
    noAudio?: boolean;
  } = {}
): Promise<AndroidDevice> {
  Log.newLine();
  Log.log(`Opening emulator ${chalk.bold(emulator.name)}`);

  const emulatorExecutable = await getEmulatorExecutableAsync();
  const spawnArgs = [`@${emulator.name}`];
  if (noAudio) {
    spawnArgs.push("-no-audio");
  }

  // Start a process to open an emulator
  const emulatorProcess = spawnAsync(emulatorExecutable, spawnArgs, {
    stdio: "ignore",
    detached: true,
  });

  // we don't want to wait for the emulator process to exit before we can finish `eas build:run` command
  // https://github.com/expo/eas-cli/pull/1485#discussion_r1007935871
  emulatorProcess.child.unref();

  return await waitForEmulatorToBeBootedAsync(timeout, interval);
}

export async function selectEmulatorAsync(): Promise<AndroidDevice> {
  const runningEmulator = await getFirstRunningEmulatorAsync();

  if (runningEmulator) {
    Log.newLine();
    Log.log(`Using open emulator: ${chalk.bold(runningEmulator.name)}`);

    return runningEmulator;
  }

  const emulators = await getAvailableAndroidEmulatorsAsync();

  Log.newLine();
  const { selectedEmulator } = await promptAsync({
    type: "select",
    message: `Select an emulator to run your app on`,
    name: "selectedEmulator",
    choices: emulators.map((emulator) => ({
      title: emulator.name,
      value: emulator,
    })),
  });

  return selectedEmulator;
}

export async function ensureEmulatorBootedAsync(
  emulator: AndroidDevice
): Promise<AndroidDevice> {
  if (!emulator.pid || !(await isEmulatorBootedAsync(emulator.pid))) {
    return await bootEmulatorAsync(emulator);
  }

  return emulator;
}

export async function installAppAsync(
  emulator: AndroidDevice,
  apkFilePath: string
): Promise<void> {
  Log.newLine();
  Log.log("Installing your app...");

  assert(emulator.pid);
  await adbAsync("-s", emulator.pid, "install", "-r", "-d", apkFilePath);

  Log.succeed("Successfully installed your app!");
}

export async function startAppAsync(
  emulator: AndroidDevice,
  packageName: string,
  activityName: string
): Promise<void> {
  Log.newLine();
  Log.log("Starting your app...");

  assert(emulator.pid);
  await adbAsync(
    "-s",
    emulator.pid,
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.MAIN",
    "-f",
    "0x20000000", // FLAG_ACTIVITY_SINGLE_TOP -- If set, the activity will not be launched if it is already running at the top of the history stack.
    "-n",
    `${packageName}/${activityName}`
  );

  Log.succeed("Successfully started your app!");
}

// Expo installed
async function isExpoClientInstalledOnEmulatorAsync(
  pid: string
): Promise<boolean> {
  const packages = await adbAsync(
    "-s",
    pid,
    "shell",
    "pm",
    "list",
    "packages",
    EXPO_GO_BUNDLE_IDENTIFIER
  );

  const lines = packages.stdout.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === `package:${EXPO_GO_BUNDLE_IDENTIFIER}`) {
      return true;
    }
  }
  return false;
}

export async function getAdbOutputAsync(args: string[]): Promise<string> {
  try {
    const result = await adbAsync(...args);
    return result.output.join("\n");
  } catch (e: any) {
    // User pressed ctrl+c to cancel the process...
    if (e.signal === "SIGINT") {
      e.isAbortError = true;
    }
    // TODO: Support heap corruption for adb 29 (process exits with code -1073740940) (windows and linux)
    let errorMessage = (e.stderr || e.stdout || e.message).trim();
    if (errorMessage.startsWith(BEGINNING_OF_ADB_ERROR_MESSAGE)) {
      errorMessage = errorMessage.substring(
        BEGINNING_OF_ADB_ERROR_MESSAGE.length
      );
    }
    e.message = errorMessage;
    throw e;
  }
}

export async function openURLAsync({ pid, url }: { pid: string; url: string }) {
  // await activateEmulatorWindowAsync({ pid });

  try {
    // NOTE(brentvatne): temporary workaround! launch Expo Go first, then
    // launch the project!
    // https://github.com/expo/expo/issues/7772
    // adb shell monkey -p host.exp.exponent -c android.intent.category.LAUNCHER 1
    // Note: this is not needed in Expo Development Client, it only applies to Expo Go
    await adbAsync(
      "-s",
      pid,
      "shell",
      "monkey",
      "-p",
      EXPO_GO_BUNDLE_IDENTIFIER,
      "-c",
      "android.intent.category.LAUNCHER",
      "1"
    );

    const openProject = await adbAsync(
      "-s",
      pid,
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      url
    );
    return openProject;
  } catch (error: any) {
    throw error;
  }
}

function getUnixPID(port: number | string) {
  return execFileSync("lsof", [`-i:${port}`, "-P", "-t", "-sTCP:LISTEN"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  })
    .split("\n")[0]
    .trim();
}

export async function activateEmulatorWindowAsync(
  device: Pick<AndroidDevice, "deviceType" | "pid">
) {
  if (
    // only mac is supported for now.
    process.platform !== "darwin" ||
    // can only focus emulators
    device.deviceType !== "emulator"
  ) {
    return;
  }

  // Google Emulator ID: `emulator-5554` -> `5554`
  const androidPid = device.pid!.match(/-(\d+)/)?.[1];
  if (!androidPid) {
    return;
  }
  // Unix PID
  const pid = getUnixPID(androidPid);

  try {
    await osascript.execAsync(`
  tell application "System Events"
    set frontmost of the first process whose unix id is ${pid} to true
  end tell`);
  } catch {
    // noop -- this feature is very specific and subject to failure.
  }
}

async function getClientForSDK(sdkVersionString?: string) {
  if (!sdkVersionString) {
    return null;
  }

  const sdkVersion = (await Versions.sdkVersionsAsync())[sdkVersionString];
  if (!sdkVersion) {
    return null;
  }

  return {
    url: sdkVersion.androidClientUrl,
    version: sdkVersion.androidClientVersion,
  };
}

async function expoVersionOnEmulatorAsync(pid: string): Promise<string | null> {
  const info = await adbAsync(
    "-s",
    pid,
    "shell",
    "dumpsys",
    "package",
    EXPO_GO_BUNDLE_IDENTIFIER
  );

  const regex = /versionName=([0-9.]+)/;
  const regexMatch = regex.exec(info.stdout);
  if (!regexMatch || regexMatch.length < 2) {
    return null;
  }

  return regexMatch[1];
}

async function doesExpoClientNeedUpdatedAsync(
  pid: string,
  sdkVersion?: string
): Promise<boolean> {
  const versions = await Versions.versionsAsync();
  const clientForSdk = await getClientForSDK(sdkVersion);
  const latestVersionForSdk =
    clientForSdk?.version ?? versions.androidClientVersion;

  const installedVersion = await expoVersionOnEmulatorAsync(pid);
  if (installedVersion && semver.lt(installedVersion, latestVersionForSdk)) {
    return true;
  }
  return false;
}

export async function installExpoOnEmulatorAsync({
  pid,
  url,
  version,
}: {
  pid: string;
  url: string;
  version?: string;
}) {
  let warningTimer: NodeJS.Timeout;
  const setWarningTimer = () => {
    if (warningTimer) {
      clearTimeout(warningTimer);
    }
    return setTimeout(() => {
      console.log(
        "This download is taking longer than expected. You can also try downloading the clients from the website at https://expo.dev/tools"
      );
    }, INSTALL_WARNING_TIMEOUT);
  };

  console.log("Downloading the Expo Go app");
  warningTimer = setWarningTimer();

  const path = await downloadApkAsync(url, (progress) => {
    console.log(`Downloading: ${progress.toFixed(2)}%`);
  });

  console.log(
    version
      ? `Installing Expo Go ${version} on ${pid}`
      : `Installing Expo Go on ${pid}`
  );
  warningTimer = setWarningTimer();

  const result = await installAppAsync({ pid } as AndroidDevice, path);

  clearTimeout(warningTimer);
  return result;
}

export async function ensureExpoClientInstalledAsync(
  pid: string,
  sdkVersion?: string
) {
  let isInstalled = await isExpoClientInstalledOnEmulatorAsync(pid);
  if (isInstalled && (await doesExpoClientNeedUpdatedAsync(pid, sdkVersion))) {
    isInstalled = false;
  }

  if (!isInstalled) {
    const androidClient = await getClientForSDK(sdkVersion);
    const versions = await Versions.versionsAsync();
    const url = androidClient?.url ?? versions.androidUrl;
    if (!url) {
      throw new Error();
    }

    await installExpoOnEmulatorAsync({
      pid,
      url,
      version: androidClient?.version,
    });
  }
}
