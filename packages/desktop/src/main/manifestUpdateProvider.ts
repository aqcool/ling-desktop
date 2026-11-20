import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { pipeline } from "node:stream/promises";
import { net } from "electron";
import type { CustomPublishOptions, PackageFileInfo } from "builder-util-runtime";
import {
  DEFAULT_ZCODE_ENDPOINT_ORIGIN,
  normalizeZCodeEndpointOrigin,
  toBearerAuthorization,
  type ElectronReleaseChannel,
} from "@zcode/shared";
import {
  Provider,
  AppImageUpdater,
  DebUpdater,
  RpmUpdater,
  PacmanUpdater,
  type AppUpdater,
  type ResolvedUpdateFileInfo,
  type UpdateFileInfo,
  type UpdateInfo,
} from "electron-updater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import { parse as parseYaml } from "yaml";
import semver from "semver";

export const ELECTRON_MANIFEST_API_PATH = "/api/v1/releases/electron/manifest";

const MANIFEST_ACCEPT_HEADER = "application/x-yaml,text/yaml,text/plain,*/*";
const LING_RELEASES_API = "https://api.github.com/repos/aqcool/ling-desktop/releases";
const LING_RELEASE_DOWNLOADS = "https://github.com/aqcool/ling-desktop/releases/download/";
const LING_RELEASE_LIST_URL = `${LING_RELEASES_API}?per_page=100`;
const LING_RELEASE_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "LING-Desktop",
};

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  name?: string | null;
  body?: string | null;
  assets: Array<{ name: string; size?: number }>;
}

function getLingReleaseCandidates(raw: unknown, currentVersion: string) {
  if (!Array.isArray(raw)) throw new Error("Invalid LING GitHub release list");
  const releases = raw as GitHubRelease[];
  return releases
    .flatMap((release) => {
      const tag = release?.tag_name;
      if (typeof tag !== "string" || !tag.startsWith("ling-v") || release.draft !== false)
        return [];
      const version = tag.slice("ling-v".length);
      if (
        semver.valid(version) !== version ||
        !semver.gt(version, currentVersion) ||
        !Array.isArray(release.assets)
      )
        return [];
      return [{ release, version }];
    })
    .sort((left, right) => semver.rcompare(left.version, right.version));
}

type LingInstaller = { version: string; name: string; size: number; url: URL };

async function fetchLingReleaseFile(url: string | URL, headers?: Record<string, string>) {
  const response = await net.fetch(url.toString(), {
    credentials: "omit",
    headers,
    signal: AbortSignal.timeout(headers ? 30_000 : 60 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error(`GitHub HTTP ${response.status}`);
  return response;
}

export async function findLingInstaller(
  currentVersion: string,
  channel: ElectronReleaseChannel,
): Promise<LingInstaller | null> {
  const platform =
    process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : process.platform;
  const target = `${platform}-${process.arch}`;
  const extensions =
    platform === "mac"
      ? [".dmg"]
      : platform === "win"
        ? [".exe"]
        : platform === "linux"
          ? process.env.APPIMAGE
            ? [".AppImage"]
            : [".deb", ".AppImage"]
          : [];
  if (!extensions.length) return null;

  const response = await fetchLingReleaseFile(LING_RELEASE_LIST_URL, LING_RELEASE_HEADERS);
  for (const { release, version } of getLingReleaseCandidates(
    await response.json(),
    currentVersion,
  )) {
    // 手动分发的正式版本号在 GitHub 标为预发布，预览开关按版本号后缀判断。
    if (channel === "stable" && semver.prerelease(version)) continue;
    if (!release.assets.some((asset) => asset?.name === "SHA256SUMS")) continue;
    for (const extension of extensions) {
      const name = `LING-${version}-${target}${extension}`;
      const asset = release.assets.find((entry) => entry?.name === name);
      const size = asset?.size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) continue;
      const base = new URL(`${release.tag_name}/`, LING_RELEASE_DOWNLOADS);
      return { version, name, size, url: new URL(name, base) };
    }
  }
  return null;
}

export async function downloadLingInstaller(
  installer: LingInstaller,
  directory: string,
  onProgress: (receivedBytes: number) => void,
): Promise<string> {
  const { name, size, url } = installer;
  const sumsResponse = await fetchLingReleaseFile(new URL("SHA256SUMS", url), {
    Accept: "text/plain",
  });
  const expectedHash = (await sumsResponse.text())
    .split(/\r?\n/)
    .map((line) => line.match(/^([a-f\d]{64})\s+(.+)$/i))
    .find((match) => match?.[2] === name)?.[1]
    ?.toLowerCase();
  if (!expectedHash) throw new Error("Missing installer checksum");

  await mkdir(directory, { recursive: true });
  const destination = join(directory, name);
  const cached = await stat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (cached?.isFile() && cached.size === size) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(destination)) hash.update(chunk);
    if (hash.digest("hex") === expectedHash) return destination;
  }

  const staging = await mkdtemp(join(directory, ".ling-"));
  const temporary = join(staging, name);
  try {
    const response = await fetchLingReleaseFile(url);
    const hash = createHash("sha256");
    let receivedBytes = 0;
    await pipeline(
      response.body!,
      async function* (source: AsyncIterable<Uint8Array>) {
        for await (const chunk of source) {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > size) throw new Error("Invalid installer size");
          hash.update(chunk);
          onProgress(receivedBytes);
          yield chunk;
        }
      },
      createWriteStream(temporary, { mode: name.endsWith(".AppImage") ? 0o700 : 0o600 }),
    );
    // 下载中断或内容不匹配时只清理临时文件，系统始终打开完整校验后的安装包。
    if (receivedBytes !== size || hash.digest("hex") !== expectedHash) {
      throw new Error("Installer verification failed");
    }
    await rename(temporary, destination);
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

type LingGitHubUpdateOptions = CustomPublishOptions & {
  resolveReleaseChannel: () => Promise<ElectronReleaseChannel>;
};

export class LingGitHubUpdateProvider extends Provider<UpdateInfo> {
  private readonly target: string;
  private readonly extensions: readonly string[];

  constructor(
    private readonly options: LingGitHubUpdateOptions,
    private readonly updater: AppUpdater,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    const platform = runtimeOptions.platform;
    this.target = `${platform === "darwin" ? "mac" : platform === "win32" ? "win" : platform}-${process.arch}`;
    this.extensions =
      platform === "darwin"
        ? [".zip"]
        : platform === "win32"
          ? [".exe"]
          : (getLinuxUpdateExtensions(updater) ?? []);
  }

  override get isUseMultipleRangeRequest(): boolean {
    return false;
  }

  override setRequestHeaders(): void {
    // GitHub 发布不按设备分批，不发送 electron-updater 的 staging 用户标识。
  }

  override async getLatestVersion(): Promise<UpdateInfo> {
    const channel = await this.options.resolveReleaseChannel();
    const currentVersion = this.updater.currentVersion.version;
    const noUpdate = {
      version: currentVersion,
      files: [],
      path: "",
      sha512: "",
      releaseDate: "",
      zcodeReleaseChannel: channel,
    };
    if (!this.extensions.length) return noUpdate;

    const manifestName = `ling-update-${this.target}.json`;
    const raw = await this.httpRequest(new URL(LING_RELEASE_LIST_URL), LING_RELEASE_HEADERS);
    const candidates = getLingReleaseCandidates(JSON.parse(raw ?? "null"), currentVersion);
    const selected = candidates.find(
      ({ release, version }) =>
        !(channel === "stable" && (release.prerelease || semver.prerelease(version))) &&
        release.assets.some((asset) => asset?.name === manifestName) &&
        this.extensions.some((ext) =>
          release.assets.some(
            (asset) =>
              asset?.name?.toLowerCase() === `LING-${version}-${this.target}`.toLowerCase() + ext,
          ),
        ),
    );
    if (!selected) return noUpdate;

    const baseUrl = new URL(`${selected.release.tag_name}/`, LING_RELEASE_DOWNLOADS);
    const manifest = await this.httpRequest(new URL(manifestName, baseUrl), {
      Accept: "application/json",
    });
    const update = JSON.parse(manifest ?? "null") as UpdateInfo | null;
    if (
      update?.version !== selected.version ||
      !Array.isArray(update.files) ||
      !update.files.length ||
      update.files.some(
        (file) =>
          !file ||
          ![".zip", ".exe", ".AppImage", ".deb"].some(
            (ext) => file.url === `LING-${selected.version}-${this.target}${ext}`,
          ) ||
          !selected.release.assets.some((asset) => asset.name === file.url) ||
          typeof file.sha512 !== "string" ||
          !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) ||
          !Number.isSafeInteger(file.size) ||
          (file.size ?? 0) <= 0,
      )
    ) {
      throw new Error(`Invalid LING update manifest for ${this.target} ${selected.version}`);
    }
    const files = update.files.filter(({ url }) =>
      this.extensions.some((ext) => url.toLowerCase().endsWith(ext)),
    );
    const installer = files[0];
    if (!installer) throw new Error(`LING update has no installer for ${this.target}`);
    const info = {
      version: selected.version,
      files,
      path: installer.url,
      sha512: installer.sha512,
      releaseDate: selected.release.published_at,
      minimumSystemVersion: update.minimumSystemVersion,
      releaseName: selected.release.name,
      releaseNotes: selected.release.body,
      zcodeReleaseChannel: channel,
    };
    return info;
  }

  override resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    const baseUrl = new URL(`ling-v${updateInfo.version}/`, LING_RELEASE_DOWNLOADS);
    return resolveManifestFiles(updateInfo, baseUrl, null);
  }
}

export interface ManifestUpdateProviderOptions extends CustomPublishOptions {
  endpointOrigin?: string;
  manifestUrl?: string;
  deviceMid?: string;
  releasePlatform?: string;
  releaseChannel?: ElectronReleaseChannel;
  resolveEndpointOrigin?: () => string | Promise<string>;
  resolveReleaseChannel?: () => ElectronReleaseChannel | Promise<ElectronReleaseChannel>;
  resolveZcodeJwtToken?: () => Promise<string | null | undefined>;
}

function normalizeReleaseChannel(channel: string | null | undefined): ElectronReleaseChannel {
  return channel === "preview" ? "preview" : "stable";
}

function mapReleaseChannelToApiValue(channel: ElectronReleaseChannel): string {
  return channel === "preview" ? "3" : "1";
}

function mapElectronReleaseArch(arch: string): string {
  switch (arch) {
    case "arm64":
      return "aarch64";
    case "x64":
      return "x86_64";
    case "ia32":
      return "x86";
    default:
      return arch;
  }
}

function mapElectronReleasePlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    default:
      return platform;
  }
}

export function getElectronReleasePlatform(
  platform: NodeJS.Platform = process.platform,
  arch = process.env["TEST_UPDATER_ARCH"] || process.arch,
): string {
  return `${mapElectronReleasePlatform(platform)}-${mapElectronReleaseArch(arch)}`;
}

export function buildElectronManifestUrl(options: {
  endpointOrigin: string;
  manifestUrl?: string;
  platform: string;
  deviceMid?: string;
  channel: ElectronReleaseChannel;
}): URL {
  const url = options.manifestUrl?.trim()
    ? new URL(options.manifestUrl.trim())
    : new URL(ELECTRON_MANIFEST_API_PATH, normalizeZCodeEndpointOrigin(options.endpointOrigin));
  url.searchParams.set("platform", options.platform);
  if (options.deviceMid?.trim()) {
    url.searchParams.set("device_mid", options.deviceMid.trim());
  }
  url.searchParams.set("channel", mapReleaseChannelToApiValue(options.channel));
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readManifestFileList(updateInfo: UpdateInfo): UpdateFileInfo[] {
  if (Array.isArray(updateInfo.files) && updateInfo.files.length > 0) {
    return updateInfo.files;
  }

  const legacyInfo = updateInfo as UpdateInfo & {
    path?: unknown;
    sha2?: unknown;
    sha512?: unknown;
  };
  if (typeof legacyInfo.path === "string") {
    return [
      {
        url: legacyInfo.path,
        ...(typeof legacyInfo.sha2 === "string" ? { sha2: legacyInfo.sha2 } : {}),
        ...(typeof legacyInfo.sha512 === "string" ? { sha512: legacyInfo.sha512 } : {}),
      } as UpdateFileInfo,
    ];
  }

  throw new Error("Manifest update info does not contain files or path");
}

function resolveManifestUrl(pathname: string, baseUrl: URL): URL {
  return new URL(pathname, baseUrl);
}

function getLinuxUpdateExtensions(updater: AppUpdater): readonly string[] | null {
  // Linux 的实际更新器由安装包类型决定，不能把 deb/rpm/pacman 统一当作
  // 不支持更新的产物删除；复用已有 updater 实例，避免再次读取安装类型产生分歧。
  if (updater instanceof AppImageUpdater) return [".appimage"];
  if (updater instanceof DebUpdater) return [".deb"];
  if (updater instanceof RpmUpdater) return [".rpm"];
  if (updater instanceof PacmanUpdater) return [".pkg.tar.zst", ".pacman"];
  return null;
}

function resolveManifestFiles(
  updateInfo: UpdateInfo,
  baseUrl: URL,
  linuxExtensions: readonly string[] | null,
): ResolvedUpdateFileInfo[] {
  const updateFiles = readManifestFileList(updateInfo).filter((file) => {
    const pathname = resolveManifestUrl(file.url, baseUrl).pathname.toLowerCase();
    return !linuxExtensions || linuxExtensions.some((extension) => pathname.endsWith(extension));
  });
  // 缺少当前格式时，上游 findFile 会回退其他包或返回 undefined，
  // 随后报非法缓存路径/TypeError；在解析边界失败，禁止跨安装格式更新。
  if (updateFiles.length === 0) {
    throw new Error(`Manifest contains no update file for ${linuxExtensions?.join(" / ")}`);
  }
  const resolved: ResolvedUpdateFileInfo[] = updateFiles.map((fileInfo) => {
    if (!fileInfo.sha512 && !("sha2" in fileInfo && fileInfo.sha2)) {
      throw new Error(`Manifest file is missing checksum: ${fileInfo.url}`);
    }

    const url = resolveManifestUrl(fileInfo.url, baseUrl);
    // PacmanUpdater 仍用 .pacman 后缀识别缓存名，.pkg.tar.zst 会退回
    // info.url；只给缓存提供文件名，避免完整 URL 被拼进 pending/temp-https:/...。
    const info = linuxExtensions?.includes(".pkg.tar.zst")
      ? { ...fileInfo, url: posix.basename(decodeURIComponent(url.pathname)) }
      : fileInfo;
    return {
      url,
      info,
    } satisfies ResolvedUpdateFileInfo;
  });

  const packages = isRecord((updateInfo as { packages?: unknown }).packages)
    ? ((updateInfo as { packages?: Record<string, PackageFileInfo> }).packages ?? null)
    : null;
  const packageInfo = packages?.[process.arch] ?? packages?.ia32;
  if (packageInfo && resolved[0]) {
    resolved[0].packageInfo = {
      ...packageInfo,
      path: resolveManifestUrl(packageInfo.path, baseUrl).href,
    };
  }

  return resolved;
}

export class ManifestUpdateProvider extends Provider<UpdateInfo> {
  private readonly options: ManifestUpdateProviderOptions;
  private readonly releasePlatform: string;
  private readonly linuxExtensions: readonly string[] | null;
  private readonly logger: AppUpdater["logger"];
  private resolveBaseUrl = new URL(DEFAULT_ZCODE_ENDPOINT_ORIGIN);

  constructor(
    options: ManifestUpdateProviderOptions,
    updater: AppUpdater,
    runtimeOptions: ProviderRuntimeOptions,
  ) {
    super(runtimeOptions);
    this.options = options;
    this.logger = updater.logger;
    this.linuxExtensions = getLinuxUpdateExtensions(updater);
    this.releasePlatform = options.releasePlatform?.trim() || getElectronReleasePlatform();
    this.resolveBaseUrl = new URL(
      normalizeZCodeEndpointOrigin(options.endpointOrigin ?? DEFAULT_ZCODE_ENDPOINT_ORIGIN),
    );
  }

  override get isUseMultipleRangeRequest(): boolean {
    return false;
  }

  override async getLatestVersion(): Promise<UpdateInfo> {
    const endpointOrigin = await this.resolveEndpointOrigin();
    const releaseChannel = await this.resolveReleaseChannel();
    const manifestUrl = buildElectronManifestUrl({
      endpointOrigin,
      manifestUrl: this.options.manifestUrl,
      platform: this.releasePlatform,
      deviceMid: this.options.deviceMid,
      channel: releaseChannel,
    });
    this.resolveBaseUrl = new URL("/", manifestUrl);
    const releaseChannelApiValue = mapReleaseChannelToApiValue(releaseChannel);
    // 更新器独立于业务 API 客户端，原先漏传登录凭据；每次读取当前 Token，避免换号或退出后复用旧值。
    // 只加到本次 manifest 请求，不设 updater 全局请求头，以免把登录凭据带到 CDN 下载。
    let authorization: string | null = null;
    try {
      authorization = toBearerAuthorization(await this.options.resolveZcodeJwtToken?.());
    } catch {
      // 登录凭据是可选信息；读取失败不能阻断更新恢复通道，也不能把异常中的凭据写入日志。
      this.logger?.warn(
        "[auto-update] credential read failed; checking manifest without authorization",
      );
    }

    const raw = await this.httpRequest(manifestUrl, {
      accept: MANIFEST_ACCEPT_HEADER,
      "X-Platform": this.releasePlatform,
      "X-Release-Channel": releaseChannelApiValue,
      ...(authorization ? { Authorization: authorization } : {}),
      ...(this.options.deviceMid?.trim() ? { "X-Device-Mid": this.options.deviceMid.trim() } : {}),
    });
    if (!raw) {
      throw new Error(`Empty electron update manifest: ${manifestUrl.toString()}`);
    }

    const parsed = parseYaml(raw);
    if (!isRecord(parsed) || typeof parsed.version !== "string") {
      throw new Error(`Invalid electron update manifest: ${manifestUrl.toString()}`);
    }

    return {
      ...(parsed as unknown as UpdateInfo),
      // Bugfix: preview/stable 切换时旧 manifest 请求可能晚于新请求返回。
      // electron-updater 的 update-available 事件默认不带请求通道，main 进程无法识别过期结果；
      // 这里把本次请求通道随 UpdateInfo 带回去，避免旧通道覆盖更新弹窗内容。
      zcodeReleaseChannel: releaseChannel,
    } as UpdateInfo;
  }

  override resolveFiles(updateInfo: UpdateInfo): ResolvedUpdateFileInfo[] {
    return resolveManifestFiles(updateInfo, this.resolveBaseUrl, this.linuxExtensions);
  }

  private async resolveEndpointOrigin(): Promise<string> {
    const resolved =
      (await this.options.resolveEndpointOrigin?.()) ??
      this.options.endpointOrigin ??
      DEFAULT_ZCODE_ENDPOINT_ORIGIN;
    return normalizeZCodeEndpointOrigin(resolved);
  }

  private async resolveReleaseChannel(): Promise<ElectronReleaseChannel> {
    const resolved =
      (await this.options.resolveReleaseChannel?.()) ?? this.options.releaseChannel ?? "stable";
    return normalizeReleaseChannel(resolved);
  }
}
